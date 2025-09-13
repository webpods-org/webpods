/**
 * List child streams of a parent stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";

const logger = createLogger("webpods:domain:streams");

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: StreamDbRow): Stream {
  return {
    id: row.id,
    podName: row.pod_name,
    name: row.name,
    path: row.path,
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: row.metadata,
    hasSchema: row.has_schema || false,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

/**
 * List direct child streams of a parent stream
 * @param ctx Data context
 * @param parentId Parent stream ID (null for root streams)
 * @param podName Pod name
 * @returns List of child streams
 */
export async function listChildStreams(
  ctx: DataContext,
  parentId: number | null,
  podName: string,
): Promise<Result<Stream[]>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.streamChildren(podName, parentId);
      const cached = await cache.get("streams", cacheKey);
      if (cached !== undefined) {
        logger.debug("Child streams found in cache", { podName, parentId });
        return success(cached as Stream[]);
      }
    }

    const query = parentId
      ? `SELECT * FROM stream
         WHERE pod_name = $(podName)
           AND parent_id = $(parentId)
         ORDER BY name ASC`
      : `SELECT * FROM stream
         WHERE pod_name = $(podName)
           AND parent_id IS NULL
         ORDER BY name ASC`;

    const params = parentId ? { podName, parentId } : { podName };

    const streams = await ctx.db.manyOrNone<StreamDbRow>(query, params);

    logger.debug("Listed child streams", {
      podName,
      parentId,
      count: streams.length,
    });

    const mappedStreams = streams.map(mapStreamFromDb);

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.streamChildren(podName, parentId);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.streams?.ttlSeconds || 300;
      await cache.set("streams", cacheKey, mappedStreams, ttl);
    }

    return success(mappedStreams);
  } catch (error: unknown) {
    logger.error("Failed to list child streams", {
      error,
      podName,
      parentId,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to list child streams"),
    );
  }
}

/**
 * Count child streams of a parent stream
 * @param ctx Data context
 * @param parentId Parent stream ID (null for root streams)
 * @param podName Pod name
 * @returns Count of child streams
 */
export async function countChildStreams(
  ctx: DataContext,
  parentId: number | null,
  podName: string,
): Promise<Result<number>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.streamChildrenCount(podName, parentId);
      const cached = await cache.get("streams", cacheKey);
      if (cached !== undefined) {
        logger.debug("Child stream count found in cache", {
          podName,
          parentId,
          count: cached,
        });
        return success(cached as number);
      }
    }

    const query = parentId
      ? `SELECT COUNT(*) as count FROM stream
         WHERE pod_name = $(podName)
           AND parent_id = $(parentId)`
      : `SELECT COUNT(*) as count FROM stream
         WHERE pod_name = $(podName)
           AND parent_id IS NULL`;

    const params = parentId ? { podName, parentId } : { podName };

    const result = await ctx.db.one<{ count: string }>(query, params);
    const count = parseInt(result.count);

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.streamChildrenCount(podName, parentId);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.streams?.ttlSeconds || 300;
      await cache.set("streams", cacheKey, count, ttl);
    }

    return success(count);
  } catch (error: unknown) {
    logger.error("Failed to count child streams", {
      error,
      podName,
      parentId,
    });
    return failure(
      createError("DATABASE_ERROR", "Failed to count child streams"),
    );
  }
}
