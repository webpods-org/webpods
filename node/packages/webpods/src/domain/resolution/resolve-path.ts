/**
 * Path resolution for WebPods URLs
 * Determines if a path points to a stream or a record within a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { createLogger } from "../../logger.js";
import { createContext, from } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:resolution");
const dbContext = createContext<DatabaseSchema>();

export interface PathResolution {
  streamId: number; // The resolved stream ID
  streamPath: string; // The stream path
  recordName?: string; // Optional record name if path points to a record
  isStream: boolean; // True if path points to a stream, false if to a record
}

/**
 * Resolve a path to determine if it's a stream or a record
 *
 * Resolution strategy:
 * 1. If using index query (?i=), entire path is a stream
 * 2. For multi-segment paths, check if full path is a stream first
 * 3. If not a stream, treat last segment as record name
 *
 * @param ctx Database context
 * @param podName Pod name
 * @param path Path to resolve (e.g., "a/b/c/d")
 * @param hasIndexQuery Whether the request has an index query parameter
 * @returns Resolution result with stream ID and optional record name
 */
export async function resolvePath(
  ctx: DataContext,
  podName: string,
  path: string,
  hasIndexQuery: boolean = false,
): Promise<Result<PathResolution>> {
  try {
    // Normalize path (remove leading slash if present)
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;

    if (!normalizedPath) {
      return failure(createError("INVALID_PATH", "Empty path"));
    }

    logger.debug("Resolving path", {
      podName,
      path: normalizedPath,
      hasIndexQuery,
    });

    // If using index query, entire path must be a stream
    if (hasIndexQuery) {
      // Direct lookup using path column - O(1)
      const streams = await executeSelect(
        ctx.db,
        (p: { podName: string; path: string }) =>
          from(dbContext, "stream")
            .where((s) => s.pod_name === p.podName && s.path === p.path)
            .select((s) => s),
        { podName, path: normalizedPath },
      );

      const stream = streams[0] || null;

      if (!stream) {
        return failure(
          createError("STREAM_NOT_FOUND", `Stream not found: ${path}`),
        );
      }

      return success({
        streamId: stream.id,
        streamPath: normalizedPath,
        isStream: true,
      });
    }

    // Try full path as stream first - O(1) lookup
    const streamResults = await executeSelect(
      ctx.db,
      (p: { podName: string; path: string }) =>
        from(dbContext, "stream")
          .where((s) => s.pod_name === p.podName && s.path === p.path)
          .select((s) => s),
      { podName, path: normalizedPath },
    );

    const stream = streamResults[0] || null;

    if (stream) {
      // Full path is a stream
      return success({
        streamId: stream.id,
        streamPath: normalizedPath,
        isStream: true,
      });
    }

    // Not a stream, try as record - O(1) lookup using JOIN
    const recordResults = await executeSelect(
      ctx.db,
      (p: { podName: string; path: string }) =>
        from(dbContext, "record")
          .join(
            from(dbContext, "stream"),
            (r) => r.stream_id,
            (s) => s.id,
            (r, s) => ({ r, s }),
          )
          .where((row) => row.s.pod_name === p.podName && row.r.path === p.path)
          .take(1)
          .select((row) => ({
            stream_id: row.r.stream_id,
            name: row.r.name,
            stream_path: row.s.path,
          })),
      { podName, path: normalizedPath },
    );

    const record = recordResults[0] || null;

    if (record) {
      // Found as record
      return success({
        streamId: record.stream_id,
        streamPath: record.stream_path,
        recordName: record.name,
        isStream: false,
      });
    }

    // Neither stream nor record found
    return failure(createError("NOT_FOUND", `Path not found: ${path}`));
  } catch (error: unknown) {
    logger.error("Failed to resolve path", { error, podName, path });
    return failure(createError("RESOLUTION_ERROR", "Failed to resolve path"));
  }
}

/**
 * Resolve a path for write operations
 * For writes, the last segment is always treated as the record name
 *
 * @param ctx Database context
 * @param podName Pod name
 * @param path Path to resolve (e.g., "a/b/c/d")
 * @returns Resolution result with stream ID and record name
 */
export async function resolvePathForWrite(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<PathResolution & { recordName: string }>> {
  try {
    // Normalize path
    const normalizedPath = path.startsWith("/") ? path.substring(1) : path;
    const pathParts = normalizedPath.split("/").filter(Boolean);

    if (pathParts.length === 0) {
      return failure(createError("INVALID_PATH", "Empty path"));
    }

    logger.debug("Resolving path for write", { podName, path: normalizedPath });

    // Last part is always the record name for writes
    const recordName = pathParts.pop()!;
    const streamPath = pathParts.length > 0 ? pathParts.join("/") : "/";

    // Special case for root stream
    if (streamPath === "/") {
      // Check if a root stream exists
      const rootStreams = await executeSelect(
        ctx.db,
        (p: { podName: string; path: string }) =>
          from(dbContext, "stream")
            .where((s) => s.pod_name === p.podName && s.path === p.path)
            .select((s) => s),
        { podName, path: "/" },
      );

      const rootStream = rootStreams[0] || null;

      if (!rootStream) {
        // Root stream doesn't exist - need to create it
        return failure(
          createError("STREAM_NOT_FOUND", "Root stream not found"),
        );
      }

      return success({
        streamId: rootStream.id,
        streamPath: "/",
        recordName,
        isStream: false,
      });
    }

    // Direct lookup for stream - O(1)
    const streamLookupResults = await executeSelect(
      ctx.db,
      (p: { podName: string; path: string }) =>
        from(dbContext, "stream")
          .where((s) => s.pod_name === p.podName && s.path === p.path)
          .select((s) => s),
      { podName, path: streamPath },
    );

    const stream = streamLookupResults[0] || null;

    if (!stream) {
      // Stream doesn't exist - this is okay for writes as we might create it
      return failure(
        createError("STREAM_NOT_FOUND", `Stream not found: ${streamPath}`),
      );
    }

    return success({
      streamId: stream.id,
      streamPath,
      recordName,
      isStream: false,
    });
  } catch (error: unknown) {
    logger.error("Failed to resolve path for write", { error, podName, path });
    return failure(createError("RESOLUTION_ERROR", "Failed to resolve path"));
  }
}
