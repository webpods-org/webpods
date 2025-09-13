import type { CacheAdapter } from "./adapter.js";
import type { CacheConfig } from "./types.js";
export declare function initializeCache(config: CacheConfig): Promise<void>;
export declare function shutdownCache(): Promise<void>;
export declare function getCache(): CacheAdapter | null;
export declare function getCacheConfig(): CacheConfig | null;
export declare function clearAllCache(): Promise<void>;
export declare const cacheInvalidation: {
  invalidatePod(podId: string, subdomain: string): Promise<void>;
  invalidateStream(
    streamId: string,
    podId: string,
    path: string,
  ): Promise<void>;
  invalidateRecord(streamId: string, recordName: string): Promise<void>;
  invalidateStream全Records(streamId: string): Promise<void>;
};
export type { CacheAdapter } from "./adapter.js";
export type {
  CacheConfig,
  CacheStats,
  CacheEntry,
  CachePoolConfig,
  RecordCachePoolConfig,
  RecordListCachePoolConfig,
} from "./types.js";
export { defaultCacheConfig } from "./types.js";
export { cacheKeys } from "./keys.js";
//# sourceMappingURL=index.d.ts.map
