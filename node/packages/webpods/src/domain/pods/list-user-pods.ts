/**
 * List all pods owned by a user
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { PodDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";

const logger = createLogger("webpods:domain:pods");

export interface UserPod {
  name: string;
  created_at: Date;
  metadata: Record<string, unknown>;
}

export async function listUserPods(
  ctx: DataContext,
  userId: string,
): Promise<Result<UserPod[]>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.userPods(userId);
      const cached = await cache.get("pods", cacheKey);
      if (cached !== undefined) {
        logger.debug("User pods found in cache", {
          userId,
          count: (cached as UserPod[]).length,
        });
        return success(cached as UserPod[]);
      }
    }

    // Get pods owned by this user directly using owner_id
    const pods = await ctx.db.manyOrNone<PodDbRow>(
      `SELECT * FROM pod WHERE owner_id = $(owner_id) ORDER BY created_at DESC`,
      { owner_id: userId },
    );

    // Map to UserPod format
    const userPods: UserPod[] = pods.map((pod) => ({
      name: pod.name,
      created_at: pod.created_at,
      metadata: pod.metadata || {},
    }));

    logger.info("Listed pods for user", {
      userId,
      count: userPods.length,
    });

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.userPods(userId);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 300;
      await cache.set("pods", cacheKey, userPods, ttl);
    }

    return success(userPods);
  } catch (error: unknown) {
    logger.error("Failed to list user pods", { error, userId });
    return failure(new Error("Failed to list user pods"));
  }
}
