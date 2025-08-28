/**
 * CLI Record/Stream Commands Tests
 */

import { expect } from "chai";
import { CliTestHelper } from "../cli-test-helpers.js";
import { 
  setupCliTests, 
  cleanupCliTests,
  resetCliTestDb,
  testToken,
  testUser,
  testDb
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
    
    // Create a test pod for each test
    testPodName = `test-pod-${Date.now()}`;
    await testDb.getDb().none(
      "INSERT INTO pod (name, user_id) VALUES ($1, $2)",
      [testPodName, testUser.id]
    );
  });
  
  describe("write command", () => {
    it("should write data to a stream record", async () => {
      const result = await cli.exec([
        "write", 
        testPodName, 
        "test-stream", 
        "record1", 
        '{"message": "hello world"}'
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Record written successfully");
      
      // Verify record was created
      const record = await testDb.getDb().oneOrNone(
        `SELECT r.* FROM record r 
         JOIN stream s ON r.stream_name = s.name AND r.pod_name = s.pod_name
         WHERE s.pod_name = $1 AND s.name = $2 AND r.name = $3`,
        [testPodName, "test-stream", "record1"]
      );
      expect(record).to.not.be.null;
      expect(JSON.parse(record.content).message).to.equal("hello world");
    });
    
    it("should write from file", async () => {
      // Create a test file
      const testFilePath = `/tmp/test-data-${Date.now()}.json`;
      await testDb.getDb().none(""); // Just to import fs
      const fs = await import("fs/promises");
      await fs.writeFile(testFilePath, '{"data": "from file"}');
      
      const result = await cli.exec([
        "write", 
        testPodName, 
        "test-stream", 
        "record2",
        "--file", testFilePath
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Record written successfully");
      
      // Cleanup
      await fs.unlink(testFilePath);
    });
    
    it("should set access permissions", async () => {
      const result = await cli.exec([
        "write", 
        testPodName, 
        "test-stream", 
        "record3",
        '{"test": true}',
        "--permission", "public"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      
      // Verify stream has public permission
      const stream = await testDb.getDb().oneOrNone(
        "SELECT * FROM stream WHERE pod_name = $1 AND name = $2",
        [testPodName, "test-stream"]
      );
      expect(stream.access_permission).to.equal("public");
    });
  });
  
  describe("read command", () => {
    beforeEach(async () => {
      // Create test stream and records
      await testDb.getDb().none(
        "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($1, $2, $3, $4)",
        [testPodName, "test-stream", testUser.id, "private"]
      );
      
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, author, index) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [testPodName, "test-stream", "record1", '{"value": 1}', "application/json", "hash1", testUser.id, 0]
      );
      
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, previous_hash, author, index) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [testPodName, "test-stream", "record2", '{"value": 2}', "application/json", "hash2", "hash1", testUser.id, 1]
      );
    });
    
    it("should read a specific record by name", async () => {
      const result = await cli.exec([
        "read", 
        testPodName, 
        "test-stream", 
        "record1"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(1);
    });
    
    it("should read latest record when no name specified", async () => {
      const result = await cli.exec([
        "read", 
        testPodName, 
        "test-stream"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(2);
    });
    
    it("should read by index", async () => {
      const result = await cli.exec([
        "read", 
        testPodName, 
        "test-stream",
        "--index", "0"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(1);
    });
    
    it("should read by negative index", async () => {
      const result = await cli.exec([
        "read", 
        testPodName, 
        "test-stream",
        "--index", "-1"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.value).to.equal(2);
    });
    
    it("should save to file", async () => {
      const outputPath = `/tmp/output-${Date.now()}.json`;
      
      const result = await cli.exec([
        "read", 
        testPodName, 
        "test-stream",
        "record1",
        "--output", outputPath
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include(`Saved to ${outputPath}`);
      
      // Verify file was created
      const fs = await import("fs/promises");
      const content = await fs.readFile(outputPath, "utf-8");
      expect(JSON.parse(content).value).to.equal(1);
      
      // Cleanup
      await fs.unlink(outputPath);
    });
  });
  
  describe("list command", () => {
    beforeEach(async () => {
      // Create test stream and multiple records
      await testDb.getDb().none(
        "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($1, $2, $3, $4)",
        [testPodName, "test-stream", testUser.id, "private"]
      );
      
      for (let i = 0; i < 10; i++) {
        await testDb.getDb().none(
          `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, author, index) 
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [testPodName, "test-stream", `record${i}`, `{"index": ${i}}`, "application/json", `hash${i}`, testUser.id, i]
        );
      }
    });
    
    it("should list records in a stream", async () => {
      const result = await cli.exec([
        "list", 
        testPodName, 
        "test-stream",
        "--format", "json"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.records).to.be.an("array");
      expect(data.records).to.have.length.at.most(50); // Default limit
      expect(data.total).to.equal(10);
    });
    
    it("should support limit parameter", async () => {
      const result = await cli.exec([
        "list", 
        testPodName, 
        "test-stream",
        "--limit", "3",
        "--format", "json"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.records).to.have.length(3);
    });
    
    it("should support pagination with after parameter", async () => {
      const result = await cli.exec([
        "list", 
        testPodName, 
        "test-stream",
        "--after", "5",
        "--format", "json"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const data = cli.parseJson(result.stdout);
      expect(data.records[0].index).to.be.greaterThan(5);
    });
    
    it("should list only unique records when flag is set", async () => {
      // Add duplicate named records
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, author, index) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [testPodName, "test-stream", "record1", '{"updated": true}', "application/json", "hash-new", testUser.id, 10]
      );
      
      const result = await cli.exec([
        "list", 
        testPodName, 
        "test-stream",
        "--unique",
        "--format", "json"
      ], { 
        token: testToken 
      });
      
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
        await testDb.getDb().none(
          "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($1, $2, $3, $4)",
          [testPodName, `stream-${i}`, testUser.id, i % 2 === 0 ? "public" : "private"]
        );
      }
    });
    
    it("should list all streams in a pod", async () => {
      const result = await cli.exec([
        "streams", 
        testPodName,
        "--format", "json"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      const streams = cli.parseJson(result.stdout);
      expect(streams).to.be.an("array");
      expect(streams).to.have.length(5);
      expect(streams[0].name).to.include("stream-");
    });
  });
  
  describe("delete-stream command", () => {
    beforeEach(async () => {
      await testDb.getDb().none(
        "INSERT INTO stream (pod_name, name, user_id, access_permission) VALUES ($1, $2, $3, $4)",
        [testPodName, "test-stream", testUser.id, "private"]
      );
      
      await testDb.getDb().none(
        `INSERT INTO record (pod_name, stream_name, name, content, content_type, hash, author, index) 
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [testPodName, "test-stream", "record1", '{"test": true}', "application/json", "hash1", testUser.id, 0]
      );
    });
    
    it("should delete a stream with force flag", async () => {
      const result = await cli.exec([
        "delete-stream", 
        testPodName, 
        "test-stream",
        "--force"
      ], { 
        token: testToken 
      });
      
      expect(result.exitCode).to.equal(0);
      expect(result.stdout).to.include("Stream 'test-stream' deleted");
      
      // Verify stream and records were deleted
      const stream = await testDb.getDb().oneOrNone(
        "SELECT * FROM stream WHERE pod_name = $1 AND name = $2",
        [testPodName, "test-stream"]
      );
      expect(stream).to.be.null;
      
      const records = await testDb.getDb().any(
        "SELECT * FROM record WHERE pod_name = $1 AND stream_name = $2",
        [testPodName, "test-stream"]
      );
      expect(records).to.have.length(0);
    });
  });
});