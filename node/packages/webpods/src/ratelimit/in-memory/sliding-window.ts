import type { RateLimitAction } from "../types.js";

type WindowEntry = {
  timestamp: number;
  count: number;
};

type IdentifierData = Map<RateLimitAction, WindowEntry[]>;

export class SlidingWindowRateLimiter {
  private data: Map<string, IdentifierData> = new Map();
  private windowMS: number;
  private maxIdentifiers: number;
  private stats = {
    totalChecks: 0,
    totalAllowed: 0,
    totalDenied: 0,
  };

  constructor(windowMS: number, maxIdentifiers: number = 10000) {
    this.windowMS = windowMS;
    this.maxIdentifiers = maxIdentifiers;
  }

  /**
   * Check if request is allowed and increment counter if so
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
    const windowStart = now - this.windowMS;

    // Get or create identifier data
    let identifierData = this.data.get(identifier);
    if (!identifierData) {
      // Check if we've hit max identifiers limit
      if (this.data.size >= this.maxIdentifiers) {
        // Evict oldest identifier (simple LRU)
        const firstKey = this.data.keys().next().value;
        if (firstKey) {
          this.data.delete(firstKey);
        }
      }
      identifierData = new Map();
      this.data.set(identifier, identifierData);
    }

    // Get or create action entries
    let entries = identifierData.get(action) || [];

    // Remove expired entries
    entries = entries.filter((entry) => entry.timestamp > windowStart);

    // Calculate current count
    const currentCount = entries.reduce((sum, entry) => sum + entry.count, 0);

    // Calculate reset time (next window boundary)
    const resetAt = new Date(now + this.windowMS);

    // Check if allowed
    const allowed = currentCount < limit;
    const remaining = Math.max(0, limit - currentCount - (allowed ? 1 : 0));

    if (allowed) {
      this.stats.totalAllowed++;
      // Add new entry
      entries.push({
        timestamp: now,
        count: 1,
      });
      identifierData.set(action, entries);
    } else {
      this.stats.totalDenied++;
    }

    return {
      allowed,
      remaining,
      resetAt,
      currentCount: allowed ? currentCount + 1 : currentCount,
    };
  }

  /**
   * Get current status without incrementing
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
    const windowStart = now - this.windowMS;

    const identifierData = this.data.get(identifier);
    if (!identifierData) {
      return {
        remaining: limit,
        resetAt: new Date(now + this.windowMS),
        currentCount: 0,
      };
    }

    let entries = identifierData.get(action) || [];

    // Remove expired entries
    entries = entries.filter((entry) => entry.timestamp > windowStart);

    // Calculate current count
    const currentCount = entries.reduce((sum, entry) => sum + entry.count, 0);

    return {
      remaining: Math.max(0, limit - currentCount),
      resetAt: new Date(now + this.windowMS),
      currentCount,
    };
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string, action?: RateLimitAction): void {
    if (!action) {
      // Reset all actions for identifier
      this.data.delete(identifier);
    } else {
      // Reset specific action
      const identifierData = this.data.get(identifier);
      if (identifierData) {
        identifierData.delete(action);
        if (identifierData.size === 0) {
          this.data.delete(identifier);
        }
      }
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMS;

    for (const [identifier, identifierData] of this.data.entries()) {
      for (const [action, entries] of identifierData.entries()) {
        const validEntries = entries.filter(
          (entry) => entry.timestamp > windowStart,
        );
        if (validEntries.length === 0) {
          identifierData.delete(action);
        } else if (validEntries.length < entries.length) {
          identifierData.set(action, validEntries);
        }
      }

      // Remove identifier if no actions left
      if (identifierData.size === 0) {
        this.data.delete(identifier);
      }
    }
  }

  /**
   * Get statistics
   */
  getStats() {
    return {
      ...this.stats,
      activeWindows: this.data.size,
    };
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.data.clear();
    this.stats = {
      totalChecks: 0,
      totalAllowed: 0,
      totalDenied: 0,
    };
  }

  /**
   * Get window info for testing
   */
  getWindowInfo(
    identifier: string,
    action: RateLimitAction,
  ): { windowStart: Date; windowEnd: Date } | null {
    const identifierData = this.data.get(identifier);
    if (!identifierData) return null;

    const entries = identifierData.get(action);
    if (!entries || entries.length === 0) return null;

    // For sliding window, we calculate based on current time
    const now = Date.now();
    const windowStart = new Date(now - this.windowMS);
    const windowEnd = new Date(now);

    return { windowStart, windowEnd };
  }

  /**
   * Set window data for testing
   */
  setWindow(
    identifier: string,
    action: RateLimitAction,
    data: { count: number; windowStart: Date; windowEnd: Date },
  ): void {
    // Clear existing entries
    let identifierData = this.data.get(identifier);
    if (!identifierData) {
      identifierData = new Map();
      this.data.set(identifier, identifierData);
    }

    // Create entries based on the count and window times
    const entries: WindowEntry[] = [];
    const windowStartMs = data.windowStart.getTime();

    // Distribute entries evenly across the window
    for (let i = 0; i < data.count; i++) {
      entries.push({ timestamp: windowStartMs + i * 1000, count: 1 }); // Spread by 1 second
    }

    identifierData.set(action, entries);
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

    const now = Date.now();
    const windowStart = now - this.windowMS;

    for (const [identifier, identifierData] of this.data.entries()) {
      for (const [action, entries] of identifierData.entries()) {
        // Count valid entries within window
        const validEntries = entries.filter(
          (entry) => entry.timestamp > windowStart,
        );

        if (validEntries.length > 0) {
          results.push({
            identifier,
            action,
            count: validEntries.length,
            windowStart: new Date(windowStart),
            windowEnd: new Date(now),
          });
        }
      }
    }

    return results;
  }
}
