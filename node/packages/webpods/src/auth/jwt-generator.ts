/**
 * WebPods JWT generation for direct API access
 */

import jwt from "jsonwebtoken";
import { getConfig } from "../config-loader.js";
import { createLogger } from "../logger.js";
import type { Result } from "../types.js";

const logger = createLogger("webpods:auth:jwt");

export interface WebPodsTokenPayload {
  sub: string; // User ID
  iat: number; // Issued at
  type: "webpods"; // Token type to distinguish from Hydra tokens
}

/**
 * Generate a WebPods JWT for API access
 *
 * @param userId - The user ID to include in the token
 * @returns JWT token string
 */
export function generateWebPodsToken(userId: string): Result<string> {
  try {
    const config = getConfig();
    const secret = config.auth.jwtSecret;

    if (!secret) {
      logger.error("JWT secret not configured");
      return {
        success: false,
        error: {
          code: "CONFIG_ERROR",
          message: "JWT secret not configured",
        },
      };
    }

    const payload: WebPodsTokenPayload = {
      sub: userId,
      iat: Math.floor(Date.now() / 1000),
      type: "webpods",
    };

    // Generate token with optional expiry
    let token: string;

    // Only add expiry if configured (defaults to no expiry)
    if (config.auth.jwtExpiry && config.auth.jwtExpiry !== "unlimited") {
      // Parse expiry - could be a string like "1h", "7d", or a number
      const expiresIn = isNaN(Number(config.auth.jwtExpiry))
        ? config.auth.jwtExpiry
        : Number(config.auth.jwtExpiry);
      token = jwt.sign(payload, secret, { expiresIn } as jwt.SignOptions);
    } else {
      token = jwt.sign(payload, secret);
    }

    logger.debug("Generated WebPods JWT", {
      userId,
      hasExpiry: config.auth.jwtExpiry && config.auth.jwtExpiry !== "unlimited",
    });

    return {
      success: true,
      data: token,
    };
  } catch (error) {
    logger.error("Failed to generate JWT", {
      error: (error as Error).message,
      userId,
    });

    return {
      success: false,
      error: {
        code: "TOKEN_GENERATION_ERROR",
        message: "Failed to generate authentication token",
      },
    };
  }
}

/**
 * Verify a WebPods JWT token
 *
 * @param token - The JWT token to verify
 * @returns Decoded token payload or error
 */
export function verifyWebPodsToken(token: string): Result<WebPodsTokenPayload> {
  try {
    const config = getConfig();
    const secret = config.auth.jwtSecret;

    if (!secret) {
      logger.error("JWT secret not configured");
      return {
        success: false,
        error: {
          code: "CONFIG_ERROR",
          message: "JWT secret not configured",
        },
      };
    }

    const decoded = jwt.verify(token, secret) as WebPodsTokenPayload;

    // Verify this is a WebPods token
    if (decoded.type !== "webpods") {
      logger.warn("Token is not a WebPods token", { type: decoded.type });
      return {
        success: false,
        error: {
          code: "INVALID_TOKEN_TYPE",
          message: "Token is not a WebPods token",
        },
      };
    }

    logger.debug("Verified WebPods JWT", {
      userId: decoded.sub,
    });

    return {
      success: true,
      data: decoded,
    };
  } catch (error) {
    const err = error as Error & {name: string};
    logger.error("Token verification failed", {
      error: err.message,
      name: err.name,
    });

    if (err.name === "TokenExpiredError") {
      return {
        success: false,
        error: {
          code: "TOKEN_EXPIRED",
          message: "Token has expired",
        },
      };
    } else if (err.name === "JsonWebTokenError") {
      return {
        success: false,
        error: {
          code: "INVALID_TOKEN",
          message: "Invalid token",
        },
      };
    } else {
      return {
        success: false,
        error: {
          code: "TOKEN_ERROR",
          message: err.message || "Token verification failed",
        },
      };
    }
  }
}

/**
 * Check if a token is a WebPods JWT (vs Hydra JWT)
 */
export function isWebPodsToken(token: string): boolean {
  try {
    // Decode without verification to check type
    const decoded = jwt.decode(token, { complete: true }) as {payload?: {type?: string}} | null;
    if (!decoded) {
      return false;
    }

    // Check if it has the WebPods type field
    return decoded.payload?.type === "webpods";
  } catch {
    return false;
  }
}
