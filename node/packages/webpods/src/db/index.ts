/**
 * Database connection using pg-promise
 */

import pgPromise from "pg-promise";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:db");

// Track query timings for query logging
let queryCounter = 0;
const queryTimings = new Map<number, number>();

// Check if query logging is enabled
const enableQueryLogging = process.env.WEBPODS_LOG_QUERIES === "true";
if (enableQueryLogging) {
  console.info("[SQL] Query logging enabled (WEBPODS_LOG_QUERIES=true)");
}

// Initialize pg-promise with conditional configuration
const pgp = pgPromise(
  enableQueryLogging
    ? {
        // With query logging
        query(e) {
          if (process.env.LOG_LEVEL === "debug") {
            logger.debug("Query", { query: e.query, params: e.params });
          }

          // Assign a unique ID to this query
          const queryId = ++queryCounter;
          (e as unknown as { __queryId: number }).__queryId = queryId;

          // Store start time for this query
          queryTimings.set(queryId, Date.now());

          // Use console for direct output that bypasses log level restrictions
          console.info(`\n[SQL QUERY #${queryId}]`, e.query);
          if (e.params && Object.keys(e.params).length > 0) {
            console.info(
              `[SQL PARAMS #${queryId}]`,
              JSON.stringify(e.params, null, 2),
            );
          }
        },
        receive(e) {
          const rowCount =
            e.result && "rows" in e.result ? e.result.rows.length : 0;

          // Get the query ID from context
          const queryId = (e.ctx as unknown as { __queryId?: number })
            .__queryId;
          let duration = 0;

          if (queryId && queryTimings.has(queryId)) {
            duration = Date.now() - queryTimings.get(queryId)!;
            queryTimings.delete(queryId);
          }

          console.info(
            `[SQL RESULT #${queryId || "?"}] ${rowCount} rows in ${duration}ms`,
          );

          // Clean up old entries to prevent memory leak
          if (queryTimings.size > 100) {
            const oldestIds = Array.from(queryTimings.keys()).slice(0, 50);
            oldestIds.forEach((id) => queryTimings.delete(id));
          }
        },
        error(err, e) {
          logger.error("Database error", {
            error: err,
            query: e?.query,
            params: e?.params,
          });
        },
      }
    : {
        // Without query logging
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
      },
);

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
