// Database connection for WebPods
import knex, { Knex } from "knex";
import { createLogger } from "./logger.js";
import { getConfig } from "./config-loader.js";

const logger = createLogger("webpods:db");

let db: Knex | null = null;

export function getDb(): Knex {
  if (!db) {
    const appConfig = getConfig();
    const connectionConfig = {
      host: appConfig.database.host,
      port: appConfig.database.port,
      database: appConfig.database.database,
      user: appConfig.database.user,
      password: appConfig.database.password,
    };

    const knexConfig: Knex.Config = {
      client: "pg",
      connection: connectionConfig,
      pool: {
        min: 2,
        max: 10,
      },
    };

    db = knex(knexConfig);
    logger.info("Database connection established", {
      host: connectionConfig.host,
      database: connectionConfig.database,
    });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.destroy();
    db = null;
    logger.info("Database connection closed");
  }
}

// Helper to check if database is connected
export async function checkDbConnection(): Promise<boolean> {
  try {
    const db = getDb();
    await db.raw("SELECT 1");
    return true;
  } catch (error) {
    logger.error("Database connection check failed", { error });
    return false;
  }
}
