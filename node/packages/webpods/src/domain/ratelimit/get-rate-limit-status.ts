/**
 * Get rate limit status without incrementing
 */

import { DataContext } from "../data-context.js";
import { Result, success, failure } from "../../utils/result.js";
import { RateLimitDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { getConfig } from "../../config-loader.js";
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

export async function getRateLimitStatus(
  ctx: DataContext,
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

    const rateLimitRecord = await ctx.db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    const used = rateLimitRecord?.count || 0;
    const remaining = Math.max(0, limit - used);
    const resetAt = windowEnd;

    return success({
      limit,
      used,
      remaining,
      resetAt,
    });
  } catch (error: any) {
    logger.error("Failed to get rate limit status", {
      error,
      identifier,
      type,
    });
    return failure(new Error("Failed to get rate limit status"));
  }
}
