/**
 * JWT validation for Hydra-issued tokens
 */

import jwt from "jsonwebtoken";
import jwksClient from "jwks-rsa";
import { getJwksUrl, getHydraPublicUrl } from "./hydra-client.js";
import { createLogger } from "../logger.js";
import { Result } from "../types.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:oauth:jwt");

// Create JWKS client with caching - config is loaded dynamically
function createJwksClient() {
  const config = getConfig();
  return jwksClient({
    jwksUri: getJwksUrl(),
    cache: true,
    cacheMaxAge: config.oauth.jwtCacheMaxAgeMs ?? 600000, // 10 minutes default
    rateLimit: true,
    jwksRequestsPerMinute: config.oauth.jwtCacheRequestsPerMinute ?? 10,
  });
}

// Lazy initialization to allow config to be loaded
let client: jwksClient.JwksClient | null = null;
function getClient() {
  if (!client) {
    client = createJwksClient();
  }
  return client;
}

// Promisify the getSigningKey function
function getKey(
  header: { kid?: string },
  callback: (err: Error | null, key?: string) => void,
) {
  if (!header.kid) {
    return callback(new Error("Missing kid in JWT header"));
  }
  getClient().getSigningKey(header.kid, (err, key) => {
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
    pods?: string[]; // List of pods with full access
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
      (err: jwt.VerifyErrors | null, decoded: unknown) => {
        if (err) {
          logger.error("Token verification failed", {
            error: err.message,
            name: err.name,
            issuer: getHydraPublicUrl() + "/",
          });

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
    const decoded = jwt.decode(token, { complete: true }) as {
      payload: { iss?: string };
    } | null;
    if (!decoded) {
      return false;
    }

    // Check if issuer is Hydra
    const hydraUrl = getHydraPublicUrl();
    const iss = decoded.payload?.iss;

    // The token issuer is "http://localhost:4444/" but hydraUrl is "http://localhost:4444"
    // We need to check both with and without trailing slash
    const isHydra = iss?.startsWith(hydraUrl);

    return !!isHydra;
  } catch {
    return false;
  }
}
