// Database connection for WebPods
import knex, { Knex } from 'knex';
import { createLogger } from './logger.js';

const logger = createLogger('webpods:db');

let db: Knex | null = null;

export function getDb(): Knex {
  if (!db) {
    const connectionConfig = {
      host: process.env.WEBPODS_DB_HOST || 'localhost',
      port: parseInt(process.env.WEBPODS_DB_PORT || '5432'),
      database: process.env.WEBPODS_DB_NAME || 'webpods',
      user: process.env.WEBPODS_DB_USER || 'postgres',
      password: process.env.WEBPODS_DB_PASSWORD || 'postgres',
    };
    
    const config: Knex.Config = {
      client: 'pg',
      connection: connectionConfig,
      pool: {
        min: 2,
        max: 10,
      },
    };

    db = knex(config);
    logger.info('Database connection established', {
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
    logger.info('Database connection closed');
  }
}

// Helper to check if database is connected
export async function checkDbConnection(): Promise<boolean> {
  try {
    const db = getDb();
    await db.raw('SELECT 1');
    return true;
  } catch (error) {
    logger.error('Database connection check failed', { error });
    return false;
  }
}