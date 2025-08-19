/**
 * Authentication domain logic
 */

import jwt from "jsonwebtoken";
import { Database } from "../db.js";
import { UserDbRow } from "../db-types.js";
import { User, Result, JWTPayload } from "../types.js";
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
    auth_id: row.auth_id,
    email: row.email,
    name: row.name,
    provider: row.provider,
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
  authId: string,
  email: string,
  name: string,
  provider: string,
): Promise<Result<User>> {
  try {
    // First check if user exists by ID
    let userRow = await db.oneOrNone<UserDbRow>(
      `SELECT * FROM "user" WHERE id = $(userId)`,
      { userId },
    );

    if (!userRow) {
      // Check if user exists by auth_id (might have different ID)
      userRow = await db.oneOrNone<UserDbRow>(
        `SELECT * FROM "user" WHERE auth_id = $(authId)`,
        { authId },
      );

      if (!userRow) {
        // Create user with the specific ID from JWT
        userRow = await db.one<UserDbRow>(
          `INSERT INTO "user" (id, auth_id, email, name, provider, created_at)
           VALUES ($(userId), $(authId), $(email), $(name), $(provider), NOW())
           RETURNING *`,
          { userId, authId, email, name, provider },
        );

        logger.info("User recreated from JWT", { userId, authId, provider });
      }
    }

    return { success: true, data: mapUserFromDb(userRow) };
  } catch (error: any) {
    logger.error("Failed to ensure user exists", { error, userId, authId });
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
): Promise<Result<User>> {
  const authId = `auth:${provider}:${profile.id}`;
  const email = profile.email || "";
  const name = profile.name || profile.username || email.split("@")[0];

  try {
    // Try to find existing user
    let userRow = await db.oneOrNone<UserDbRow>(
      `SELECT * FROM "user" WHERE auth_id = $(authId)`,
      { authId },
    );

    if (!userRow) {
      // Create new user
      userRow = await db.one<UserDbRow>(
        `INSERT INTO "user" (id, auth_id, email, name, provider, created_at)
         VALUES (gen_random_uuid(), $(authId), $(email), $(name), $(provider), NOW())
         RETURNING *`,
        { authId, email, name, provider },
      );

      logger.info("New user created", { authId, provider });
    } else {
      // Update user info if changed
      if (userRow.email !== email || userRow.name !== name) {
        userRow = await db.one<UserDbRow>(
          `UPDATE "user" 
           SET email = $(email), name = $(name), updated_at = NOW()
           WHERE id = $(userId)
           RETURNING *`,
          { userId: userRow.id, email, name },
        );
      }
    }

    return { success: true, data: mapUserFromDb(userRow) };
  } catch (error: any) {
    logger.error("Failed to find or create user", { error, authId });
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
  pod?: string,
  expiresIn: string = "7d",
): string {
  const config = getConfig();
  const payload: JWTPayload = {
    user_id: user.id,
    auth_id: user.auth_id,
    email: user.email,
    name: user.name,
    provider: user.provider,
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
