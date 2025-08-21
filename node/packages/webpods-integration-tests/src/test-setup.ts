// Test setup for WebPods integration tests
import { TestDatabase, TestServer, testLogger } from "webpods-test-utils";

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
