/**
 * Get user information with identity details
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { createLogger } from "../../logger.js";

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

    return success({
      user_id: userInfo.id,
      email: userInfo.email,
      name: userInfo.name,
      provider: userInfo.provider,
    });
  } catch (error) {
    logger.error("Failed to get user info", { error, userId });
    return failure(new Error("Failed to get user information"));
  }
}
