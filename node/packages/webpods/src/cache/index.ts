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
  async invalidatePod(podId: string, subdomain: string): Promise<void> {
    if (!cacheInstance) return;

    // Delete specific pod entry
    await cacheInstance.delete("pods", cacheKeys.pod(subdomain));

    // Clear all streams under this pod
    await cacheInstance.clear(cacheKeys.podPattern(podId));
  },

  // When a stream is updated/deleted
  async invalidateStream(
    streamId: string,
    podId: string,
    path: string,
  ): Promise<void> {
    if (!cacheInstance) return;

    // Delete specific stream entry by path
    await cacheInstance.delete("streams", cacheKeys.stream(podId, path));

    // Delete stream entry by ID (for get-stream-by-id caching)
    await cacheInstance.delete("streams", `stream-id:${streamId}`);

    // Clear pod streams cache (since stream list changed)
    await cacheInstance.clear(`pod-streams:${podId}:*`);

    // Clear all record lists for this stream
    await cacheInstance.clear(cacheKeys.recordListPattern(streamId));
  },

  // When a record is added/updated/deleted
  async invalidateRecord(streamId: string, recordName: string): Promise<void> {
    if (!cacheInstance) return;

    // Delete specific record entry
    await cacheInstance.delete(
      "singleRecords",
      cacheKeys.record(streamId, recordName),
    );

    // Invalidate all list queries for this stream (since lists would change)
    await cacheInstance.clear(cacheKeys.recordListPattern(streamId));
  },

  // When bulk operations occur
  async invalidateStream全Records(streamId: string): Promise<void> {
    if (!cacheInstance) return;

    // Clear all individual records and lists for this stream
    await cacheInstance.clear(`record:${streamId}:*`);
    await cacheInstance.clear(cacheKeys.recordListPattern(streamId));
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
