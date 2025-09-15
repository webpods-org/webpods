import type {
  RateLimitAction,
  RateLimitConfig,
  RateLimitResult,
  RateLimitStats,
} from "./types.js";

export type RateLimiterAdapter = {
  // Check and increment in one atomic operation
  checkAndIncrement: (
    identifier: string,
    action: RateLimitAction,
  ) => Promise<RateLimitResult>;

  // Get current status without incrementing
  getStatus: (
    identifier: string,
    action: RateLimitAction,
  ) => Promise<RateLimitResult>;

  // Reset rate limit for identifier (useful for testing)
  reset: (identifier: string, action?: RateLimitAction) => Promise<void>;

  // Get statistics (optional, for monitoring)
  getStats?: () => Promise<RateLimitStats>;

  // Lifecycle
  initialize: (config: RateLimitConfig) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type CreateRateLimiterAdapter = (
  config: RateLimitConfig,
) => RateLimiterAdapter;
