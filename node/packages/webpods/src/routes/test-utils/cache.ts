/**
 * Cache test utilities - endpoints for testing cache behavior
 */

import { Router, Request, Response } from "express";
import {
  getCache,
  clearAllCache,
  cacheInvalidation,
} from "../../cache/index.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("test-utils:cache");

/**
 * Create cache test utilities router
 */
export function createCacheTestRouter(): Router {
  const router = Router();

  // Clear all cache or specific pool
  router.post("/clear", async (req: Request, res: Response): Promise<void> => {
    try {
      const { pool } = req.body;

      if (pool) {
        const cache = getCache();
        if (!cache) {
          res.status(503).json({
            error: { code: "CACHE_DISABLED", message: "Cache is not enabled" },
          });
          return;
        }

        // Clear specific pool
        const validPools = ["pods", "streams", "singleRecords", "recordLists"];
        if (!validPools.includes(pool)) {
          res.status(400).json({
            error: { code: "INVALID_POOL", message: `Unknown pool: ${pool}` },
          });
          return;
        }

        // Use the clearPool method if available, otherwise fallback
        if (cache.clearPool) {
          await cache.clearPool(pool);
        } else {
          // Fallback: clear all cache (not ideal but works)
          await cache.clear();
        }
        logger.info("Cache pool cleared", { pool });
        res.json({ success: true, pool });
      } else {
        await clearAllCache();
        logger.info("All cache cleared");
        res.json({ success: true, message: "All cache cleared" });
      }
    } catch (error) {
      logger.error("Failed to clear cache", { error });
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to clear cache" },
      });
    }
  });

  // Clear by pattern
  router.post(
    "/clear-pattern",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pattern } = req.body;

        if (!pattern || typeof pattern !== "string") {
          res.status(400).json({
            error: { code: "INVALID_PATTERN", message: "Pattern is required" },
          });
          return;
        }

        // Validate pattern - only allow ":*" at the end
        if (pattern.includes("*")) {
          if (!pattern.endsWith(":*")) {
            res.status(400).json({
              error: {
                code: "INVALID_PATTERN",
                message:
                  "Wildcards must be in the format ':*' at the end (e.g., 'pod:test:*')",
              },
            });
            return;
          }

          const wildcardCount = (pattern.match(/\*/g) || []).length;
          if (wildcardCount > 1) {
            res.status(400).json({
              error: {
                code: "INVALID_PATTERN",
                message: "Only one wildcard is allowed",
              },
            });
            return;
          }
        }

        const cache = getCache();
        if (!cache) {
          res.status(503).json({
            error: { code: "CACHE_DISABLED", message: "Cache is not enabled" },
          });
          return;
        }

        await cache.clear(pattern);
        logger.info("Cache cleared by pattern", { pattern });
        res.json({ success: true, pattern });
      } catch (error) {
        logger.error("Failed to clear cache by pattern", { error });
        res.status(500).json({
          error: { code: "INTERNAL_ERROR", message: "Failed to clear cache" },
        });
      }
    },
  );

  // Get all pool statistics
  router.get("/stats", async (_req: Request, res: Response): Promise<void> => {
    try {
      const cache = getCache();
      if (!cache) {
        res.json({ stats: {} });
        return;
      }

      const stats = await cache.getAllStats();
      res.json({ stats });
    } catch (error) {
      logger.error("Failed to get cache stats", { error });
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to get cache stats" },
      });
    }
  });

  // Get specific pool statistics
  router.get(
    "/stats/:pool",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pool } = req.params;
        const cache = getCache();

        if (!cache) {
          res.json({
            hits: 0,
            misses: 0,
            evictions: 0,
            entryCount: 0,
            currentSize: 0,
          });
          return;
        }

        if (!pool) {
          res.status(400).json({
            error: {
              code: "INVALID_POOL",
              message: "Pool parameter is required",
            },
          });
          return;
        }

        const stats = await cache.getPoolStats(pool);
        res.json(stats);
      } catch (error) {
        logger.error("Failed to get pool stats", {
          error,
          pool: req.params.pool,
        });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to get pool stats",
          },
        });
      }
    },
  );

  // Check if entry exists
  router.get(
    "/exists/:pool/:key",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pool, key } = req.params;

        if (!pool || !key) {
          res.status(400).json({
            error: {
              code: "INVALID_PARAMS",
              message: "Pool and key are required",
            },
          });
          return;
        }

        const decodedKey = Buffer.from(key, "base64").toString("utf-8");

        const cache = getCache();
        if (!cache) {
          res.json({ exists: false });
          return;
        }

        const value = await cache.get(pool, decodedKey);
        const exists = value !== undefined && value !== null;

        // Get additional metadata if possible
        const response: Record<string, unknown> = { exists };

        if (exists) {
          // Calculate approximate size
          response.size = cache.checkSize(value);

          // Note: We can't get hits, createdAt, expiresAt from current API
          // These would require extending the cache adapter interface
          response.metadata = {
            type: typeof value,
            isArray: Array.isArray(value),
          };
        }

        res.json(response);
      } catch (error) {
        logger.error("Failed to check cache entry", { error });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to check cache entry",
          },
        });
      }
    },
  );

  // List keys in pool (limited to prevent memory issues)
  router.get(
    "/keys/:pool",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pool } = req.params;
        const limit = parseInt(req.query.limit as string) || 100;

        const cache = getCache();
        if (!cache) {
          res.json({ keys: [], total: 0 });
          return;
        }

        if (!cache.getKeys) {
          res.status(501).json({
            error: {
              code: "NOT_IMPLEMENTED",
              message: "Key listing not supported by cache adapter",
            },
          });
          return;
        }

        if (!pool) {
          res.status(400).json({
            error: {
              code: "INVALID_POOL",
              message: "Pool parameter is required",
            },
          });
          return;
        }

        const keys = await cache.getKeys(pool, limit);
        const stats = await cache.getPoolStats(pool);

        res.json({
          keys,
          total: stats.entryCount,
          limited: keys.length === limit,
        });
      } catch (error) {
        logger.error("Failed to list keys", { error, pool: req.params.pool });
        res.status(500).json({
          error: { code: "INTERNAL_ERROR", message: "Failed to list keys" },
        });
      }
    },
  );

  // Get entry details
  router.get(
    "/entry/:pool/:key",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pool, key } = req.params;

        if (!pool || !key) {
          res.status(400).json({
            error: {
              code: "INVALID_PARAMS",
              message: "Pool and key are required",
            },
          });
          return;
        }

        const decodedKey = Buffer.from(key, "base64").toString("utf-8");

        const cache = getCache();
        if (!cache) {
          res.json({ exists: false });
          return;
        }

        // Try to get metadata without affecting cache stats
        if (cache.getEntryMetadata) {
          const metadata = await cache.getEntryMetadata(pool, decodedKey);
          if (metadata) {
            res.json({
              ...metadata,
              pool,
              key: decodedKey,
              ttlRemaining: metadata.expiresAt
                ? Math.max(0, metadata.expiresAt - Date.now()) / 1000
                : null,
            });
            return;
          }
        }

        // Fallback to getting the actual value (affects cache stats)
        const value = await cache.get(pool, decodedKey);
        const exists = value !== undefined && value !== null;

        if (!exists) {
          res.json({ exists: false });
          return;
        }

        res.json({
          exists: true,
          pool,
          key: decodedKey,
          size: cache.checkSize(value),
          type: typeof value,
          isArray: Array.isArray(value),
        });
      } catch (error) {
        logger.error("Failed to get entry details", { error });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to get entry details",
          },
        });
      }
    },
  );

  // Force expire entry
  router.post("/expire", async (req: Request, res: Response): Promise<void> => {
    try {
      const { pool, key } = req.body;

      if (!pool || !key) {
        res.status(400).json({
          error: {
            code: "INVALID_REQUEST",
            message: "Pool and key are required",
          },
        });
        return;
      }

      const cache = getCache();
      if (!cache) {
        res.status(503).json({
          error: { code: "CACHE_DISABLED", message: "Cache is not enabled" },
        });
        return;
      }

      const deleted = await cache.delete(pool, key);
      res.json({ success: deleted, pool, key });
    } catch (error) {
      logger.error("Failed to expire entry", { error });
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to expire entry" },
      });
    }
  });

  // Modify TTL (would require cache adapter extension)
  router.post(
    "/set-ttl",
    async (_req: Request, res: Response): Promise<void> => {
      res.status(501).json({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "TTL modification not yet implemented in cache adapter",
        },
      });
    },
  );

  // Fill pool to capacity (for testing eviction)
  router.post(
    "/fill-pool",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { pool, count = 10, sizeEach = 1024 } = req.body;

        if (!pool) {
          res.status(400).json({
            error: { code: "INVALID_REQUEST", message: "Pool is required" },
          });
          return;
        }

        const cache = getCache();
        if (!cache) {
          res.status(503).json({
            error: { code: "CACHE_DISABLED", message: "Cache is not enabled" },
          });
          return;
        }

        // Create dummy data of specified size
        const dummyData = "x".repeat(sizeEach);
        const ttl = 300; // 5 minutes

        for (let i = 0; i < count; i++) {
          const key = `test-fill-${Date.now()}-${i}`;
          await cache.set(pool, key, dummyData, ttl);
        }

        const stats = await cache.getPoolStats(pool);
        res.json({
          success: true,
          pool,
          entriesAdded: count,
          currentStats: stats,
        });
      } catch (error) {
        logger.error("Failed to fill pool", { error });
        res.status(500).json({
          error: { code: "INTERNAL_ERROR", message: "Failed to fill pool" },
        });
      }
    },
  );

  // Get cache configuration
  router.get("/config", async (_req: Request, res: Response): Promise<void> => {
    try {
      // Note: Current implementation doesn't expose config
      // Would need to export getCacheConfig from cache module

      res.status(501).json({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Config access not yet implemented",
        },
      });
    } catch (error) {
      logger.error("Failed to get cache config", { error });
      res.status(500).json({
        error: {
          code: "INTERNAL_ERROR",
          message: "Failed to get cache config",
        },
      });
    }
  });

  // Temporarily modify cache config (would require extension)
  router.post(
    "/config",
    async (_req: Request, res: Response): Promise<void> => {
      res.status(501).json({
        error: {
          code: "NOT_IMPLEMENTED",
          message: "Config modification not yet implemented",
        },
      });
    },
  );

  // Debug information
  router.get("/debug", async (_req: Request, res: Response): Promise<void> => {
    try {
      const cache = getCache();
      if (!cache) {
        res.json({ enabled: false });
        return;
      }

      const stats = await cache.getAllStats();

      // Calculate aggregate stats
      const aggregate = {
        totalHits: 0,
        totalMisses: 0,
        totalEvictions: 0,
        totalEntries: 0,
        totalSize: 0,
      };

      for (const poolStats of Object.values(stats)) {
        aggregate.totalHits += poolStats.hits;
        aggregate.totalMisses += poolStats.misses;
        aggregate.totalEvictions += poolStats.evictions;
        aggregate.totalEntries += poolStats.entryCount;
        aggregate.totalSize += Number(poolStats.currentSize) || 0;
      }

      const hitRate =
        aggregate.totalHits + aggregate.totalMisses > 0
          ? aggregate.totalHits / (aggregate.totalHits + aggregate.totalMisses)
          : 0;

      res.json({
        enabled: true,
        pools: stats,
        aggregate,
        performance: {
          hitRate: (hitRate * 100).toFixed(2) + "%",
          totalRequests: aggregate.totalHits + aggregate.totalMisses,
        },
      });
    } catch (error) {
      logger.error("Failed to get debug info", { error });
      res.status(500).json({
        error: { code: "INTERNAL_ERROR", message: "Failed to get debug info" },
      });
    }
  });

  // Invalidate pod-related cache
  router.post(
    "/invalidate-pod",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { podName } = req.body;

        if (!podName) {
          res.status(400).json({
            error: { code: "INVALID_REQUEST", message: "podName is required" },
          });
          return;
        }

        await cacheInvalidation.invalidatePod(podName);
        logger.info("Pod cache invalidated", { podName });
        res.json({ success: true, podName });
      } catch (error) {
        logger.error("Failed to invalidate pod cache", { error });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to invalidate pod cache",
          },
        });
      }
    },
  );

  // Invalidate stream-related cache
  router.post(
    "/invalidate-stream",
    async (req: Request, res: Response): Promise<void> => {
      try {
        const { podName, streamPath } = req.body;

        if (!podName || !streamPath) {
          res.status(400).json({
            error: {
              code: "INVALID_REQUEST",
              message: "podName and streamPath are required",
            },
          });
          return;
        }

        await cacheInvalidation.invalidateStream(podName, streamPath);
        logger.info("Stream cache invalidated", { podName, streamPath });
        res.json({ success: true, podName, streamPath });
      } catch (error) {
        logger.error("Failed to invalidate stream cache", { error });
        res.status(500).json({
          error: {
            code: "INTERNAL_ERROR",
            message: "Failed to invalidate stream cache",
          },
        });
      }
    },
  );

  return router;
}
