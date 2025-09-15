import type { RateLimitAction } from "../types.js";

type WindowData = {
  count: number;
  windowStart: number;
  windowEnd: number;
};

/**
 * Efficient fixed-window rate limiter using counters
 * Matches PostgreSQL implementation for consistency
 */
export class FixedWindowRateLimiter {
  // Map key format: "identifier:action:windowStart"
  private windows: Map<string, WindowData> = new Map();
  private windowMS: number;
  private maxIdentifiers: number;
  private stats = {
    totalChecks: 0,
    totalAllowed: 0,
    totalDenied: 0,
  };
  private lastCleanup: number = Date.now();
  private cleanupInterval: number;

  constructor(
    windowMS: number,
    maxIdentifiers: number = 10000,
    cleanupIntervalMs: number = 60000, // Clean every minute by default
  ) {
    this.windowMS = windowMS;
    this.maxIdentifiers = maxIdentifiers;
    this.cleanupInterval = cleanupIntervalMs;
  }

  /**
   * Check if request is allowed and increment counter if so
   * O(1) time complexity
   */
  checkAndIncrement(
    identifier: string,
    action: RateLimitAction,
    limit: number,
  ): {
    allowed: boolean;
    remaining: number;
    resetAt: Date;
    currentCount: number;
  } {
    this.stats.totalChecks++;
    const now = Date.now();

    // Calculate window boundaries (matching PostgreSQL logic)
    const windowEnd = Math.ceil(now / this.windowMS) * this.windowMS;
    const windowStart = windowEnd - this.windowMS;
    const key = `${identifier}:${action}:${windowStart}`;

    // Periodic cleanup
    if (now - this.lastCleanup > this.cleanupInterval) {
      this.cleanup();
      this.lastCleanup = now;
    }

    // Get or create window data
    let windowData = this.windows.get(key);
    if (!windowData || windowData.windowStart !== windowStart) {
      // New window or expired window
      windowData = {
        count: 0,
        windowStart,
        windowEnd,
      };

      // Check size limit before adding
      if (this.windows.size >= this.maxIdentifiers * 4) {
        // Emergency cleanup if too many windows
        this.cleanup();
      }

      this.windows.set(key, windowData);
    }

    // Check if allowed
    const allowed = windowData.count < limit;
    const remaining = Math.max(0, limit - windowData.count - (allowed ? 1 : 0));

    if (allowed) {
      this.stats.totalAllowed++;
      windowData.count++;
    } else {
      this.stats.totalDenied++;
    }

    return {
      allowed,
      remaining,
      resetAt: new Date(windowEnd),
      currentCount: windowData.count,
    };
  }

  /**
   * Get current status without incrementing
   * O(1) time complexity
   */
  getStatus(
    identifier: string,
    action: RateLimitAction,
    limit: number,
  ): {
    remaining: number;
    resetAt: Date;
    currentCount: number;
  } {
    const now = Date.now();
    const windowEnd = Math.ceil(now / this.windowMS) * this.windowMS;
    const windowStart = windowEnd - this.windowMS;
    const key = `${identifier}:${action}:${windowStart}`;

    const windowData = this.windows.get(key);
    const currentCount = windowData?.count || 0;
    const remaining = Math.max(0, limit - currentCount);

    return {
      remaining,
      resetAt: new Date(windowEnd),
      currentCount,
    };
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string, action?: RateLimitAction): void {
    if (action) {
      // Reset specific action - find and delete matching windows
      for (const [key] of this.windows) {
        if (key.startsWith(`${identifier}:${action}:`)) {
          this.windows.delete(key);
        }
      }
    } else {
      // Reset all actions for identifier
      for (const [key] of this.windows) {
        if (key.startsWith(`${identifier}:`)) {
          this.windows.delete(key);
        }
      }
    }
  }

  /**
   * Clean up expired windows
   * O(n) but only runs periodically
   */
  cleanup(): void {
    const now = Date.now();
    const cutoff = now - this.windowMS; // Remove windows older than one window period

    for (const [key, data] of this.windows) {
      if (data.windowEnd < cutoff) {
        this.windows.delete(key);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeWindows: this.windows.size,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.windows.clear();
    this.stats = {
      totalChecks: 0,
      totalAllowed: 0,
      totalDenied: 0,
    };
  }

  // Test-specific methods to match the adapter interface

  /**
   * Get window info for testing
   */
  getWindowInfo(
    identifier: string,
    action: RateLimitAction,
  ): { windowStart: Date; windowEnd: Date } | null {
    const now = Date.now();
    const windowEnd = Math.ceil(now / this.windowMS) * this.windowMS;
    const windowStart = windowEnd - this.windowMS;
    const key = `${identifier}:${action}:${windowStart}`;

    const windowData = this.windows.get(key);
    if (!windowData) return null;

    return {
      windowStart: new Date(windowData.windowStart),
      windowEnd: new Date(windowData.windowEnd),
    };
  }

  /**
   * Set window data for testing
   */
  setWindow(
    identifier: string,
    action: RateLimitAction,
    data: { count: number; windowStart: Date; windowEnd: Date },
  ): void {
    const key = `${identifier}:${action}:${data.windowStart.getTime()}`;
    this.windows.set(key, {
      count: data.count,
      windowStart: data.windowStart.getTime(),
      windowEnd: data.windowEnd.getTime(),
    });
  }

  /**
   * Get all windows for testing
   */
  getAllWindows(): Array<{
    identifier: string;
    action: RateLimitAction;
    count: number;
    windowStart: Date;
    windowEnd: Date;
  }> {
    const results: Array<{
      identifier: string;
      action: RateLimitAction;
      count: number;
      windowStart: Date;
      windowEnd: Date;
    }> = [];

    for (const [key, data] of this.windows) {
      const parts = key.split(":");
      // Key format is "identifier:action:windowStart"
      if (parts.length >= 3 && parts[0] && parts[1]) {
        results.push({
          identifier: parts[0],
          action: parts[1] as RateLimitAction,
          count: data.count,
          windowStart: new Date(data.windowStart),
          windowEnd: new Date(data.windowEnd),
        });
      }
    }

    return results;
  }
}
