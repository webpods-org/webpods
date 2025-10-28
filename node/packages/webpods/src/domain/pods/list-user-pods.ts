/**
 * List all pods owned by a user
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:pods");
const schema = createSchema<DatabaseSchema>();

export interface UserPod {
  name: string;
  created_at: number;
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

    // Get pods owned by this user using Tinqer
    const pods = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("pod")
          .where((pod) => pod.owner_id === p.ownerId)
          .orderByDescending((pod) => pod.created_at),
      { ownerId: userId },
    );

    // Map to UserPod format
    const userPods: UserPod[] = pods.map((pod) => ({
      name: pod.name,
      created_at: pod.created_at,
      metadata: pod.metadata ? JSON.parse(pod.metadata) : {},
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
