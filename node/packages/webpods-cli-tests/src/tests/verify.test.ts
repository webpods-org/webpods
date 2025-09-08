/**
 * CLI Verify Command Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
} from "../test-setup.js";
import {
  createOwnerConfig,
  createTestStream,
  createTestRecord,
} from "../utils/test-data-helpers.js";

describe("CLI Verify Command", function () {
  this.timeout(30000);

  let cli: CliTestHelper;
  let testPodName: string;

  before(async () => {
    await setupCliTests();
    cli = new CliTestHelper();
    await cli.setup();
  });

  after(async () => {
    await cli.cleanup();
    await cleanupCliTests();
  });

  beforeEach(async () => {
    await resetCliTestDb();

    // Create a test pod
    testPodName = `test-pod-${Date.now()}`;
    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });

    // Create owner config
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );

    // Create test stream with proper hash chain
    const streamId = await createTestStream(testDb.getDb(), {
      podName: testPodName,
      streamPath: "test-stream",
      userId: testUser.userId,
      accessPermission: "private",
    });

    // Add records with proper hash chain
    let previousHash: string | null = null;
    for (let i = 0; i < 5; i++) {
      const contentObj = { index: i, data: `Record ${i}` };
      const content = JSON.stringify(contentObj);

      await createTestRecord(testDb.getDb(), {
        streamId,
        name: `record-${i}`,
        content,
        contentType: "application/json",
        userId: testUser.userId,
        index: i,
        previousHash,
      });

      // Get the actual hash for the next iteration
      const record = await testDb.getDb().one<{ hash: string }>(
        `SELECT hash FROM record 
         WHERE stream_id = $(streamId) AND index = $(index)`,
        { streamId, index: i },
      );
      previousHash = record.hash;
    }
  });

  describe("verify command - summary", () => {
    it("should show stream summary by default", async () => {
      const result = await cli.exec(["verify", testPodName, "/test-stream"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Stream '/test-stream' summary:");
      expect(result.stdout).to.include("Total records: 5");
      expect(result.stdout).to.include("First record:");
      expect(result.stdout).to.include("Last record:");
      expect(result.stdout).to.include("Hash chain:");
    });

    it("should handle empty stream", async () => {
      // Create empty stream using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "empty-stream",
        userId: testUser.userId,
        accessPermission: "private",
      });

      const result = await cli.exec(["verify", testPodName, "/empty-stream"], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Stream '/empty-stream' is empty");
    });
  });

  describe("verify command - show chain", () => {
    it("should display full hash chain with --show-chain", async () => {
      const result = await cli.exec(
        ["verify", testPodName, "/test-stream", "--show-chain"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Hash chain for stream '/test-stream':");

      // Should show all 5 records
      for (let i = 0; i < 5; i++) {
        expect(result.stdout).to.include(`Index ${i}:`);
        expect(result.stdout).to.include(`Name: record-${i}`);
        expect(result.stdout).to.include("Hash: sha256:");
      }

      // First record should have no previous hash
      expect(result.stdout).to.include("Previous: (genesis)");
    });
  });

  describe("verify command - check integrity", () => {
    it("should verify valid hash chain", async () => {
      const result = await cli.exec(
        ["verify", testPodName, "/test-stream", "--check-integrity"],
        {
          token: testToken,
        },
      );

      console.log("Verify stdout:", result.stdout);
      console.log("Verify stderr:", result.stderr);
      console.log("Verify exitCode:", result.exitCode);
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        "Verifying integrity of stream '/test-stream'",
      );
      expect(result.stdout).to.include("✓ Stream integrity verified");
      expect(result.stdout).to.include("all 5 records are valid");
    });

    it("should detect broken hash chain", async () => {
      // Break the hash chain by updating a record's previous_hash
      // First get the stream
      const stream = await testDb.getDb().one<{
        id: number;
      }>(`SELECT id FROM stream WHERE pod_name = $(podName) AND name = $(streamName) AND parent_id IS NULL`, { podName: testPodName, streamName: "test-stream" });

      await testDb
        .getDb()
        .none(
          "UPDATE record SET previous_hash = $(brokenHash) WHERE stream_id = $(streamId) AND index = 3",
          {
            brokenHash: "sha256:broken",
            streamId: stream.id,
          },
        );

      const result = await cli.exec(
        ["verify", testPodName, "/test-stream", "--check-integrity"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Hash chain broken");
      expect(result.stderr).to.include("✗ Stream integrity check failed");
    });

    it("should detect invalid first record with previous_hash", async () => {
      // Add previous_hash to first record (should be null)
      // First get the stream
      const stream = await testDb.getDb().one<{
        id: number;
      }>(`SELECT id FROM stream WHERE pod_name = $(podName) AND name = $(streamName) AND parent_id IS NULL`, { podName: testPodName, streamName: "test-stream" });

      await testDb
        .getDb()
        .none(
          "UPDATE record SET previous_hash = $(hash) WHERE stream_id = $(streamId) AND index = 0",
          {
            hash: "sha256:shouldnothaveprevious",
            streamId: stream.id,
          },
        );

      const result = await cli.exec(
        ["verify", testPodName, "/test-stream", "--check-integrity"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include(
        "First record should not have previousHash",
      );
    });
  });

  describe("verify command - permissions", () => {
    it("should require authentication for private streams", async () => {
      const result = await cli.exec(["verify", testPodName, "/test-stream"]);

      expect(result.exitCode).to.not.equal(0);
      // The server returns an error when trying to fetch without auth
      expect(result.stderr).to.include("Failed to fetch stream");
    });

    it("should work for public streams without auth", async () => {
      // Create public stream
      const publicStreamId = await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "public-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Add a record with proper hash
      const contentObj = { public: true };
      const content = JSON.stringify(contentObj);

      await createTestRecord(testDb.getDb(), {
        streamId: publicStreamId,
        name: "record-0",
        content,
        contentType: "application/json",
        userId: testUser.userId,
        index: 0,
      });

      const result = await cli.exec(["verify", testPodName, "/public-stream"]);

      // Should work without authentication for public streams
      expect(result.stdout).to.include("Stream '/public-stream' summary:");
    });
  });
});
