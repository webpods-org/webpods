/**
 * Increment rate limit counter for tracking purposes
 */

import { DataContext } from "../data-context.js";
import { RateLimitDbRow } from "../../db-types.js";
import { createLogger } from "../../logger.js";
import { sql } from "../../db/index.js";

const logger = createLogger("webpods:domain:ratelimit");

export type RateLimitType = "read" | "write" | "pod_create" | "stream_create";

export async function incrementRateLimit(
  ctx: DataContext,
  identifier: string,
  type: RateLimitType,
): Promise<void> {
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  const windowEnd = new Date(Math.ceil(now.getTime() / windowMs) * windowMs);
  const actualWindowStart = new Date(windowEnd.getTime() - windowMs);

  try {
    const rateLimitRecord = await ctx.db.oneOrNone<RateLimitDbRow>(
      `SELECT * FROM rate_limit
       WHERE identifier = $(identifier)
         AND action = $(type)
         AND window_start = $(windowStart)`,
      { identifier, type, windowStart: actualWindowStart },
    );

    if (!rateLimitRecord) {
      // Create new window with count 1
      const params = {
        identifier: identifier,
        action: type,
        count: 1,
        window_start: actualWindowStart,
        window_end: windowEnd,
      };

      await ctx.db.none(sql.insert("rate_limit", params), params);
    } else {
      // Increment existing counter
      await ctx.db.none(
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
