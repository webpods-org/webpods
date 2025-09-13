/**
 * Get user information with identity details
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";

const logger = createLogger("webpods:domain:users");

export interface UserInfo {
  user_id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
}

interface UserIdentityRow {
  id: string;
  email: string | null;
  name: string | null;
  provider: string | null;
}

export async function getUserInfo(
  ctx: DataContext,
  userId: string,
): Promise<Result<UserInfo>> {
  try {
    // Check cache first
    const cache = getCache();
    if (cache) {
      const cacheKey = cacheKeys.userInfo(userId);
      const cached = await cache.get("pods", cacheKey); // Using pods pool for user data
      if (cached !== undefined) {
        logger.debug("User info found in cache", { userId });
        return success(cached as UserInfo);
      }
    }

    // Get user with identity info
    const userInfo = await ctx.db.oneOrNone<UserIdentityRow>(
      `SELECT u.id, i.email, i.name, i.provider 
       FROM "user" u 
       LEFT JOIN identity i ON i.user_id = u.id 
       WHERE u.id = $(userId) 
       LIMIT 1`,
      { userId },
    );

    if (!userInfo) {
      logger.warn("User not found", { userId });
      return failure(new Error("User not found"));
    }

    const result: UserInfo = {
      user_id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      provider: userInfo.provider,
    };

    // Cache the result
    if (cache) {
      const cacheKey = cacheKeys.userInfo(userId);
      const cacheConfig = getCacheConfig();
      const ttl = cacheConfig?.pools?.pods?.ttlSeconds || 600;
      await cache.set("pods", cacheKey, result, ttl);
    }

    return success(result);
  } catch (error) {
    logger.error("Failed to get user info", { error, userId });
    return failure(new Error("Failed to get user information"));
  }
}
