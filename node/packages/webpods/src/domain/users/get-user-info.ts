/**
 * Get user information with identity details
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";
import { getCache, getCacheConfig, cacheKeys } from "../../cache/index.js";
import { createSchema } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:users");
const schema = createSchema<DatabaseSchema>();

export interface UserInfo {
  user_id: string;
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

    // Get user with identity info using Tinqer LEFT JOIN
    const userInfos = await executeSelect(
      ctx.db,
      schema,
      (q, p) =>
        q
          .from("user")
          .groupJoin(
            q.from("identity"),
            (u) => u.id,
            (i) => i.user_id,
            (u, identities) => ({ u, identities }),
          )
          .selectMany(
            (g) => g.identities.defaultIfEmpty(),
            (g, i) => ({ user: g.u, identity: i }),
          )
          .where((row) => row.user.id === p.userId)
          .take(1)
          .select((row) => ({
            id: row.user.id,
            email: row.identity ? row.identity.email : null,
            name: row.identity ? row.identity.name : null,
            provider: row.identity ? row.identity.provider : null,
          })),
      { userId },
    );

    const userInfo = userInfos[0] || null;

    if (!userInfo) {
      logger.warn("User not found", { userId });
      return failure(new Error("User not found"));
    }

    const result: UserInfo = {
      user_id: userInfo.id,
      email: userInfo.email || null,
      name: userInfo.name || null,
      provider: userInfo.provider || null,
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
