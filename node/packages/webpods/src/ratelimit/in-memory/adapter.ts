import type { RateLimiterAdapter } from "../adapter.js";
import type {
  RateLimitAction,
  RateLimitConfig,
  RateLimitResult,
  RateLimitStats,
} from "../types.js";
import { getActionLimit } from "../types.js";
import { SlidingWindowRateLimiter } from "./sliding-window.js";

let rateLimiter: SlidingWindowRateLimiter | null = null;
let config: RateLimitConfig | null = null;
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function startCleanup(intervalMs: number): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(() => {
    if (rateLimiter) {
      rateLimiter.cleanup();
    }
  }, intervalMs);
}

function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export const inMemoryRateLimiterAdapter: RateLimiterAdapter = {
  async initialize(cfg: RateLimitConfig): Promise<void> {
    config = cfg;
    rateLimiter = new SlidingWindowRateLimiter(
      cfg.windowMs,
      cfg.maxIdentifiers || 10000,
    );

    // Start cleanup interval
    startCleanup(cfg.cleanupIntervalMs || 60000);
  },

  async shutdown(): Promise<void> {
    stopCleanup();
    if (rateLimiter) {
      rateLimiter.clear();
      rateLimiter = null;
    }
    config = null;
  },

  async checkAndIncrement(
    identifier: string,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    if (!rateLimiter || !config) {
      // If not initialized, allow all requests
      return {
        allowed: true,
        remaining: 1000,
        limit: 1000,
        resetAt: new Date(Date.now() + 3600000),
      };
    }

    const limit = getActionLimit(action, config.limits);
    const result = rateLimiter.checkAndIncrement(identifier, action, limit);

    return {
      allowed: result.allowed,
      remaining: result.remaining,
      limit,
      resetAt: result.resetAt,
    };
  },

  async getStatus(
    identifier: string,
    action: RateLimitAction,
  ): Promise<RateLimitResult> {
    if (!rateLimiter || !config) {
      // If not initialized, return default status
      return {
        allowed: true,
        remaining: 1000,
        limit: 1000,
        resetAt: new Date(Date.now() + 3600000),
      };
    }

    const limit = getActionLimit(action, config.limits);
    const status = rateLimiter.getStatus(identifier, action, limit);

    return {
      allowed: status.remaining > 0,
      remaining: status.remaining,
      limit,
      resetAt: status.resetAt,
    };
  },

  async reset(identifier: string, action?: RateLimitAction): Promise<void> {
    if (!rateLimiter) return;
    rateLimiter.reset(identifier, action);
  },

  async getStats(): Promise<RateLimitStats> {
    if (!rateLimiter) {
      return {
        totalChecks: 0,
        totalAllowed: 0,
        totalDenied: 0,
        activeWindows: 0,
      };
    }

    return rateLimiter.getStats();
  },

  // Test-specific methods
  async getWindowInfo(identifier: string, action: RateLimitAction) {
    if (!rateLimiter) return null;
    return rateLimiter.getWindowInfo(identifier, action);
  },

  async setWindow(
    identifier: string,
    action: RateLimitAction,
    data: { count: number; windowStart: Date; windowEnd: Date },
  ) {
    if (!rateLimiter) return;
    rateLimiter.setWindow(identifier, action, data);
  },

  async getAllWindows() {
    if (!rateLimiter) return [];
    return rateLimiter.getAllWindows();
  },
};
