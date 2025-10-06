/**
 * List child streams of a parent stream
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:streams");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapStreamFromDb(row: DatabaseSchema["stream"]): Stream {
  return {
    id: row.id,
    podName: row.pod_name,
    name: row.name,
    path: row.path,
    parentId: row.parent_id || null,
    userId: row.user_id,
    accessPermission: row.access_permission,
    metadata: JSON.parse(row.metadata),
    hasSchema: row.has_schema,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

    const streams = parentId
      ? await executeSelect(
          ctx.db,
          schema,
          (q, p) =>
            q
              .from("stream")
              .where(
                (s) => s.pod_name === p.podName && s.parent_id === p.parentId,
              )
              .orderBy((s) => s.name)
              .select((s) => s),
          { podName, parentId },
        )
      : await executeSelect(
          ctx.db,
          schema,
          (q, p) =>
            q
              .from("stream")
              .where((s) => s.pod_name === p.podName && s.parent_id === null)
              .orderBy((s) => s.name)
              .select((s) => s),
          { podName },
        );

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

    const count = parentId
      ? await executeSelect(
          ctx.db,
          schema,
          (q, p) =>
            q
              .from("stream")
              .where(
                (s) => s.pod_name === p.podName && s.parent_id === p.parentId,
              )
              .count(),
          { podName, parentId },
        )
      : await executeSelect(
          ctx.db,
          schema,
          (q, p) =>
            q
              .from("stream")
              .where((s) => s.pod_name === p.podName && s.parent_id === null)
              .count(),
          { podName },
        );

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
