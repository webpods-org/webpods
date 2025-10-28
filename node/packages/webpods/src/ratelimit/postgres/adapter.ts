import type { RateLimiterAdapter } from "../adapter.js";
import type {
  RateLimitAction,
  RateLimitConfig,
  RateLimitResult,
} from "../types.js";
import { getActionLimit } from "../types.js";
import { getDb } from "../../db/index.js";
import { createLogger } from "../../logger.js";
import { createSchema } from "@tinqerjs/tinqer";
import {
  executeSelect,
  executeInsert,
  executeUpdate,
  executeDelete,
} from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../../db/schema.js";

const logger = createLogger("webpods:ratelimit:postgres");
const schema = createSchema<DatabaseSchema>();

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
        resetAt: Date.now() + 3600000,
      };
    }

    const db = getDb();
    const limit = getActionLimit(action, config.limits);
    const windowMS = config.windowMS;
    const now = Date.now();
    const windowStart = now - windowMS;

    try {
      // Get or create window
      const windowEnd = Math.ceil(now / windowMS) * windowMS;
      const actualWindowStart = windowEnd - windowMS;

      const rateLimitResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("rate_limit")
            .where(
              (r) =>
                r.identifier === p.identifier &&
                r.action === p.action &&
                r.window_start === p.windowStart,
            )
            .take(1),
        { identifier, action, windowStart: actualWindowStart },
      );

      let rateLimitRecord = rateLimitResults[0] || null;

      if (!rateLimitRecord) {
        // Try to insert, handle conflict with SELECT if it already exists
        try {
          const insertResults = await executeInsert(
            db,
            schema,
            (q, p) =>
              q
                .insertInto("rate_limit")
                .values({
                  identifier: p.identifier,
                  action: p.action,
                  count: p.count,
                  window_start: p.windowStart,
                  window_end: p.windowEnd,
                })
                .returning((r) => r),
            {
              identifier,
              action,
              count: 0,
              windowStart: actualWindowStart,
              windowEnd,
            },
          );
          rateLimitRecord = insertResults[0]!;
        } catch (error: unknown) {
          // On conflict (concurrent insert), query again to get the existing record
          if ((error as { code?: string }).code === "23505") {
            const retryResults = await executeSelect(
              db,
              schema,
              (q, p) =>
                q
                  .from("rate_limit")
                  .where(
                    (r) =>
                      r.identifier === p.identifier &&
                      r.action === p.action &&
                      r.window_start === p.windowStart,
                  )
                  .take(1),
              { identifier, action, windowStart: actualWindowStart },
            );
            rateLimitRecord = retryResults[0]!;
          } else {
            throw error;
          }
        }
      }

      const count = rateLimitRecord.count;
      const remaining = Math.max(0, limit - count);

      // Clean old windows (do this before checking limit)
      await executeDelete(
        db,
        schema,
        (q, p) =>
          q
            .deleteFrom("rate_limit")
            .where((r) => r.window_start < p.windowStart),
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
      const newCount = count + 1;
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("rate_limit")
            .set({ count: p.newCount })
            .where((r) => r.id === p.id),
        { id: rateLimitRecord.id, newCount },
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
        resetAt: now + windowMS,
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
        resetAt: Date.now() + 3600000,
      };
    }

    const db = getDb();
    const limit = getActionLimit(action, config.limits);
    const windowMS = config.windowMS;
    const now = Date.now();

    try {
      const windowEnd = Math.ceil(now / windowMS) * windowMS;
      const actualWindowStart = windowEnd - windowMS;

      const rateLimitResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("rate_limit")
            .where(
              (r) =>
                r.identifier === p.identifier &&
                r.action === p.action &&
                r.window_start === p.windowStart,
            )
            .take(1),
        { identifier, action, windowStart: actualWindowStart },
      );

      const rateLimitRecord = rateLimitResults[0] || null;

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
        resetAt: now + windowMS,
      };
    }
  },

  async reset(identifier: string, action?: RateLimitAction): Promise<void> {
    try {
      const db = getDb();

      if (action) {
        // Reset specific action
        await executeDelete(
          db,
          schema,
          (q, p) =>
            q
              .deleteFrom("rate_limit")
              .where(
                (r) => r.identifier === p.identifier && r.action === p.action,
              ),
          { identifier, action },
        );
      } else {
        // Reset all actions for identifier
        await executeDelete(
          db,
          schema,
          (q, p) =>
            q
              .deleteFrom("rate_limit")
              .where((r) => r.identifier === p.identifier),
          { identifier },
        );
      }

      logger.debug("Rate limit reset", { identifier, action });
    } catch (error) {
      logger.error("Failed to reset rate limit", { error, identifier, action });
    }
  },

  // Test-specific methods
  async getWindowInfo(identifier: string, action: RateLimitAction) {
    try {
      const db = getDb();
      const results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("rate_limit")
            .where(
              (r) => r.identifier === p.identifier && r.action === p.action,
            )
            .orderByDescending((r) => r.window_end)
            .take(1),
        { identifier, action },
      );

      const result = results[0] || null;

      if (!result) {
        return null;
      }

      return {
        windowStart: result.window_start,
        windowEnd: result.window_end,
      };
    } catch (error) {
      logger.error("Failed to get window info", { error, identifier, action });
      return null;
    }
  },

  async setWindow(
    identifier: string,
    action: RateLimitAction,
    data: { count: number; windowStart: number; windowEnd: number },
  ) {
    try {
      const db = getDb();

      // First delete any existing window
      await executeDelete(
        db,
        schema,
        (q, p) =>
          q
            .deleteFrom("rate_limit")
            .where(
              (r) => r.identifier === p.identifier && r.action === p.action,
            ),
        { identifier, action },
      );

      // Insert the new window with specified values
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("rate_limit").values({
            identifier: p.identifier,
            action: p.action,
            count: p.count,
            window_start: p.windowStart,
            window_end: p.windowEnd,
          }),
        {
          identifier,
          action,
          count: data.count,
          windowStart: data.windowStart,
          windowEnd: data.windowEnd,
        },
      );

      logger.debug("Rate limit window set", { identifier, action, data });
    } catch (error) {
      logger.error("Failed to set window", { error, identifier, action });
      throw error;
    }
  },

  async getAllWindows() {
    try {
      const db = getDb();
      const results = await executeSelect(
        db,
        schema,
        (q) =>
          q.from("rate_limit").select((r) => ({
            identifier: r.identifier,
            action: r.action as RateLimitAction,
            count: r.count,
            window_start: r.window_start,
            window_end: r.window_end,
          })),
        {},
      );

      return results.map((r) => ({
        identifier: r.identifier,
        action: r.action,
        count: r.count,
        windowStart: r.window_start,
        windowEnd: r.window_end,
      }));
    } catch (error) {
      logger.error("Failed to get all windows", { error });
      return [];
    }
  },
};
