/**
 * List all streams in a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow, PodDbRow, RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createHash } from "crypto";

const logger = createLogger("webpods:domain:pods");

export interface StreamInfo {
  // Core identification
  path: string;
  name: string;
  id: number;

  // Hierarchy info
  parentPath: string | null;
  depth: number;
  hasChildren: boolean;
  childCount: number;

  // Creator info
  userId: string;

  // Access info
  accessPermission: string;

  // Timestamps
  createdAt: number;
  updatedAt: number;

  // Metadata
  metadata: Record<string, unknown>;

  // Optional: Record counts
  recordCount?: number;
  lastRecordIndex?: number;
  firstRecordAt?: number | null;
  lastRecordAt?: number | null;

  // Optional: Hash info
  hashChainValid?: boolean;
  lastHash?: string | null;
}

export interface ListStreamsOptions {
  path?: string;
  recursive?: boolean;
  includeRecordCounts?: boolean;
  includeHashes?: boolean;
}

/**
 * Build path map for efficient path construction
 */
function buildPathMap(
  streams: StreamDbRow[],
): Map<number, { path: string; parentId: number | null }> {
  const pathMap = new Map<number, { path: string; parentId: number | null }>();
  const idToRow = new Map<number, StreamDbRow>();

  // First pass: create id to row mapping
  for (const stream of streams) {
    idToRow.set(stream.id, stream);
  }

  // Second pass: build paths recursively
  function buildPath(streamId: number): string {
    if (pathMap.has(streamId)) {
      return pathMap.get(streamId)!.path;
    }

    const stream = idToRow.get(streamId);
    if (!stream) return "/";

    let path: string;
    if (!stream.parent_id) {
      // Root stream
      path = "/" + stream.name;
    } else {
      // Child stream
      const parentPath = buildPath(stream.parent_id);
      path =
        parentPath === "/" ? "/" + stream.name : parentPath + "/" + stream.name;
    }

    pathMap.set(streamId, { path, parentId: stream.parent_id || null });
    return path;
  }

  // Build all paths
  for (const stream of streams) {
    buildPath(stream.id);
  }

  return pathMap;
}

/**
 * Calculate stream depth based on path
 */
function calculateDepth(path: string): number {
  if (path === "/") return 0;
  return path.split("/").filter((segment) => segment !== "").length;
}

/**
 * Validate hash chain for a stream
 */
