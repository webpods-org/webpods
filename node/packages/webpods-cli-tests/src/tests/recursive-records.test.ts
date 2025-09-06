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
  calculateContentHash,
  calculateRecordHash,
} from "../test-setup.js";

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

      // Create hierarchical streams
      const streams = ["/api", "/api/v1", "/api/v1/users", "/api/v2", "/other"];

      for (const streamName of streams) {
        await db.none(
          `INSERT INTO stream (pod_name, name, user_id, access_permission, created_at) 
           VALUES ($(podName), $(streamName), $(userId), 'public', NOW())`,
          {
            podName: testPodName,
            streamName,
            userId: testUser.userId,
          },
        );
      }

      // Add records to each stream
      const records = [
        { stream: "/api", name: "record1", content: '{"data": "api root"}' },
        { stream: "/api/v1", name: "record1", content: '{"data": "api v1"}' },
        {
          stream: "/api/v1/users",
          name: "record1",
          content: '{"data": "api v1 users"}',
        },
        { stream: "/api/v2", name: "record1", content: '{"data": "api v2"}' },
        { stream: "/other", name: "record1", content: '{"data": "other"}' },
      ];

      for (const record of records) {
        const contentHash = calculateContentHash(record.content);
        const timestamp = new Date().toISOString();
        const hash = calculateRecordHash(
          null,
          contentHash,
          testUser.userId,
          timestamp,
        );

        await db.none(
          `INSERT INTO record (pod_name, stream_name, index, name, content, content_type, content_hash, hash, user_id, created_at)
           VALUES ($(podName), $(streamName), 0, $(name), $(content), 'application/json', $(contentHash), $(hash), $(userId), $(timestamp))`,
          {
            podName: testPodName,
            streamName: record.stream,
            name: record.name,
            content: record.content,
            contentHash,
            hash,
            userId: testUser.userId,
            timestamp,
          },
        );
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

    it("should reject --recursive with --unique", async () => {
      const result = await cli.exec(
        ["record", "list", testPodName, "api", "--recursive", "--unique"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include(
        "Cannot use --recursive and --unique together",
      );
    });

    it("should work with pagination parameters", async () => {
      // Add more records to test pagination
      const db = testDb.getDb();
      let previousHash: string | null = null;
      for (let i = 2; i <= 5; i++) {
        const content = JSON.stringify({ data: `api root ${i}` });
        const contentHash = calculateContentHash(content);
        const timestamp = new Date().toISOString();
        const hash = calculateRecordHash(
          previousHash,
          contentHash,
          testUser.userId,
          timestamp,
        );

        await db.none(
          `INSERT INTO record (pod_name, stream_name, index, name, content, content_type, content_hash, hash, user_id, created_at)
           VALUES ($(podName), $(streamName), $(index), $(name), $(content), 'application/json', $(contentHash), $(hash), $(userId), $(timestamp))`,
          {
            podName: testPodName,
            streamName: "/api",
            index: i - 1,
            name: `record${i}`,
            content,
            contentHash,
            hash,
            userId: testUser.userId,
            timestamp,
          },
        );
        previousHash = hash;
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
