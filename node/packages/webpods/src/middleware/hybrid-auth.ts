/**
 * Hybrid authentication middleware supporting both WebPods and Hydra tokens
 */

import { Request, Response, NextFunction } from "express";
import { verifyHydraToken } from "../oauth/jwt-validator.js";
import { verifyWebPodsToken, isWebPodsToken } from "../auth/jwt-generator.js";
import { HydraAuth, AuthRequest } from "../types.js";
import { createLogger } from "../logger.js";
import { getIpAddress } from "../utils.js";

const logger = createLogger("webpods:auth:hybrid");

/**
 * Extract token from request
 */
function extractToken(req: Request, currentPod?: string): string | null {
  // For pod requests, prefer pod_token cookie
  let token = currentPod
    ? (req as any).cookies?.pod_token
    : (req as any).cookies?.token;

  if (!token) {
    token = (req as any).cookies?.token; // Fallback to regular token
  }

  if (!token) {
    const authHeader = req.headers.authorization;
    if (authHeader) {
      if (authHeader.startsWith("Bearer ")) {
        token = authHeader.substring(7);
      } else if (!authHeader.includes(" ")) {
        token = authHeader;
      }
    }
  }

  return token;
}

/**
 * Hybrid authentication middleware supporting both WebPods and Hydra tokens
 */
export async function authenticateHybrid(
  req: AuthRequest,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const currentPod = req.podName || undefined;
    const token = extractToken(req, currentPod);

    if (!token) {
      res.status(401).json({
        error: {
          code: "UNAUTHORIZED",
          message: "Authentication required",
        },
      });
      return;
    }

    req.ipAddress = getIpAddress(req);

    // Determine token type and verify accordingly
    logger.debug("Attempting to verify token", {
      tokenPrefix: token.substring(0, 50),
      pod: currentPod,
    });

    // Check if it's a WebPods token
    if (isWebPodsToken(token)) {
      const webpodsResult = verifyWebPodsToken(token);

      if (!webpodsResult.success) {
        logger.warn("Invalid WebPods token", { error: webpodsResult.error });
        res.status(401).json({ error: webpodsResult.error });
        return;
      }

      // WebPods tokens have full access to all pods for the user
      req.auth = {
        user_id: webpodsResult.data.sub,
        client_id: "webpods",
        pods: [], // Empty means all pods
        scope: "full_access",
      } as HydraAuth;
      req.authType = "webpods";

      // Also set req.user for compatibility with WebPods JWT middleware
      req.user = {
        id: webpodsResult.data.sub,
        type: "webpods",
      };

      logger.debug("WebPods token authenticated", {
        userId: webpodsResult.data.sub,
      });

      next();
      return;
    }

    // Otherwise, try Hydra token
    const hydraResult = await verifyHydraToken(token);

    if (!hydraResult.success) {
      logger.warn("Invalid token", { error: hydraResult.error });
      res.status(401).json({ error: hydraResult.error });
      return;
    }

    const payload = hydraResult.data;

    // Check pod permissions if on a pod subdomain
    if (currentPod) {
      // Check both audience and ext.pods claims
      // Handle nested ext structure from Hydra (ext.ext.pods)
      const allowedPods =
        payload.ext?.pods || (payload.ext as any)?.ext?.pods || [];
      const audience = payload.aud || [];

      // For testing/development, accept both localhost and webpods.com audiences
      const possibleAudiences = [
        `https://${currentPod}.webpods.com`,
        `http://${currentPod}.localhost:3000`,
        `http://${currentPod}.localhost`,
      ];

      // Token is valid if either:
      // 1. The pod is in the ext.pods claim, OR
      // 2. Any of the expected audiences is in the aud claim
      const isAuthorized =
        allowedPods.includes(currentPod) ||
        audience.some((aud) => possibleAudiences.includes(aud));

      if (!isAuthorized) {
        logger.warn("Hydra token not authorized for pod", {
          currentPod,
          allowedPods,
          audience,
          possibleAudiences,
        });
        res.status(403).json({
          error: {
            code: "POD_FORBIDDEN",
            message: `Token not authorized for pod '${currentPod}'`,
          },
        });
        return;
      }
    }

    // Pod-level access means both read and write are allowed
    // No need to check for specific permissions

    // Attach Hydra auth info
    req.auth = {
      user_id: payload.sub,
      client_id: payload.client_id,
      pods: payload.ext?.pods,
      scope: payload.scope,
    } as HydraAuth;
    req.authType = "hydra";

    logger.debug("Hydra token authenticated", {
      userId: payload.sub,
      clientId: payload.client_id,
      pods: payload.ext?.pods,
    });

    next();
  } catch (error) {
    logger.error("Authentication error", { error });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  }
}

/**
 * Optional hybrid authentication - doesn't require auth but extracts it if present
 */
export async function optionalAuthHybrid(
  req: AuthRequest,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    req.ipAddress = getIpAddress(req);

    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }

    // Check if it's a WebPods token
    if (isWebPodsToken(token)) {
      const webpodsResult = verifyWebPodsToken(token);
      if (webpodsResult.success) {
        req.auth = {
          user_id: webpodsResult.data.sub,
          client_id: "webpods",
          pods: [], // Empty means all pods
          scope: "full_access",
        } as HydraAuth;
        req.authType = "webpods";
      }
    } else {
      // Try Hydra token
      const hydraResult = await verifyHydraToken(token);
      if (hydraResult.success) {
        const payload = hydraResult.data;
        req.auth = {
          user_id: payload.sub,
          client_id: payload.client_id,
          pods: payload.ext?.pods,
          scope: payload.scope,
        } as HydraAuth;
        req.authType = "hydra";
      }
    }

    next();
  } catch (error) {
    logger.error("Optional auth error", { error });
    next();
  }
}
