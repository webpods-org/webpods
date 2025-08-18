/**
 * Rate limiting middleware
 */

import { Request, Response, NextFunction } from "express";
import { checkRateLimit, getRateLimitStatus } from "../domain/ratelimit.js";
import { getDb } from "../db.js";
import { createLogger } from "../logger.js";
import { getIpAddress } from "../utils.js";

const logger = createLogger("webpods:ratelimit");

/**
 * Rate limiting middleware factory
 */
export function rateLimit(
  action: "read" | "write" | "pod_create" | "stream_create",
) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    try {
      const db = getDb();

      // Use auth ID if authenticated, otherwise IP address with prefix
      const key = (req as any).auth
        ? (req as any).auth.auth_id
        : `ip:${getIpAddress(req)}`;

      const result = await checkRateLimit(db, key, action);

      if (!result.success) {
        logger.error("Rate limit check failed", { error: result.error });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Rate limit check failed",
          },
        });
        return;
      }

      // Get the limit for headers
      const statusResult = await getRateLimitStatus(db, key, action);
      const limit = statusResult.success ? statusResult.data.limit : 1000;

      // Set rate limit headers
      res.setHeader("X-RateLimit-Limit", limit.toString());
      res.setHeader("X-RateLimit-Remaining", result.data.remaining.toString());
      res.setHeader("X-RateLimit-Reset", result.data.resetAt.toISOString());

      if (!result.data.allowed) {
        logger.warn("Rate limit exceeded", { key, action });
        res.status(429).json({
          error: {
            code: "RATE_LIMIT_EXCEEDED",
            message: "Too many requests",
          },
        });
        return;
      }

      next();
    } catch (error) {
      logger.error("Rate limit middleware error", { error });
      // On error, allow the request to proceed
      next();
    }
  };
}
