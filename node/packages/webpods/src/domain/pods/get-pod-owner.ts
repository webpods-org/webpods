/**
 * Get the current owner of a pod
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RecordDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { createError } from "../../utils/errors.js";
import { getCache, getCacheConfig } from "../../cache/index.js";

const logger = createLogger("webpods:domain:pods");

export async function getPodOwner(
  ctx: DataContext,
  podName: string,
): Promise<Result<string | null>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = `pod-owner:${podName}`;
      const cached = await cache.get("pods", cacheKey);
      if (cached !== undefined) {
        logger.debug("Pod owner found in cache", { podName, owner: cached });
        return success(cached as string | null);
      }
    }

    // Get the latest owner record using separate queries
    // Get .config stream
    const configStream = await ctx.db.oneOrNone<{ id: string }>(
      `SELECT id FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = '.config' 
         AND parent_id IS NULL`,
      { pod_name: podName },
    );

    if (!configStream) {
      return success(null);
    }

    // Get owner stream (child of .config)
    const ownerStream = await ctx.db.oneOrNone<{ id: string }>(
      `SELECT id FROM stream 
       WHERE parent_id = $(parent_id) 
         AND name = 'owner'`,
      { parent_id: configStream.id },
    );

    if (!ownerStream) {
      return success(null);
    }

    // Get owner record
    const ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
      `SELECT * FROM record 
       WHERE stream_id = $(stream_id)
         AND name = 'owner'
       ORDER BY index DESC
       LIMIT 1`,
      { stream_id: ownerStream.id },
    );

    if (!ownerRecord) {
      return success(null);
    }

    try {
      const content = JSON.parse(ownerRecord.content);
      const ownerId = content.userId || null;

      // Cache the result
      if (cache) {
        const cacheKey = `pod-owner:${podName}`;
        const cacheConfig = getCacheConfig();
        const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
        await cache.set("pods", cacheKey, ownerId, ttl);
      }

      return success(ownerId);
    } catch {
      logger.warn("Failed to parse owner record", { podName });
      return success(null);
    }
  } catch (error: unknown) {
    logger.error("Failed to get pod owner", { error, podName });
    return failure(createError("GET_OWNER_ERROR", "Failed to get pod owner"));
  }
}
