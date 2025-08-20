/**
 * JWT validation for Hydra-issued tokens
 */

import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { getJwksUrl, getHydraPublicUrl } from "./hydra-client.js";
import { createLogger } from "../logger.js";
import { Result } from "../types.js";

const logger = createLogger("webpods:oauth:jwt");

// Create JWKS client with caching
const client = jwksClient({
  jwksUri: getJwksUrl(),
  cache: true,
  cacheMaxAge: 600000, // 10 minutes
  rateLimit: true,
  jwksRequestsPerMinute: 10,
});

// Promisify the getSigningKey function
function getKey(header: any, callback: any) {
  client.getSigningKey(header.kid, (err, key) => {
    if (err) {
      logger.error("Failed to get signing key", {
        error: err,
        kid: header.kid,
      });
      return callback(err);
    }
    const signingKey = key?.getPublicKey();
    callback(null, signingKey);
  });
}

export interface HydraTokenPayload {
  sub: string;
  iss: string;
  aud: string[];
  exp: number;
  iat: number;
  client_id: string;
  scope: string;
  ext?: {
    pods?: string[];
    permissions?: string[];
  };
}

/**
 * Verify a Hydra-issued JWT token
 */
export async function verifyHydraToken(
  token: string,
): Promise<Result<HydraTokenPayload>> {
  return new Promise((resolve) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
        issuer: getHydraPublicUrl() + "/",
      },
      (err, decoded) => {
        if (err) {
          logger.debug("Token verification failed", { error: err.message });

          if (err.name === "TokenExpiredError") {
            resolve({
              success: false,
              error: {
                code: "TOKEN_EXPIRED",
                message: "Token has expired",
              },
            });
          } else if (err.name === "JsonWebTokenError") {
            resolve({
              success: false,
              error: {
                code: "INVALID_TOKEN",
                message: "Invalid token",
              },
            });
          } else {
            resolve({
              success: false,
              error: {
                code: "TOKEN_ERROR",
                message: err.message || "Token verification failed",
              },
            });
          }
        } else {
          const payload = decoded as HydraTokenPayload;

          logger.debug("Token verified successfully", {
            sub: payload.sub,
            client_id: payload.client_id,
            pods: payload.ext?.pods,
          });

          resolve({
            success: true,
            data: payload,
          });
        }
      },
    );
  });
}

/**
 * Check if a token is a Hydra JWT (vs WebPods JWT)
 */
export function isHydraToken(token: string): boolean {
  try {
    // Decode without verification to check issuer
    const decoded = jwt.decode(token, { complete: true }) as any;
    if (!decoded) return false;

    // Check if issuer is Hydra
    const hydraUrl = getHydraPublicUrl();
    return decoded.payload?.iss?.startsWith(hydraUrl);
  } catch {
    return false;
  }
}
