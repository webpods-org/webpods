/**
 * Rate limiting middleware
 */

import { Request, Response, NextFunction } from "express";
import { checkRateLimit } from "../domain/ratelimit/check-rate-limit.js";
import { getRateLimitStatus } from "../domain/ratelimit/get-rate-limit-status.js";
import { getDb } from "../db/index.js";
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
    // Skip if response already sent (happens during re-routing)
    if (res.headersSent) {
      return next();
    }

    try {
      const db = getDb();

      // Use user ID if authenticated, otherwise IP address with prefix
      const authReq = req as { auth?: { user_id?: string } };
      const key = authReq.auth?.user_id || `ip:${getIpAddress(req)}`;

      const result = await checkRateLimit({ db }, key, action);

      if (!result.success) {
        logger.error("Rate limit check failed", { error: result.error });
        // Only send error response if headers haven't been sent
        if (!res.headersSent) {
          res.status(500).json({
            error: {
              code: "INTERNAL_ERROR",
              message: "Rate limit check failed",
            },
          });
        }
        return;
      }

      // Get the limit for headers
      const statusResult = await getRateLimitStatus({ db }, key, action);
      const limit = statusResult.success ? statusResult.data.limit : 1000;

      // Set rate limit headers only if response hasn't been sent
      // This prevents ERR_HTTP_HEADERS_SENT when middleware runs again after re-routing
      if (!res.headersSent) {
        try {
          // Set rate limit headers (lowercase for consistency with HTTP/2 and fetch)
          res.setHeader("x-ratelimit-limit", limit.toString());
          res.setHeader(
            "x-ratelimit-remaining",
            result.data.remaining.toString(),
          );
          res.setHeader("x-ratelimit-reset", result.data.resetAt.toISOString());
        } catch (headerError) {
          // Silently ignore header setting errors - this can happen during re-routing
          // when response is being sent between the headersSent check and setHeader call
          logger.debug("Could not set rate limit headers", {
            error: headerError,
            headersSent: res.headersSent,
          });
        }
      }

      if (!result.data.allowed) {
        logger.warn("Rate limit exceeded", { key, action });
        // Only send rate limit error if headers haven't been sent
        if (!res.headersSent) {
          res.status(429).json({
            error: {
              code: "RATE_LIMIT_EXCEEDED",
              message: "Too many requests",
            },
          });
        }
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
