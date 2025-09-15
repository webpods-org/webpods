// Test setup for WebPods performance tests
import {
  TestDatabase,
  TestServer,
  testLogger,
  clearAllCache,
} from "webpods-test-utils";
import * as path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { PerfReport } from "./perf-utils.js";

/* global before, after, afterEach */

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure test mode is enabled for this process
process.env.NODE_ENV = "test";
process.env.WEBPODS_TEST_MODE = "enabled";

// Test configuration - use env var if provided, otherwise default config
const configFileName = process.env.WEBPODS_CONFIG_PATH || "test-config.json";
const perfTestConfigPath = path.join(__dirname, "..", configFileName);

// Set config path for the test process itself (not just the server)
process.env.WEBPODS_CONFIG_PATH = perfTestConfigPath;

export const testDb = new TestDatabase({
  dbName: "webpodsdb_test",
  logger: testLogger,
});
export const testServer = new TestServer({
  port: 3000,
  dbName: "webpodsdb_test",
  logger: testLogger,
  configPath: perfTestConfigPath, // Use performance test config
});

// Global performance report
export const globalPerfReport = new PerfReport();

// Setup before all tests
before(async function () {
  this.timeout(60000); // 60 seconds for setup

  testLogger.info("Starting WebPods Performance Tests");

  // Read and display cache configuration only when disabled
  try {
    const configContent = await fs.readFile(perfTestConfigPath, "utf-8");
    const config = JSON.parse(configContent);
    const cacheEnabled = config.cache?.enabled || false;

    // Only log when cache is disabled - use console.warn to ensure it shows
    if (!cacheEnabled) {
      // eslint-disable-next-line no-console
      console.warn("\n⚠️  Cache Configuration: DISABLED\n");
    }
  } catch {
    // eslint-disable-next-line no-console
    console.warn("\n⚠️  Could not read cache configuration\n");
  }

  // Clear test media directory
  const testMediaDir = path.join(process.cwd(), ".tests", "media");
  await fs.rm(testMediaDir, { recursive: true, force: true }).catch(() => {});
  await fs.mkdir(testMediaDir, { recursive: true });
  testLogger.info("Cleared test media directory", { path: testMediaDir });

  // Setup database
  await testDb.setup();

  // Start the real WebPods server
  await testServer.start();
});

// Cleanup after each test
afterEach(async function () {
  // Keep data between perf tests for more realistic measurements
  // Only truncate if a test specifically requests it
  if (process.env.PERF_TEST_CLEANUP === "true") {
    await testDb.truncateAllTables();
    await clearAllCache(); // Clear cache when cleaning up data
  }
});

// Teardown after all tests
after(async function () {
  this.timeout(30000); // 30 seconds for teardown

  // Save performance summary to file
  const timestamp = Date.now();
  const summaryFile = path.join(
    process.cwd(),
    ".tests",
    `perf-${timestamp}.txt`,
  );
  await fs.mkdir(path.dirname(summaryFile), { recursive: true });
  await fs.writeFile(summaryFile, globalPerfReport.getSummary(), "utf8");
  testLogger.info(`Performance summary saved to: ${summaryFile}`);

  // Stop server
  await testServer.stop();

  // Cleanup database
  await testDb.cleanup();
});
