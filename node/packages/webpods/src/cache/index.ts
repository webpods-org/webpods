import type { CacheAdapter } from "./adapter.js";
import type { CacheConfig } from "./types.js";
import { inMemoryCacheAdapter } from "./in-memory/index.js";
import { cacheKeys } from "./keys.js";

// Global cache instance
let cacheInstance: CacheAdapter | null = null;
let cacheConfig: CacheConfig | null = null;

export async function initializeCache(config: CacheConfig): Promise<void> {
  if (!config.enabled) {
    cacheInstance = null;
    cacheConfig = null;
    return;
  }

  // Store the config for later access
  cacheConfig = config;

  // Select adapter based on config
  switch (config.adapter) {
    case "in-memory":
      cacheInstance = inMemoryCacheAdapter;
      break;
    case "redis":
      // Future: import and use Redis adapter
      throw new Error("Redis cache adapter not yet implemented");
    default:
      throw new Error(`Unknown cache adapter: ${config.adapter}`);
  }

  await cacheInstance.initialize(config);
}

export async function shutdownCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.shutdown();
    cacheInstance = null;
    cacheConfig = null;
  }
}

export function getCache(): CacheAdapter | null {
  return cacheInstance;
}

export function getCacheConfig(): CacheConfig | null {
  return cacheConfig;
}

// Clear all cache entries (useful for testing)
export async function clearAllCache(): Promise<void> {
  if (cacheInstance) {
    await cacheInstance.clear();
  }
}

// Cache invalidation helpers
export const cacheInvalidation = {
  // When a pod is updated/deleted
  async invalidatePod(podName: string): Promise<void> {
    if (!cacheInstance) return;

    // Clear all pod-related caches using pattern
    await cacheInstance.clear(cacheKeys.podPattern(podName));
  },

  // When a stream is updated/deleted
  async invalidateStream(podName: string, streamPath: string): Promise<void> {
    if (!cacheInstance) return;

    // Clear all stream-related caches using pattern
    await cacheInstance.clear(cacheKeys.streamPattern(podName, streamPath));
  },

  // When a record is added/updated/deleted
  async invalidateRecord(
    podName: string,
    streamPath: string,
    recordName: string,
  ): Promise<void> {
    if (!cacheInstance) return;

    // Clear specific record and all list caches for the stream
    await cacheInstance.clear(
      cacheKeys.recordPattern(podName, streamPath, recordName),
    );
    await cacheInstance.clear(cacheKeys.recordListPattern(podName, streamPath));
  },

  // When bulk operations occur
  async invalidateStreamAllRecords(
    podName: string,
    streamPath: string,
  ): Promise<void> {
    if (!cacheInstance) return;

    // Clear all records and lists for this stream
    await cacheInstance.clear(cacheKeys.streamPattern(podName, streamPath));
  },
};

// Re-export types and utilities
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
