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
import crypto from "crypto";

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

    // Create test stream with proper hash chain
    await testDb
      .getDb()
      .none(
        "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
        {
          podName: testPodName,
          name: "/test-stream",
          userId: testUser.userId,
          permission: "private",
        },
      );

    // Add records with proper hash chain
    let previousHash = null;
    for (let i = 0; i < 5; i++) {
      const contentObj = { index: i, data: `Record ${i}` };
      const content = JSON.stringify(contentObj);
      const timestamp = new Date().toISOString();

      // Calculate hash exactly like the server does
      const hashData: string = JSON.stringify({
        previous_hash: previousHash,
        timestamp: timestamp,
        content: contentObj, // Use the object, not the string
      });
      const hash: string = `sha256:${crypto.createHash("sha256").update(hashData).digest("hex")}`;

      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, previous_hash, user_id, index, created_at) 
         VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(previousHash), $(userId), $(index), $(createdAt))`,
        {
          podName: testPodName,
          streamName: "/test-stream",
          name: `record-${i}`,
          content,
          contentType: "application/json",
          hash,
          previousHash,
          userId: testUser.userId,
          index: i,
          createdAt: timestamp,
        },
      );

      previousHash = hash;
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
      // Create empty stream
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(name), $(userId))",
          {
            podName: testPodName,
            name: "/empty-stream",
            userId: testUser.userId,
          },
        );

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

      if (result.exitCode !== 0) {
        console.log("VERIFY ERROR - STDERR:", result.stderr);
        console.log("VERIFY ERROR - STDOUT:", result.stdout);
      }

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        "Verifying integrity of stream '/test-stream'",
      );
      expect(result.stdout).to.include("✓ Stream integrity verified");
      expect(result.stdout).to.include("all 5 records are valid");
    });

    it("should detect broken hash chain", async () => {
      // Break the hash chain by updating a record's previous_hash
      await testDb
        .getDb()
        .none(
          "UPDATE record SET previous_hash = $(brokenHash) WHERE pod_name = $(podName) AND stream_name = $(streamName) AND index = 3",
          {
            brokenHash: "sha256:broken",
            podName: testPodName,
            streamName: "/test-stream",
          },
        );

      const result = await cli.exec(
        ["verify", testPodName, "/test-stream", "--check-integrity"],
        {
          token: testToken,
        },
      );

      if (!result.stdout.includes("Hash chain broken")) {
        console.log("BROKEN CHAIN TEST - STDOUT:", result.stdout);
        console.log("BROKEN CHAIN TEST - STDERR:", result.stderr);
      }

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Hash chain broken");
      expect(result.stderr).to.include("✗ Stream integrity check failed");
    });

    it("should detect invalid first record with previous_hash", async () => {
      // Add previous_hash to first record (should be null)
      await testDb
        .getDb()
        .none(
          "UPDATE record SET previous_hash = $(hash) WHERE pod_name = $(podName) AND stream_name = $(streamName) AND index = 0",
          {
            hash: "sha256:shouldnothaveprevious",
            podName: testPodName,
            streamName: "/test-stream",
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
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
          {
            podName: testPodName,
            name: "/public-stream",
            userId: testUser.userId,
            permission: "public",
          },
        );

      // Add a record with proper hash
      const contentObj = { public: true };
      const content = JSON.stringify(contentObj);
      const timestamp = new Date().toISOString();

      // Calculate hash exactly like the server does
      const hashData: string = JSON.stringify({
        previous_hash: null,
        timestamp: timestamp,
        content: contentObj, // Use the object, not the string
      });
      const hash: string = `sha256:${crypto.createHash("sha256").update(hashData).digest("hex")}`;

      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index, created_at) 
         VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0, $(createdAt))`,
        {
          podName: testPodName,
          streamName: "/public-stream",
          name: "record-0",
          content,
          contentType: "application/json",
          hash,
          userId: testUser.userId,
          createdAt: timestamp,
        },
      );

      const result = await cli.exec(["verify", testPodName, "/public-stream"]);

      if (!result.stdout.includes("Stream '/public-stream' summary:")) {
        console.log("PUBLIC STREAM TEST - STDOUT:", result.stdout);
        console.log("PUBLIC STREAM TEST - STDERR:", result.stderr);
        console.log("PUBLIC STREAM TEST - EXIT CODE:", result.exitCode);
      }

      // Should work without authentication for public streams
      expect(result.stdout).to.include("Stream '/public-stream' summary:");
    });
  });
});
