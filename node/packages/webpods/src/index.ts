/**
 * WebPods server entry point
 */

import { config } from "dotenv";
import { createLogger } from "./logger.js";
import { closeDb, checkDbConnection } from "./db.js";
import { startStateCleanup } from "./auth/pkce-store.js";
import { createApp } from "./server.js";
import { getConfig } from "./config-loader.js";
import { getVersion } from "./version.js";

// Load environment variables (for secrets referenced in config.json)
config();

const logger = createLogger("webpods");

export async function start() {
  try {
    // Load configuration (will validate required fields)
    const appConfig = getConfig();

    // Check OAuth configuration
    const { getConfiguredProviders } = await import("./auth/oauth-config.js");
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

    // Start PKCE state cleanup
    startStateCleanup();

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
        await closeDb();
        process.exit(0);
      });
    });

    process.on("SIGINT", async () => {
      logger.info("SIGINT received, shutting down gracefully");
      server.close(async () => {
        await closeDb();
        process.exit(0);
      });
    });
  } catch (error: any) {
    console.error(`\nError: ${error.message}`);
    process.exit(1);
  }
}

// Start if run directly
if (import.meta.url === `file://${process.argv[1]}`) {
  start();
}

export { start as default };
