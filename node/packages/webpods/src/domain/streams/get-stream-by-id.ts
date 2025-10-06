/**
 * Get a stream by its numeric ID
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
 * Get a stream by its numeric ID
 * @param ctx Data context
 * @param streamId The numeric stream ID
 */
export async function getStreamById(
  ctx: DataContext,
  streamId: number,
): Promise<Result<Stream>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.streamById(streamId);
      const cached = await cache.get("streams", cacheKey);
      if (cached !== undefined) {
        logger.debug("Stream found in cache by ID", { streamId });
        return success(cached as Stream);
      }
    }

    const streams = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("stream").where((s) => s.id === p.id),
      { id: streamId },
    );

    const stream = streams[0] || null;

    if (!stream) {
      logger.debug("Stream not found by ID", { streamId });
      return failure(
        createError("STREAM_NOT_FOUND", `Stream with ID ${streamId} not found`),
      );
    }

    const mappedStream = mapStreamFromDb(stream);

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.streamById(streamId);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.streams?.ttlSeconds || 300;
      await cache.set("streams", cacheKey, mappedStream, ttl);
    }

    return success(mappedStream);
  } catch (error: unknown) {
    logger.error("Failed to get stream by ID", { error, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}
