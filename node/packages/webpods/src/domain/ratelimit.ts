/**
 * Rate limiting domain logic
 */

import { Database } from "../db/index.js";
import { RateLimitDbRow } from "../db-types.js";
import { Result } from "../types.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:domain:ratelimit");

export type RateLimitType = "read" | "write" | "pod_create" | "stream_create";

interface RateLimitConfig {
  read: number;
  write: number;
  pod_create: number;
  stream_create: number;
}

// Get rate limits from config
function getRateLimits(): RateLimitConfig {
  const config = getConfig();
  return {
    read: config.rateLimits.reads,
    write: config.rateLimits.writes,
    pod_create: config.rateLimits.podCreate,
    stream_create: config.rateLimits.streamCreate,
  };
}

/**
 * Increment rate limit counter for tracking purposes
 */
export async function incrementRateLimit(
  db: Database,
  identifier: string,
  type: RateLimitType,
): Promise<void> {
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  const windowEnd = new Date(Math.ceil(now.getTime() / windowMs) * windowMs);
  const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

  try {
    const rateLimitRecord = await db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    if (!rateLimitRecord) {
      // Create new window with count 1
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES (gen_random_uuid(), $(identifier), $(type), 1, $(windowStart), $(windowEnd))`,
        { identifier, type, windowStart: actualWindowStart, windowEnd },
      );
    } else {
      // Increment existing counter
      await db.none(
        `UPDATE rate_limit 
         SET count = count + 1
         WHERE id = $(id)`,
        { id: rateLimitRecord.id },
      );
    }
  } catch (error) {
    // Log but don't fail the operation
    logger.error("Failed to increment rate limit", { error, identifier, type });
  }
}

/**
 * Check if request is rate limited
 */
export async function checkRateLimit(
  db: Database,
  identifier: string,
  type: RateLimitType,
): Promise<Result<{ allowed: boolean; remaining: number; resetAt: Date }>> {
  const limits = getRateLimits();
  const limit = limits[type];
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    // Get or create window
    const windowEnd = new Date(Math.ceil(now.getTime() / windowMs) * windowMs);
    const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

    let rateLimitRecord = await db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    if (!rateLimitRecord) {
      // Create new window
      rateLimitRecord = await db.one<RateLimitDbRow>(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES (gen_random_uuid(), $(identifier), $(type), 0, $(windowStart), $(windowEnd))
         RETURNING *`,
        { identifier, type, windowStart: actualWindowStart, windowEnd },
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
        success: true,
        data: {
          allowed: false,
          remaining: 0,
          resetAt: windowEnd,
        },
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
      success: true,
      data: {
        allowed: true,
        remaining: remaining - 1,
        resetAt: windowEnd,
      },
    };
  } catch (error: any) {
    logger.error("Failed to check rate limit", { error, identifier, type });
    // Allow request on error to avoid blocking users
    return {
      success: true,
      data: {
        allowed: true,
        remaining: limit,
        resetAt: new Date(now.getTime() + windowMs),
      },
    };
  }
}

/**
 * Get rate limit status without incrementing
 */
export async function getRateLimitStatus(
  db: Database,
  identifier: string,
  type: RateLimitType,
): Promise<
  Result<{ limit: number; used: number; remaining: number; resetAt: Date }>
> {
  const limits = getRateLimits();
  const limit = limits[type];
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();

  try {
    const windowEnd = new Date(Math.ceil(now.getTime() / windowMs) * windowMs);
    const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

    const rateLimitRecord = await db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    const used = rateLimitRecord?.count || 0;
    const remaining = Math.max(0, limit - used);
    const resetAt = windowEnd;

    return {
      success: true,
      data: {
        limit,
        used,
        remaining,
        resetAt,
      },
    };
  } catch (error: any) {
    logger.error("Failed to get rate limit status", {
      error,
      identifier,
      type,
    });
    return {
      success: false,
      error: {
        code: "DATABASE_ERROR",
        message: "Failed to get rate limit status",
      },
    };
  }
}
