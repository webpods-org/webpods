/**
 * CLI Field Selection and Content Truncation Tests
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
  createTestStream,
  createTestRecord,
  createOwnerConfig,
} from "../utils/test-data-helpers.js";
import { createSchema } from "@webpods/tinqer";
import { executeInsert, executeSelect } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("CLI Field Selection and Content Truncation", function () {
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

    // Create owner config for the pod
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );

    // Create a test stream
    await createTestStream(testDb.getDb(), {
      podName: testPodName,
      streamPath: "test-stream",
      userId: testUser.userId,
      accessPermission: "public",
    });
  });

  describe("Field Selection", () => {
    beforeEach(async () => {
      // Get the stream ID
      const streamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .select((s) => ({ id: s.id }))
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.streamName &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodName, streamName: "test-stream" },
      );
      const stream = streamResults[0];

      // Write test records
      await createTestRecord(testDb.getDb(), {
        streamId: stream.id,
        name: "record1",
        content: "Test content for record 1",
        contentType: "text/plain",
        userId: testUser.userId,
        index: 0,
      });

      await createTestRecord(testDb.getDb(), {
        streamId: stream.id,
        name: "record2",
        content: JSON.stringify({ message: "JSON content", value: 42 }),
        contentType: "application/json",
        userId: testUser.userId,
        index: 1,
      });
    });

    it("should return only requested fields with --fields", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--fields",
          "name,index,timestamp",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      expect(response.records).to.have.lengthOf(2);

      const record = response.records[0];
      expect(record).to.have.all.keys("name", "index", "timestamp");
      expect(record).to.not.have.any.keys(
        "content",
        "contentType",
        "hash",
        "contentHash",
      );
    });

    it("should include size when content is requested", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--fields",
          "content,name",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      const record = response.records[0];
      expect(record).to.have.all.keys("content", "name", "size");
      expect(record.size).to.exist;
    });

    it("should work in table format with selected fields", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--fields",
          "name,index",
          "--format",
          "table",
        ],
        {
          token: testToken,
        },
      );

      // Log stderr for debugging if test fails
      if (result.exitCode !== 0) {
        console.error("Table format test stderr:", result.stderr);
      }

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("record1");
      expect(result.stdout).to.include("record2");
      // Should not include content in table output
      expect(result.stdout).to.not.include("Test content");
    });
  });

  describe("Content Truncation", () => {
    beforeEach(async () => {
      // Get the stream ID
      const streamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .select((s) => ({ id: s.id }))
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.streamName &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodName, streamName: "test-stream" },
      );
      const stream = streamResults[0];

      // Write a record with large content
      const largeContent = "A".repeat(10000);
      await createTestRecord(testDb.getDb(), {
        streamId: stream.id,
        name: "large-record",
        content: largeContent,
        contentType: "text/plain",
        userId: testUser.userId,
        index: 0,
      });

      // Write a small record
      await createTestRecord(testDb.getDb(), {
        streamId: stream.id,
        name: "small-record",
        content: "Small content",
        contentType: "text/plain",
        userId: testUser.userId,
        index: 1,
      });
    });

    it("should truncate content with --max-content-size", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--max-content-size",
          "100",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      const largeRecord = response.records.find(
        (r: any) => r.name === "large-record",
      );

      expect(largeRecord).to.exist;
      expect(largeRecord.content).to.have.lengthOf(100);
      expect(parseInt(largeRecord.size)).to.equal(10000); // Original size preserved
    });

    it("should not truncate content smaller than max-content-size", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--max-content-size",
          "1000",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      const smallRecord = response.records.find(
        (r: any) => r.name === "small-record",
      );

      expect(smallRecord).to.exist;
      expect(smallRecord.content).to.equal("Small content");
    });

    it("should combine fields and max-content-size", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--fields",
          "name,content",
          "--max-content-size",
          "50",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      const largeRecord = response.records.find(
        (r: any) => r.name === "large-record",
      );

      expect(largeRecord).to.exist;
      expect(largeRecord).to.have.all.keys("name", "content", "size");
      expect(largeRecord.content).to.have.lengthOf(50);
      expect(parseInt(largeRecord.size)).to.equal(10000);
    });
  });

  describe("With Other Options", () => {
    beforeEach(async () => {
      // Get the stream ID
      const streamResults = await executeSelect(
        testDb.getDb(),
        schema,
        (q, p) =>
          q
            .from("stream")
            .select((s) => ({ id: s.id }))
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.streamName &&
                s.parent_id === null,
            )
            .take(1),
        { podName: testPodName, streamName: "test-stream" },
      );
      const stream = streamResults[0];

      // Create multiple records
      for (let i = 0; i < 5; i++) {
        await createTestRecord(testDb.getDb(), {
          streamId: stream.id,
          name: `record-${i}`,
          content: `Content ${i}`,
          contentType: "text/plain",
          userId: testUser.userId,
          index: i,
        });
      }
    });

    it("should work with --unique and --fields", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--unique",
          "--fields",
          "name,index",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      expect(response.records.length).to.be.greaterThan(0);

      response.records.forEach((record: any) => {
        expect(record).to.have.all.keys("name", "index");
        expect(record).to.not.have.property("content");
        expect(record).to.not.have.property("size");
      });
    });

    it("should work with --limit and --max-content-size", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--limit",
          "3",
          "--max-content-size",
          "5",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      const response = JSON.parse(result.stdout);
      expect(response.records).to.have.lengthOf(3);

      response.records.forEach((record: any) => {
        if (record.content && record.content.length > 5) {
          expect(record.content).to.have.lengthOf(5);
        }
      });
    });
  });
});
