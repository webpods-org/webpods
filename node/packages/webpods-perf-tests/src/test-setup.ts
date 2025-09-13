// Test setup for WebPods performance tests
import { TestDatabase, TestServer, testLogger } from "webpods-test-utils";
import * as path from "path";
import { fileURLToPath } from "url";
import { promises as fs } from "fs";
import { PerfReport } from "./perf-utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Ensure test mode is enabled for this process
process.env.NODE_ENV = "test";
process.env.WEBPODS_TEST_MODE = "enabled";

// Set config path for the test process itself (not just the server)
process.env.WEBPODS_CONFIG_PATH = path.join(__dirname, "../test-config.json");

// Test configuration
export const testDb = new TestDatabase({
  dbName: "webpodsdb_test",
  logger: testLogger,
});
export const testServer = new TestServer({
  port: 3000,
  dbName: "webpodsdb_test",
  logger: testLogger,
});

// Global performance report
export const globalPerfReport = new PerfReport();

// Setup before all tests
before(async function () {
  this.timeout(60000); // 60 seconds for setup

  console.log("\n🚀 Starting WebPods Performance Tests...\n");

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
  }
});

// Teardown after all tests
after(async function () {
  this.timeout(30000); // 30 seconds for teardown

  // Print performance summary
  console.log(globalPerfReport.getSummary());

  // Stop server
  await testServer.stop();

  // Cleanup database
  await testDb.cleanup();
});
