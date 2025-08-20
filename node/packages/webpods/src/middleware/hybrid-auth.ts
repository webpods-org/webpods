/**
 * Hybrid authentication middleware supporting both WebPods and Hydra tokens
 */

import { Request, Response, NextFunction } from "express";
import { verifyToken } from "../domain/auth.js";
import { verifyHydraToken, isHydraToken } from "../oauth/jwt-validator.js";
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
    const currentPod = req.pod_id || undefined;
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

    req.ip_address = getIpAddress(req);

    // Check if it's a Hydra token
    if (isHydraToken(token)) {
      logger.debug("Detected Hydra token");

      const hydraResult = await verifyHydraToken(token);

      if (!hydraResult.success) {
        logger.warn("Invalid Hydra token", { error: hydraResult.error });
        res.status(401).json({ error: hydraResult.error });
        return;
      }

      const payload = hydraResult.data;

      // Check pod permissions if on a pod subdomain
      if (currentPod) {
        const allowedPods = payload.ext?.pods || [];
        if (!allowedPods.includes(currentPod)) {
          logger.warn("Hydra token not authorized for pod", {
            currentPod,
            allowedPods,
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
      req.auth_type = "hydra";

      logger.debug("Hydra token authenticated", {
        userId: payload.sub,
        clientId: payload.client_id,
        pods: payload.ext?.pods,
      });
    } else {
      // WebPods token
      logger.debug("Detected WebPods token");

      const result = verifyToken(token, currentPod);

      if (!result.success) {
        logger.warn("Invalid WebPods token", {
          error: result.error,
          pod: currentPod,
        });
        res.status(401).json({ error: result.error });
        return;
      }

      req.auth = result.data;
      req.auth_type = "webpods";

      logger.debug("WebPods token authenticated", {
        userId: result.data.user_id,
        ip: req.ip_address,
      });
    }

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
    req.ip_address = getIpAddress(req);

    const token = extractToken(req);
    if (!token) {
      next();
      return;
    }

    // Try Hydra first
    if (isHydraToken(token)) {
      const hydraResult = await verifyHydraToken(token);
      if (hydraResult.success) {
        const payload = hydraResult.data;
        req.auth = {
          user_id: payload.sub,
          client_id: payload.client_id,
          pods: payload.ext?.pods,
          scope: payload.scope,
        } as HydraAuth;
        req.auth_type = "hydra";
      }
    } else {
      // Try WebPods token
      const result = verifyToken(token);
      if (result.success) {
        req.auth = result.data;
        req.auth_type = "webpods";
      }
    }

    next();
  } catch (error) {
    logger.error("Optional auth error", { error });
    next();
  }
}
