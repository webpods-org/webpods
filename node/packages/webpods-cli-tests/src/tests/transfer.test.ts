/**
 * CLI Transfer Command Tests
 */

import { expect } from "chai";
import { randomUUID } from "crypto";
import { sign } from "jsonwebtoken";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
  calculateContentHash,
  calculateRecordHash,
} from "../test-setup.js";

describe("CLI Transfer Command", function () {
  this.timeout(30000);

  let cli: CliTestHelper;
  let testPodName: string;
  let newOwnerId: string;
  let newOwnerToken: string;

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

    // Create .config/owner stream for pod ownership
    await testDb
      .getDb()
      .none(
        "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
        {
          podName: testPodName,
          streamName: "/.config/owner",
          userId: testUser.userId,
        },
      );

    // Add owner record
    const ownerContent = JSON.stringify({ owner: testUser.userId });
    const ownerContentHash = calculateContentHash(ownerContent);
    const ownerTimestamp = new Date().toISOString();
    const ownerHash = calculateRecordHash(
      null,
      ownerContentHash,
      testUser.userId,
      ownerTimestamp,
    );

    await testDb.getDb().none(
      `INSERT INTO record (pod_name, stream_name, name, content, content_type, content_hash, hash, user_id, index, created_at) 
       VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(contentHash), $(hash), $(userId), 0, $(timestamp))`,
      {
        podName: testPodName,
        streamName: "/.config/owner",
        name: "owner",
        content: ownerContent,
        contentType: "application/json",
        contentHash: ownerContentHash,
        hash: ownerHash,
        userId: testUser.userId,
        timestamp: ownerTimestamp,
      },
    );

    // Create new owner user
    newOwnerId = randomUUID();
    await testDb
      .getDb()
      .none(
        'INSERT INTO "user" (id, created_at, updated_at) VALUES ($(id), NOW(), NOW())',
        { id: newOwnerId },
      );

    // Create identity for new owner
    await testDb
      .getDb()
      .none(
        "INSERT INTO identity (id, user_id, provider, provider_id, email, name, created_at, updated_at) VALUES ($(id), $(userId), $(provider), $(providerId), $(email), $(name), NOW(), NOW())",
        {
          id: randomUUID(),
          userId: newOwnerId,
          provider: "test-provider",
          providerId: randomUUID(),
          email: "newowner@example.com",
          name: "New Owner",
        },
      );

    // Create a proper JWT token for the new owner
    newOwnerToken = sign(
      {
        sub: newOwnerId,
        email: "newowner@example.com",
        provider: "test-provider",
        type: "webpods", // Required for WebPods JWT validation
        iat: Math.floor(Date.now() / 1000),
      },
      "test-secret-key", // Must match TestServer JWT_SECRET
      { expiresIn: "7d" },
    );
  });

  describe("transfer command", () => {
    it("should show warning without --force flag", async () => {
      const result = await cli.exec(["transfer", testPodName, newOwnerId], {
        token: testToken,
      });

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("WARNING");
      expect(result.stdout).to.include("permanently transfer ownership");
      expect(result.stdout).to.include("You will lose all access");
      expect(result.stdout).to.include("run the command again with --force");

      // Verify ownership was NOT transferred
      const ownerRecord = await testDb.getDb().oneOrNone(
        `SELECT * FROM record 
         WHERE pod_name = $(podName) 
         AND stream_name = '/.config/owner' 
         AND name = 'owner'
         ORDER BY index DESC
         LIMIT 1`,
        { podName: testPodName },
      );
      const ownerContent = JSON.parse(ownerRecord.content);
      expect(ownerContent.owner).to.equal(testUser.userId); // Still original owner
    });

    it("should transfer ownership with --force flag", async () => {
      const result = await cli.exec(
        ["transfer", testPodName, newOwnerId, "--force"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Pod '${testPodName}' ownership transferred`,
      );
      expect(result.stdout).to.include(newOwnerId);
      expect(result.stdout).to.include("You no longer have access");

      // Verify ownership was transferred in database
      // Note: The actual implementation would create a new record in .config/owner
      // For now, we're just checking the command runs
    });

    it("should only allow current owner to transfer", async () => {
      // Try to transfer using a different user's token
      const otherUserId = randomUUID();
      await testDb
        .getDb()
        .none(
          'INSERT INTO "user" (id, created_at, updated_at) VALUES ($(id), NOW(), NOW())',
          { id: otherUserId },
        );
      const otherToken = cli.createTestToken(otherUserId, "other@example.com");

      const result = await cli.exec(
        ["transfer", testPodName, newOwnerId, "--force"],
        {
          token: otherToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      // Should get permission denied or similar error
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "transfer",
        testPodName,
        newOwnerId,
        "--force",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });

    it("should validate new owner exists", async () => {
      const nonExistentUser = randomUUID();

      const result = await cli.exec(
        ["transfer", testPodName, nonExistentUser, "--force"],
        {
          token: testToken,
        },
      );

      // Should fail when trying to transfer to non-existent user
      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("User not found");
    });
  });

  describe("transfer command - post transfer", () => {
    it("should prevent old owner from accessing pod after transfer", async () => {
      // First transfer the pod
      const transferResult = await cli.exec(
        ["transfer", testPodName, newOwnerId, "--force"],
        {
          token: testToken,
        },
      );

      expect(transferResult.exitCode).to.equal(0);

      // Try to write to existing stream with old owner's token
      // This should fail since they're no longer the pod owner
      const existingStreamResult = await cli.exec(
        ["write", testPodName, "/test-stream", "test-record", "data"],
        {
          token: testToken,
        },
      );

      // Should be denied access to existing stream
      console.log("EXISTING STREAM WRITE ATTEMPT:", {
        exitCode: existingStreamResult.exitCode,
        stdout: existingStreamResult.stdout,
        stderr: existingStreamResult.stderr,
      });
      expect(existingStreamResult.exitCode).to.not.equal(0);

      // Try to write to a non-existent stream with old owner's token
      // This should fail with STREAM_NOT_FOUND since streams must be created explicitly
      // and the old owner can't create streams anymore
      const newStreamResult = await cli.exec(
        [
          "write",
          testPodName,
          "new-stream-after-transfer",
          "test-record",
          "data",
        ],
        {
          token: testToken,
        },
      );

      // Should fail because old owner no longer has access
      expect(newStreamResult.exitCode).to.not.equal(0);
      // The error message will be about not having write permission
      expect(newStreamResult.stderr).to.satisfy(
        (msg: string) =>
          msg.includes("No write permission") ||
          msg.includes("FORBIDDEN") ||
          msg.includes("permission"),
        "Error should be about permissions",
      );
    });

    it("should allow new owner to access pod after transfer", async () => {
      // First transfer the pod
      await cli.exec(["transfer", testPodName, newOwnerId, "--force"], {
        token: testToken,
      });

      // Create a stream with new owner's user_id (should succeed)
      await testDb.getDb().none(
        `INSERT INTO stream (pod_name, name, user_id, access_permission, created_at) 
         VALUES ($(podName), $(streamName), $(userId), 'public', NOW())`,
        {
          podName: testPodName,
          streamName: "/new-owner-stream",
          userId: newOwnerId,
        },
      );

      // Try to write to the stream with new owner's token
      const result = await cli.exec(
        ["write", testPodName, "/new-owner-stream", "test-record", "data"],
        {
          token: newOwnerToken,
        },
      );

      // New owner should have access
      expect(result.exitCode).to.equal(0);
    });
  });
});
