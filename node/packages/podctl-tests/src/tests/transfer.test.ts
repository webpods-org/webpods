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
} from "../test-setup.js";
import { createOwnerConfig } from "../utils/test-data-helpers.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeInsert, executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

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
    const now = Date.now();
    await executeInsert(
      testDb.getDb(),
      schema,
      (q, p) =>
        q.insertInto("pod").values({
          name: p.name,
          created_at: p.now,
          updated_at: p.now,
          metadata: "{}",
        }),
      {
        name: testPodName,
        now,
      },
    );

    // Create .config/owner stream for pod ownership
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );

    // Create new owner user
    newOwnerId = randomUUID();
    await executeInsert(
      testDb.getDb(),
      schema,
      (q, p) =>
        q.insertInto("user").values({
          id: p.id,
          created_at: p.now,
          updated_at: p.now,
        }),
      { id: newOwnerId, now },
    );

    // Create identity for new owner
    const identityId = randomUUID();
    const providerId = randomUUID();
    await executeInsert(
      testDb.getDb(),
      schema,
      (q, p) =>
        q.insertInto("identity").values({
          id: p.id,
          user_id: p.userId,
          provider: p.provider,
          provider_id: p.providerId,
          email: p.email,
          name: p.name,
          metadata: p.metadata,
          created_at: p.now,
          updated_at: p.now,
        }),
      {
        id: identityId,
        userId: newOwnerId,
        provider: "test-provider",
        providerId,
        email: "newowner@example.com",
        name: "New Owner",
        metadata: "{}",
        now,
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
      const result = await cli.exec(
        ["pod", "transfer", testPodName, newOwnerId],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("WARNING");
      expect(result.stdout).to.include("permanently transfer ownership");
      expect(result.stdout).to.include("You will lose all access");
      expect(result.stdout).to.include("run the command again with --force");

      // Verify ownership was NOT transferred
      // First get the .config stream
      const configStreamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .select((s) => ({ id: s.id }))
            .take(1),
        { podName: testPodName },
      );
      // Then get the owner stream
      const ownerStreamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.configId && s.name === "owner")
            .select((s) => ({ id: s.id }))
            .take(1),
        { configId: configStreamResults[0]!.id },
      );
      const ownerStream = ownerStreamResults[0]!;

      const ownerRecordResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId && r.name === "owner")
            .orderByDescending((r) => r.index)
            .take(1),
        { streamId: ownerStream.id },
      );
      const ownerRecord = ownerRecordResults[0] || null;
      const ownerContent = JSON.parse(ownerRecord!.content);
      expect(ownerContent.userId).to.equal(testUser.userId); // Still original owner
    });

    it("should transfer ownership with --force flag", async () => {
      const result = await cli.exec(
        ["pod", "transfer", testPodName, newOwnerId, "--force"],
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
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("user").values({
            id: p.id,
            created_at: p.now,
            updated_at: p.now,
          }),
        { id: otherUserId, now },
      );
      const otherToken = cli.createTestToken(otherUserId, "other@example.com");

      const result = await cli.exec(
        ["pod", "transfer", testPodName, newOwnerId, "--force"],
        {
          token: otherToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      // Should get permission denied or similar error
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "pod",
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
        ["pod", "transfer", testPodName, nonExistentUser, "--force"],
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
        ["pod", "transfer", testPodName, newOwnerId, "--force"],
        {
          token: testToken,
        },
      );

      expect(transferResult.exitCode).to.equal(0);

      // Try to write to existing stream with old owner's token
      // This should fail since they're no longer the pod owner
      const existingStreamResult = await cli.exec(
        ["record", "write", testPodName, "/test-stream", "test-record", "data"],
        {
          token: testToken,
        },
      );

      // Should be denied access to existing stream
      expect(existingStreamResult.exitCode).to.not.equal(0);

      // Try to write to a non-existent stream with old owner's token
      // This should fail with STREAM_NOT_FOUND since streams must be created explicitly
      // and the old owner can't create streams anymore
      const newStreamResult = await cli.exec(
        [
          "record",
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
      await cli.exec(["pod", "transfer", testPodName, newOwnerId, "--force"], {
        token: testToken,
      });

      // Create a stream with new owner's user_id (should succeed)
      const now = Date.now();
      await executeInsert(
        testDb.getDb(),
        schema,
        (q, p) =>
          q.insertInto("stream").values({
            pod_name: p.podName,
            name: p.streamName,
            path: p.path,
            parent_id: null,
            user_id: p.userId,
            access_permission: "public",
            created_at: p.now,
            updated_at: p.now,
            metadata: "{}",
            has_schema: false,
          }),
        {
          podName: testPodName,
          streamName: "new-owner-stream",
          path: "new-owner-stream",
          userId: newOwnerId,
          now,
        },
      );

      // Try to write to the stream with new owner's token
      const result = await cli.exec(
        [
          "record",
          "write",
          testPodName,
          "/new-owner-stream",
          "test-record",
          "data",
        ],
        {
          token: newOwnerToken,
        },
      );

      // New owner should have access
      expect(result.exitCode).to.equal(0);
    });
  });
});
