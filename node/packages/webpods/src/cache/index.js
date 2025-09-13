import { inMemoryCacheAdapter } from "./in-memory/index.js";
import { cacheKeys } from "./keys.js";
// Global cache instance
let cacheInstance = null;
let cacheConfig = null;
export async function initializeCache(config) {
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
export async function shutdownCache() {
  if (cacheInstance) {
    await cacheInstance.shutdown();
    cacheInstance = null;
    cacheConfig = null;
  }
}
export function getCache() {
  return cacheInstance;
}
export function getCacheConfig() {
  return cacheConfig;
}
// Clear all cache entries (useful for testing)
export async function clearAllCache() {
  if (cacheInstance) {
    await cacheInstance.clear();
  }
}
// Cache invalidation helpers
export const cacheInvalidation = {
  // When a pod is updated/deleted
  async invalidatePod(podId, subdomain) {
    if (!cacheInstance) return;
    // Delete specific pod entry
    await cacheInstance.delete("pods", cacheKeys.pod(subdomain));
    // Clear all streams under this pod
    await cacheInstance.clear(cacheKeys.podPattern(podId));
  },
  // When a stream is updated/deleted
  async invalidateStream(streamId, podId, path) {
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
  async invalidateRecord(streamId, recordName) {
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
  async invalidateStream全Records(streamId) {
    if (!cacheInstance) return;
    // Clear all individual records and lists for this stream
    await cacheInstance.clear(`record:${streamId}:*`);
    await cacheInstance.clear(cacheKeys.recordListPattern(streamId));
  },
};
export { defaultCacheConfig } from "./types.js";
export { cacheKeys } from "./keys.js";
//# sourceMappingURL=index.js.map
