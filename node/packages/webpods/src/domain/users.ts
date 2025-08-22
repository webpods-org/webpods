/**
 * User management functions
 */

import { Database } from "../db.js";
import { Result, User, Identity } from "../types.js";
import { createLogger } from "../logger.js";
import type { OAuthProvider } from "../types.js";
import type { UserDbRow, IdentityDbRow } from "../db-types.js";

const logger = createLogger("webpods:users");

/**
 * Map database row to User domain type
 */
function mapUserFromDb(row: UserDbRow): User {
  return {
    id: row.id,
    email: undefined,
    name: undefined,
    avatar_url: undefined,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

/**
 * Map database row to Identity domain type
 */
function mapIdentityFromDb(row: IdentityDbRow): Identity {
  return {
    id: row.id,
    userId: row.user_id,
    provider: row.provider,
    providerId: row.provider_id,
    email: row.email || null,
    name: row.name || null,
    metadata: row.metadata,
    createdAt: row.created_at,
    updatedAt: row.updated_at || row.created_at,
  };
}

/**
 * Ensure a user exists in the database
 */
export async function ensureUserExists(
  db: Database,
  userId: string,
): Promise<Result<User>> {
  try {
    // Check if user exists
    const existingUsers = await db.manyOrNone<UserDbRow>(
      `SELECT * FROM "user" WHERE id = $(userId)`,
      { userId },
    );

    if (existingUsers && existingUsers.length > 0) {
      const user = mapUserFromDb(existingUsers[0]!);
      return { success: true, data: user };
    }

    // User doesn't exist, we can't create them without proper OAuth data
    // This shouldn't happen in normal operation
    logger.warn("User not found in database", { userId });
    return {
      success: false,
      error: {
        code: "USER_NOT_FOUND",
        message: "User not found in database",
      },
    };
  } catch (error) {
    logger.error("Failed to ensure user exists", { error, userId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to check user existence",
      },
    };
  }
}

/**
 * Find or create a user from OAuth profile
 */
export async function findOrCreateUser(
  db: Database,
  provider: OAuthProvider,
  profile: any,
): Promise<Result<{ user: User; identity: Identity }>> {
  const providerId = profile.id;
  const email = profile.email || profile.emails?.[0]?.value;
  const name = profile.displayName || profile.name || profile.username;
  const avatarUrl = profile.photos?.[0]?.value || profile.picture;

  try {
    // First check if we have an identity for this provider
    const existingIdentityRow = await db.oneOrNone<IdentityDbRow>(
      `SELECT * FROM identity 
       WHERE provider = $(provider) AND provider_id = $(providerId)`,
      { provider: provider.provider, providerId },
    );

    if (existingIdentityRow) {
      const existingIdentity = mapIdentityFromDb(existingIdentityRow);

      // Get the associated user
      const userRow = await db.one<UserDbRow>(
        `SELECT * FROM "user" WHERE id = $(userId)`,
        { userId: existingIdentity.userId },
      );

      const user = mapUserFromDb(userRow);
      // Set email and name from current data
      user.email = email;
      user.name = name;
      user.avatar_url = avatarUrl;

      // Update identity info if changed
      if (
        (email && email !== existingIdentityRow.email) ||
        (name && name !== existingIdentityRow.name)
      ) {
        await db.none(
          `UPDATE identity 
           SET email = $(email), name = $(name), updated_at = NOW()
           WHERE provider = $(provider) AND provider_id = $(providerId)`,
          { email, name, provider: provider.provider, providerId },
        );
      }

      return { success: true, data: { user, identity: existingIdentity } };
    }

    // No existing identity, check if we have a user with this email via identity table
    let user: User | null = null;
    let userRow: UserDbRow | null = null;

    if (email) {
      // Look for a user with this email in any identity
      const existingUserWithEmailRow = await db.oneOrNone<{ user_id: string }>(
        `SELECT DISTINCT user_id FROM identity WHERE email = $(email) LIMIT 1`,
        { email },
      );

      if (existingUserWithEmailRow) {
        userRow = await db.one<UserDbRow>(
          `SELECT * FROM "user" WHERE id = $(userId)`,
          { userId: existingUserWithEmailRow.user_id },
        );
        user = mapUserFromDb(userRow);
        user.email = email;
        user.name = name;
        user.avatar_url = avatarUrl;
      }
    }

    // Create new user if needed
    if (!user) {
      // Generate a unique user ID
      const userId = `${provider.provider}-${providerId}`;

      userRow = await db.one<UserDbRow>(
        `INSERT INTO "user" (id) 
         VALUES ($(userId))
         RETURNING *`,
        { userId },
      );

      user = mapUserFromDb(userRow);
      user.email = email;
      user.name = name;
      user.avatar_url = avatarUrl;

      logger.info("Created new user", {
        userId: user.id,
        provider: provider.provider,
      });
    }

    // Create identity
    const identityRow = await db.one<IdentityDbRow>(
      `INSERT INTO identity (user_id, provider, provider_id, email, name, metadata) 
       VALUES ($(userId), $(provider), $(providerId), $(email), $(name), $(metadata))
       RETURNING *`,
      {
        userId: user.id,
        provider: provider.provider,
        providerId,
        email,
        name,
        metadata: JSON.stringify(profile),
      },
    );

    const identity = mapIdentityFromDb(identityRow);

    logger.info("Created new identity", {
      userId: user.id,
      provider: provider.provider,
      providerId,
    });

    return { success: true, data: { user, identity } };
  } catch (error) {
    logger.error("Failed to find or create user", { error, provider, profile });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to find or create user",
      },
    };
  }
}
