/**
 * Database connection using pg-promise
 */

import pgPromise from "pg-promise";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:db");

// Initialize pg-promise
const pgp = pgPromise({
  // Log queries in debug mode
  query(e) {
    if (process.env.LOG_LEVEL === "debug") {
      logger.debug("Query", { query: e.query, params: e.params });
    }
  },
  error(err, e) {
    logger.error("Database error", {
      error: err,
      query: e?.query,
      params: e?.params,
    });
  },
});

// Database connection instance
let db: pgPromise.IDatabase<unknown> | null = null;

export type Database = pgPromise.IDatabase<unknown>;

export function getDb(): Database {
  if (!db) {
    const appConfig = getConfig();
    const connectionConfig = {
      host: appConfig.database.host,
      port: appConfig.database.port,
      database: appConfig.database.database,
      user: appConfig.database.user,
      password: appConfig.database.password,
    };

    db = pgp(connectionConfig);

    logger.info("Database connection established", {
      host: connectionConfig.host,
      database: connectionConfig.database,
    });
  }
  return db;
}

export async function closeDb(): Promise<void> {
  if (db) {
    await db.$pool.end();
    db = null;
    logger.info("Database connection closed");
  }
}

// Helper to check if database is connected
export async function checkDbConnection(): Promise<boolean> {
  try {
    const database = getDb();
    await database.one("SELECT 1 as result");
    return true;
  } catch (error) {
    logger.error("Database connection check failed", { error });
    return false;
  }
}

// Export pgp for use in transactions and helpers
export { pgp };

// Export SQL helper functions
export * as sql from "./sql.js";
