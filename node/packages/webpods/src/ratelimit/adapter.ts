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

  // Test-specific methods (optional, for testing internals)
  getWindowInfo?: (
    identifier: string,
    action: RateLimitAction,
  ) => Promise<{ windowStart: Date; windowEnd: Date } | null>;

  setWindow?: (
    identifier: string,
    action: RateLimitAction,
    data: {
      count: number;
      windowStart: Date;
      windowEnd: Date;
    },
  ) => Promise<void>;

  getAllWindows?: () => Promise<
    Array<{
      identifier: string;
      action: RateLimitAction;
      count: number;
      windowStart: Date;
      windowEnd: Date;
    }>
  >;

  // Lifecycle
  initialize: (config: RateLimitConfig) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type CreateRateLimiterAdapter = (
  config: RateLimitConfig,
) => RateLimiterAdapter;
