/**
 * CLI Record/Stream Commands Tests
 */

import { expect } from "chai";
import fs from "fs/promises";
import { CliTestHelper } from "../cli-test-helpers.js";
import {
  setupCliTests,
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb,
} from "../test-setup.js";

describe("CLI Record Commands", function () {
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

    await testDb
      .getDb()
      .none("INSERT INTO pod (name, created_at) VALUES ($(name), NOW())", {
        name: testPodName,
      });
  });

  describe("write command", () => {
    it("should write data to a stream record", async () => {
      const result = await cli.exec(
        [
          "write",
          testPodName,
          "test-stream",
          "record1",
          '{"message": "hello world"}',
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Written to ${testPodName}/test-stream/record1`,
      );

      // Verify record was created
      const record = await testDb.getDb().oneOrNone(
        `SELECT r.* FROM record r 
         JOIN stream s ON r.stream_name = s.name AND r.pod_name = s.pod_name
         WHERE s.pod_name = $(podName) AND s.name = $(streamName) AND r.name = $(recordName)`,
        {
          podName: testPodName,
          streamName: "test-stream",
          recordName: "record1",
        },
      );
      expect(record).to.not.be.null;
      expect(JSON.parse(record.content).message).to.equal("hello world");
    });

    it("should write from file", async () => {
      // Create a test file
      const testFilePath = `/tmp/test-data-${Date.now()}.json`;
      await fs.writeFile(testFilePath, '{"data": "from file"}');

      const result = await cli.exec(
        [
          "write",
          testPodName,
          "test-stream",
          "record2",
          "--file",
          testFilePath,
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Written to ${testPodName}/test-stream/record2`,
      );

      // Cleanup
      await fs.unlink(testFilePath);
    });

    it("should set access permissions", async () => {
      const result = await cli.exec(
        [
          "write",
          testPodName,
          "test-stream",
          "record3",
          '{"test": true}',
          "--permission",
          "public",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      // Verify stream has public permission
      const stream = await testDb
        .getDb()
        .oneOrNone(
          "SELECT * FROM stream WHERE pod_name = $(podName) AND name = $(name)",
          {
            podName: testPodName,
            name: "test-stream",
          },
        );
      expect(stream.access_permission).to.equal("public");
    });
  });

  describe("read command", () => {
    beforeEach(async () => {
      // Create test stream and records
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
          {
            podName: testPodName,
            name: "test-stream",
            userId: testUser.userId,
            permission: "private",
          },
        );

      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(recordName), $(content), $(contentType), $(hash), $(userId), $(index))`,
        {
          podName: testPodName,
          streamName: "test-stream",
          recordName: "record1",
          content: '{"value": 1}',
          contentType: "application/json",
          hash: "hash1",
          userId: testUser.userId,
          index: 0,
        },
      );

      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, previous_hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(recordName), $(content), $(contentType), $(hash), $(previous), $(userId), $(index))`,
        {
          podName: testPodName,
          streamName: "test-stream",
          recordName: "record2",
          content: '{"value": 2}',
          contentType: "application/json",
          hash: "hash2",
          previous: "hash1",
          userId: testUser.userId,
          index: 1,
        },
      );
    });

    it("should read a specific record by name", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "record1"],
        {
          token: testToken,
        },
      );

      if (result.exitCode !== 0) {
        console.log("Read failed:");
        console.log("stdout:", result.stdout);
        console.log("stderr:", result.stderr);
      }
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(1);
    });

    it("should read latest record when no name specified", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "--index", "-1"],
        {
          token: testToken,
        },
      );

      if (result.exitCode !== 0) {
        console.log("Read latest failed:");
        console.log("stdout:", result.stdout);
        console.log("stderr:", result.stderr);
      }
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(2);
    });

    it("should read by index", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "--index", "0"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(1);
    });

    it("should read by negative index", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "--index", "-1"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(2);
    });

    it("should save to file", async () => {
      const outputPath = `/tmp/output-${Date.now()}.json`;

      const result = await cli.exec(
        ["read", testPodName, "test-stream", "record1", "--output", outputPath],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(`Saved to ${outputPath}`);

      // Verify file was created
      const content = await fs.readFile(outputPath, "utf-8");
      expect(JSON.parse(content).value).to.equal(1);

      // Cleanup
      await fs.unlink(outputPath);
    });
  });

  describe("list command", () => {
    beforeEach(async () => {
      // Create test stream and multiple records
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
          {
            podName: testPodName,
            name: "test-stream",
            userId: testUser.userId,
            permission: "private",
          },
        );

      for (let i = 0; i < 10; i++) {
        await testDb.getDb().none(
          `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
           VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), $(index))`,
          {
            podName: testPodName,
            streamName: "test-stream",
            name: `record${i}`,
            content: `{"index": ${i}}`,
            contentType: "application/json",
            hash: `hash${i}`,
            userId: testUser.userId,
            index: i,
          },
        );
      }
    });

    it("should list records in a stream", async () => {
      const result = await cli.exec(
        ["records", testPodName, "test-stream", "--format", "json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.records).to.be.an("array");
      expect(data.records).to.have.length.at.most(50); // Default limit
      expect(data.total).to.equal(10);
    });

    it("should support limit parameter", async () => {
      const result = await cli.exec(
        [
          "records",
          testPodName,
          "test-stream",
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
      const data = cli.parseJson(result.stdout);
      expect(data.records).to.have.length(3);
    });

    it("should support pagination with after parameter", async () => {
      const result = await cli.exec(
        [
          "records",
          testPodName,
          "test-stream",
          "--after",
          "5",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.records[0].index).to.be.greaterThan(5);
    });

    it("should list only unique records when flag is set", async () => {
      // Add duplicate named records
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(recordName), $(content), $(contentType), $(hash), $(userId), $(index))`,
        {
          podName: testPodName,
          streamName: "test-stream",
          recordName: "record1",
          content: '{"updated": true}',
          contentType: "application/json",
          hash: "hash-new",
          userId: testUser.userId,
          index: 10,
        },
      );

      const result = await cli.exec(
        ["records", testPodName, "test-stream", "--unique", "--format", "json"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      // Should only have unique names
      const names = data.records.map((r: any) => r.name);
      expect(names).to.have.length(new Set(names).size);
    });
  });

  describe("streams command", () => {
    beforeEach(async () => {
      // Create multiple test streams
      for (let i = 0; i < 5; i++) {
        await testDb
          .getDb()
          .none(
            "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
            {
              podName: testPodName,
              name: `stream-${i}`,
              userId: testUser.userId,
              permission: i % 2 === 0 ? "public" : "private",
            },
          );
      }
    });

    it("should list all streams in a pod", async () => {
      const result = await cli.exec(
        ["streams", testPodName, "--format", "json"],
        {
          token: testToken,
        },
      );

      if (result.exitCode !== 0) {
        console.log("Streams command failed:");
        console.log("stdout:", result.stdout);
        console.log("stderr:", result.stderr);
      }
      expect(result.exitCode).to.equal(0);
      const streams = cli.parseJson(result.stdout);
      expect(streams).to.be.an("array");
      expect(streams).to.have.length(5);
      // The CLI returns stream objects with full details
      expect(streams[0]).to.have.property("name");
      expect(streams[0].name).to.include("stream-");
    });
  });

  describe("delete-stream command", () => {
    beforeEach(async () => {
      // Create .meta/streams/owner stream
      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id) VALUES ($(podName), $(streamName), $(userId))",
          {
            podName: testPodName,
            streamName: ".meta/streams/owner",
            userId: testUser.userId,
          },
        );

      // Add owner record
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(name), $(content), $(contentType), $(hash), $(userId), 0)`,
        {
          podName: testPodName,
          streamName: ".meta/streams/owner",
          name: "owner",
          content: JSON.stringify({ owner: testUser.userId }),
          contentType: "application/json",
          hash: "hash-owner",
          userId: testUser.userId,
        },
      );

      await testDb
        .getDb()
        .none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($(podName), $(name), $(userId), $(permission))",
          {
            podName: testPodName,
            name: "test-stream",
            userId: testUser.userId,
            permission: "private",
          },
        );

      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, user_id, index) 
         VALUES ($(podName), $(streamName), $(recordName), $(content), $(contentType), $(hash), $(userId), $(index))`,
        {
          podName: testPodName,
          streamName: "test-stream",
          recordName: "record1",
          content: '{"test": true}',
          contentType: "application/json",
          hash: "hash1",
          userId: testUser.userId,
          index: 0,
        },
      );
    });

    it("should delete a stream with force flag", async () => {
      const result = await cli.exec(
        ["delete-stream", testPodName, "test-stream", "--force"],
        {
          token: testToken,
        },
      );

      if (result.exitCode !== 0) {
        console.log("Delete stream failed:");
        console.log("stdout:", result.stdout);
        console.log("stderr:", result.stderr);
      }
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("deleted successfully");

      // Verify stream and records were deleted
      const stream = await testDb
        .getDb()
        .oneOrNone(
          "SELECT * FROM stream WHERE pod_name = $(podName) AND name = $(name)",
          {
            podName: testPodName,
            name: "test-stream",
          },
        );
      expect(stream).to.be.null;

      const records = await testDb
        .getDb()
        .any(
          "SELECT * FROM record WHERE pod_name = $(podName) AND stream_name = $(streamName)",
          {
            podName: testPodName,
            streamName: "test-stream",
          },
        );
      expect(records).to.have.length(0);
    });
  });
});
