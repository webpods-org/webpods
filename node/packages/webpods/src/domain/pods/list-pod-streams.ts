/**
 * List all streams in a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createHash } from "crypto";
import { createContext, from } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const dbContext = createContext<DatabaseSchema>();

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
    const records = await executeSelect(
      ctx.db,
      (p: { streamId: number }) =>
        from(dbContext, "record")
          .where((r) => r.stream_id === p.streamId)
          .orderBy((r) => r.index)
          .select((r) => ({
            hash: r.hash,
            previous_hash: r.previous_hash,
            index: r.index,
          })),
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

    const podResults = await executeSelect(
      ctx.db,
      (p: { pod_name: string }) =>
        from(dbContext, "pod")
          .where((pod) => pod.name === p.pod_name)
          .select((pod) => pod),
      { pod_name: podName },
    );

    const pod = podResults[0] || null;

    if (!pod) {
      return failure(createError("POD_NOT_FOUND", "Pod not found"));
    }

    // Get all streams for the pod
    const allStreams = await executeSelect(
      ctx.db,
      (p: { pod_name: string }) =>
        from(dbContext, "stream")
          .where((s) => s.pod_name === p.pod_name)
          .orderBy((s) => s.parent_id)
          .thenBy((s) => s.name)
          .select((s) => s),
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
        const countResult = await executeSelect(
          ctx.db,
          (p: { streamId: number }) =>
            from(dbContext, "record")
              .where((r) => r.stream_id === p.streamId)
              .count(),
          { streamId: stream.id },
        );
        streamInfo.recordCount = Number(countResult);

        if (streamInfo.recordCount > 0) {
          // Get last record index
          const lastRecordResults = await executeSelect(
            ctx.db,
            (p: { streamId: number }) =>
              from(dbContext, "record")
                .where((r) => r.stream_id === p.streamId)
                .orderByDescending((r) => r.index)
                .take(1)
                .select((r) => ({ index: r.index, created_at: r.created_at })),
            { streamId: stream.id },
          );

          const lastRecord = lastRecordResults[0] || null;

          if (lastRecord) {
            streamInfo.lastRecordIndex = lastRecord.index;
            streamInfo.lastRecordAt = lastRecord.created_at;
          } else {
            streamInfo.lastRecordIndex = -1;
            streamInfo.lastRecordAt = null;
          }

          // Get first record timestamp
          const firstRecordResults = await executeSelect(
            ctx.db,
            (p: { streamId: number }) =>
              from(dbContext, "record")
                .where((r) => r.stream_id === p.streamId)
                .orderBy((r) => r.index)
                .take(1)
                .select((r) => ({ created_at: r.created_at })),
            { streamId: stream.id },
          );

          const firstRecord = firstRecordResults[0] || null;

          streamInfo.firstRecordAt = firstRecord?.created_at || null;
        } else {
          streamInfo.lastRecordIndex = -1;
          streamInfo.firstRecordAt = null;
          streamInfo.lastRecordAt = null;
        }
      }

      // Add hash info if requested
      if (options.includeHashes) {
        const lastRecordResults = await executeSelect(
          ctx.db,
          (p: { streamId: number }) =>
            from(dbContext, "record")
              .where((r) => r.stream_id === p.streamId)
              .orderByDescending((r) => r.index)
              .take(1)
              .select((r) => ({ hash: r.hash })),
          { streamId: stream.id },
        );

        const lastRecord = lastRecordResults[0] || null;

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
