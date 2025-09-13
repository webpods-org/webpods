import { createLRUCache } from "./lru-cache.js";
let pools = null;
let config = null;
let cleanupInterval = null;
// Helper to check if value should be cached based on size limits
function shouldCache(pool, value, config) {
  if (!config.pools[pool].enabled) return false;
  const size = pools[pool].checkSize(value);
  // Check size limits for specific pools
  if (pool === "singleRecords") {
    const poolConfig = config.pools.singleRecords;
    if (size > poolConfig.maxRecordSizeBytes) return false;
  } else if (pool === "recordLists") {
    const poolConfig = config.pools.recordLists;
    if (size > poolConfig.maxResultSizeBytes) return false;
    // Check record count if it's an array
    if (Array.isArray(value) && value.length > poolConfig.maxRecordsPerQuery) {
      return false;
    }
  }
  return true;
}
// Periodic cleanup of expired entries
function startCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    if (!pools) return;
    // Force a get on a few entries in each pool to trigger expiration checks
    Object.values(pools).forEach((pool) => {
      // This is a simple way to trigger cleanup without exposing internals
      // In production, we might want a more sophisticated approach
      pool.get("__cleanup_check__");
    });
  }, 60000);
}
function stopCleanup() {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}
export const inMemoryCacheAdapter = {
  async initialize(cfg) {
    config = cfg;
    pools = {
      pods: createLRUCache(cfg.pools.pods.maxEntries),
      streams: createLRUCache(cfg.pools.streams.maxEntries),
      singleRecords: createLRUCache(cfg.pools.singleRecords.maxEntries),
      recordLists: createLRUCache(cfg.pools.recordLists.maxQueries),
    };
    startCleanup();
  },
  async shutdown() {
    stopCleanup();
    if (pools) {
      Object.values(pools).forEach((pool) => pool.clear());
      pools = null;
    }
    config = null;
  },
  async get(pool, key) {
    if (!pools || !config) return null;
    if (!(pool in pools)) return null;
    if (!config.pools[pool].enabled) return null;
    return pools[pool].get(key);
  },
  async set(pool, key, value, ttlSeconds) {
    if (!pools || !config) return;
    if (!(pool in pools)) return;
    const poolKey = pool;
    if (!shouldCache(poolKey, value, config)) return;
    pools[poolKey].set(key, value, ttlSeconds);
  },
  async delete(pool, key) {
    if (!pools) return false;
    if (!(pool in pools)) return false;
    return pools[pool].delete(key);
  },
  async deletePattern(pool, pattern) {
    if (!pools) return 0;
    if (!(pool in pools)) return 0;
    // Delete all keys matching the pattern in the specified pool
    // Pattern can use * as wildcard (e.g., "pod-streams:cache-test:*")
    return pools[pool].deletePattern(pattern);
  },
  async clear(pattern) {
    if (!pools) return;
    if (!pattern) {
      // Clear all pools
      Object.values(pools).forEach((pool) => pool.clear());
    } else {
      // Clear by pattern across all pools
      Object.values(pools).forEach((pool) => pool.clear(pattern));
    }
  },
  async getPoolStats(pool) {
    if (!pools || !(pool in pools)) {
      return {
        hits: 0,
        misses: 0,
        evictions: 0,
        currentSize: 0,
        entryCount: 0,
      };
    }
    return pools[pool].getStats();
  },
  async getAllStats() {
    if (!pools) return {};
    const stats = {};
    for (const [name, pool] of Object.entries(pools)) {
      stats[name] = pool.getStats();
    }
    return stats;
  },
  checkSize(value) {
    // Use any pool's checkSize method (they're all the same)
    if (!pools) return 0;
    return pools.pods.checkSize(value);
  },
};
//# sourceMappingURL=adapter.js.map
