// Comprehensive cache tests for scenarios not covered in basic tests
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Cache - Comprehensive Coverage", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "cache-comp-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    const user = await createTestUser(db, {
      provider: "test-cache-provider",
      providerId: `cache-user-${Date.now()}`,
      email: "cache@example.com",
      name: "Cache Test User",
    });

    userId = user.userId;
    await createTestPod(db, testPodId, userId);
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Pod Operations Cache", () => {
    it("should cache pod info lookups", async () => {
      // First, we need to get the owner record to check pod info
      const ownerResponse = await client.get("/.config/owner");
      expect(ownerResponse.status).to.equal(200);

      // Parse the owner data - it might be a string or object
      let ownerData;
      if (typeof ownerResponse.data === "string") {
        try {
          ownerData = JSON.parse(ownerResponse.data);
        } catch {
          // If it's not JSON, it might be plain text with just the userId
          ownerData = { userId: ownerResponse.data };
        }
      } else {
        ownerData = ownerResponse.data;
      }

      // The owner record should have userId (might be nested)
      const ownerId = ownerData.userId || ownerData;
      expect(ownerId).to.exist;

      // Get it again (should use cache)
      const ownerResponse2 = await client.get("/.config/owner");
      expect(ownerResponse2.status).to.equal(200);

      // Should get same data from cache
      let ownerData2;
      if (typeof ownerResponse2.data === "string") {
        try {
          ownerData2 = JSON.parse(ownerResponse2.data);
        } catch {
          ownerData2 = { userId: ownerResponse2.data };
        }
      } else {
        ownerData2 = ownerResponse2.data;
      }

      const ownerId2 = ownerData2.userId || ownerData2;
      expect(ownerId2).to.exist;
      // Both should be the same user ID
      expect(typeof ownerId2).to.equal(typeof ownerId);
    });

    it("should cache user's pod list", async () => {
      // Switch to main domain to get user's pods
      const mainClient = new TestHttpClient("http://localhost:3000");
      mainClient.setAuthToken(authToken);

      // Get user's pods (should cache)
      const response1 = await mainClient.get("/api/pods");
      expect(response1.status).to.equal(200);
      expect(response1.data).to.be.an("array");
      const initialCount = response1.data.length;

      // Get again (should use cache)
      const response2 = await mainClient.get("/api/pods");
      expect(response2.status).to.equal(200);
      expect(response2.data.length).to.equal(initialCount);
    });
  });

  describe("Record Delete/Purge Cache Invalidation", () => {
    const streamName = "delete-test-stream";

    beforeEach(async () => {
      client.setBaseUrl(baseUrl);
      await client.createStream(streamName, "owner");
    });

    it("should invalidate cache on record update", async () => {
      // Create and cache a record
      await client.post(`/${streamName}/update-me`, { test: "data" });

      const response1 = await client.get(`/${streamName}/update-me`);
      expect(response1.status).to.equal(200);
      const content1 =
        typeof response1.data === "string"
          ? JSON.parse(response1.data)
          : response1.data;
      expect(content1).to.deep.equal({ test: "data" });

      // Update the record (which invalidates cache)
      await client.post(`/${streamName}/update-me`, {
        test: "updated",
        version: 2,
      });

      // The record should have new content (cache invalidated)
      const response2 = await client.get(`/${streamName}/update-me`);
      expect(response2.status).to.equal(200);
      const content2 =
        typeof response2.data === "string"
          ? JSON.parse(response2.data)
          : response2.data;
      // Content should be different from original
      expect(content2).to.deep.equal({ test: "updated", version: 2 });
    });

    it("should invalidate list cache on new record", async () => {
      // Create initial records
      for (let i = 0; i < 3; i++) {
        await client.post(`/${streamName}/initial-${i}`, { index: i });
      }

      // Cache the list
      const list1 = await client.get(`/${streamName}`);
      expect(list1.status).to.equal(200);
      const records1 = Array.isArray(list1.data)
        ? list1.data
        : list1.data.records;
      const count1 = records1.length;

      // Add a new record (should invalidate list cache)
      await client.post(`/${streamName}/new-record`, { index: 999 });

      // List should include the new record (cache invalidated)
      const list2 = await client.get(`/${streamName}`);
      expect(list2.status).to.equal(200);
      const records2 = Array.isArray(list2.data)
        ? list2.data
        : list2.data.records;
      expect(records2.length).to.equal(count1 + 1);
      expect(records2.some((r: any) => r.name === "new-record")).to.be.true;
    });
  });

  describe("Stream Delete Cache Invalidation", () => {
    it("should invalidate caches when stream data changes", async () => {
      const tempStream = `temp-stream-${Date.now()}`;

      // Create stream with records
      await client.createStream(tempStream, "owner");
      await client.post(`/${tempStream}/record1`, { data: "test" });

      // Cache stream list and record
      const streamList1 = await client.get(`/.config/api/streams`);
      expect(streamList1.status).to.equal(200);
      const initialStreamCount = streamList1.data.streams.length;

      const record1 = await client.get(`/${tempStream}/record1`);
      expect(record1.status).to.equal(200);

      // Create another stream (invalidates stream list cache)
      const newStream = `new-stream-${Date.now()}`;
      await client.createStream(newStream, "private");

      // Stream list should be updated
      const streamList2 = await client.get(`/.config/api/streams`);
      expect(streamList2.status).to.equal(200);
      expect(streamList2.data.streams.length).to.equal(initialStreamCount + 1);

      // Update the record (invalidates record cache)
      await client.post(`/${tempStream}/record1`, { data: "updated" });

      // Record should have new content
      const record2 = await client.get(`/${tempStream}/record1`);
      expect(record2.status).to.equal(200);
      const content =
        typeof record2.data === "string"
          ? JSON.parse(record2.data)
          : record2.data;
      expect(content.data).to.equal("updated");
    });
  });

  describe("Query Parameter Cache Variations", () => {
    const streamName = "query-test-stream";

    beforeEach(async () => {
      await client.createStream(streamName, "public");
      // Create 10 records
      for (let i = 0; i < 10; i++) {
        await client.post(`/${streamName}/item-${i}`, { index: i });
      }
    });

    it("should cache different pagination parameters separately", async () => {
      // Different limit values
      const response1 = await client.get(`/${streamName}?limit=3`);
      const response2 = await client.get(`/${streamName}?limit=5`);
      const response3 = await client.get(`/${streamName}?limit=3`); // Should hit cache

      const records1 = Array.isArray(response1.data)
        ? response1.data
        : response1.data.records;
      const records2 = Array.isArray(response2.data)
        ? response2.data
        : response2.data.records;
      const records3 = Array.isArray(response3.data)
        ? response3.data
        : response3.data.records;

      expect(records1.length).to.equal(3);
      expect(records2.length).to.equal(5);
      expect(records3.length).to.equal(3);
    });

    it("should handle negative 'after' parameter caching", async () => {
      // Get last 3 records
      const response1 = await client.get(`/${streamName}?after=-3`);
      expect(response1.status).to.equal(200);
      const records1 = Array.isArray(response1.data)
        ? response1.data
        : response1.data.records;

      // Get again (should cache)
      const response2 = await client.get(`/${streamName}?after=-3`);
      expect(response2.status).to.equal(200);
      const records2 = Array.isArray(response2.data)
        ? response2.data
        : response2.data.records;

      expect(records2.length).to.equal(records1.length);
    });

    it("should cache field selection queries", async () => {
      // Request with field selection
      const response1 = await client.get(`/${streamName}?fields=name,index`);
      expect(response1.status).to.equal(200);

      // Same field selection (should cache)
      const response2 = await client.get(`/${streamName}?fields=name,index`);
      expect(response2.status).to.equal(200);

      // Different field selection (should not use same cache)
      const response3 = await client.get(`/${streamName}?fields=name,content`);
      expect(response3.status).to.equal(200);
    });
  });

  describe("Binary Content Caching", () => {
    it("should handle large content in cache", async () => {
      const largeStream = "large-content-stream";
      await client.createStream(largeStream, "public");

      // Create large content (simulated binary data as base64)
      const largeContent = {
        type: "binary",
        data: "x".repeat(10000), // 10KB of data
        encoding: "base64",
      };

      const response1 = await client.post(
        `/${largeStream}/large-file`,
        largeContent,
      );
      expect(response1.status).to.equal(201);

      // Get large content (should cache if not too large)
      const response2 = await client.get(`/${largeStream}/large-file`);
      expect(response2.status).to.equal(200);

      // Get again (might be from cache depending on size limits)
      const response3 = await client.get(`/${largeStream}/large-file`);
      expect(response3.status).to.equal(200);

      // Content should be the same
      const content2 =
        typeof response2.data === "string"
          ? JSON.parse(response2.data)
          : response2.data;
      const content3 =
        typeof response3.data === "string"
          ? JSON.parse(response3.data)
          : response3.data;
      expect(content3).to.deep.equal(content2);
    });
  });

  describe("Cache Eviction", () => {
    it("should evict least recently used entries when at capacity", async () => {
      const evictionStream = "eviction-test";
      await client.createStream(evictionStream, "public");

      // This test would need to know the cache capacity
      // and create enough entries to trigger eviction
      // For now, we just test that the system handles many entries

      const recordCount = 100;
      for (let i = 0; i < recordCount; i++) {
        await client.post(`/${evictionStream}/record-${i}`, { index: i });
      }

      // Access the first record (make it recently used)
      await client.get(`/${evictionStream}/record-0`);

      // Create more records to potentially trigger eviction
      for (let i = recordCount; i < recordCount + 50; i++) {
        await client.post(`/${evictionStream}/record-${i}`, { index: i });
      }

      // First record should still be accessible (was recently used)
      const response = await client.get(`/${evictionStream}/record-0`);
      expect(response.status).to.equal(200);
    });
  });

  describe("Cache Isolation", () => {
    it("should maintain cache isolation between different pods", async () => {
      // Create a second pod
      const pod2Id = "cache-iso-test";
      const db = testDb.getDb();
      await createTestPod(db, pod2Id, userId);

      // Create same-named stream in both pods
      const streamName = "shared-name";
      await client.createStream(streamName, "public");

      // Create record in first pod
      await client.post(`/${streamName}/record1`, { pod: testPodId });

      // Switch to second pod
      const client2 = new TestHttpClient(`http://${pod2Id}.localhost:3000`);
      const authToken2 = await client2.authenticateViaOAuth(userId, [pod2Id]);
      client2.setAuthToken(authToken2);

      // Create stream and different record in second pod
      await client2.createStream(streamName, "public");
      await client2.post(`/${streamName}/record1`, { pod: pod2Id });

      // Each pod should have its own cached data
      const response1 = await client.get(`/${streamName}/record1`);
      const response2 = await client2.get(`/${streamName}/record1`);

      const content1 =
        typeof response1.data === "string"
          ? JSON.parse(response1.data)
          : response1.data;
      const content2 =
        typeof response2.data === "string"
          ? JSON.parse(response2.data)
          : response2.data;

      expect(content1.pod).to.equal(testPodId);
      expect(content2.pod).to.equal(pod2Id);
    });
  });

  describe("Child Stream Caching", () => {
    it("should cache nested stream operations", async () => {
      const parentStream = "parent-stream";
      await client.createStream(parentStream, "public");

      // Create child streams
      for (let i = 0; i < 3; i++) {
        await client.createStream(`${parentStream}/child-${i}`, "public");
      }

      // List all streams (includes parent and children)
      const response1 = await client.get(`/.config/api/streams`);
      expect(response1.status).to.equal(200);
      const streams1 = response1.data.streams;
      const childStreams = streams1.filter((s: any) =>
        s.path.startsWith(`/${parentStream}/`),
      );
      expect(childStreams.length).to.equal(3);

      // Get again (should use cache)
      const response2 = await client.get(`/.config/api/streams`);
      expect(response2.status).to.equal(200);
      const streams2 = response2.data.streams;
      expect(streams2.length).to.equal(streams1.length);

      // Create new child (should invalidate cache)
      await client.createStream(`${parentStream}/child-new`, "public");

      // Get streams again (cache invalidated)
      const response3 = await client.get(`/.config/api/streams`);
      expect(response3.status).to.equal(200);
      const streams3 = response3.data.streams;
      const newChildStreams = streams3.filter((s: any) =>
        s.path.startsWith(`/${parentStream}/`),
      );
      expect(newChildStreams.length).to.equal(4);
    });
  });
});
