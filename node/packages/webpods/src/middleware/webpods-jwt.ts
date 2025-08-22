/**
 * WebPods JWT authentication middleware
 */

import { Request, Response, NextFunction } from "express";
import { verifyWebPodsToken } from "../auth/jwt-generator.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:middleware:jwt");

// Extend Express Request to include user
declare module "express-serve-static-core" {
  interface Request {
    user?: {
      id: string;
      type: "webpods" | "hydra";
    };
  }
}

/**
 * Middleware that requires a valid WebPods JWT token
 */
export function requireWebPodsJWT(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    logger.debug("No authorization header", {
      path: req.path,
      method: req.method,
    });
    res.status(401).json({
      error: {
        code: "MISSING_TOKEN",
        message: "Authorization header required",
      },
    });
    return;
  }

  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    logger.debug("Invalid authorization header format", {
      path: req.path,
    });
    res.status(401).json({
      error: {
        code: "INVALID_HEADER",
        message: "Authorization header must be 'Bearer <token>'",
      },
    });
    return;
  }

  const token = match[1];
  const result = verifyWebPodsToken(token || "");

  if (!result.success) {
    logger.debug("Token verification failed", {
      error: result.error,
      path: req.path,
    });
    res.status(401).json({
      error: result.error,
    });
    return;
  }

  // Attach user to request
  req.user = {
    id: result.data.sub,
    type: "webpods",
  };

  logger.debug("WebPods JWT authenticated", {
    userId: req.user.id,
    path: req.path,
  });

  next();
}

/**
 * Middleware that optionally validates WebPods JWT if present
 */
export function optionalWebPodsJWT(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    next();
    return;
  }

  const match = authHeader.match(/^Bearer (.+)$/);
  if (!match) {
    next();
    return;
  }

  const token = match[1];
  const result = verifyWebPodsToken(token || "");

  if (result.success) {
    req.user = {
      id: result.data.sub,
      type: "webpods",
    };
    logger.debug("Optional WebPods JWT found and validated", {
      userId: req.user.id,
      path: req.path,
    });
  }

  next();
}
