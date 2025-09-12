/**
 * Main GET handler for content retrieval
 */

import {
  Response,
  NextFunction,
  AuthRequest,
  readMiddleware,
  parseIndexQuery,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { getConfig } from "../../config-loader.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import { getStreamById } from "../../domain/streams/get-stream-by-id.js";
import { listChildStreams } from "../../domain/streams/list-child-streams.js";
import { getStreamPath } from "../../domain/streams/get-stream-by-path.js";
import { resolvePath } from "../../domain/resolution/resolve-path.js";
import { getRecord } from "../../domain/records/get-record.js";
import { getRecordRange } from "../../domain/records/get-record-range.js";
import { listRecords } from "../../domain/records/list-records.js";
import { listUniqueRecords } from "../../domain/records/list-unique-records.js";
import { listRecordsRecursive } from "../../domain/records/list-records-recursive.js";
import { listUniqueRecordsRecursive } from "../../domain/records/list-unique-records-recursive.js";
import { recordToResponse } from "../../domain/records/record-to-response.js";
import { hasTombstone } from "../../domain/records/check-tombstone.js";
import { canRead } from "../../domain/permissions/can-read.js";
import type { StreamRecord, StreamInfo } from "../../types.js";

/**
 * Main content retrieval handler
 * GET {pod}.webpods.org/{stream_path} - List records
 * GET {pod}.webpods.org/{stream_path}?i=0 - Get by index
 * GET {pod}.webpods.org/{stream_path}?i=10:20 - Get range
 * GET {pod}.webpods.org/{stream_path}/{name} - Get by name
 */
export const getHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.podName) {
    return next();
  }

  if (!req.pod) {
    // On subdomains, return POD_NOT_FOUND
    // On main domain (even with rootPod), fall through to generic 404
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const config = getConfig();
    const mainDomain = config.server.public?.hostname || "localhost";
    const port = config.server.public?.port || config.server.port;

    // Check if this is the main domain (with or without port)
    const isMainDomain =
      hostname === mainDomain ||
      hostname === `${mainDomain}:${port}` ||
      (hostname === "localhost" && mainDomain === "localhost");

    if (isMainDomain) {
      // Main domain - fall through to 404 handler
      return next();
    }

    // Subdomain - pod not found
    if (!res.headersSent) {
      if (!res.headersSent) {
        res.status(404).json({
          error: {
            code: "POD_NOT_FOUND",
            message: "Pod not found",
          },
        });
      }
    }
    return;
  }

  const pathParts = req.path.substring(1).split("/"); // Remove leading /
  const db = getDb();

  // Link resolution is now handled by middleware, so we don't need to check here

  // Check for index query parameter
  const indexQuery = req.query.i as string | undefined;
  const fullPath = pathParts.join("/");

  // Use path resolution to determine if this is a stream or record
  const resolutionResult = await resolvePath(
    { db },
    req.podName,
    fullPath,
    !!indexQuery,
  );

  // Extract resolved components
  let streamId: number | undefined;
  let streamPath: string;
  let name: string | undefined;

  if (resolutionResult.success) {
    streamId = resolutionResult.data.streamId;
    streamPath = resolutionResult.data.streamPath;
    name = resolutionResult.data.recordName;
  } else {
    // Path resolution failed - handle special cases
    streamPath = fullPath;
  }

  // Get stream by ID if we have one
  const streamResult = streamId
    ? await getStreamById({ db }, streamId)
    : {
        success: false as const,
        error: !resolutionResult.success
          ? resolutionResult.error
          : { code: "STREAM_NOT_FOUND", message: "Stream not found" },
      };

  // Special handling for recursive queries - they can work even if exact stream doesn't exist
  const recursive = req.query.recursive === "true";

  if (!streamResult.success) {
    // If this is a recursive query and we're not looking for a specific record,
    // we can still search for nested streams
    if (recursive && !name && !indexQuery) {
      // Try to find nested streams even if the exact stream doesn't exist
      const config = getConfig();
      const maxLimit = config.rateLimits.maxRecordLimit;

      const defaultLimit = config.rateLimits.defaultQueryLimit ?? 100;
      let limit = parseInt(req.query.limit as string) || defaultLimit;
      if (limit > maxLimit) {
        limit = maxLimit;
      }

      const after = req.query.after
        ? parseInt(req.query.after as string)
        : undefined;
      const unique = req.query.unique === "true";

      // For recursive listing when stream doesn't exist, we still use the path-based approach
      // This is a special case that needs to search for nested streams
      const result = unique
        ? await listUniqueRecordsRecursive(
            { db },
            req.podName,
            streamPath,
            req.auth?.user_id || null,
            limit,
            after,
          )
        : await listRecordsRecursive(
            { db },
            req.podName,
            streamPath,
            req.auth?.user_id || null,
            limit,
            after,
          );

      if (!result.success) {
        if (!res.headersSent) {
          res.status(500).json({
            error: result.error,
          });
        }
        return;
      }

      const data = result.data;
      if (!res.headersSent) {
        res.json({
          records: data.records.map((r) => recordToResponse(r, streamPath)),
          streams: [], // Recursive listing doesn't include child streams separately
          total: data.total,
          hasMore: data.hasMore,
          nextIndex:
            data.hasMore && data.records.length > 0
              ? data.records[data.records.length - 1]?.index
              : null,
        });
      }
      return;
    }

    // Regular non-recursive case - stream not found
    const fullPath = req.path.substring(1);
    if (name) {
      // We were looking for a record in a stream that doesn't exist
      if (!res.headersSent) {
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message: `Not found: no stream '${fullPath}' and no stream '${streamPath}' with record '${name}'`,
          },
        });
      }
    } else {
      // We were looking for a stream
      if (!res.headersSent) {
        res.status(404).json({
          error: {
            code: "STREAM_NOT_FOUND",
            message: `Stream '${streamPath}' not found`,
          },
        });
      }
    }
    return;
  }

  // Check read permission
  const canReadResult = await canRead(
    { db },
    streamResult.data,
    req.auth?.user_id || null,
  );
  if (!canReadResult) {
    if (!res.headersSent) {
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "No read permission for this stream",
        },
      });
    }
    return;
  }

  // Handle index query parameter
  if (indexQuery) {
    const parsed = parseIndexQuery(indexQuery);
    if (!parsed) {
      if (!res.headersSent) {
        res.status(400).json({
          error: {
            code: "INVALID_INDEX",
            message: "Invalid index format. Use ?i=0, ?i=-1, or ?i=10:20",
          },
        });
      }
      return;
    }

    if (parsed.type === "single") {
      // Single record by index (don't prefer name when using ?i=)
      const result = await getRecord(
        { db },
        req.podName,
        streamResult.data.id,
        parsed.start.toString(),
        false,
      );

      if (!result.success) {
        if (!res.headersSent) {
          res.status(404).json({
            error: result.error,
          });
        }
        return;
      }

      // Check if record is deleted
      const record = result.data;
      try {
        const content =
          typeof record.content === "string" &&
          record.contentType === "application/json"
            ? JSON.parse(record.content)
            : record.content;

        if (
          typeof content === "object" &&
          content !== null &&
          content.deleted === true
        ) {
          if (!res.headersSent) {
            res.status(404).json({
              error: {
                code: "RECORD_DELETED",
                message: "Record has been deleted",
              },
            });
          }
          return;
        }
      } catch {
        // Not JSON or can't parse, continue normally
      }

      // Check if content is stored externally
      const recordRow = result.data as StreamRecord & {
        storage?: string | null;
      }; // Access the record with storage field
      if (recordRow.storage) {
        // Content is stored externally, return 302 redirect
        const adapter = getStorageAdapter();
        if (adapter) {
          const redirectUrl = adapter.getFileUrl(recordRow.storage);

          if (!res.headersSent) {
            // Set cache headers based on content hash
            res.setHeader("Cache-Control", "private, max-age=3600");
            res.setHeader("ETag", `"${record.contentHash}"`);
            res.setHeader("X-Record-Type", "file");
            res.redirect(302, redirectUrl);
          }
          return;
        }
      }

      // Return raw content for single records (not external)
      // Set headers (only if not already sent)
      if (!res.headersSent) {
        res.setHeader("X-Content-Hash", record.contentHash);
        res.setHeader("X-Hash", record.hash);
        res.setHeader("X-Previous-Hash", record.previousHash || "");
        res.setHeader("X-Author", record.userId);
        res.setHeader("X-Timestamp", record.createdAt.toISOString());

        // Add custom headers if present
        if (record.headers) {
          for (const [key, value] of Object.entries(record.headers)) {
            res.setHeader(key, value);
          }
        }
      }

      // Set content type and send response (only if not already sent)
      if (!res.headersSent) {
        res.type(record.contentType);

        // Handle different content types
        if (record.isBinary) {
          // Decode base64 for binary content
          const contentStr =
            typeof record.content === "string"
              ? record.content
              : String(record.content);
          const buffer = Buffer.from(contentStr, "base64");
          res.send(buffer);
        } else if (
          record.contentType === "application/json" &&
          typeof record.content === "string"
        ) {
          // Parse JSON content if needed
          try {
            res.send(JSON.parse(record.content));
          } catch {
            res.send(record.content);
          }
        } else {
          res.send(record.content);
        }
      }
    } else {
      // Range of records
      const result = await getRecordRange(
        { db },
        req.podName,
        streamResult.data.id,
        parsed.start,
        parsed.end!,
      );

      if (!result.success) {
        if (!res.headersSent) {
          res.status(500).json({
            error: result.error,
          });
        }
        return;
      }

      if (!res.headersSent) {
        res.json({
          records: result.data.map((r) => recordToResponse(r, streamPath)),
          range: { start: parsed.start, end: parsed.end },
          total: result.data.length,
        });
      }
    }
  } else if (name) {
    // Get by name (prefer name over index for path-based access)
    const result = await getRecord(
      { db },
      req.podName,
      streamResult.data.id,
      name,
      true,
    );

    if (!result.success) {
      res.status(404).json({
        error: result.error,
      });
      return;
    }

    // Check if there's a tombstone record for this name that's newer than the current record
    const hasTombstoneRecord = await hasTombstone(
      { db },
      streamResult.data.id,
      name,
      result.data.index,
    );

    if (hasTombstoneRecord) {
      // Found a newer tombstone, so this record is considered deleted
      if (!res.headersSent) {
        res.status(404).json({
          error: {
            code: "RECORD_DELETED",
            message: "Record has been deleted",
          },
        });
      }
      return;
    }

    // Check if record itself is a purged record
    const record = result.data;
    try {
      const content =
        typeof record.content === "string" &&
        record.contentType === "application/json"
          ? JSON.parse(record.content)
          : record.content;

      if (
        typeof content === "object" &&
        content !== null &&
        (content.deleted === true || content.purged === true)
      ) {
        res.status(404).json({
          error: {
            code: "RECORD_DELETED",
            message: "Record has been deleted",
          },
        });
        return;
      }
    } catch {
      // Not JSON or can't parse, continue normally
    }

    // Check if content is stored externally
    const recordRow = result.data as StreamRecord & { storage?: string | null };
    if (recordRow.storage) {
      // Content is stored externally, return 302 redirect
      const adapter = getStorageAdapter();
      if (adapter) {
        const redirectUrl = adapter.getFileUrl(recordRow.storage);

        if (!res.headersSent) {
          // Set cache headers based on content hash
          res.setHeader("Cache-Control", "private, max-age=3600");
          res.setHeader("ETag", `"${record.contentHash}"`);
          res.setHeader("X-Record-Type", "file");
          res.redirect(302, redirectUrl);
        }
        return;
      }
    }

    // Return raw content for single records (not external)
    // Set headers (only if not already sent)
    if (!res.headersSent) {
      res.setHeader("X-Content-Hash", record.contentHash);
      res.setHeader("X-Hash", record.hash);
      res.setHeader("X-Previous-Hash", record.previousHash || "");
      res.setHeader("X-Author", record.userId);
      res.setHeader("X-Timestamp", record.createdAt.toISOString());

      // Add custom headers if present
      if (record.headers) {
        for (const [key, value] of Object.entries(record.headers)) {
          res.setHeader(key, value);
        }
      }
    }

    // Set content type and send response (only if not already sent)
    if (!res.headersSent) {
      res.type(record.contentType);

      // Handle different content types
      if (record.isBinary) {
        // Decode base64 for binary content
        const contentStr =
          typeof record.content === "string"
            ? record.content
            : String(record.content);
        const buffer = Buffer.from(contentStr, "base64");
        res.send(buffer);
      } else if (
        record.contentType === "application/json" &&
        typeof record.content === "string"
      ) {
        // Parse JSON content if needed
        try {
          res.send(JSON.parse(record.content));
        } catch {
          res.send(record.content);
        }
      } else {
        res.send(record.content);
      }
    }
  } else {
    // List all records
    const config = getConfig();
    const maxLimit = config.rateLimits.maxRecordLimit;

    // Parse and cap the limit to maxRecordLimit
    const defaultLimit = config.rateLimits.defaultQueryLimit ?? 100;
    let limit = parseInt(req.query.limit as string) || defaultLimit;
    if (limit > maxLimit) {
      limit = maxLimit; // Silently cap to max without erroring
    }

    const after = req.query.after
      ? parseInt(req.query.after as string)
      : undefined;
    const unique = req.query.unique === "true";
    // recursive was already defined earlier

    // Use appropriate listing function based on parameters
    let result;
    if (recursive && unique) {
      // Use optimized path-based recursive unique listing
      result = await listUniqueRecordsRecursive(
        { db },
        req.podName,
        streamPath,
        req.auth?.user_id || null,
        limit,
        after,
      );
    } else if (recursive) {
      result = await listRecordsRecursive(
        { db },
        req.podName,
        streamPath,
        req.auth?.user_id || null,
        limit,
        after,
      );
    } else if (unique) {
      result = await listUniqueRecords(
        { db },
        req.podName,
        streamResult.data.id,
        limit,
        after,
      );
    } else {
      result = await listRecords(
        { db },
        req.podName,
        streamResult.data.id,
        limit,
        after,
      );
    }

    if (!result.success) {
      res.status(500).json({
        error: result.error,
      });
      return;
    }

    // All listing functions now return the same format
    const data = result.data as {
      records: StreamRecord[];
      total: number;
      hasMore: boolean;
    };

    // Get child streams for this directory
    const childStreamsResult = await listChildStreams(
      { db },
      streamId || null,
      req.podName,
    );

    // Build StreamInfo for child streams
    const childStreams: StreamInfo[] = [];
    if (childStreamsResult.success) {
      for (const childStream of childStreamsResult.data) {
        // Get the full path for each child stream
        const childPathResult = await getStreamPath({ db }, childStream.id);
        if (childPathResult.success) {
          childStreams.push({
            name: childStream.name,
            path: childPathResult.data,
            createdAt: childStream.createdAt.toISOString(),
          });
        }
      }
    }

    if (!res.headersSent) {
      res.json({
        records: data.records.map((r) => recordToResponse(r, streamPath)),
        streams: childStreams,
        total: data.total,
        hasMore: data.hasMore,
        nextIndex:
          data.hasMore && data.records.length > 0
            ? data.records[data.records.length - 1]?.index
            : null,
      });
    }
  }
};

export const getRoute = {
  path: "*", // This should match any path
  middleware: readMiddleware,
  handler: getHandler,
};
