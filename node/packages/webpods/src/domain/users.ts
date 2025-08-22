/**
 * User management functions
 */

import { Database } from "../db.js";
import { Result, User, Identity } from "../types.js";
import { createLogger } from "../logger.js";
import type { OAuthProvider } from "../types.js";

const logger = createLogger("webpods:users");

/**
 * Ensure a user exists in the database
 */
export async function ensureUserExists(
  db: Database,
  userId: string,
  _email?: string | null,
  _name?: string | null,
): Promise<Result<User>> {
  try {
    // Check if user exists
    const existingUsers = await db.manyOrNone<User>(
      `SELECT * FROM "user" WHERE id = $(userId)`,
      { userId },
    );

    if (existingUsers && existingUsers.length > 0) {
      return { success: true, data: existingUsers[0]! };
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
    const existingIdentity = await db.oneOrNone<Identity>(
      `SELECT * FROM identity 
       WHERE provider = $(provider) AND provider_id = $(providerId)`,
      { provider: provider.provider, providerId },
    );

    if (existingIdentity) {
      // Get the associated user
      const user = await db.one<User>(
        `SELECT * FROM "user" WHERE id = $(userId)`,
        { userId: existingIdentity.user_id },
      );

      // Update user info if changed
      if (email && email !== user.email) {
        await db.none(
          `UPDATE "user" SET email = $(email) WHERE id = $(userId)`,
          { email, userId: user.id },
        );
        user.email = email;
      }

      if (name && name !== user.name) {
        await db.none(`UPDATE "user" SET name = $(name) WHERE id = $(userId)`, {
          name,
          userId: user.id,
        });
        user.name = name;
      }

      return { success: true, data: { user, identity: existingIdentity } };
    }

    // No existing identity, check if we have a user with this email
    let user: User | null = null;

    if (email) {
      user = await db.oneOrNone<User>(
        `SELECT * FROM "user" WHERE email = $(email)`,
        { email },
      );
    }

    // Create new user if needed
    if (!user) {
      // Generate a unique user ID
      const userId = `${provider.provider}-${providerId}`;

      user = await db.one<User>(
        `INSERT INTO "user" (id, email, name, avatar_url) 
         VALUES ($(userId), $(email), $(name), $(avatarUrl))
         RETURNING *`,
        { userId, email, name, avatarUrl },
      );

      logger.info("Created new user", {
        userId: user.id,
        provider: provider.provider,
      });
    }

    // Create identity
    const identity = await db.one<Identity>(
      `INSERT INTO identity (user_id, provider, provider_id, profile) 
       VALUES ($(userId), $(provider), $(providerId), $(profile))
       RETURNING *`,
      {
        userId: user.id,
        provider: provider.provider,
        providerId,
        profile: JSON.stringify(profile),
      },
    );

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
