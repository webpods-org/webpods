/**
 * Link resolution middleware
 * Resolves .config/routing links BEFORE other middleware runs
 */

import { Request, Response, NextFunction } from "express";
import { resolveLink } from "../domain/routing/resolve-link.js";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:resolve-links");

declare module "express-serve-static-core" {
  interface Request {
    originalPath?: string;
    wasRewritten?: boolean;
  }
}

/**
 * Middleware to resolve linked paths from .config/routing
 * This runs BEFORE authentication and rate limiting so those
 * middlewares see the final resolved path
 */
export async function resolveLinks(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Skip if no pod context
    const podName = (req as Request & { podName?: string }).podName;
    if (!podName) {
      return next();
    }

    // Skip if already resolved (prevents infinite loops)
    if (req.wasRewritten) {
      return next();
    }

    // IMPORTANT: Skip resolution for .config paths
    // We don't want to resolve links when accessing .config/routing itself!
    if (req.path.startsWith("/.config/")) {
      return next();
    }

    const db = getDb();

    // Check if this path is mapped in .config/routing
    const linkResult = await resolveLink({ db }, podName, req.path);

    if (linkResult.success && linkResult.data) {
      // Store original path for reference
      req.originalPath = req.path;
      req.wasRewritten = true;

      // Rewrite to the mapped stream/record
      const { streamPath, target } = linkResult.data;

      if (target && target.startsWith("?")) {
        // Handle query parameters (e.g., "?i=-1")
        req.url = `/${streamPath}${target}`;
        Object.defineProperty(req, "path", {
          value: `/${streamPath}`,
          writable: true,
          configurable: true,
        });
        // Parse and merge query parameters
        const params = new URLSearchParams(target.substring(1));
        for (const [key, value] of params) {
          req.query[key] = value;
        }
      } else if (target) {
        // Handle path targets (e.g., "/record-name")
        req.url = `/${streamPath}${target}`;
        Object.defineProperty(req, "path", {
          value: `/${streamPath}${target}`,
          writable: true,
          configurable: true,
        });
      } else {
        // Just stream name
        req.url = `/${streamPath}`;
        Object.defineProperty(req, "path", {
          value: `/${streamPath}`,
          writable: true,
          configurable: true,
        });
      }

      logger.debug("Link resolved", {
        original: req.originalPath,
        resolved: req.path,
        podName,
      });
    }

    next();
  } catch (error) {
    logger.error("Link resolution error", { error });
    // On error, continue without resolution
    next();
  }
}

/**
 * Optional link resolution for public routes
 */
export async function optionalResolveLinks(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  // Just call resolveLinks - it already handles missing pod gracefully
  return resolveLinks(req, res, next);
}
