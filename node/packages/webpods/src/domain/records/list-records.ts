/**
 * List records in a stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { getConfig } from "../../config-loader.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:records");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: DatabaseSchema["record"]): StreamRecord {
  return {
    id: row.id || 0,
    streamId: row.stream_id,
    index: row.index,
    content: row.content,
    contentType: row.content_type,
    isBinary: row.is_binary,
    size: row.size,
    name: row.name,
    path: row.path,
    contentHash: row.content_hash,
    hash: row.hash,
    previousHash: row.previous_hash || null,
    userId: row.user_id,
    storage: row.storage || null,
    headers: JSON.parse(row.headers),
    metadata: undefined,
    createdAt: row.created_at,
  };
}

export async function listRecords(
  ctx: DataContext,
  podName: string,
  streamId: number,
  limit: number = 100,
  after?: number,
  streamPath?: string,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  // Normalize stream name to ensure leading slash

  try {
    // Check cache first
    const cache = getCache();
    const config = getConfig();

    // Get stream path if not provided (needed for cache keys)
    let actualStreamPath = streamPath;
    if (!actualStreamPath) {
      const streamInfo = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.id === p.streamId)
            .select((s) => ({ path: s.path })),
        { streamId },
      );
      if (streamInfo[0]) {
        actualStreamPath = streamInfo[0].path;
      }
    }

    // Create cache key based on query parameters
    const queryParams = { limit, after: after ?? "none" };
    const cacheKey = actualStreamPath
      ? cacheKeys.recordList(podName, actualStreamPath, queryParams)
      : null;

    if (cache && config.cache?.pools?.recordLists?.enabled && cacheKey) {
      const cachedResult = await cache.get<{
        records: StreamRecord[];
        total: number;
        hasMore: boolean;
      }>("recordLists", cacheKey);
      if (cachedResult) {
        logger.debug("Record list cache hit", { streamId, limit, after });
        return success(cachedResult);
      }
      logger.debug("Record list cache miss", { streamId, limit, after });
    }

    // Cache miss - fetch from database
    // Note: We include ALL records, including deletion markers, as this is an append-only log

    // Handle negative 'after' parameter
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // Get total count to convert negative index
      const countResult = await executeSelect(
        ctx.db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .count(),
        { streamId },
      );
      const totalCount = Number(countResult);
      // after=-3 means "get the last 3 records", so we skip totalCount-3 records
      // This means we want records after index (totalCount + after - 1)
      actualAfter = totalCount + after - 1; // e.g., 5 + (-3) - 1 = 1, so index > 1 gives indices 2,3,4

      // If still negative after conversion, start from beginning
      if (actualAfter < 0) {
        actualAfter = -1; // This will get all records from start
      }
    }

    // Fetch records
    const records =
      actualAfter !== undefined
        ? await executeSelect(
            ctx.db,
            schema,
            (q, p) =>
              q
                .from("record")
                .where((r) => r.stream_id === p.streamId && r.index > p.after)
                .orderBy((r) => r.index)
                .take(p.limit)
                .select((r) => r),
            { streamId, after: actualAfter, limit: limit + 1 },
          )
        : await executeSelect(
            ctx.db,
            schema,
            (q, p) =>
              q
                .from("record")
                .where((r) => r.stream_id === p.streamId)
                .orderBy((r) => r.index)
                .take(p.limit)
                .select((r) => r),
            { streamId, limit: limit + 1 },
          );

    const countResult = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("record")
          .where((r) => r.stream_id === p.streamId)
          .count(),
      { streamId },
    );

    const total = Number(countResult);
    const hasMore = records.length > limit;

    if (hasMore) {
      records.pop(); // Remove the extra record
    }

    const result = {
      records: records.map(mapRecordFromDb),
      total,
      hasMore,
    };

    // Cache the result if it meets the criteria
    if (cache && config.cache?.pools?.recordLists?.enabled && cacheKey) {
      const poolConfig = config.cache.pools.recordLists;

      // Check if result should be cached based on size and record count
      if (result.records.length <= poolConfig.maxRecordsPerQuery) {
        // Don't pre-calculate size for complex objects - let cache handle it
        const size = cache.checkSize(result);
        if (size <= poolConfig.maxResultSizeBytes) {
          const ttl = poolConfig.ttlSeconds;
          await cache.set("recordLists", cacheKey, result, ttl);
          logger.debug("Record list cached", {
            streamId,
            limit,
            after,
            recordCount: result.records.length,
            size,
            ttl,
          });
        } else {
          logger.debug("Record list too large to cache", { streamId, size });
        }
      } else {
        logger.debug("Too many records to cache", {
          streamId,
          recordCount: result.records.length,
        });
      }
    }

    return success(result);
  } catch (error: unknown) {
    logger.error("Failed to list records", {
      error,
      podName,
      streamId,
      limit,
      after,
    });
    return failure(new Error("Failed to list records"));
  }
}
