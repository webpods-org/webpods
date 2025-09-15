/**
 * Custom test server for CLI tests
 */

import { spawn, ChildProcess } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export class CliTestServer {
  private process: ChildProcess | null = null;
  private port: number;
  private dbName: string;
  private cacheAdapter?: string;
  private rateLimitAdapter?: string;

  constructor(port = 3000, dbName = "webpodsdb_test") {
    this.port = port;
    this.dbName = dbName;
    // Allow overriding adapters via environment variables
    this.cacheAdapter = process.env.TEST_CACHE_ADAPTER;
    this.rateLimitAdapter = process.env.TEST_RATELIMIT_ADAPTER;
  }

  public async start(): Promise<void> {
    const serverPath = path.join(__dirname, "../../webpods/dist/index.js");
    // When compiled, this file is in dist/, so we need to go up one level
    const configPath = path.join(__dirname, "../test-config.json");

    const env: any = {
      ...process.env,
      NODE_ENV: "test",
      WEBPODS_TEST_MODE: "enabled",
      WEBPODS_CONFIG_PATH: configPath,
      WEBPODS_PORT: String(this.port),
      WEBPODS_DB_NAME: this.dbName,
      WEBPODS_DB_HOST: process.env.WEBPODS_DB_HOST || "localhost",
      WEBPODS_DB_PORT: process.env.WEBPODS_DB_PORT || "5432",
      WEBPODS_DB_USER: process.env.WEBPODS_DB_USER || "postgres",
      WEBPODS_DB_PASSWORD: process.env.WEBPODS_DB_PASSWORD || "postgres",
      JWT_SECRET: "test-secret-key",
      SESSION_SECRET: "test-session-secret",
      PORT: String(this.port),
      LOG_LEVEL: process.env.LOG_LEVEL || "info", // Set to info so server starts properly
      DOMAIN: "localhost",
    };

    return new Promise((resolve, reject) => {
      // Build command line arguments
      const args = [serverPath, "--enable-test-utils"];

      // Add cache adapter if specified
      if (this.cacheAdapter) {
        args.push("--cache-adapter", this.cacheAdapter);
      }

      // Add rate limit adapter if specified
      if (this.rateLimitAdapter) {
        args.push("--ratelimit-adapter", this.rateLimitAdapter);
      }

      // Add --enable-test-utils flag for test server
      this.process = spawn("node", args, {
        env,
        stdio: ["pipe", "inherit", "inherit"], // stdin pipe, stdout/stderr inherit to see console logs
      });

      // With inherit, we can't listen to stdout/stderr directly
      // We need to wait for the server to start in a different way
      // Let's wait longer to make sure server is fully up
      setTimeout(() => {
        resolve();
      }, 3000); // Wait 3 seconds for server to start

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          console.error(`Test server exited with code ${code}`);
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!this.process?.killed) {
          reject(new Error("Server failed to start within 10 seconds"));
        }
      }, 10000);
    });
  }

  public async stop(): Promise<void> {
    if (this.process) {
      return new Promise((resolve) => {
        this.process!.on("exit", () => {
          this.process = null;
          resolve();
        });

        this.process!.kill("SIGTERM");

        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.process) {
            this.process.kill("SIGKILL");
          }
        }, 5000);
      });
    }
  }
}
