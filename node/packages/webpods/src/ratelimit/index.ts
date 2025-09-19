import type { RateLimiterAdapter } from "./adapter.js";
import type { RateLimitConfig } from "./types.js";
import { inMemoryRateLimiterAdapter } from "./in-memory/index.js";
import { postgresRateLimiterAdapter } from "./postgres/index.js";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:ratelimit");

// Global rate limiter instance
let rateLimiterInstance: RateLimiterAdapter | null = null;
let rateLimiterConfig: RateLimitConfig | null = null;

export async function initializeRateLimiter(
  config: RateLimitConfig,
): Promise<void> {
  if (!config.enabled) {
    rateLimiterInstance = null;
    rateLimiterConfig = null;
    logger.info("Rate limiting disabled");
    return;
  }

  // Store the config for later access
  rateLimiterConfig = config;

  // Select adapter based on config
  switch (config.adapter) {
    case "in-memory":
      rateLimiterInstance = inMemoryRateLimiterAdapter;
      break;
    case "postgres":
      rateLimiterInstance = postgresRateLimiterAdapter;
      break;
    case "redis":
      // Future: import and use Redis adapter
      throw new Error("Redis rate limiter adapter not yet implemented");
    default:
      throw new Error(`Unknown rate limiter adapter: ${config.adapter}`);
  }

  await rateLimiterInstance.initialize(config);
  logger.info("Rate limiter initialized", { adapter: config.adapter });
}

export async function shutdownRateLimiter(): Promise<void> {
  if (rateLimiterInstance) {
    await rateLimiterInstance.shutdown();
    rateLimiterInstance = null;
    rateLimiterConfig = null;
    logger.info("Rate limiter shut down");
  }
}

export function getRateLimiter(): RateLimiterAdapter | null {
  return rateLimiterInstance;
}

export function getRateLimiterConfig(): RateLimitConfig | null {
  return rateLimiterConfig;
}

// Helper function to check rate limit (convenience wrapper)
export async function checkRateLimit(
  identifier: string,
  action: import("./types.js").RateLimitAction,
): Promise<import("./types.js").RateLimitResult> {
  if (!rateLimiterInstance) {
    // If not initialized, allow all requests
    return {
      allowed: true,
      remaining: 1000,
      limit: 1000,
      resetAt: Date.now() + 3600000,
    };
  }

  return rateLimiterInstance.checkAndIncrement(identifier, action);
}

// Re-export types and utilities
export type { RateLimiterAdapter } from "./adapter.js";
export type {
  RateLimitAction,
  RateLimitConfig,
  RateLimitResult,
  RateLimitStats,
} from "./types.js";
export { defaultRateLimitConfig, getActionLimit } from "./types.js";
