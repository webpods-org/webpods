/**
 * Get pod by name
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { Pod } from "../../types.js";
import { createLogger } from "../../logger.js";
import { getCache, cacheKeys } from "../../cache/index.js";
import { getConfig } from "../../config-loader.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const schema = createSchema<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapPodFromDb(row: DatabaseSchema["pod"]): Pod {
  return {
    name: row.name,
    userId: row.owner_id || "", // Use owner_id directly from pod table
    metadata: JSON.parse(row.metadata),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
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

    // Cache miss - fetch from database using Tinqer
    const pods = await executeSelect(
      ctx.db,
      schema,
      (q, p) => q.from("pod").where((pod) => pod.name === p.podName),
      { podName },
    );

    const pod = pods[0] || null;

    if (!pod) {
      return failure(new Error("Pod not found"));
    }

    // Map directly - owner_id is now on the pod table
    const mappedPod = mapPodFromDb(pod);

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
