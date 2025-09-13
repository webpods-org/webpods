/**
 * Get pod by name
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow, RecordDbRow } from "../../db-types.js";
import { Pod } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { getConfig } from "../../config-loader.js";

const logger = createLogger("webpods:domain:pods");

/**
 * Map database row to domain type
 */
function mapPodFromDb(row: PodDbRow): Pod {
  return {
    name: row.name,
    userId: "", // Will be populated from .config/owner stream
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

export async function getPod(
  ctx: DataContext,
  podName: string,
): Promise<Result<Pod>> {
  try {
    // Check cache first
    const cache = getCache();
    const config = getConfig();
    const cacheKey = cacheKeys.podMeta(podName);

    if (cache && config.cache?.pools?.pods?.enabled) {
      const cachedPod = await cache.get<Pod>("pods", cacheKey);
      if (cachedPod) {
        logger.debug("Pod cache hit", { podName });
        return success(cachedPod);
      }
      logger.debug("Pod cache miss", { podName });
    }

    // Cache miss - fetch from database
    const pod = await ctx.db.oneOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE name = $(pod_name)`,
      { pod_name: podName },
    );

    if (!pod) {
      return failure(new Error("Pod not found"));
    }

    // Get owner using separate queries
    // Get .config stream
    const configStream = await ctx.db.oneOrNone<{ id: string }>(
      `SELECT id FROM stream 
       WHERE pod_name = $(pod_name) 
         AND name = '.config' 
         AND parent_id IS NULL`,
      { pod_name: pod.name },
    );

    let ownerRecord: RecordDbRow | null = null;
    if (configStream) {
      // Get owner stream (child of .config)
      const ownerStream = await ctx.db.oneOrNone<{ id: string }>(
        `SELECT id FROM stream 
         WHERE parent_id = $(parent_id) 
           AND name = 'owner'`,
        { parent_id: configStream.id },
      );

      if (ownerStream) {
        // Get owner record
        ownerRecord = await ctx.db.oneOrNone<RecordDbRow>(
          `SELECT * FROM record 
           WHERE stream_id = $(stream_id)
             AND name = 'owner'
           ORDER BY index DESC
           LIMIT 1`,
          { stream_id: ownerStream.id },
        );
      }
    }

    const mappedPod = mapPodFromDb(pod);
    if (ownerRecord) {
      try {
        const content = JSON.parse(ownerRecord.content);
        mappedPod.userId = content.userId || "";
      } catch {
        logger.warn("Failed to parse owner record", { podName });
      }
    }

    // Cache the result
    if (cache && config.cache?.pools?.pods?.enabled) {
      const ttl = config.cache.pools.pods.ttlSeconds;
      await cache.set("pods", cacheKey, mappedPod, ttl);
      logger.debug("Pod cached", { podName, ttl });
    }

    return success(mappedPod);
  } catch (error: unknown) {
    logger.error("Failed to get pod", { error, podName });
    return failure(new Error("Failed to get pod"));
  }
}
