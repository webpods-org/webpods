/**
 * Ensure a user exists in the database
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { UserDbRow } from "../../db-types.js";
import { User } from "../../types.js";
import { createLogger } from "../../logger.js";
import { createContext, from } from "@webpods/tinqer";
import { executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:domain:users");
const dbContext = createContext<DatabaseSchema>();

/**
 * Map database row to domain type
 */
function mapUserFromDb(row: UserDbRow): User {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function ensureUserExists(
  ctx: DataContext,
  userId: string,
): Promise<Result<User>> {
  try {
    // Check if user exists
    const existingUsers = await executeSelect(
      ctx.db,
      (p: { user_id: string }) =>
        from(dbContext, "user")
          .where((u) => u.id === p.user_id)
          .select((u) => u),
      { user_id: userId },
    );

    if (existingUsers && existingUsers.length > 0) {
      const user = mapUserFromDb(existingUsers[0]!);
      return success(user);
    }

    // User doesn't exist, we can't create them without proper OAuth data
    // This shouldn't happen in normal operation
    logger.warn("User not found in database", { userId });
    return failure(new Error("User not found in database"));
  } catch (error) {
    logger.error("Failed to ensure user exists", { error, userId });
    return failure(new Error("Failed to check user existence"));
  }
}
