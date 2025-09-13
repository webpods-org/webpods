import type { CacheStats } from "../types.js";
export type LRUCache<T = unknown> = {
  get: (key: string) => T | null;
  set: (key: string, value: T, ttlSeconds: number) => void;
  delete: (key: string) => boolean;
  deletePattern: (pattern: string) => number;
  clear: (pattern?: string) => void;
  getStats: () => CacheStats;
  checkSize: (value: unknown) => number;
};
export declare function createLRUCache<T>(maxEntries: number): LRUCache<T>;
//# sourceMappingURL=lru-cache.d.ts.map