async function validateHashChain(
  ctx: DataContext,
  streamId: number,
): Promise<boolean> {
  try {
    const records = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT hash, previous_hash, index FROM record
       WHERE stream_id = $(streamId)
       ORDER BY index ASC`,
      { streamId },
    );

    for (let i = 0; i < records.length; i++) {
      const record = records[i];
      if (!record) continue;

      // First record should have no previous hash
      if (i === 0 && record.previous_hash) {
        return false;
      }

      // Subsequent records should reference previous record's hash
      if (i > 0) {
        const prevRecord = records[i - 1];
        if (!prevRecord || record.previous_hash !== prevRecord.hash) {
          return false;
        }
      }
    }

    return true;
  } catch (error) {
    logger.error("Failed to validate hash chain", { streamId, error });
    return false;
  }
}

export async function listPodStreams(
  ctx: DataContext,
  podName: string,
  options: ListStreamsOptions = {},
): Promise<Result<StreamInfo[]>> {
  try {
    // Create cache key based on pod name and options
    const cache = getCache();
    let cacheKey: string | null = null;

    // Only cache simple queries (not ones with record counts or hashes)
    if (cache && !options.includeRecordCounts && !options.includeHashes) {
      const optionsHash = createHash("sha256")
        .update(
          JSON.stringify({
            path: options.path || "",
            recursive: options.recursive || false,
          }),
        )
        .digest("hex")
        .substring(0, 8);
      cacheKey = cacheKeys.podStreams(podName, optionsHash);

      const cached = await cache.get("streams", cacheKey);
      if (cached !== undefined) {
        logger.debug("Pod streams found in cache", { podName, options });
        return success(cached as StreamInfo[]);
      }
    }

    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: podName },
    );

    if (!pod) {
      return failure(createError("POD_NOT_FOUND", "Pod not found"));
    }

    // Get all streams for the pod
    const allStreams = await ctx.db.manyOrNone<StreamDbRow>(
      `SELECT * FROM stream 
       WHERE pod_name = $(pod_name)
       ORDER BY parent_id ASC NULLS FIRST, name ASC`,
      { pod_name: pod.name },
    );

    // Build path map
    const pathMap = buildPathMap(allStreams);

    // Filter streams based on path and recursive options
    let filteredStreams = allStreams;
    let targetStreamId: number | null = null;

    if (options.path) {
      // Normalize path (ensure it starts with /)
      const normalizedPath = options.path.startsWith("/")
        ? options.path
        : "/" + options.path;

      // Find the target stream
      const targetStream = allStreams.find((s) => {
        const streamPath = pathMap.get(s.id)?.path;
        return streamPath === normalizedPath;
      });

      if (!targetStream) {
        // Return empty array if stream not found
        return success([]);
      }

      targetStreamId = targetStream.id;

      if (options.recursive) {
        // Include target and all descendants
        const descendantIds = new Set<number>();
        descendantIds.add(targetStreamId);

        // Find all descendants
        function findDescendants(parentId: number) {
          for (const stream of allStreams) {
            if (stream.parent_id === parentId) {
              descendantIds.add(stream.id);
              findDescendants(stream.id);
            }
          }
        }
        findDescendants(targetStreamId);

        filteredStreams = allStreams.filter((s) => descendantIds.has(s.id));
      } else {
        // Only include the target stream
        filteredStreams = [targetStream];
      }
    }

    // Build result with StreamInfo objects
    const result: StreamInfo[] = [];

    for (const stream of filteredStreams) {
      const pathInfo = pathMap.get(stream.id)!;
      const parentPath = stream.parent_id
        ? pathMap.get(stream.parent_id)?.path || null
        : null;

      // Count children
      const childCount = allStreams.filter(
        (s) => s.parent_id === stream.id,
      ).length;

      const streamInfo: StreamInfo = {
        // Core identification
        path: pathInfo.path,
        name: stream.name,
        id: stream.id,

        // Hierarchy info
        parentPath,
        depth: calculateDepth(pathInfo.path),
        hasChildren: childCount > 0,
        childCount,

        // Creator info
        userId: stream.user_id,

        // Access info
        accessPermission: stream.access_permission,

        // Timestamps
        createdAt: stream.created_at,
        updatedAt: stream.updated_at,

        // Metadata
        metadata: stream.metadata ? JSON.parse(stream.metadata) : {},
      };

      // Add record counts if requested
      if (options.includeRecordCounts) {
        const countResult = await ctx.db.one<{ count: string }>(
          `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId)`,
          { streamId: stream.id },
        );
        streamInfo.recordCount = parseInt(countResult.count, 10);

        if (streamInfo.recordCount > 0) {
          // Get last record index
          const lastRecord = await ctx.db.oneOrNone<{
            index: number;
            created_at: string;
          }>(
            `SELECT index, created_at FROM record
             WHERE stream_id = $(streamId)
             ORDER BY index DESC LIMIT 1`,
            { streamId: stream.id },
          );

          if (lastRecord) {
            streamInfo.lastRecordIndex = lastRecord.index;
            streamInfo.lastRecordAt = parseInt(lastRecord.created_at, 10);
          } else {
            streamInfo.lastRecordIndex = -1;
            streamInfo.lastRecordAt = null;
          }

          // Get first record timestamp
          const firstRecord = await ctx.db.oneOrNone<{ created_at: string }>(
            `SELECT created_at FROM record
             WHERE stream_id = $(streamId) 
             ORDER BY index ASC LIMIT 1`,
            { streamId: stream.id },
          );

          streamInfo.firstRecordAt = firstRecord?.created_at
            ? parseInt(firstRecord.created_at, 10)
            : null;
        } else {
          streamInfo.lastRecordIndex = -1;
          streamInfo.firstRecordAt = null;
          streamInfo.lastRecordAt = null;
        }
      }

      // Add hash info if requested
      if (options.includeHashes) {
        const lastRecord = await ctx.db.oneOrNone<{ hash: string }>(
          `SELECT hash FROM record 
           WHERE stream_id = $(streamId) 
           ORDER BY index DESC LIMIT 1`,
          { streamId: stream.id },
        );

        streamInfo.lastHash = lastRecord?.hash || null;
        streamInfo.hashChainValid = await validateHashChain(ctx, stream.id);
      }

      result.push(streamInfo);
    }

    // Sort by path
    result.sort((a, b) => a.path.localeCompare(b.path));

    // Cache the result if we generated a cache key
    if (cache && cacheKey) {
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.streams?.ttlSeconds || 300;
      await cache.set("streams", cacheKey, result, ttl);
    }

    return success(result);
  } catch (error: unknown) {
    logger.error("Failed to list pod streams", { error, podName, options });
    return failure(createError("DATABASE_ERROR", "Failed to list streams"));
  }
}
