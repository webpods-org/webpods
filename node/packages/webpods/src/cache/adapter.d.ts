import type { CacheConfig, CacheKey, CacheStats } from "./types.js";
export type CacheAdapter = {
  get: <T>(pool: string, key: CacheKey) => Promise<T | null>;
  set: <T>(
    pool: string,
    key: CacheKey,
    value: T,
    ttlSeconds: number,
  ) => Promise<void>;
  delete: (pool: string, key: CacheKey) => Promise<boolean>;
  deletePattern: (pool: string, pattern: string) => Promise<number>;
  clear: (pattern?: string) => Promise<void>;
  getPoolStats: (pool: string) => Promise<CacheStats>;
  getAllStats: () => Promise<Record<string, CacheStats>>;
  checkSize: (value: unknown) => number;
  initialize: (config: CacheConfig) => Promise<void>;
  shutdown: () => Promise<void>;
};
export type CreateCacheAdapter = (config: CacheConfig) => CacheAdapter;
//# sourceMappingURL=adapter.d.ts.map
