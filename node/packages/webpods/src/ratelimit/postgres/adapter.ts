import type { RateLimiterAdapter } from "../adapter.js";
import type {
  RateLimitAction,
  RateLimitConfig,
  RateLimitResult,
} from "../types.js";
import { getActionLimit } from "../types.js";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../logger.js";
import type { RateLimitDbRow } from "../../db-types.js";

const logger = createLogger("webpods:ratelimit:postgres");

let config: RateLimitConfig | null = null;

export const postgresRateLimiterAdapter: RateLimiterAdapter = {
  async initialize(cfg: RateLimitConfig): Promise<void> {
    config = cfg;
    logger.debug("PostgreSQL rate limiter initialized");
  },

  async shutdown(): Promise<void> {
    config = null;
    logger.debug("PostgreSQL rate limiter shut down");
  },

  async checkAndIncrement(
    identifier: string,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    if (!config) {
      // If not initialized, allow all requests
      return {
        allowed: true,
        remaining: 1000,
        limit: 1000,
        resetAt: new Date(Date.now() + 3600000),
      };
    }

    const db = getDb();
    const limit = getActionLimit(action, config.limits);
    const windowMs = config.windowMs;
    const now = new Date();
    const windowStart = new Date(now.getTime() - windowMs);

    try {
      // Get or create window
      const windowEnd = new Date(
        Math.ceil(now.getTime() / windowMs) * windowMs,
      );
      const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

      let rateLimitRecord = await db.oneOrNone<RateLimitDbRow>(
        `SELECT * FROM rate_limit
         WHERE identifier = $(identifier)
           AND action = $(action)
           AND window_start = $(windowStart)`,
        { identifier, action, windowStart: actualWindowStart },
      );

      if (!rateLimitRecord) {
        // Use UPSERT to handle concurrent inserts
        const params = {
          identifier: identifier,
          action: action,
          count: 0,
          window_start: actualWindowStart,
          window_end: windowEnd,
        };

        rateLimitRecord = await db.one<RateLimitDbRow>(
          `INSERT INTO rate_limit (identifier, action, count, window_start, window_end)
           VALUES ($(identifier), $(action), $(count), $(window_start), $(window_end))
           ON CONFLICT (identifier, action, window_start)
           DO UPDATE SET count = rate_limit.count
           RETURNING *`,
          params,
        );
      }

      const count = rateLimitRecord.count;
      const remaining = Math.max(0, limit - count);

      // Clean old windows (do this before checking limit)
      await db.none(
        `DELETE FROM rate_limit WHERE window_start < $(windowStart)`,
        { windowStart },
      );

      if (count >= limit) {
        return {
          allowed: false,
          remaining: 0,
          limit,
          resetAt: windowEnd,
        };
      }

      // Increment counter only if allowed
      await db.none(
        `UPDATE rate_limit
         SET count = count + 1
         WHERE id = $(id)`,
        { id: rateLimitRecord.id },
      );

      return {
        allowed: true,
        remaining: remaining - 1,
        limit,
        resetAt: windowEnd,
      };
    } catch (error: unknown) {
      logger.error("Failed to check rate limit", { error, identifier, action });
      // Allow request on error to avoid blocking users
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }
  },

  async getStatus(
    identifier: string,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    if (!config) {
      return {
        allowed: true,
        remaining: 1000,
        limit: 1000,
        resetAt: new Date(Date.now() + 3600000),
      };
    }

    const db = getDb();
    const limit = getActionLimit(action, config.limits);
    const windowMs = config.windowMs;
    const now = new Date();

    try {
      const windowEnd = new Date(
        Math.ceil(now.getTime() / windowMs) * windowMs,
      );
      const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

      const rateLimitRecord = await db.oneOrNone<RateLimitDbRow>(
        `SELECT * FROM rate_limit
         WHERE identifier = $(identifier)
           AND action = $(action)
           AND window_start = $(windowStart)`,
        { identifier, action, windowStart: actualWindowStart },
      );

      const used = rateLimitRecord?.count || 0;
      const remaining = Math.max(0, limit - used);

      return {
        allowed: remaining > 0,
        remaining,
        limit,
        resetAt: windowEnd,
      };
    } catch (error: unknown) {
      logger.error("Failed to get rate limit status", {
        error,
        identifier,
        action,
      });
      // On error, return permissive status
      return {
        allowed: true,
        remaining: limit,
        limit,
        resetAt: new Date(now.getTime() + windowMs),
      };
    }
  },

  async reset(identifier: string, action?: RateLimitAction): Promise<void> {
    try {
      const db = getDb();

      if (action) {
        // Reset specific action
        await db.none(
          `DELETE FROM rate_limit
           WHERE identifier = $(identifier) AND action = $(action)`,
          { identifier, action },
        );
      } else {
        // Reset all actions for identifier
        await db.none(
          `DELETE FROM rate_limit WHERE identifier = $(identifier)`,
          { identifier },
        );
      }

      logger.debug("Rate limit reset", { identifier, action });
    } catch (error) {
      logger.error("Failed to reset rate limit", { error, identifier, action });
    }
  },
};
