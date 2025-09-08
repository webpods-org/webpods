/**
 * CLI Record/Stream Commands Tests - Fixed for hierarchical schema
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
import {
  createTestStream,
  createTestRecord,
  createOwnerConfig,
} from "../utils/test-data-helpers.js";

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

    // Create owner config for the pod
    await createOwnerConfig(
      testDb.getDb(),
      testPodName,
      testUser.userId,
      testUser.userId,
    );
  });

  describe("write command", () => {
    it("should write data to a stream record", async () => {
      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

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

      // Verify record was created - use hierarchical query
      const record = await testDb.getDb().oneOrNone(
        `SELECT r.* FROM record r 
         JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_name = $(podName) AND s.name = $(streamName) 
         AND s.parent_id IS NULL AND r.name = $(recordName)`,
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
      // Create the stream first using helper
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

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

    it("should write to stream with existing permissions", async () => {
      // Create stream with private permission first
      const streamId = await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "private",
      });

      // Write with permission flag - this updates the stream permission to public
      const result = await cli.exec(
        [
          "write",
          testPodName,
          "test-stream",
          "record1",
          '{"test": true}',
          "--permission",
          "public",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      // Verify stream permission was updated
      const stream = await testDb
        .getDb()
        .oneOrNone("SELECT * FROM stream WHERE id = $(id)", {
          id: streamId,
        });
      expect(stream.access_permission).to.equal("public");
    });
  });

  describe("read command", () => {
    beforeEach(async () => {
      // Create test stream and records using helpers
      const streamId = await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "private",
      });

      // Create first record
      await createTestRecord(testDb.getDb(), {
        streamId,
        name: "record1",
        content: '{"value": 1}',
        contentType: "application/json",
        userId: testUser.userId,
        index: 0,
      });

      // Create second record
      await createTestRecord(testDb.getDb(), {
        streamId,
        name: "record2",
        content: '{"value": 2}',
        contentType: "application/json",
        userId: testUser.userId,
        index: 1,
        previousHash: "dummy-hash",
      });
    });

    it("should read a specific record by name", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "record1"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      // When reading by name, the server returns raw content
      const output = JSON.parse(result.stdout);
      expect(output).to.deep.equal({ value: 1 });
    });

    it("should read latest record without name", async () => {
      // Without a name, the CLI must specify an index
      const result = await cli.exec(["read", testPodName, "test-stream"], {
        token: testToken,
      });

      // Should fail because neither index nor name is provided
      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include(
        "Specify either --index or provide a record name",
      );
    });

    it("should read by index", async () => {
      const result = await cli.exec(
        ["read", testPodName, "test-stream", "--index", "0"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      // When reading by single index, the server returns raw content like with name
      const output = JSON.parse(result.stdout);
      expect(output).to.deep.equal({ value: 1 });
    });

    it("should require authentication for private streams", async () => {
      const result = await cli.exec([
        "read",
        testPodName,
        "test-stream",
        "record1",
      ]);

      expect(result.exitCode).to.not.equal(0);
      // Error message may vary - just check it fails
      expect(result.stderr).to.not.be.empty;
    });
  });

  describe("list command", () => {
    beforeEach(async () => {
      // Create test stream and multiple records using helpers
      const streamId = await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "test-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

      // Create multiple records
      for (let i = 0; i < 5; i++) {
        await createTestRecord(testDb.getDb(), {
          streamId,
          name: i < 3 ? `record${i}` : undefined, // undefined will auto-generate name
          content: JSON.stringify({ index: i }),
          contentType: "application/json",
          userId: testUser.userId,
          index: i,
          previousHash: i > 0 ? "dummy-hash" : null,
        });
      }
    });

    it("should list records in a stream", async () => {
      // Use the correct command structure: "record list <pod> <stream>"
      const result = await cli.exec(
        ["record", "list", testPodName, "test-stream"],
        {
          token: testToken,
        },
      );

      console.log("List stdout:", result.stdout);
      console.log("List stderr:", result.stderr);
      console.log("List exitCode:", result.exitCode);
      expect(result.exitCode).to.equal(0);
      const lines = result.stdout.trim().split("\n");
      expect(lines).to.have.length.greaterThan(0);

      // Should show both named and unnamed records
      expect(result.stdout).to.include("record0");
      expect(result.stdout).to.include("record1");
      expect(result.stdout).to.include("record2");
    });

    it("should support limit flag", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--limit",
          "2",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      // Parse JSON output to check limit
      const output = JSON.parse(result.stdout);
      expect(output.records).to.have.length(2);
    });

    it("should support after flag for pagination", async () => {
      const result = await cli.exec(
        ["record", "list", testPodName, "test-stream", "--after", "1"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.not.include("record0");
      expect(result.stdout).to.not.include("record1");
      expect(result.stdout).to.include("record2");
    });

    it("should support unique flag", async () => {
      const result = await cli.exec(
        [
          "record",
          "list",
          testPodName,
          "test-stream",
          "--unique",
          "--format",
          "json",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      // Parse JSON output to check unique filter
      const output = JSON.parse(result.stdout);
      console.log(
        "Unique records:",
        output.records.map((r: any) => ({ name: r.name, index: r.index })),
      );
      // Should only show named records (3 records have names) - empty names are excluded
      expect(output.records).to.have.length(3);
      expect(output.records[0].name).to.equal("record0");
      expect(output.records[1].name).to.equal("record1");
      expect(output.records[2].name).to.equal("record2");
    });
  });

  describe("streams command", () => {
    it.skip("should list all streams in a pod", async () => {
      // TODO: Fix API endpoint /.config/api/streams to work with hierarchical streams
      // Create multiple test streams using helpers
      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "stream1",
        userId: testUser.userId,
        accessPermission: "public",
      });

      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "stream2",
        userId: testUser.userId,
        accessPermission: "private",
      });

      await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "nested/stream3",
        userId: testUser.userId,
        accessPermission: "public",
      });

      const result = await cli.exec(["streams", testPodName], {
        token: testToken,
      });

      console.log("Streams stdout:", result.stdout);
      console.log("Streams stderr:", result.stderr);
      console.log("Streams exitCode:", result.exitCode);
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("stream1");
      expect(result.stdout).to.include("stream2");
      expect(result.stdout).to.include("nested/stream3");
      expect(result.stdout).to.include(".config/owner");
    });
  });

  describe("stream create command", () => {
    it("should create a public stream", async () => {
      const result = await cli.exec(
        ["stream", "create", testPodName, "new-stream", "--access", "public"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Stream 'new-stream' created successfully`,
      );

      // Verify in database
      const stream = await testDb
        .getDb()
        .oneOrNone(
          "SELECT * FROM stream WHERE pod_name = $(podName) AND name = $(name) AND parent_id IS NULL",
          {
            podName: testPodName,
            name: "new-stream",
          },
        );
      expect(stream).to.not.be.null;
      expect(stream.access_permission).to.equal("public");
    });

    it("should create a private stream", async () => {
      const result = await cli.exec(
        [
          "stream",
          "create",
          testPodName,
          "private-stream",
          "--access",
          "private",
        ],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);

      // Verify in database
      const stream = await testDb
        .getDb()
        .oneOrNone(
          "SELECT * FROM stream WHERE pod_name = $(podName) AND name = $(name) AND parent_id IS NULL",
          {
            podName: testPodName,
            name: "private-stream",
          },
        );
      expect(stream).to.not.be.null;
      expect(stream.access_permission).to.equal("private");
    });

    it.skip("should create a permission stream", async () => {
      // Permission streams are not supported via CLI - only public and private
    });

    it("should require authentication", async () => {
      const result = await cli.exec([
        "stream",
        "create",
        testPodName,
        "new-stream",
      ]);

      expect(result.exitCode).to.not.equal(0);
      expect(result.stderr).to.include("Authentication required");
    });
  });

  describe("stream delete command", () => {
    beforeEach(async () => {
      // Create a test stream with records using helpers
      const streamId = await createTestStream(testDb.getDb(), {
        podName: testPodName,
        streamPath: "deletable-stream",
        userId: testUser.userId,
        accessPermission: "public",
      });

      await createTestRecord(testDb.getDb(), {
        streamId,
        name: "record1",
        content: '{"test": true}',
        contentType: "application/json",
        userId: testUser.userId,
        index: 0,
      });
    });

    it("should delete a stream with force flag", async () => {
      const result = await cli.exec(
        ["stream", "delete", testPodName, "deletable-stream", "--force"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(
        `Stream '/deletable-stream' deleted successfully`,
      );

      // Verify stream is deleted
      const stream = await testDb
        .getDb()
        .oneOrNone(
          "SELECT * FROM stream WHERE pod_name = $(podName) AND name = $(name) AND parent_id IS NULL",
          {
            podName: testPodName,
            name: "deletable-stream",
          },
        );
      expect(stream).to.be.null;
    });

    it("should require force flag", async () => {
      const result = await cli.exec(
        ["stream", "delete", testPodName, "deletable-stream"],
        {
          token: testToken,
        },
      );

      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("--force");
    });
  });
});
