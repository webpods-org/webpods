/**
 * List unique records (latest version of each named record)
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow, StreamDbRow } from "../../db-types.js";
import { StreamRecord } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";

const logger = createLogger("webpods:domain:records");

/**
 * Map database row to domain type
 */
function mapRecordFromDb(row: RecordDbRow): StreamRecord {
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
    headers: row.headers,
    metadata: undefined,
    createdAt:
      typeof row.created_at === "string"
        ? new Date(row.created_at)
        : row.created_at,
  };
}

export async function listUniqueRecords(
  ctx: DataContext,
  podName: string,
  streamId: number,
  limit: number = 100,
  after?: number,
): Promise<
  Result<{ records: StreamRecord[]; total: number; hasMore: boolean }>
> {
  try {
    // Check cache first
    const cache = getCache();
    let cacheKey: string | null = null;
    let streamPath: string | null = null;

    if (cache) {
      // Get stream path for cache key generation
      const stream = await ctx.db.oneOrNone<StreamDbRow>(
        `SELECT path FROM stream WHERE id = $(streamId)`,
        { streamId },
      );

      if (stream) {
        streamPath = stream.path;
        // Use cacheKeys function to generate proper hierarchical key
        cacheKey = cacheKeys.uniqueRecordList(podName, streamPath, {
          limit,
          after: after || 0,
        });

        const cached = await cache.get("recordLists", cacheKey);
        if (cached !== undefined) {
          logger.debug("Unique records found in cache", {
            streamId,
            limit,
            after,
          });
          return success(
            cached as {
              records: StreamRecord[];
              total: number;
              hasMore: boolean;
            },
          );
        }
      }
    }

    // Get the latest record for each unique name using DISTINCT ON
    const latestRecords = await ctx.db.manyOrNone<RecordDbRow>(
      `SELECT DISTINCT ON (name) *
       FROM record
       WHERE stream_id = $(streamId)
         AND name IS NOT NULL
         AND name != ''
       ORDER BY name, index DESC`,
      { streamId },
    );

    // Filter out deleted/purged records in memory and sort by index
    let uniqueRecords = latestRecords
      .filter((record) => !record.deleted && !record.purged)
      .sort((a, b) => a.index - b.index);

    // Apply pagination
    let actualAfter = after;
    if (after !== undefined && after < 0) {
      // Get total count to convert negative index
      const totalCount = await ctx.db
        .one<{
          count: string;
        }>(
          `SELECT COUNT(*) as count FROM record WHERE stream_id = $(streamId) `,
          { streamId },
        )
        .then((r) => parseInt(r.count));

      // after=-3 means "get the last 3 records", so we skip totalCount-3 records
      actualAfter = totalCount + after - 1;

      // If still negative, start from beginning
      if (actualAfter < 0) {
        actualAfter = -1;
      }
    }

    if (actualAfter !== undefined) {
      uniqueRecords = uniqueRecords.filter((r) => r.index > actualAfter);
    }

    const total = uniqueRecords.length;
    const hasMore = uniqueRecords.length > limit;

    if (hasMore) {
      uniqueRecords = uniqueRecords.slice(0, limit);
    }

    const result = {
      records: uniqueRecords.map(mapRecordFromDb),
      total,
      hasMore,
    };

    // Cache the result if we have a cache key and result is reasonable size
    if (cache && cacheKey) {
      // Check size before caching (don't cache large results)
      const resultSize = JSON.stringify(result).length;
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.recordLists?.ttlSeconds || 30;
      if (resultSize <= 52428800) {
        // 50MB limit for unique record lists
        await cache.set("recordLists", cacheKey, result, ttl);
      }
    }

    return success(result);
  } catch (error: unknown) {
    logger.error("Failed to list unique records", {
      error,
      podName,
      streamId,
      limit,
      after,
    });
    return failure(new Error("Failed to list unique records"));
  }
}
