/**
 * WebPods server entry point
 */

import { config } from "dotenv";
import { createLogger } from "./logger.js";
import { closeDb, checkDbConnection } from "./db/index.js";
import { cleanupExpiredStates } from "./auth/pkce-store.js";
import { createApp } from "./server.js";
import { getConfig } from "./config-loader.js";
import { getVersion } from "./version.js";
import { getConfiguredProviders } from "./auth/oauth-config.js";
import { initializeCache, shutdownCache } from "./cache/index.js";
import {
  initializeRateLimiter,
  shutdownRateLimiter,
} from "./ratelimit/index.js";
import type { RateLimitConfig } from "./ratelimit/types.js";

// Load environment variables (for secrets referenced in config.json)
config();

const logger = createLogger("webpods");

export async function start() {
  try {
    // Load configuration (will validate required fields)
    const appConfig = getConfig();

    // Check OAuth configuration
    const configuredProviders = getConfiguredProviders();

    if (configuredProviders.length === 0) {
      logger.error(
        "At least one OAuth provider must be configured in config.json",
      );
      process.exit(1);
    }

    logger.info("Configuration loaded", {
      providers: configuredProviders,
      defaultProvider: appConfig.oauth.defaultProvider,
      publicUrl: appConfig.server.publicUrl,
      host: appConfig.server.host,
      port: appConfig.server.port,
    });

    // Test database connection
    const dbConnected = await checkDbConnection();
    if (!dbConnected) {
      logger.error("Failed to connect to database");
      process.exit(1);
    }

    // Initialize cache if configured
    // Check for CLI/env override for cache adapter
    const cacheAdapterOverride = process.env.CACHE_ADAPTER;
    if (cacheAdapterOverride === "none") {
      logger.info("Cache disabled via CLI/env override");
    } else if (appConfig.cache?.enabled || cacheAdapterOverride) {
      const cacheConfig = appConfig.cache || {
        enabled: true,
        adapter: "in-memory" as const,
        pools: {
          pods: { enabled: true, maxEntries: 1000, ttlSeconds: 300 },
          streams: { enabled: true, maxEntries: 5000, ttlSeconds: 300 },
          singleRecords: {
            enabled: true,
            maxEntries: 10000,
            ttlSeconds: 60,
            maxRecordSizeBytes: 10240,
          },
          recordLists: {
            enabled: true,
            maxQueries: 500,
            ttlSeconds: 30,
            maxResultSizeBytes: 52428800,
            maxRecordsPerQuery: 1000,
          },
        },
      };

      // Override adapter if specified via CLI/env
      if (cacheAdapterOverride && cacheAdapterOverride !== "none") {
        cacheConfig.adapter = cacheAdapterOverride as "in-memory";
        cacheConfig.enabled = true;
      }

      await initializeCache(cacheConfig);
      logger.info("Cache initialized", {
        adapter: cacheConfig.adapter,
        overridden: !!cacheAdapterOverride,
        pools: Object.keys(cacheConfig.pools).filter(
          (pool) =>
            cacheConfig.pools[pool as keyof typeof cacheConfig.pools].enabled,
        ),
      });
    } else {
      logger.info("Cache disabled");
    }

    // Initialize rate limiter
    // Check for CLI/env override for rate limit adapter
    const rateLimitAdapterOverride = process.env.RATELIMIT_ADAPTER;
    if (rateLimitAdapterOverride === "none") {
      logger.info("Rate limiting disabled via CLI/env override");
    } else {
      const rateLimiterConfig: RateLimitConfig = {
        enabled: appConfig.rateLimits.enabled !== false, // Default to enabled
        adapter: appConfig.rateLimits.adapter || "in-memory", // Default to in-memory
        limits: {
          reads: appConfig.rateLimits.reads,
          writes: appConfig.rateLimits.writes,
          podCreate: appConfig.rateLimits.podCreate,
          streamCreate: appConfig.rateLimits.streamCreate,
        },
        windowMS: appConfig.rateLimits.windowMS || 3600000, // Default 1 hour
        cleanupIntervalMS: appConfig.rateLimits.cleanupIntervalMS,
        maxIdentifiers: appConfig.rateLimits.maxIdentifiers,
      };

      // Override adapter if specified via CLI/env
      if (rateLimitAdapterOverride && rateLimitAdapterOverride !== "none") {
        rateLimiterConfig.adapter = rateLimitAdapterOverride as
          | "in-memory"
          | "postgres";
        rateLimiterConfig.enabled = true;
        logger.info(
          `Rate limit adapter overridden to: ${rateLimitAdapterOverride}`,
        );
      }

      // Only initialize if enabled
      if (rateLimiterConfig.enabled) {
        await initializeRateLimiter(rateLimiterConfig);
        logger.info("Rate limiter initialized", {
          enabled: rateLimiterConfig.enabled,
          adapter: rateLimiterConfig.adapter,
          overridden: !!rateLimitAdapterOverride,
        });
      } else {
        logger.info("Rate limiting disabled");
      }
    }

    // Start PKCE state cleanup
    setInterval(
      () => {
        cleanupExpiredStates().catch((err) =>
          logger.error("Failed to cleanup expired states", err),
        );
      },
      60 * 60 * 1000,
    ); // Run every hour

    // Create app
    const app = createApp();
    const port = appConfig.server.port;

    const server = app.listen(port, appConfig.server.host, () => {
      logger.info(`WebPods server started`, {
        version: getVersion(),
        host: appConfig.server.host,
        port,
        publicUrl: appConfig.server.publicUrl,
        cors: appConfig.server.corsOrigin,
      });
    });

    // Graceful shutdown
    process.on("SIGTERM", async () => {
      logger.info("SIGTERM received, shutting down gracefully");
      server.close(async () => {
        await shutdownRateLimiter();
        await shutdownCache();
        await closeDb();
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");
      server.close(async () => {
        await shutdownRateLimiter();
        await shutdownCache();
        await closeDb();
        process.exit(0);
      });
    });

    // Handle uncaught exceptions and rejections in test mode
    if (process.env.NODE_ENV === "test") {
      process.on("uncaughtException", (error) => {
        logger.error("Uncaught exception in test mode", { error });
        // Don't exit in test mode, let tests continue
      });

      process.on("unhandledRejection", (reason, promise) => {
        logger.error("Unhandled rejection in test mode", { reason, promise });
        // Don't exit in test mode, let tests continue
      });
    }
  } catch (error: unknown) {
    console.error(`\nError: ${(error as Error).message}`);
    process.exit(1);
  }
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { start as default };
