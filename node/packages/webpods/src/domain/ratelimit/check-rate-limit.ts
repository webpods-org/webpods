/**
 * Check if request is rate limited
 */

import { DataContext } from "../data-context.js";
import { Result, success } from "../../utils/result.js";
import { RateLimitDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getConfig } from "../../config-loader.js";
import { sql } from "../../db/index.js";
import type { RateLimitType } from "./increment-rate-limit.js";

const logger = createLogger("webpods:domain:ratelimit");

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

export async function checkRateLimit(
  ctx: DataContext,
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

    let rateLimitRecord = await ctx.db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    if (!rateLimitRecord) {
      // Create new window with snake_case parameters
      const params = {
        id: crypto.randomUUID(),
        identifier: identifier,
        action: type,
        count: 0,
        window_start: actualWindowStart,
        window_end: windowEnd,
      };

      rateLimitRecord = await ctx.db.one<RateLimitDbRow>(
        `${sql.insert("rate_limit", params)} RETURNING *`,
        params,
      );
    }

    const count = rateLimitRecord.count;
    const remaining = Math.max(0, limit - count);

    // Clean old windows (do this before checking limit)
    await ctx.db.none(
      `DELETE FROM rate_limit WHERE window_start < $(windowStart)`,
      { windowStart },
    );

    if (count >= limit) {
      return success({
        allowed: false,
        remaining: 0,
        resetAt: windowEnd,
      });
    }

    // Increment counter only if allowed
    await ctx.db.none(
      `UPDATE rate_limit 
       SET count = count + 1
       WHERE id = $(id)`,
      { id: rateLimitRecord.id },
    );

    return success({
      allowed: true,
      remaining: remaining - 1,
      resetAt: windowEnd,
    });
  } catch (error: any) {
    logger.error("Failed to check rate limit", { error, identifier, type });
    // Allow request on error to avoid blocking users
    return success({
      allowed: true,
      remaining: limit,
      resetAt: new Date(now.getTime() + windowMs),
    });
  }
}
