import type { CacheConfig, CacheKey, CacheStats } from "./types.js";

export type CacheAdapter = {
  // Basic operations
  get: <T>(pool: string, key: CacheKey) => Promise<T | null | undefined>;
  set: <T>(
    pool: string,
    key: CacheKey,
    value: T | null,
    ttlSeconds: number,
    size?: number, // Optional pre-calculated size to avoid expensive JSON.stringify
  ) => Promise<void>;
  delete: (pool: string, key: CacheKey) => Promise<boolean>;
  deletePattern: (pool: string, pattern: string) => Promise<number>; // Delete by pattern, returns count deleted
  clear: (pattern?: string) => Promise<void>; // Clear by pattern or all
  clearPool?: (pool: string) => Promise<void>; // Clear entire pool

  // Pool management
  getPoolStats: (pool: string) => Promise<CacheStats>;
  getAllStats: () => Promise<Record<string, CacheStats>>;

  // Size checking (for conditional caching)
  checkSize: (value: unknown) => number;

  // Introspection (optional, for testing/debugging)
  getKeys?: (pool: string, limit?: number) => Promise<string[]>;
  getEntryMetadata?: (
    pool: string,
    key: string,
  ) => Promise<{
    exists: boolean;
    size?: number;
    hits?: number;
    expiresAt?: number;
    age?: number;
  } | null>;

  // Lifecycle
  initialize: (config: CacheConfig) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type CreateCacheAdapter = (config: CacheConfig) => CacheAdapter;
