export type RateLimitAction = "read" | "write" | "pod_create" | "stream_create";

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  limit: number;
  resetAt: Date;
};

export type RateLimitStats = {
  totalChecks: number;
  totalAllowed: number;
  totalDenied: number;
  activeWindows: number;
};

export type RateLimitConfig = {
  enabled: boolean;
  adapter: "in-memory" | "postgres" | "redis";

  // Adapter-specific config
  adapterConfig?: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };

  // Rate limits
  limits: {
    reads: number;
    writes: number;
    podCreate: number;
    streamCreate: number;
  };

  // Window configuration
  windowMs: number; // Window duration in milliseconds

  // In-memory specific options
  cleanupIntervalMs?: number; // How often to clean up expired windows (default: 60000)
  maxIdentifiers?: number; // Max number of identifiers to track (default: 10000)
};

// Default rate limit configuration
export const defaultRateLimitConfig: RateLimitConfig = {
  enabled: true,
  adapter: "in-memory",
  limits: {
    reads: 10000,
    writes: 1000,
    podCreate: 10,
    streamCreate: 100,
  },
  windowMs: 3600000, // 1 hour
  cleanupIntervalMs: 60000, // 1 minute
  maxIdentifiers: 10000,
};

// Helper to map action to limit
export function getActionLimit(
  action: RateLimitAction,
  limits: RateLimitConfig["limits"],
): number {
  switch (action) {
    case "read":
      return limits.reads;
    case "write":
      return limits.writes;
    case "pod_create":
      return limits.podCreate;
    case "stream_create":
      return limits.streamCreate;
  }
}
