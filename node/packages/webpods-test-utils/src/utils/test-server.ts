// Test server utilities
import { spawn, ChildProcess } from "child_process";
import * as path from "path";
import { fileURLToPath } from "url";
import { Logger, consoleLogger } from "./test-logger.js";
import {
  createMockOAuthProvider,
  MockOAuthProvider,
} from "./mock-oauth-provider.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export interface TestServerConfig {
  port?: number;
  dbName?: string;
  logger?: Logger;
  useMockOAuth?: boolean;
  mockOAuthPort?: number;
  configPath?: string; // Path to config.json file
  cacheAdapter?: "in-memory" | "none"; // Cache adapter override
  rateLimitAdapter?: "in-memory" | "postgres" | "none"; // Rate limit adapter override
}

export class TestServer {
  private process: ChildProcess | null = null;
  private config: TestServerConfig;
  private logger: Logger;
  private mockOAuth: MockOAuthProvider | null = null;

  constructor(config: TestServerConfig = {}) {
    this.config = {
      port: config.port || 3000,
      dbName: config.dbName || "webpodsdb_test",
      logger: config.logger,
      useMockOAuth: config.useMockOAuth !== false, // Default to true for tests
      mockOAuthPort: config.mockOAuthPort || 4567,
      configPath: config.configPath, // Use provided config path
      cacheAdapter: config.cacheAdapter,
      rateLimitAdapter: config.rateLimitAdapter,
    };
    this.logger = config.logger || consoleLogger;
  }

  public async start(): Promise<void> {
    // Start mock OAuth provider first if enabled
    if (this.config.useMockOAuth) {
      this.mockOAuth = createMockOAuthProvider(this.config.mockOAuthPort!);
      await this.mockOAuth.start();
    }

    const serverPath = path.join(__dirname, "../../../webpods/dist/cli.js");

    // Path to test config file - use provided path or default to integration tests config
    const testConfigPath =
      this.config.configPath ||
      path.join(
        __dirname,
        "../../../webpods-integration-tests/test-config.json",
      );

    // Set environment variables (minimal now, config is in JSON)
    const env: any = {
      ...process.env,
      NODE_ENV: "test",
      WEBPODS_TEST_MODE: "enabled", // Enable test mode for integration tests
      WEBPODS_CONFIG_PATH: testConfigPath,
      WEBPODS_PORT: String(this.config.port),
      WEBPODS_DB_NAME: this.config.dbName,
      WEBPODS_DB_HOST: process.env.WEBPODS_DB_HOST || "localhost",
      WEBPODS_DB_PORT: process.env.WEBPODS_DB_PORT || "5432",
      WEBPODS_DB_USER: process.env.WEBPODS_DB_USER || "postgres",
      WEBPODS_DB_PASSWORD: process.env.WEBPODS_DB_PASSWORD || "postgres",
      JWT_SECRET: "test-secret-key",
      SESSION_SECRET: "test-session-secret",
      PORT: String(this.config.port),
      LOG_LEVEL: process.env.LOG_LEVEL || "info", // Set to info so server starts properly
      DOMAIN: "localhost", // Use localhost for testing
    };

    return new Promise((resolve, reject) => {
      // Build command line arguments
      const args = [serverPath, "--enable-test-utils"];

      // Add cache adapter if specified
      if (this.config.cacheAdapter) {
        args.push("--cache-adapter", this.config.cacheAdapter);
      }

      // Add rate limit adapter if specified
      if (this.config.rateLimitAdapter) {
        args.push("--ratelimit-adapter", this.config.rateLimitAdapter);
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
        this.logger.error("Failed to start test server", { error: err });
        reject(err);
      });

      this.process.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          this.logger.error(`Test server exited with code ${code}`);
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
    if (this.process && !this.process.killed) {
      this.process.kill("SIGTERM");

      // Wait for process to exit
      await new Promise((resolve) => {
        if (this.process) {
          this.process.on("exit", resolve);
          setTimeout(resolve, 2000); // Timeout after 2 seconds
        } else {
          resolve(undefined);
        }
      });

      this.process = null;
    }

    // Stop mock OAuth provider if it was started
    if (this.mockOAuth) {
      await this.mockOAuth.stop();
      this.mockOAuth = null;
    }
  }

  public getMockOAuth(): MockOAuthProvider | null {
    return this.mockOAuth;
  }
}
