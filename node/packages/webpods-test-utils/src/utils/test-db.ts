// Test database utilities
import knex from "knex";
import pgPromise from "pg-promise";
import * as path from "path";
import { fileURLToPath } from "url";
import { Logger, consoleLogger } from "./test-logger.js";

const pgp = pgPromise();
const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestDatabaseConfig {
  dbName?: string;
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  logger?: Logger;
}

export class TestDatabase {
  private db: pgPromise.IDatabase<any> | null = null;
  private config: TestDatabaseConfig;
  private logger: Logger;

  constructor(config: TestDatabaseConfig = {}) {
    this.config = {
      dbName: config.dbName || "webpodsdb_test",
      host: config.host || process.env.WEBPODS_DB_HOST || "localhost",
      port: config.port || parseInt(process.env.WEBPODS_DB_PORT || "5432"),
      user: config.user || process.env.WEBPODS_DB_USER || "postgres",
      password:
        config.password || process.env.WEBPODS_DB_PASSWORD || "postgres",
      logger: config.logger,
    };
    this.logger = config.logger || consoleLogger;
  }

  public async setup(): Promise<void> {
    this.logger.info(`📦 Setting up test database ${this.config.dbName}...`);

    // First connect to postgres database to drop/create test database using Knex (for migrations only)
    const adminDb = knex({
      client: "pg",
      connection: {
        host: this.config.host,
        port: this.config.port,
        database: "postgres",
        user: this.config.user,
        password: this.config.password,
      },
    });

    try {
      // Drop test database if it exists
      this.logger.info(
        `Dropping database ${this.config.dbName} if it exists...`,
      );
      await adminDb.raw(`DROP DATABASE IF EXISTS "${this.config.dbName}"`);

      // Create fresh test database
      this.logger.info(`Creating fresh database ${this.config.dbName}...`);
      await adminDb.raw(`CREATE DATABASE "${this.config.dbName}"`);
    } finally {
      await adminDb.destroy();
    }

    // Connect to test database with Knex for migrations
    const knexDb = knex({
      client: "pg",
      connection: {
        host: this.config.host,
        port: this.config.port,
        database: this.config.dbName,
        user: this.config.user,
        password: this.config.password,
      },
    });

    try {
      // Run all migrations from scratch
      const migrationsPath = path.join(
        __dirname,
        "../../../../../database/webpods/migrations",
      );
      this.logger.info(`Running full migrations from: ${migrationsPath}`);

      await knexDb.migrate.latest({
        directory: migrationsPath,
      });
    } finally {
      await knexDb.destroy();
    }

    // Now connect with pg-promise for actual usage
    const connectionString = `postgres://${this.config.user}:${this.config.password}@${this.config.host}:${this.config.port}/${this.config.dbName}`;
    this.db = pgp(connectionString);

    this.logger.info(
      `✅ Test database ${this.config.dbName} ready with fresh schema`,
    );
  }

  public async truncateAllTables(): Promise<void> {
    if (!this.db) throw new Error("Database not initialized");

    // Get all tables except knex_migrations using pg-promise
    const tables = await this.db.manyOrNone<{ tablename: string }>(
      `SELECT tablename FROM pg_tables 
       WHERE schemaname = 'public' 
       AND tablename NOT IN ('knex_migrations', 'knex_migrations_lock')`,
    );

    // Truncate all tables
    for (const { tablename } of tables) {
      await this.db.none(`TRUNCATE TABLE "${tablename}" CASCADE`);
    }
  }

  public async cleanup(): Promise<void> {
    if (this.db) {
      // pg-promise uses $pool.end() to close connections
      await (this.db as any).$pool.end();
      this.db = null;
    }
    this.logger.info(
      `🧹 Test database ${this.config.dbName} connections closed`,
    );
  }

  public getDb(): pgPromise.IDatabase<any> {
    if (!this.db) {
      throw new Error("Database not initialized. Call setup() first.");
    }
    return this.db;
  }
}
