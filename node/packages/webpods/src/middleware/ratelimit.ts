/**
 * Rate limiting middleware
 */

import { Request, Response, NextFunction } from "express";
import { getRateLimiter } from "../ratelimit/index.js";
import type { RateLimitAction } from "../ratelimit/types.js";
import { createLogger } from "../logger.js";
import { getIpAddress } from "../utils.js";

const logger = createLogger("webpods:ratelimit");

/**
 * Rate limiting middleware factory
 */
export function rateLimit(action: RateLimitAction) {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    // Skip if response already sent (happens during re-routing)
    if (res.headersSent) {
      return next();
    }

    const rateLimiter = getRateLimiter();
    if (!rateLimiter) {
      // If rate limiting is disabled, proceed
      return next();
    }

    try {
      // Use user ID if authenticated, otherwise IP address with prefix
      const authReq = req as { auth?: { user_id?: string } };
      const identifier = authReq.auth?.user_id || `ip:${getIpAddress(req)}`;

      const result = await rateLimiter.checkAndIncrement(identifier, action);

      // Set rate limit headers only if response hasn't been sent
      // This prevents ERR_HTTP_HEADERS_SENT when middleware runs again after re-routing
      if (!res.headersSent) {
        try {
          // Set rate limit headers (lowercase for consistency with HTTP/2 and fetch)
          res.setHeader("x-ratelimit-limit", result.limit.toString());
          res.setHeader("x-ratelimit-remaining", result.remaining.toString());
          res.setHeader(
            "x-ratelimit-reset",
            new Date(result.resetAt).toISOString(),
          );
        } catch (headerError) {
          // Silently ignore header setting errors - this can happen during re-routing
          // when response is being sent between the headersSent check and setHeader call
          logger.debug("Could not set rate limit headers", {
            error: headerError,
            headersSent: res.headersSent,
          });
        }
      }

      if (!result.allowed) {
        logger.warn("Rate limit exceeded", { identifier, action });
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
