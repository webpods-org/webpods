/**
 * Get a stream by traversing a hierarchical path
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createError } from "../../utils/errors.js";
import { StreamDbRow } from "../../db-types.js";
import { Stream } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { getConfig } from "../../config-loader.js";

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
 * Get a stream by its hierarchical path
 * @param ctx Data context
 * @param podName Pod name
 * @param path Full path like "/blog/posts/2024" or "blog/posts/2024"
 */
export async function getStreamByPath(
  ctx: DataContext,
  podName: string,
  path: string,
): Promise<Result<Stream>> {
  // Remove leading slash if present for consistency
  const normalizedPath = path.startsWith("/") ? path.substring(1) : path;

  // Empty path means root
  if (!normalizedPath) {
    return failure(createError("INVALID_PATH", "Cannot get root as stream"));
  }

  try {
    // Check cache first
    const cache = getCache();
    const config = getConfig();
    const cacheKey = cacheKeys.stream(podName, normalizedPath);

    if (cache && config.cache?.pools?.streams?.enabled) {
      const cachedStream = await cache.get<Stream>("streams", cacheKey);
      if (cachedStream) {
        logger.debug("Stream cache hit", { podName, path: normalizedPath });
        return success(cachedStream);
      }
      logger.debug("Stream cache miss", { podName, path: normalizedPath });
    }

    // Cache miss - fetch from database
    // Direct lookup using path column - O(1) instead of O(n)
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT * FROM stream
       WHERE pod_name = $(podName)
         AND path = $(path)`,
      { podName, path: normalizedPath },
    );

    if (!stream) {
      logger.debug("Stream not found by path", {
        podName,
        path: normalizedPath,
      });
      return failure(
        createError("STREAM_NOT_FOUND", `Stream not found: ${path}`),
      );
    }

    const mappedStream = mapStreamFromDb(stream);

    // Cache the result
    if (cache && config.cache?.pools?.streams?.enabled) {
      const ttl = config.cache.pools.streams.ttlSeconds;
      await cache.set("streams", cacheKey, mappedStream, ttl);
      logger.debug("Stream cached", { podName, path: normalizedPath, ttl });
    }

    return success(mappedStream);
  } catch (error: unknown) {
    logger.error("Failed to get stream by path", { error, podName, path });
    return failure(createError("DATABASE_ERROR", "Failed to get stream"));
  }
}

/**
 * Get the full path for a stream (now just returns the path field)
 */
export async function getStreamPath(
  ctx: DataContext,
  streamId: number,
): Promise<Result<string>> {
  try {
    const stream = await ctx.db.oneOrNone<StreamDbRow>(
      `SELECT path FROM stream WHERE id = $(id)`,
      { id: streamId },
    );

    if (!stream) {
      return failure(createError("STREAM_NOT_FOUND", "Stream not found"));
    }

    // Return path with leading slash for consistency
    return success("/" + stream.path);
  } catch (error: unknown) {
    logger.error("Failed to get stream path", { error, streamId });
    return failure(createError("DATABASE_ERROR", "Failed to get stream path"));
  }
}
