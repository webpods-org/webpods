import type { CacheConfig, CacheKey, CacheStats } from "./types.js";

export type CacheAdapter = {
  // Basic operations
  get: <T>(pool: string, key: CacheKey) => Promise<T | null | undefined>;
  set: <T>(
    pool: string,
    key: CacheKey,
    value: T | null,
    ttlSeconds: number,
  ) => Promise<void>;
  delete: (pool: string, key: CacheKey) => Promise<boolean>;
  deletePattern: (pool: string, pattern: string) => Promise<number>; // Delete by pattern, returns count deleted
  clear: (pattern?: string) => Promise<void>; // Clear by pattern or all

  // Pool management
  getPoolStats: (pool: string) => Promise<CacheStats>;
  getAllStats: () => Promise<Record<string, CacheStats>>;

  // Size checking (for conditional caching)
  checkSize: (value: unknown) => number;

  // Lifecycle
  initialize: (config: CacheConfig) => Promise<void>;
  shutdown: () => Promise<void>;
};

export type CreateCacheAdapter = (config: CacheConfig) => CacheAdapter;
