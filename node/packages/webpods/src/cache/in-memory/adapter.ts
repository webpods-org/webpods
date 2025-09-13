import type { CacheAdapter } from "../adapter.js";
import type {
  CacheConfig,
  CacheKey,
  CacheStats,
  RecordCachePoolConfig,
  RecordListCachePoolConfig,
} from "../types.js";
import { createLRUCache, type LRUCache } from "./lru-cache.js";

type CachePools = {
  pods: LRUCache;
  streams: LRUCache;
  singleRecords: LRUCache;
  recordLists: LRUCache;
};

let pools: CachePools | null = null;
let config: CacheConfig | null = null;
let cleanupInterval: NodeJS.Timeout | null = null;

// Helper to check if value should be cached based on size limits
function shouldCache(
  pool: keyof CachePools,
  value: unknown,
  config: CacheConfig,
): boolean {
  if (!config.pools[pool].enabled) return false;

  const size = pools![pool].checkSize(value);

  // Check size limits for specific pools
  if (pool === "singleRecords") {
    const poolConfig = config.pools.singleRecords as RecordCachePoolConfig;
    if (size > poolConfig.maxRecordSizeBytes) return false;
  } else if (pool === "recordLists") {
    const poolConfig = config.pools.recordLists as RecordListCachePoolConfig;
    if (size > poolConfig.maxResultSizeBytes) return false;

    // Check record count if it's an array
    if (Array.isArray(value) && value.length > poolConfig.maxRecordsPerQuery) {
      return false;
    }
  }

  return true;
}

// Periodic cleanup of expired entries
function startCleanup(): void {
  if (cleanupInterval) return;

  cleanupInterval = setInterval(
    () => {
      if (!pools) return;

      // Force a get on a few entries in each pool to trigger expiration checks
      Object.values(pools).forEach((pool) => {
        // This is a simple way to trigger cleanup without exposing internals
        // In production, we might want a more sophisticated approach
        pool.get("__cleanup_check__");
      });
    },
    60000, // Run every minute
  );
}

function stopCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
  }
}

export const inMemoryCacheAdapter: CacheAdapter = {
  async initialize(cfg: CacheConfig): Promise<void> {
    config = cfg;
    pools = {
      pods: createLRUCache(cfg.pools.pods.maxEntries),
      streams: createLRUCache(cfg.pools.streams.maxEntries),
      singleRecords: createLRUCache(cfg.pools.singleRecords.maxEntries),
      recordLists: createLRUCache(
        (cfg.pools.recordLists as RecordListCachePoolConfig).maxQueries,
      ),
    };
    startCleanup();
  },

  async shutdown(): Promise<void> {
    stopCleanup();
    if (pools) {
      Object.values(pools).forEach((pool) => pool.clear());
      pools = null;
    }
    config = null;
  },

  async get<T>(pool: string, key: CacheKey): Promise<T | null> {
    if (!pools || !config) return null;
    if (!(pool in pools)) return null;
    if (!config.pools[pool as keyof CachePools].enabled) return null;

    return pools[pool as keyof CachePools].get(key) as T | null;
  },

  async set<T>(
    pool: string,
    key: CacheKey,
    value: T,
    ttlSeconds: number,
  ): Promise<void> {
    if (!pools || !config) return;
    if (!(pool in pools)) return;

    const poolKey = pool as keyof CachePools;
    if (!shouldCache(poolKey, value, config)) return;

    pools[poolKey].set(key, value, ttlSeconds);
  },

  async delete(pool: string, key: CacheKey): Promise<boolean> {
    if (!pools) return false;
    if (!(pool in pools)) return false;

    return pools[pool as keyof CachePools].delete(key);
  },

  async deletePattern(pool: string, pattern: string): Promise<number> {
    if (!pools) return 0;
    if (!(pool in pools)) return 0;

    // Delete all keys matching the pattern in the specified pool
    // Pattern can use * as wildcard (e.g., "pod-streams:cache-test:*")
    return pools[pool as keyof CachePools].deletePattern(pattern);
  },

  async clear(pattern?: string): Promise<void> {
    if (!pools) return;

    if (!pattern) {
      // Clear all pools
      Object.values(pools).forEach((pool) => pool.clear());
    } else {
      // Clear by pattern across all pools
      Object.values(pools).forEach((pool) => pool.clear(pattern));
    }
  },

  async getPoolStats(pool: string): Promise<CacheStats> {
    if (!pools || !(pool in pools)) {
      return {
        hits: 0,
        misses: 0,
        evictions: 0,
        currentSize: 0,
        entryCount: 0,
      };
    }

    return pools[pool as keyof CachePools].getStats();
  },

  async getAllStats(): Promise<Record<string, CacheStats>> {
    if (!pools) return {};

    const stats: Record<string, CacheStats> = {};
    for (const [name, pool] of Object.entries(pools)) {
      stats[name] = pool.getStats();
    }
    return stats;
  },

  checkSize(value: unknown): number {
    // Use any pool's checkSize method (they're all the same)
    if (!pools) return 0;
    return pools.pods.checkSize(value);
  },
};