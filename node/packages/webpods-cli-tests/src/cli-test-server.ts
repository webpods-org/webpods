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

  constructor(port = 3456, dbName = "webpodsdb_cli_test") {
    this.port = port;
    this.dbName = dbName;
  }

  public async start(): Promise<void> {
    const serverPath = path.join(__dirname, "../../webpods/dist/index.js");
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
      LOG_LEVEL: process.env.LOG_LEVEL || "error", // Quiet during tests
      DOMAIN: "localhost",
    };

    return new Promise((resolve, reject) => {
      this.process = spawn("node", [serverPath], {
        env,
        stdio: "pipe",
      });

      let started = false;

      const checkStartup = (data: Buffer) => {
        const message = data.toString();
        if (!started && message.includes("WebPods server started")) {
          started = true;
          // Wait a bit more to ensure server is fully ready
          setTimeout(() => resolve(), 500);
        }
      };

      this.process.stdout?.on("data", checkStartup);
      this.process.stderr?.on("data", checkStartup);

      this.process.on("error", (err) => {
        reject(new Error(`Failed to start server: ${err.message}`));
      });

      this.process.on("exit", (code) => {
        if (!started) {
          reject(new Error(`Server exited with code ${code} before starting`));
        }
      });

      // Timeout after 10 seconds
      setTimeout(() => {
        if (!started) {
          this.stop();
          reject(new Error("Server startup timeout"));
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
