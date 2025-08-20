/**
 * Authentication domain logic
 */

import jwt from "jsonwebtoken";
import { Database } from "../db.js";
import { UserDbRow, IdentityDbRow } from "../db-types.js";
import { User, Identity, Result, JWTPayload } from "../types.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

type OAuthProvider = string;

const logger = createLogger("webpods:domain:auth");

/**
 * Map database row to domain type
 */
function mapUserFromDb(row: UserDbRow): User {
  return {
    id: row.id,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

/**
 * Map identity database row to domain type
 */
function mapIdentityFromDb(row: IdentityDbRow): Identity {
  return {
    id: row.id,
    user_id: row.user_id,
    provider: row.provider,
    provider_id: row.provider_id,
    email: row.email || null,
    name: row.name || null,
    metadata: row.metadata,
    created_at: row.created_at,
    updated_at: row.updated_at || row.created_at,
  };
}

/**
 * Ensure user exists in database (create if missing)
 * This is needed when a valid JWT references a user that was deleted
 */
export async function ensureUserExists(
  db: Database,
  userId: string,
  _email?: string | null,
  _name?: string | null,
): Promise<Result<User>> {
  try {
    // Check if user exists by ID
    let userRow = await db.oneOrNone<UserDbRow>(
      `SELECT * FROM "user" WHERE id = $(userId)`,
      { userId },
    );

    if (!userRow) {
      // Create user with the specific ID from JWT
      userRow = await db.one<UserDbRow>(
        `INSERT INTO "user" (id, created_at)
         VALUES ($(userId), NOW())
         RETURNING *`,
        { userId },
      );

      logger.info("User recreated from JWT", { userId });
    }

    return { success: true, data: mapUserFromDb(userRow) };
  } catch (error: any) {
    logger.error("Failed to ensure user exists", { error, userId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to ensure user exists",
      },
    };
  }
}

/**
 * Find or create user from OAuth profile
 */
export async function findOrCreateUser(
  db: Database,
  provider: OAuthProvider,
  profile: any,
): Promise<Result<{ user: User; identity: Identity }>> {
  const providerId = profile.id;
  const email = profile.email || null;
  const name = profile.name || profile.username || (email ? email.split("@")[0] : null);

  try {
    // Try to find existing identity
    let identityRow = await db.oneOrNone<IdentityDbRow>(
      `SELECT * FROM identity WHERE provider = $(provider) AND provider_id = $(providerId)`,
      { provider, providerId },
    );

    let userRow: UserDbRow;

    if (!identityRow) {
      // Create new user and identity
      userRow = await db.one<UserDbRow>(
        `INSERT INTO "user" (id, created_at)
         VALUES (gen_random_uuid(), NOW())
         RETURNING *`,
      );

      identityRow = await db.one<IdentityDbRow>(
        `INSERT INTO identity (id, user_id, provider, provider_id, email, name, created_at)
         VALUES (gen_random_uuid(), $(userId), $(provider), $(providerId), $(email), $(name), NOW())
         RETURNING *`,
        { userId: userRow.id, provider, providerId, email, name },
      );

      logger.info("New user and identity created", { userId: userRow.id, provider, providerId });
    } else {
      // Get existing user
      userRow = await db.one<UserDbRow>(
        `SELECT * FROM "user" WHERE id = $(userId)`,
        { userId: identityRow.user_id },
      );

      // Update identity info if changed
      if (identityRow.email !== email || identityRow.name !== name) {
        identityRow = await db.one<IdentityDbRow>(
          `UPDATE identity 
           SET email = $(email), name = $(name), updated_at = NOW()
           WHERE id = $(identityId)
           RETURNING *`,
          { identityId: identityRow.id, email, name },
        );
      }
    }

    return { 
      success: true, 
      data: {
        user: mapUserFromDb(userRow),
        identity: mapIdentityFromDb(identityRow)
      }
    };
  } catch (error: any) {
    logger.error("Failed to find or create user", { error, provider, providerId });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to find or create user",
      },
    };
  }
}

/**
 * Generate JWT token for user
 */
export function generateToken(
  user: User,
  identity?: Identity | null,
  pod?: string,
  expiresIn: string = "7d",
): string {
  const config = getConfig();
  const payload: JWTPayload = {
    user_id: user.id,
    email: identity?.email || null,
    name: identity?.name || null,
    pod, // Include pod if provided (for pod-specific tokens)
  };

  return jwt.sign(payload, config.auth.jwtSecret, { expiresIn } as any);
}

/**
 * Verify JWT token
 */
export function verifyToken(
  token: string,
  expectedPod?: string,
): Result<JWTPayload> {
  try {
    const config = getConfig();
    const payload = jwt.verify(token, config.auth.jwtSecret) as JWTPayload;

    // If we're on a pod subdomain, verify the token is for this pod
    if (expectedPod) {
      // Pod-specific token for a different pod is not allowed
      if (payload.pod && payload.pod !== expectedPod) {
        return {
          success: false,
          error: {
            code: "POD_MISMATCH",
            message: `Token is for pod '${payload.pod}' but request is for pod '${expectedPod}'`,
          },
        };
      }
      
      // Global tokens (without pod claim) should not work on pod subdomains
      // UNLESS we're creating the pod for the first time (write operations)
      // The middleware will need to handle this case
      if (!payload.pod) {
        return {
          success: false,
          error: {
            code: "POD_MISMATCH",
            message: `Global token cannot be used on pod subdomain '${expectedPod}'`,
          },
        };
      }
    }

    return { success: true, data: payload };
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      return {
        success: false,
        error: {
          code: "TOKEN_EXPIRED",
          message: "Token has expired",
        },
      };
    }

    if (error.name === "JsonWebTokenError") {
      return {
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid token",
        },
      };
    }

    return {
      success: false,
      error: {
        code: "TOKEN_ERROR",
        message: error.message || "Token verification failed",
      },
    };
  }
}
