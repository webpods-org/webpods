/**
 * CLI Recursive Records Tests
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

describe("CLI Recursive Records", function () {
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

    // Create a test pod directly in database
    testPodName = `test-recursive-${Date.now()}`;

    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });
  });

  describe("record list --recursive", () => {
    beforeEach(async () => {
      const db = testDb.getDb();

      // Create owner config first
      await createOwnerConfig(
        db,
        testPodName,
        testUser.userId,
        testUser.userId,
      );

      // Create hierarchical streams using the helper
      const streams = [
        { path: "api", content: '{"data": "api root"}' },
        { path: "api/v1", content: '{"data": "api v1"}' },
        { path: "api/v1/users", content: '{"data": "api v1 users"}' },
        { path: "api/v2", content: '{"data": "api v2"}' },
        { path: "other", content: '{"data": "other"}' },
      ];

      for (const stream of streams) {
        const streamId = await createTestStream(db, {
          podName: testPodName,
          streamPath: stream.path,
          userId: testUser.userId,
          accessPermission: "public",
        });

        await createTestRecord(db, {
          streamId,
          name: "record1",
          content: stream.content,
          contentType: "application/json",
          userId: testUser.userId,
          index: 0,
        });
      }
    });

    it("should list records recursively with --recursive flag", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "/api",
          "--recursive",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.lengthOf(4);

      const recordData = output.records.map((r: any) => r.content.data);
      expect(recordData).to.include.members([
        "api root",
        "api v1",
        "api v1 users",
        "api v2",
      ]);
      expect(recordData).to.not.include("other");
    });

    it("should list only nested streams without exact match", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "api/v1",
          "--recursive",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.lengthOf(2);

      const recordData = output.records.map((r: any) => r.content.data);
      expect(recordData).to.include.members(["api v1", "api v1 users"]);
      expect(recordData).to.not.include("api root");
      expect(recordData).to.not.include("api v2");
    });

    it("should support --recursive with --unique", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "api",
          "--recursive",
          "--unique",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const output = JSON.parse(result.stdout);

      // Should have unique records from all nested streams
      expect(output.records).to.be.an("array");

      // Should have 4 records: record1 from /api, /api/v1, /api/v1/users, and /api/v2 streams
      expect(output.records).to.have.lengthOf(4);

      // All records should be named "record1" (one from each matching stream)
      const recordNames = output.records.map((r: any) => r.name);
      expect(recordNames.every((name: string) => name === "record1")).to.be
        .true;
    });

    it("should work with pagination parameters", async () => {
      // Add more records to test pagination
      const db = testDb.getDb();

      // Get the /api stream ID
      const apiStream = await db.one<{ id: number }>(
        `SELECT id FROM stream 
         WHERE pod_name = $(podName) AND name = 'api' AND parent_id IS NULL`,
        { podName: testPodName },
      );

      const previousHash: string | null = null;
      for (let i = 2; i <= 5; i++) {
        const content = JSON.stringify({ data: `api root ${i}` });
        await createTestRecord(db, {
          streamId: apiStream.id,
          name: `record${i}`,
          content,
          contentType: "application/json",
          userId: testUser.userId,
          index: i - 1,
          previousHash,
        });
      }

      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "/api",
          "--recursive",
          "--limit",
          "3",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.lengthOf(3);
      expect(output.hasMore).to.be.true;
    });

    it("should handle non-existent stream with recursive", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "nonexistent",
          "--recursive",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.lengthOf(0);
      expect(output.total).to.equal(0);
      expect(output.hasMore).to.be.false;
    });

    it("should work with negative after parameter", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "/api",
          "--recursive",
          "--after",
          "-2",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.lengthOf(2);
    });
  });
});
