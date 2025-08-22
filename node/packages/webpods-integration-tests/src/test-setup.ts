// Test setup for WebPods integration tests
import { TestDatabase, TestServer, testLogger } from "webpods-test-utils";
import * as path from "path";
import { fileURLToPath } from "url";

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
// Note: Each test file should create its own TestHttpClient instance to avoid interference

// Setup before all tests
before(async function () {
  this.timeout(60000); // 60 seconds for setup

  // Setup database
  await testDb.setup();

  // Start the real WebPods server
  await testServer.start();
});

// Cleanup after each test
afterEach(async function () {
  await testDb.truncateAllTables();
  // Note: Each test file manages its own client, so no global client cleanup needed
});

// Teardown after all tests
after(async function () {
  this.timeout(30000); // 30 seconds for teardown

  // Stop server
  await testServer.stop();

  // Cleanup database
  await testDb.cleanup();
});
