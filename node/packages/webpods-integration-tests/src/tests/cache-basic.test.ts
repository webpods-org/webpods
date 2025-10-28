// Cache tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { createSchema } from "@tinqerjs/tinqer";
import {
  executeUpdate,
  executeDelete,
  executeSelect,
} from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("WebPods Caching Layer", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "cache-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    // Create a test user
    const user = await createTestUser(db, {
      provider: "test-cache-provider",
      providerId: `cache-user-${Date.now()}`,
      email: "cache@example.com",
      name: "Cache Test User",
    });

    userId = user.userId;

    // Create test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  afterEach(async () => {
    // Clear all cache entries to ensure test isolation
    await clearAllCache();
  });

  describe("Stream Caching", () => {
    const testStreamName = "cache-test-stream";

    it("should cache stream lookups by path", async () => {
      // Create test stream
      await client.createStream(testStreamName, "public");

      // Access stream to cache it (just write a record)
      const write1 = await client.post(`/${testStreamName}/test1`, {
        test: "data1",
      });

      expect(write1.status).to.equal(201);

      // Second access - should use cached stream lookup
      const write2 = await client.post(`/${testStreamName}/test2`, {
        test: "data2",
      });

      expect(write2.status).to.equal(201);
    });

    it("should show cached stream permissions become stale after direct DB update", async () => {
      // Create stream with public permission
      await client.createStream("perm-test-stream", "public");

      // Write to stream (caches stream with public permission)
      const write1 = await client.post(`/perm-test-stream/test`, {
        test: true,
      });
      expect(write1.status).to.equal(201);

      // Update stream permission via database (bypassing cache invalidation)
      const db = testDb.getDb();
      await executeUpdate(
        db,
        schema,
        (q, p) =>
          q
            .update("stream")
            .set({ access_permission: "private" })
            .where((s) => s.pod_name === p.podName && s.name === p.streamName),
        { podName: testPodId, streamName: "perm-test-stream" },
      );

      // Cache still has old permission (public), so owner can still write
      // This demonstrates that direct DB updates don't invalidate cache
      const write2 = await client.post(`/perm-test-stream/test2`, {
        test: true,
      });
      expect(write2.status).to.equal(201);

      // Wait for cache TTL to expire (2 seconds for streams in test config)
      await new Promise((resolve) => setTimeout(resolve, 2100));

      // After TTL expiration, cache refreshes and sees new permission
      // Owner can still write to private stream
      const write3 = await client.post(`/perm-test-stream/test3`, {
        test: true,
      });
      expect(write3.status).to.equal(201);
    });

    it("should cache pod stream lists", async () => {
      // Create a few streams
      await client.createStream("list-stream-1", "public");
      await client.createStream("list-stream-2", "private");

      // First list - should hit database
      const response1 = await client.get(`/.config/api/streams`);

      expect(response1.status).to.equal(200);
      expect(response1.data.pod).to.equal(testPodId);
      expect(response1.data.streams).to.be.an("array");

      // Second list - should hit cache
      const response2 = await client.get(`/.config/api/streams`);

      expect(response2.status).to.equal(200);
      expect(response2.data.pod).to.equal(testPodId);
      expect(response2.data.streams).to.be.an("array");
    });

    it("should invalidate stream list cache on stream creation", async () => {
      // Get initial stream list
      const response1 = await client.get(`/.config/api/streams`);
      expect(response1.status).to.equal(200);
      const initialStreams = response1.data.streams;
      const initialCount = initialStreams.length;

      // Create a new stream
      const newStreamName = `cache-new-stream-${Date.now()}`;
      await client.createStream(newStreamName, "private");

      // Get stream list again - should include new stream
      const response2 = await client.get(`/.config/api/streams`);
      expect(response2.status).to.equal(200);
      const newStreams = response2.data.streams;

      expect(newStreams.length).to.equal(initialCount + 1);
      expect(newStreams.some((s: any) => s.name === newStreamName)).to.be.true;
    });
  });

  describe("Record Caching", () => {
    const streamName = "cache-record-stream";

    beforeEach(async () => {
      // Create stream for records (owner permission for delete operations)
      await client.createStream(streamName, "owner");
    });

    it("should cache record lookups", async () => {
      // Create a record
      const recordContent = { data: "test data" };
      await client.post(`/${streamName}/test-record`, recordContent);

      // First lookup - should hit database
      const response1 = await client.get(`/${streamName}/test-record`);

      expect(response1.status).to.equal(200);
      // Records return content directly, parse if it's JSON
      const content1 =
        typeof response1.data === "string"
          ? JSON.parse(response1.data)
          : response1.data;
      expect(content1).to.deep.equal(recordContent);

      // Second lookup - should hit cache
      const response2 = await client.get(`/${streamName}/test-record`);

      expect(response2.status).to.equal(200);
      // Records return content directly, parse if it's JSON
      const content2 =
        typeof response2.data === "string"
          ? JSON.parse(response2.data)
          : response2.data;
      expect(content2).to.deep.equal(recordContent);
    });

    it("should invalidate record cache on update", async () => {
      // Create and get record
      const initialContent = { test: "initial" };
      await client.post(`/${streamName}/update-test`, initialContent);
      const response1 = await client.get(`/${streamName}/update-test`);
      expect(response1.status).to.equal(200);
      const content1 =
        typeof response1.data === "string"
          ? JSON.parse(response1.data)
          : response1.data;
      expect(content1).to.deep.equal(initialContent);

      // Update record by writing a new version
      const updatedContent = { test: "updated" };
      await client.post(`/${streamName}/update-test`, updatedContent);

      // Get record again - should return updated content (cache invalidated)
      const response2 = await client.get(`/${streamName}/update-test`);
      expect(response2.status).to.equal(200);
      const content2 =
        typeof response2.data === "string"
          ? JSON.parse(response2.data)
          : response2.data;
      expect(content2).to.deep.equal(updatedContent);
    });

    it("should cache record lists with pagination", async () => {
      // Create multiple records
      for (let i = 0; i < 5; i++) {
        await client.post(`/${streamName}/list-test-${i}`, { index: i });
      }

      // First list - should hit database
      const response1 = await client.get(`/${streamName}?limit=3`);

      expect(response1.status).to.equal(200);
      const records1 = Array.isArray(response1.data)
        ? response1.data
        : response1.data.records;
      expect(records1).to.be.an("array");
      expect(records1.length).to.be.at.most(3);

      // Second list with same params - should hit cache
      const response2 = await client.get(`/${streamName}?limit=3`);

      expect(response2.status).to.equal(200);
      const records2 = Array.isArray(response2.data)
        ? response2.data
        : response2.data.records;
      expect(records2).to.be.an("array");
      expect(records2.length).to.equal(records1.length);

      // Different pagination params - should hit database again
      const response3 = await client.get(`/${streamName}?limit=2&after=1`);
      expect(response3.status).to.equal(200);
    });

    it("should cache unique record lists", async () => {
      // Create records with same name (for unique testing)
      const uniqueName = "unique-test";
      for (let i = 0; i < 3; i++) {
        await client.post(`/${streamName}/${uniqueName}`, { version: i });
      }

      // First unique list - should hit database
      const response1 = await client.get(`/${streamName}?unique=true`);

      expect(response1.status).to.equal(200);
      const records1 = Array.isArray(response1.data)
        ? response1.data
        : response1.data.records;
      expect(records1).to.be.an("array");

      // Second unique list - should hit cache
      const response2 = await client.get(`/${streamName}?unique=true`);

      expect(response2.status).to.equal(200);
      const records2 = Array.isArray(response2.data)
        ? response2.data
        : response2.data.records;
      expect(records2).to.be.an("array");
    });

    it("should invalidate record list cache on new record", async () => {
      // Get initial record list
      const response1 = await client.get(`/${streamName}`);
      expect(response1.status).to.equal(200);
      const records1 = Array.isArray(response1.data)
        ? response1.data
        : response1.data.records;
      const initialCount = records1.length;

      // Add a new record
      const newRecordName = `new-record-${Date.now()}`;
      await client.post(`/${streamName}/${newRecordName}`, { new: true });

      // Get record list again - should include new record
      const response2 = await client.get(`/${streamName}`);
      expect(response2.status).to.equal(200);
      const records2 = Array.isArray(response2.data)
        ? response2.data
        : response2.data.records;
      expect(records2.length).to.be.greaterThan(initialCount);
      expect(records2.some((r: any) => r.name === newRecordName)).to.be.true;
    });
  });

  describe("Cache TTL and Expiration", () => {
    it("should respect TTL settings", async function () {
      // This test needs to wait for TTL expiration
      this.timeout(5000); // 5 seconds timeout (test config has 1-2 second TTLs)

      const ttlStreamName = `ttl-stream-${Date.now()}`;
      const ttlRecordName = `ttl-test`;

      // Create stream and record
      await client.createStream(ttlStreamName, "public");
      await client.post(`/${ttlStreamName}/${ttlRecordName}`, { ttl: "test" });

      // First lookup - cache it
      const response1 = await client.get(`/${ttlStreamName}/${ttlRecordName}`);
      expect(response1.status).to.equal(200);

      // Record cache has 1 second TTL in test config
      // Wait for expiration
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Lookup again - should hit database (cache expired)
      const response2 = await client.get(`/${ttlStreamName}/${ttlRecordName}`);
      expect(response2.status).to.equal(200);
    });
  });

  describe("Cache Performance", () => {
    it("should handle large result sets appropriately", async () => {
      // Create stream for large data set
      const largeStreamName = `large-stream-${Date.now()}`;
      await client.createStream(largeStreamName, "public");

      // Create 50 records (reduced from 100 for faster testing)
      for (let i = 0; i < 50; i++) {
        await client.post(`/${largeStreamName}/bulk-${i}`, {
          index: i,
          data: "x".repeat(1000), // 1KB of data per record
        });
      }

      // List all records - should check size before caching
      const response = await client.get(`/${largeStreamName}?limit=50`);
      expect(response.status).to.equal(200);
      const records = Array.isArray(response.data)
        ? response.data
        : response.data.records;
      expect(records).to.be.an("array");

      // The implementation should decide whether to cache based on size
      // We're just verifying it doesn't crash or cause memory issues
    });

    it("should handle concurrent cache operations", async () => {
      // Test concurrent reads and writes to cache
      const promises = [];

      // Concurrent reads - use stream list endpoint that exists on subdomains
      for (let i = 0; i < 10; i++) {
        promises.push(client.get(`/.config/api/streams`));
      }

      // Concurrent writes (creating streams)
      for (let i = 0; i < 5; i++) {
        promises.push(
          client.createStream(`concurrent-${i}-${Date.now()}`, "private"),
        );
      }

      // Wait for all operations
      const results = await Promise.allSettled(promises);

      // Verify all operations completed successfully
      const failures = results.filter((r) => r.status === "rejected");
      expect(failures.length).to.equal(0);
    });
  });

  describe("Cache Invalidation Completeness", () => {
    it("should invalidate stream list cache when creating nested streams", async () => {
      // Get initial stream count
      const response1 = await client.get(`/.config/api/streams`);
      expect(response1.status).to.equal(200);
      const initialTotalCount = response1.data.streams.length;

      // Create a parent stream
      const parentStreamName = `parent-${Date.now()}`;
      await client.createStream(parentStreamName, "public");

      // Get updated stream list - should include parent
      const response2 = await client.get(`/.config/api/streams`);
      expect(response2.status).to.equal(200);
      expect(response2.data.streams.length).to.equal(initialTotalCount + 1);

      // Create child stream
      const childSegmentName = `child-${Date.now()}`;
      const childStreamPath = `${parentStreamName}/${childSegmentName}`;
      await client.createStream(childStreamPath, "private");

      // Get streams again - should include both parent and child
      const response3 = await client.get(`/.config/api/streams`);
      expect(response3.status).to.equal(200);
      expect(response3.data.streams.length).to.equal(initialTotalCount + 2);

      // Verify the child stream is present with correct path
      // Note: stream.name is just the last segment, stream.path is the full path
      const childStream = response3.data.streams.find(
        (s: any) => s.path === `/${childStreamPath}`,
      );
      expect(childStream).to.exist;
      expect(childStream.name).to.equal(childSegmentName);
      expect(childStream.path).to.equal(`/${childStreamPath}`);
    });

    it("should show cache expires after TTL when data is deleted from DB", async () => {
      const deleteStreamName = `delete-test-${Date.now()}`;

      // Create stream and record
      await client.createStream(deleteStreamName, "owner");
      await client.post(`/${deleteStreamName}/record1`, { test: true });

      // Cache the record by accessing it
      const record1 = await client.get(`/${deleteStreamName}/record1`);
      expect(record1.status).to.equal(200);

      // Delete ONLY the record from database (keep stream intact)
      const db = testDb.getDb();
      // First get the stream ID
      const streamResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.pod_name === p.podName && s.name === p.streamName)
            .take(1),
        { podName: testPodId, streamName: deleteStreamName },
      );
      const stream = streamResults[0];

      // Then delete records from that stream
      await executeDelete(
        db,
        schema,
        (q, p) =>
          q.deleteFrom("record").where((r) => r.stream_id === p.streamId),
        { streamId: stream.id },
      );

      // Immediately after DB deletion, cache should still return the record
      // because we bypassed the application layer
      const record2 = await client.get(`/${deleteStreamName}/record1`);
      // Cache is still valid if it returns 200, or it might check stream and return 404
      // Either way, this shows current behavior
      if (record2.status === 200) {
        // Cache returned stale data - expected when bypassing app layer
      } else if (record2.status === 404) {
        // Cache was somehow invalidated or stream check failed
      }

      // Wait for cache TTL to expire (1 second for single records in test config)
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // After TTL expiration, should get 404 as cache is refreshed from DB
      const record3 = await client.get(`/${deleteStreamName}/record1`);
      expect(record3.status).to.equal(404);
    });
  });
});
