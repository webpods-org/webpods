/**
 * Rate limit test utilities
 * Only available when --enable-test-utils flag is set
 */

import { Router, Request, Response } from "express";
import { getRateLimiter, getRateLimiterConfig } from "../../ratelimit/index.js";
import { createLogger } from "../../logger.js";
import type { RateLimitAction } from "../../ratelimit/types.js";

const logger = createLogger("webpods:test-utils:ratelimit");
const router = Router();

// Middleware to ensure test mode and localhost access
const testModeOnly = (req: Request, res: Response, next: () => void) => {
  if (
    process.env.NODE_ENV !== "test" &&
    process.env.WEBPODS_TEST_MODE !== "enabled"
  ) {
    logger.warn("Test utilities access denied - not in test mode");
    res.status(403).json({
      error: {
        code: "TEST_MODE_REQUIRED",
        message: "Test utilities only available in test mode",
      },
    });
    return;
  }

  // Additional safety: only allow from localhost
  const ip = req.ip || req.socket.remoteAddress;
  if (ip && !["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip)) {
    logger.warn("Test utilities access denied from non-localhost", { ip });
    res.status(403).json({
      error: {
        code: "LOCALHOST_ONLY",
        message: "Test utilities only accessible from localhost",
      },
    });
    return;
  }

  next();
};

/**
 * Get rate limit status for an identifier and action
 * GET /test-utils/ratelimit/status
 */
router.get("/status", testModeOnly, async (req: Request, res: Response) => {
  const identifier = req.query.identifier as string;
  const action = req.query.action as RateLimitAction;

  if (!identifier || !action) {
    res.status(400).json({
      error: {
        code: "MISSING_PARAMS",
        message: "identifier and action query parameters are required",
      },
    });
    return;
  }

  const rateLimiter = getRateLimiter();
  if (!rateLimiter) {
    res.json({
      enabled: false,
      message: "Rate limiting is disabled",
    });
    return;
  }

  try {
    const status = await rateLimiter.getStatus(identifier, action);
    const config = getRateLimiterConfig();

    res.json({
      enabled: true,
      identifier,
      action,
      count: status.limit - status.remaining,
      remaining: status.remaining,
      limit: status.limit,
      resetAt: status.resetAt,
      windowMs: config?.windowMs || 3600000,
    });
  } catch (error) {
    logger.error("Failed to get rate limit status", { error });
    res.status(500).json({
      error: {
        code: "STATUS_ERROR",
        message: "Failed to get rate limit status",
      },
    });
  }
});

/**
 * Reset rate limits for an identifier
 * POST /test-utils/ratelimit/reset
 */
router.post("/reset", testModeOnly, async (req: Request, res: Response) => {
  const { identifier, action } = req.body;

  const rateLimiter = getRateLimiter();
  if (!rateLimiter) {
    res.json({
      success: true,
      message: "Rate limiting is disabled, nothing to reset",
    });
    return;
  }

  try {
    if (identifier) {
      await rateLimiter.reset(identifier, action);
      res.json({
        success: true,
        message: action
          ? `Reset ${action} rate limit for ${identifier}`
          : `Reset all rate limits for ${identifier}`,
      });
    } else {
      // Reset all is not in the adapter interface, so we can't do this
      res.status(400).json({
        error: {
          code: "IDENTIFIER_REQUIRED",
          message: "identifier is required for reset",
        },
      });
    }
  } catch (error) {
    logger.error("Failed to reset rate limit", { error });
    res.status(500).json({
      error: {
        code: "RESET_ERROR",
        message: "Failed to reset rate limit",
      },
    });
  }
});

/**
 * Set rate limit count for testing exceeded limits
 * POST /test-utils/ratelimit/set
 */
router.post("/set", testModeOnly, async (req: Request, res: Response) => {
  const { identifier, action, count } = req.body;

  if (!identifier || !action || count === undefined) {
    res.status(400).json({
      error: {
        code: "MISSING_PARAMS",
        message: "identifier, action, and count are required",
      },
    });
    return;
  }

  const rateLimiter = getRateLimiter();
  if (!rateLimiter) {
    res.status(400).json({
      error: {
        code: "RATE_LIMITING_DISABLED",
        message: "Cannot set count when rate limiting is disabled",
      },
    });
    return;
  }

  try {
    // First reset to clear any existing count
    await rateLimiter.reset(identifier, action);

    // Then increment by the desired count
    // This is a bit hacky but works with the current adapter interface
    for (let i = 0; i < count; i++) {
      await rateLimiter.checkAndIncrement(identifier, action);
    }

    const status = await rateLimiter.getStatus(identifier, action);
    res.json({
      success: true,
      identifier,
      action,
      count: status.limit - status.remaining,
      remaining: status.remaining,
    });
  } catch (error) {
    logger.error("Failed to set rate limit count", { error });
    res.status(500).json({
      error: {
        code: "SET_ERROR",
        message: "Failed to set rate limit count",
      },
    });
  }
});

/**
 * Increment rate limit count (simulate a request)
 * POST /test-utils/ratelimit/increment
 */
router.post("/increment", testModeOnly, async (req: Request, res: Response) => {
  const { identifier, action } = req.body;

  if (!identifier || !action) {
    res.status(400).json({
      error: {
        code: "MISSING_PARAMS",
        message: "identifier and action are required",
      },
    });
    return;
  }

  const rateLimiter = getRateLimiter();
  if (!rateLimiter) {
    res.json({
      success: true,
      allowed: true,
      message: "Rate limiting is disabled",
    });
    return;
  }

  try {
    const result = await rateLimiter.checkAndIncrement(identifier, action);
    res.json({
      success: true,
      allowed: result.allowed,
      count: result.limit - result.remaining,
      remaining: result.remaining,
      limit: result.limit,
      resetAt: result.resetAt,
    });
  } catch (error) {
    logger.error("Failed to increment rate limit", { error });
    res.status(500).json({
      error: {
        code: "INCREMENT_ERROR",
        message: "Failed to increment rate limit",
      },
    });
  }
});

export default router;
