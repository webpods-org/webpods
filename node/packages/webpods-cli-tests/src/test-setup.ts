/**
 * Test setup for CLI integration tests
 */

import { 
  TestDatabase,
  createTestUser
} from "webpods-test-utils";
import { sign } from "jsonwebtoken";
import { CliTestServer } from "./cli-test-server.js";

// Global test context
export let testServer: CliTestServer;
export let testDb: TestDatabase;
export let testUser: any;
export let testToken: string;

/**
 * Create a test JWT token
 */
function createTestJWT(userId: string, email: string): string {
  return sign(
    { 
      sub: userId, 
      email: email,
      provider: "test-provider"
    },
    "test-secret-key", // Must match TestServer JWT_SECRET
    { expiresIn: "7d" }
  );
}

/**
 * Setup before all tests
 */
export async function setupCliTests(): Promise<void> {
  console.log("Setting up CLI test environment...");
  
  // Setup test database with a different name to avoid conflicts
  testDb = new TestDatabase({ dbName: "webpodsdb_cli_test" });
  await testDb.setup();
  
  // Start test server on a different port
  testServer = new CliTestServer(3456, "webpodsdb_cli_test");
  await testServer.start();
  
  // Wait for server to be ready
  await new Promise(resolve => setTimeout(resolve, 2000));
  
  // Create a test user and token
  testUser = await createTestUser(testDb.getDb(), {
    email: "cli-test@example.com",
    name: "CLI Test User",
    provider: "test-provider"
  });
  
  testToken = createTestJWT(testUser.id, testUser.email);
  
  console.log("CLI test environment ready");
}

/**
 * Cleanup after all tests
 */
export async function cleanupCliTests(): Promise<void> {
  console.log("Cleaning up CLI test environment...");
  
  if (testServer) {
    await testServer.stop();
  }
  
  if (testDb) {
    await testDb.cleanup();
  }
  
  console.log("CLI test environment cleaned up");
}

/**
 * Reset database between tests
 */
export async function resetCliTestDb(): Promise<void> {
  // Clean all data but keep the schema
  await testDb.getDb().none("TRUNCATE TABLE record, stream, pod, \"user\", identity CASCADE");
  
  // Recreate the test user
  testUser = await createTestUser(testDb.getDb(), {
    email: "cli-test@example.com",
    name: "CLI Test User",
    provider: "test-provider"
  });
  
  testToken = createTestJWT(testUser.id, testUser.email);
}