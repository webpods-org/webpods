/**
 * Test setup for CLI integration tests
 */

import { TestDatabase, createTestUser } from "webpods-test-utils";
import { sign } from "jsonwebtoken";
import { createHash } from "crypto";
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
      provider: "test-provider",
      type: "webpods", // Required for WebPods JWT validation
      iat: Math.floor(Date.now() / 1000),
    },
    "test-secret-key", // Must match TestServer JWT_SECRET
    { expiresIn: "7d" },
  );
}

/**
 * Setup before all tests
 */
export async function setupCliTests(): Promise<void> {
  // Setup test database with a different name to avoid conflicts
  testDb = new TestDatabase({ dbName: "webpodsdb_cli_test" });
  await testDb.setup();

  // Start test server on a different port
  testServer = new CliTestServer(3456, "webpodsdb_cli_test");
  await testServer.start();

  // Create a test user and token
  testUser = await createTestUser(testDb.getDb(), {
    email: "cli-test@example.com",
    name: "CLI Test User",
    provider: "test-provider",
  });

  testToken = createTestJWT(testUser.userId, testUser.email);
}

/**
 * Cleanup after all tests
 */
export async function cleanupCliTests(): Promise<void> {
  if (testServer) {
    await testServer.stop();
  }

  if (testDb) {
    await testDb.cleanup();
  }
}

/**
 * Reset database between tests
 */
export async function resetCliTestDb(): Promise<void> {
  // Clean all data but keep the schema
  await testDb
    .getDb()
    .none('TRUNCATE TABLE record, stream, pod, "user", identity CASCADE');

  // Recreate the test user
  testUser = await createTestUser(testDb.getDb(), {
    email: "cli-test@example.com",
    name: "CLI Test User",
    provider: "test-provider",
  });

  testToken = createTestJWT(testUser.userId, testUser.email);
}

/**
 * Calculate content hash for a record
 */
export function calculateContentHash(content: unknown): string {
  const data = typeof content === "string" ? content : JSON.stringify(content);
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

/**
 * Calculate record hash
 */
export function calculateRecordHash(
  previousHash: string | null,
  contentHash: string,
  userId: string,
  timestamp: string,
): string {
  const data = JSON.stringify({
    previous_hash: previousHash,
    content_hash: contentHash,
    user_id: userId,
    timestamp: timestamp,
  });
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}
