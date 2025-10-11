/**
 * CLI Grant/Revoke Commands Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testDb,
  testUser,
} from "../test-setup.js";
import { randomUUID } from "crypto";
import { createSchema } from "@webpods/tinqer";
import { executeInsert } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("CLI Grant/Revoke Commands", function () {
  this.timeout(30000);

  let cli: CliTestHelper;
  let testPodName: string;
  let otherUserId: string;

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

    // Create the permissions stream (required for grant/revoke to work)
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
        streamName: "team-permissions",
        path: "team-permissions",
        userId: testUser.userId,
        now,
      },
    );

    // Create another user for testing
    otherUserId = randomUUID();
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
  });

  describe("grant command", () => {
    it("should grant read permission to a user", async () => {
      const result = await cli.exec(
        [
          "permission",
          "grant",
          testPodName,
          "/team-permissions",
          otherUserId,
          "--read",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Granted read access");
      expect(result.stdout).to.include(otherUserId);
    });

    it("should grant write permission to a user", async () => {
      const result = await cli.exec(
        [
          "permission",
          "grant",
          testPodName,
          "/team-permissions",
          otherUserId,
          "--write",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Granted write access");
    });

    it("should grant both read and write permissions", async () => {
      const result = await cli.exec(
        [
          "permission",
          "grant",
          testPodName,
          "team-permissions",
          otherUserId,
          "--read",
          "--write",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Granted read and write access");
    });

    it("should require at least one permission flag", async () => {
      const result = await cli.exec(
        ["permission", "grant", testPodName, "/team-permissions", otherUserId],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("at least one permission");
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "permission",
        "grant",
        testPodName,
        "team-permissions",
        otherUserId,
        "--read",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });

  describe("revoke command", () => {
    beforeEach(async () => {
      // First grant some permissions
      await cli.exec(
        [
          "permission",
          "grant",
          testPodName,
          "team-permissions",
          otherUserId,
          "--read",
          "--write",
        ],
        {
          token: testToken,
        },
      );
    });

    it("should revoke all permissions from a user", async () => {
      const result = await cli.exec(
        ["permission", "revoke", testPodName, "/team-permissions", otherUserId],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Revoked all access");
      expect(result.stdout).to.include(otherUserId);
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "permission",
        "revoke",
        testPodName,
        "team-permissions",
        otherUserId,
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Not authenticated");
    });
  });
});
