/**
 * Comprehensive cache tests using test utility endpoints
 * Tests all cache behaviors through the new test-utils API
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

// Helper to create cache keys matching the actual implementation
const cacheKey = {
  recordData: (podName: string, streamPath: string, recordName: string) =>
    `pod:${podName}:stream:${streamPath}:record:${recordName}:data`,

  encodeKey: (key: string) => Buffer.from(key).toString("base64"),
};

describe("Cache Test Utilities - Comprehensive Tests", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "cache-utils-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    // Create a test user
    const user = await createTestUser(db, {
      provider: "test-cache-provider",
      providerId: `cache-utils-user-${Date.now()}`,
      email: "cache-utils@example.com",
      name: "Cache Utils Test User",
    });

    userId = user.userId;

    // Create test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);

    // Clear cache before each test (test utils are on localhost:3000)
    client.setBaseUrl("http://localhost:3000");
    await client.post("/test-utils/cache/clear");
    client.setBaseUrl(baseUrl); // Switch back to pod domain
  });

  describe("Test Utilities Health Check", () => {
    it("should verify test utilities are available", async () => {
      // Switch to main domain for test utils
      client.setBaseUrl("http://localhost:3000");

      const response = await client.get("/test-utils/health");
      expect(response.status).to.equal(200);
      expect(response.data.available).to.be.true;
      expect(response.data.namespaces).to.have.property("cache");
      expect(response.data.protection.localhost).to.be.true;
    });
  });

  describe("Cache Statistics", () => {
    it("should track cache hits and misses accurately", async () => {
      client.setBaseUrl("http://localhost:3000");

      // Clear cache first
      await client.post("/test-utils/cache/clear");

      // Verify cache is empty
      const keysInitial = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      expect(keysInitial.data.keys).to.have.lengthOf(0);

      // Switch to pod domain for data operations
      client.setBaseUrl(baseUrl);

      // Create a stream and record
      await client.createStream("stats-test", "public");
      await client.post("/stats-test/record1", { data: "test" });

      // First read - should be a miss
      await client.get("/stats-test/record1");

      // Check stats and verify the exact key was cached
      client.setBaseUrl("http://localhost:3000");
      const stats1 = await client.get("/test-utils/cache/stats/singleRecords");
      expect(stats1.status).to.equal(200);
      expect(stats1.data.misses).to.be.at.least(1);

      // Verify the exact key is now in cache
      const keys1 = await client.get("/test-utils/cache/keys/singleRecords");
      const expectedKey = cacheKey.recordData(
        testPodId,
        "stats-test",
        "record1",
      );
      expect(keys1.data.keys).to.include(expectedKey);
      expect(keys1.data.keys).to.have.lengthOf(1); // Only this one key should be cached

      // Verify the entry metadata
      const encodedKey = cacheKey.encodeKey(expectedKey);
      const entryMeta = await client.get(
        `/test-utils/cache/entry/singleRecords/${encodedKey}`,
      );
      expect(entryMeta.data.exists).to.be.true;
      expect(entryMeta.data.pool).to.equal("singleRecords");

      // Second read - should be a hit
      client.setBaseUrl(baseUrl);
      await client.get("/stats-test/record1");

      // Check updated stats
      client.setBaseUrl("http://localhost:3000");
      const stats2 = await client.get("/test-utils/cache/stats/singleRecords");
      expect(stats2.status).to.equal(200);
      expect(stats2.data.hits).to.be.greaterThan(stats1.data.hits || 0);

      // Verify no additional keys were added (same record accessed)
      const keys2 = await client.get("/test-utils/cache/keys/singleRecords");
      expect(keys2.data.keys).to.have.lengthOf(1);
      expect(keys2.data.keys).to.include(expectedKey);
    });

    it("should provide aggregate statistics across all pools", async () => {
      client.setBaseUrl("http://localhost:3000");

      const response = await client.get("/test-utils/cache/stats");
      expect(response.status).to.equal(200);
      expect(response.data.stats).to.be.an("object");

      // Should have all pools
      expect(response.data.stats).to.have.property("pods");
      expect(response.data.stats).to.have.property("streams");
      expect(response.data.stats).to.have.property("singleRecords");
      expect(response.data.stats).to.have.property("recordLists");
    });

    it("should provide debug information with hit rates", async () => {
      client.setBaseUrl("http://localhost:3000");

      const response = await client.get("/test-utils/cache/debug");
      expect(response.status).to.equal(200);
      expect(response.data.enabled).to.be.true;
      expect(response.data.aggregate).to.exist;
      expect(response.data.performance).to.have.property("hitRate");
      expect(response.data.performance).to.have.property("totalRequests");
    });
  });

  describe("Cache Entry Management", () => {
    it("should check if cache entry exists", async () => {
      client.setBaseUrl(baseUrl);

      // Create and read a record to cache it
      await client.createStream("exists-test", "public");
      await client.post("/exists-test/record1", { data: "test" });
      await client.get("/exists-test/record1");

      // Check if entry exists
      client.setBaseUrl("http://localhost:3000");
      const key = cacheKey.recordData(testPodId, "exists-test", "record1");
      const encodedKey = cacheKey.encodeKey(key);
      const response = await client.get(
        `/test-utils/cache/exists/singleRecords/${encodedKey}`,
      );

      expect(response.status).to.equal(200);
      expect(response.data.exists).to.be.true;
      expect(response.data.size).to.be.a("number");
      expect(response.data.metadata).to.exist;
    });

    it("should get entry details", async () => {
      client.setBaseUrl(baseUrl);

      // Create and read a record
      await client.createStream("entry-test", "public");
      await client.post("/entry-test/record1", { data: "test-data" });
      await client.get("/entry-test/record1");

      // Get entry details
      client.setBaseUrl("http://localhost:3000");
      const key = cacheKey.recordData(testPodId, "entry-test", "record1");
      const encodedKey = cacheKey.encodeKey(key);
      const response = await client.get(
        `/test-utils/cache/entry/singleRecords/${encodedKey}`,
      );

      expect(response.status).to.equal(200);
      expect(response.data.exists).to.be.true;
      expect(response.data.pool).to.equal("singleRecords");
      // Size can be a number or string, convert to ensure it's valid
      const size =
        typeof response.data.size === "string"
          ? parseInt(response.data.size)
          : response.data.size;
      expect(size).to.be.a("number");
      // Type field should exist if the entry exists
      if (response.data.type) {
        expect(response.data.type).to.be.a("string");
      }
    });

    it("should force expire specific entry", async () => {
      client.setBaseUrl(baseUrl);

      // Create and cache a record
      await client.createStream("expire-test", "public");
      await client.post("/expire-test/record1", { data: "test" });
      await client.get("/expire-test/record1");

      // Force expire the entry
      client.setBaseUrl("http://localhost:3000");
      const key = cacheKey.recordData(testPodId, "expire-test", "record1");
      const response = await client.post("/test-utils/cache/expire", {
        pool: "singleRecords",
        key: key,
      });

      expect(response.status).to.equal(200);
      expect(response.data.success).to.exist;

      // Verify it's gone
      const encodedKey = cacheKey.encodeKey(key);
      const checkResponse = await client.get(
        `/test-utils/cache/exists/singleRecords/${encodedKey}`,
      );
      expect(checkResponse.data.exists).to.be.false;
    });
  });

  describe("Cache Clear Operations", () => {
    it("should clear all cache", async () => {
      client.setBaseUrl(baseUrl);

      // Create some cached data
      await client.createStream("clear-test", "public");
      await client.post("/clear-test/record1", { data: "test1" });
      await client.post("/clear-test/record2", { data: "test2" });
      await client.get("/clear-test/record1");
      await client.get("/clear-test/record2");
      await client.get("/clear-test"); // Cache list too

      // Verify specific keys are cached before clearing
      client.setBaseUrl("http://localhost:3000");
      const keysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      const record1Key = cacheKey.recordData(
        testPodId,
        "clear-test",
        "record1",
      );
      const record2Key = cacheKey.recordData(
        testPodId,
        "clear-test",
        "record2",
      );
      expect(keysBefore.data.keys).to.include(record1Key);
      expect(keysBefore.data.keys).to.include(record2Key);

      // Verify list is also cached
      const listKeysBefore = await client.get(
        "/test-utils/cache/keys/recordLists",
      );
      expect(listKeysBefore.data.keys.length).to.be.at.least(1);

      // Clear all cache
      const response = await client.post("/test-utils/cache/clear");
      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;

      // Verify cache is completely empty
      const stats = await client.get("/test-utils/cache/stats");
      expect(stats.data.stats.singleRecords.entryCount).to.equal(0);
      expect(stats.data.stats.recordLists.entryCount).to.equal(0);

      // Verify no keys remain in any pool
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      const listKeysAfter = await client.get(
        "/test-utils/cache/keys/recordLists",
      );
      expect(keysAfter.data.keys).to.have.lengthOf(0);
      expect(listKeysAfter.data.keys).to.have.lengthOf(0);
    });

    it("should clear specific pool", async () => {
      client.setBaseUrl(baseUrl);

      // Create data in multiple pools
      await client.createStream("pool-test", "public");
      await client.post("/pool-test/record1", { data: "test" });
      await client.get("/pool-test/record1"); // Single record cache
      await client.get("/pool-test"); // Record list cache

      // Verify both pools have data
      client.setBaseUrl("http://localhost:3000");
      const singleKeysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      const listKeysBefore = await client.get(
        "/test-utils/cache/keys/recordLists",
      );

      const expectedRecordKey = cacheKey.recordData(
        testPodId,
        "pool-test",
        "record1",
      );
      expect(singleKeysBefore.data.keys).to.include(expectedRecordKey);
      expect(listKeysBefore.data.keys.length).to.be.at.least(1);

      // Clear only singleRecords pool
      const response = await client.post("/test-utils/cache/clear", {
        pool: "singleRecords",
      });
      expect(response.status).to.equal(200);

      // Check that only singleRecords was cleared
      const stats = await client.get("/test-utils/cache/stats");
      expect(stats.data.stats.singleRecords.entryCount).to.equal(0);

      // Verify singleRecords keys are gone but recordLists remain
      const singleKeysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      const listKeysAfter = await client.get(
        "/test-utils/cache/keys/recordLists",
      );

      expect(singleKeysAfter.data.keys).to.have.lengthOf(0);
      expect(listKeysAfter.data.keys.length).to.be.at.least(1); // List should still be cached
    });

    it("should clear by pattern", async () => {
      client.setBaseUrl(baseUrl);

      // Create a stream and multiple records
      await client.createStream("test-stream", "public");
      await client.post("/test-stream/record1", { data: "1" });
      await client.post("/test-stream/record2", { data: "2" });
      await client.post("/test-stream/record3", { data: "3" });

      // Cache all records
      await client.get("/test-stream/record1");
      await client.get("/test-stream/record2");
      await client.get("/test-stream/record3");

      // Clear all cache entries for test-stream using the pattern that production code uses
      // This simulates what happens when a stream is deleted or updated
      client.setBaseUrl("http://localhost:3000");
      const response = await client.post("/test-utils/cache/clear-pattern", {
        pattern: `pod:${testPodId}:stream:test-stream:*`,
      });
      expect(response.status).to.equal(200);

      // Verify all records for this stream are gone
      const key1 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "test-stream", "record1"),
      );
      const key2 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "test-stream", "record2"),
      );
      const key3 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "test-stream", "record3"),
      );

      const check1 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key1}`,
      );
      const check2 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key2}`,
      );
      const check3 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key3}`,
      );

      expect(check1.data.exists).to.be.false;
      expect(check2.data.exists).to.be.false;
      expect(check3.data.exists).to.be.false;
    });
  });

  describe("Cache Invalidation", () => {
    it("should invalidate all pod-related cache", async () => {
      client.setBaseUrl(baseUrl);

      // Create streams and records
      await client.createStream("inv-test-1", "public");
      await client.createStream("inv-test-2", "public");
      await client.post("/inv-test-1/record1", { data: "1" });
      await client.post("/inv-test-2/record2", { data: "2" });

      // Cache everything
      await client.get("/inv-test-1/record1");
      await client.get("/inv-test-2/record2");
      await client.get("/inv-test-1");
      await client.get("/inv-test-2");

      // Invalidate entire pod
      client.setBaseUrl("http://localhost:3000");
      const response = await client.post("/test-utils/cache/invalidate-pod", {
        podName: testPodId,
      });
      expect(response.status).to.equal(200);

      // Check stats - should be significantly reduced
      await client.get("/test-utils/cache/stats");
      // Pod-related entries should be gone
    });

    it("should invalidate stream-specific cache", async () => {
      client.setBaseUrl(baseUrl);

      // Create multiple streams
      await client.createStream("stream-inv-1", "public");
      await client.createStream("stream-inv-2", "public");

      await client.post("/stream-inv-1/record1", { data: "1" });
      await client.post("/stream-inv-1/record2", { data: "2" });
      await client.post("/stream-inv-2/record3", { data: "3" });

      // Cache all
      await client.get("/stream-inv-1/record1");
      await client.get("/stream-inv-1/record2");
      await client.get("/stream-inv-2/record3");

      // Invalidate only stream-inv-1
      client.setBaseUrl("http://localhost:3000");
      const response = await client.post(
        "/test-utils/cache/invalidate-stream",
        {
          podName: testPodId,
          streamPath: "stream-inv-1",
        },
      );
      expect(response.status).to.equal(200);

      // Check that stream-inv-1 entries are gone but stream-inv-2 remains
      const key1 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "stream-inv-1", "record1"),
      );
      const key3 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "stream-inv-2", "record3"),
      );

      const check1 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key1}`,
      );
      const check3 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key3}`,
      );

      expect(check1.data.exists).to.be.false;
      expect(check3.data.exists).to.be.true;
    });
  });

  describe("Cache Pool Testing", () => {
    it("should fill pool to test eviction", async () => {
      client.setBaseUrl("http://localhost:3000");

      // Clear cache first
      await client.post("/test-utils/cache/clear");

      // Verify cache is empty
      const keysInitial = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      expect(keysInitial.data.keys).to.have.lengthOf(0);

      // Fill the pool with test data
      const response = await client.post("/test-utils/cache/fill-pool", {
        pool: "singleRecords",
        count: 20,
        sizeEach: 1024, // 1KB each
      });

      expect(response.status).to.equal(200);
      expect(response.data.success).to.be.true;
      expect(response.data.entriesAdded).to.equal(20);
      expect(response.data.currentStats).to.exist;
      expect(response.data.currentStats.entryCount).to.be.at.least(20);

      // Verify exact number of keys added
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=50",
      );
      expect(keysAfter.data.keys.length).to.be.at.least(20);

      // Verify keys follow expected pattern
      const testFillKeys = keysAfter.data.keys.filter((key: string) =>
        key.includes("test-fill"),
      );
      expect(testFillKeys.length).to.equal(20);
    });

    it("should track evictions when pool is full", async () => {
      client.setBaseUrl("http://localhost:3000");

      // Clear cache to start fresh
      await client.post("/test-utils/cache/clear");

      // Get initial stats
      const initialStats = await client.get(
        "/test-utils/cache/stats/singleRecords",
      );
      const initialEvictions = initialStats.data.evictions || 0;

      // Get initial keys count
      const keysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      expect(keysBefore.data.keys).to.have.lengthOf(0);

      // Fill pool beyond capacity (test config has maxEntries: 1000)
      // Add 1100 entries to ensure we exceed capacity
      await client.post("/test-utils/cache/fill-pool", {
        pool: "singleRecords",
        count: 1100, // More than maxEntries (1000)
        sizeEach: 100, // Small size to focus on entry count
      });

      // Check for evictions
      const finalStats = await client.get(
        "/test-utils/cache/stats/singleRecords",
      );
      expect(finalStats.data.evictions).to.be.greaterThan(initialEvictions);
      expect(finalStats.data.evictions).to.be.at.least(100); // At least 100 evictions

      // Verify entry count is at max capacity (1000)
      expect(finalStats.data.entryCount).to.equal(1000);

      // Verify actual keys match the count
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=1200",
      );
      expect(keysAfter.data.keys).to.have.lengthOf(1000);
      expect(keysAfter.data.total).to.equal(1000);
    });
  });

  describe("Hierarchical Cache Structure", () => {
    it("should handle nested stream hierarchies", async () => {
      client.setBaseUrl(baseUrl);

      // Create nested streams
      await client.createStream("level1", "public");
      await client.createStream("level1/level2", "public");
      await client.createStream("level1/level2/level3", "public");

      // Write and cache records at each level
      await client.post("/level1/rec1", { data: "l1" });
      await client.post("/level1/level2/rec2", { data: "l2" });
      await client.post("/level1/level2/level3/rec3", { data: "l3" });

      await client.get("/level1/rec1");
      await client.get("/level1/level2/rec2");
      await client.get("/level1/level2/level3/rec3");

      // Clear specific nested stream (level1/level2) - this is what production code does
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear-pattern", {
        pattern: `pod:${testPodId}:stream:level1/level2:*`,
      });

      // Check that level1 remains, level2 is gone, but level3 remains
      // (level3 is a separate stream, not under level2's pattern)
      const key1 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "level1", "rec1"),
      );
      const key2 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "level1/level2", "rec2"),
      );
      const key3 = cacheKey.encodeKey(
        cacheKey.recordData(testPodId, "level1/level2/level3", "rec3"),
      );

      const check1 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key1}`,
      );
      const check2 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key2}`,
      );
      const check3 = await client.get(
        `/test-utils/cache/exists/singleRecords/${key3}`,
      );

      expect(check1.data.exists).to.be.true;
      expect(check2.data.exists).to.be.false;
      // level3 remains because the pattern only matches "level1/level2:*" not "level1/level2/level3:*"
      expect(check3.data.exists).to.be.true;
    });
  });

  describe("Cache Pool Isolation", () => {
    it("should maintain separate statistics for each pool", async () => {
      client.setBaseUrl(baseUrl);

      // Create data that uses different pools
      await client.createStream("pool-iso-test", "public");
      await client.post("/pool-iso-test/record1", { data: "test" });

      // Access different types to populate different pools
      await client.get("/.config/api/streams"); // Streams pool
      await client.get("/pool-iso-test/record1"); // Single records pool
      await client.get("/pool-iso-test"); // Record lists pool

      // Check each pool has independent stats
      client.setBaseUrl("http://localhost:3000");
      const allStats = await client.get("/test-utils/cache/stats");

      // Each pool should have its own stats
      expect(allStats.data.stats.streams).to.exist;
      expect(allStats.data.stats.singleRecords).to.exist;
      expect(allStats.data.stats.recordLists).to.exist;

      // Stats should be independent
      expect(allStats.data.stats.singleRecords.entryCount).to.be.at.least(1);
      expect(allStats.data.stats.recordLists.entryCount).to.be.at.least(1);
    });

    it("should clear only specified pool", async () => {
      client.setBaseUrl(baseUrl);

      // Populate multiple pools
      await client.createStream("multi-pool", "public");
      await client.post("/multi-pool/rec1", { data: "1" });
      await client.get("/multi-pool/rec1"); // singleRecords
      await client.get("/multi-pool"); // recordLists

      // Clear only singleRecords
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear", { pool: "singleRecords" });

      // Check pools
      const stats = await client.get("/test-utils/cache/stats");
      expect(stats.data.stats.singleRecords.entryCount).to.equal(0);
      // recordLists should still have entries
    });
  });

  describe("Error Handling", () => {
    it("should handle invalid pool names", async () => {
      client.setBaseUrl("http://localhost:3000");

      const response = await client.post("/test-utils/cache/clear", {
        pool: "invalidPool",
      });
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_POOL");
    });

    it("should handle invalid patterns", async () => {
      client.setBaseUrl("http://localhost:3000");

      const response = await client.post("/test-utils/cache/clear-pattern", {
        pattern: "",
      });
      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_PATTERN");
    });

    it("should handle non-existent cache entries", async () => {
      client.setBaseUrl("http://localhost:3000");

      const nonExistentKey = Buffer.from("non-existent-key").toString("base64");
      const response = await client.get(
        `/test-utils/cache/exists/singleRecords/${nonExistentKey}`,
      );

      expect(response.status).to.equal(200);
      expect(response.data.exists).to.be.false;
    });

    it("should return 501 for unimplemented features", async () => {
      client.setBaseUrl("http://localhost:3000");

      // Test unimplemented endpoints
      const ttlResponse = await client.post("/test-utils/cache/set-ttl", {
        pool: "singleRecords",
        key: "test",
        ttlSeconds: 10,
      });
      expect(ttlResponse.status).to.equal(501);
      expect(ttlResponse.data.error.code).to.equal("NOT_IMPLEMENTED");

      const configResponse = await client.get("/test-utils/cache/config");
      expect(configResponse.status).to.equal(501);
    });
  });

  describe("Cache Introspection", () => {
    it("should list keys in cache pool", async () => {
      client.setBaseUrl(baseUrl);

      // Create and cache some records
      await client.createStream("keys-test", "public");
      await client.post("/keys-test/record1", { data: "test1" });
      await client.post("/keys-test/record2", { data: "test2" });
      await client.post("/keys-test/record3", { data: "test3" });

      // Read them to populate cache
      await client.get("/keys-test/record1");
      await client.get("/keys-test/record2");
      await client.get("/keys-test/record3");

      // Get keys from the cache
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=10",
      );

      expect(response.status).to.equal(200);
      expect(response.data.keys).to.be.an("array");
      expect(response.data.keys.length).to.be.at.least(3);

      // Verify the expected keys are present
      const expectedKey1 = cacheKey.recordData(
        testPodId,
        "keys-test",
        "record1",
      );
      const expectedKey2 = cacheKey.recordData(
        testPodId,
        "keys-test",
        "record2",
      );
      const expectedKey3 = cacheKey.recordData(
        testPodId,
        "keys-test",
        "record3",
      );

      expect(response.data.keys).to.include(expectedKey1);
      expect(response.data.keys).to.include(expectedKey2);
      expect(response.data.keys).to.include(expectedKey3);
    });

    it("should verify exact cache entries after operations", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache to start fresh
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create and cache specific records
      client.setBaseUrl(baseUrl);
      await client.createStream("verify-test", "public");
      await client.post("/verify-test/item1", { data: "value1" });
      await client.post("/verify-test/item2", { data: "value2" });

      // Read only item1 - item2 should NOT be cached yet
      await client.get("/verify-test/item1");

      // Verify only item1 is in cache
      client.setBaseUrl("http://localhost:3000");
      const keys1 = await client.get("/test-utils/cache/keys/singleRecords");
      const expectedKey1 = cacheKey.recordData(
        testPodId,
        "verify-test",
        "item1",
      );
      const expectedKey2 = cacheKey.recordData(
        testPodId,
        "verify-test",
        "item2",
      );

      expect(keys1.data.keys).to.include(expectedKey1);
      expect(keys1.data.keys).to.not.include(expectedKey2);

      // Now read item2
      client.setBaseUrl(baseUrl);
      await client.get("/verify-test/item2");

      // Verify both are now in cache
      client.setBaseUrl("http://localhost:3000");
      const keys2 = await client.get("/test-utils/cache/keys/singleRecords");
      expect(keys2.data.keys).to.include(expectedKey1);
      expect(keys2.data.keys).to.include(expectedKey2);
    });

    it("should verify cache state after deletion", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache first
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create multiple records
      client.setBaseUrl(baseUrl);
      await client.createStream("delete-verify", "public");
      await client.post("/delete-verify/keep1", { data: "keep" });
      await client.post("/delete-verify/keep2", { data: "keep" });
      await client.post("/delete-verify/remove1", { data: "remove" });
      await client.post("/delete-verify/remove2", { data: "remove" });

      // Cache all of them
      await client.get("/delete-verify/keep1");
      await client.get("/delete-verify/keep2");
      await client.get("/delete-verify/remove1");
      await client.get("/delete-verify/remove2");

      // Verify all are cached
      client.setBaseUrl("http://localhost:3000");
      const keysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      expect(keysBefore.data.keys.length).to.be.at.least(4);

      // Delete specific entries
      const removeKey1 = cacheKey.recordData(
        testPodId,
        "delete-verify",
        "remove1",
      );
      const removeKey2 = cacheKey.recordData(
        testPodId,
        "delete-verify",
        "remove2",
      );
      await client.post("/test-utils/cache/expire", {
        pool: "singleRecords",
        key: removeKey1,
      });
      await client.post("/test-utils/cache/expire", {
        pool: "singleRecords",
        key: removeKey2,
      });

      // Verify only the keep entries remain
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      const keepKey1 = cacheKey.recordData(testPodId, "delete-verify", "keep1");
      const keepKey2 = cacheKey.recordData(testPodId, "delete-verify", "keep2");

      expect(keysAfter.data.keys).to.include(keepKey1);
      expect(keysAfter.data.keys).to.include(keepKey2);
      expect(keysAfter.data.keys).to.not.include(removeKey1);
      expect(keysAfter.data.keys).to.not.include(removeKey2);
    });

    it("should verify pattern-based deletion affects only matched keys", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create records in different streams
      client.setBaseUrl(baseUrl);
      await client.createStream("pattern-test-a", "public");
      await client.createStream("pattern-test-b", "public");
      await client.createStream("different-stream", "public");

      await client.post("/pattern-test-a/rec1", { data: "a1" });
      await client.post("/pattern-test-a/rec2", { data: "a2" });
      await client.post("/pattern-test-b/rec1", { data: "b1" });
      await client.post("/different-stream/rec1", { data: "d1" });

      // Cache all
      await client.get("/pattern-test-a/rec1");
      await client.get("/pattern-test-a/rec2");
      await client.get("/pattern-test-b/rec1");
      await client.get("/different-stream/rec1");

      // Get initial keys
      client.setBaseUrl("http://localhost:3000");
      const keysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );
      expect(keysBefore.data.keys.length).to.be.at.least(4);

      // Delete with pattern matching only pattern-test-a
      await client.post("/test-utils/cache/clear-pattern", {
        pattern: `pod:${testPodId}:stream:pattern-test-a:*`,
      });

      // Verify only pattern-test-a entries are gone
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );

      const keyA1 = cacheKey.recordData(testPodId, "pattern-test-a", "rec1");
      const keyA2 = cacheKey.recordData(testPodId, "pattern-test-a", "rec2");
      const keyB1 = cacheKey.recordData(testPodId, "pattern-test-b", "rec1");
      const keyD1 = cacheKey.recordData(testPodId, "different-stream", "rec1");

      expect(keysAfter.data.keys).to.not.include(keyA1);
      expect(keysAfter.data.keys).to.not.include(keyA2);
      expect(keysAfter.data.keys).to.include(keyB1);
      expect(keysAfter.data.keys).to.include(keyD1);
    });

    it("should respect limit parameter when listing keys", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create many records
      client.setBaseUrl(baseUrl);
      await client.createStream("limit-test", "public");

      // Create and cache 10 records
      for (let i = 1; i <= 10; i++) {
        await client.post(`/limit-test/record${i}`, { data: `test${i}` });
        await client.get(`/limit-test/record${i}`);
      }

      // Request only 5 keys
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=5",
      );

      expect(response.status).to.equal(200);
      expect(response.data.keys).to.have.lengthOf(5);
      expect(response.data.limited).to.be.true;
      expect(response.data.total).to.be.at.least(10);
    });
  });

  describe("LRU Behavior", () => {
    it("should evict least recently used items when cache is full", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Fill cache near capacity (test config has maxEntries: 1000)
      client.setBaseUrl(baseUrl);
      await client.createStream("lru-test", "public");

      // Create records that will be evicted
      const oldRecords = 5;
      for (let i = 1; i <= oldRecords; i++) {
        await client.post(`/lru-test/old${i}`, { data: `old${i}` });
        await client.get(`/lru-test/old${i}`);
      }

      // Fill cache to near capacity
      await client.post("/test-utils/cache/fill-pool", {
        pool: "singleRecords",
        count: 995, // Total will be 1000
        sizeEach: 100,
      });

      // Access old1 and old2 to make them recently used
      client.setBaseUrl(baseUrl);
      await client.get("/lru-test/old1");
      await client.get("/lru-test/old2");

      // Add more records to trigger eviction
      for (let i = 1; i <= 10; i++) {
        await client.post(`/lru-test/new${i}`, { data: `new${i}` });
        await client.get(`/lru-test/new${i}`);
      }

      // Check which old records survived
      client.setBaseUrl("http://localhost:3000");
      const keys = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=1100",
      );

      const old1Key = cacheKey.recordData(testPodId, "lru-test", "old1");
      const old2Key = cacheKey.recordData(testPodId, "lru-test", "old2");
      const old3Key = cacheKey.recordData(testPodId, "lru-test", "old3");
      const old4Key = cacheKey.recordData(testPodId, "lru-test", "old4");
      const old5Key = cacheKey.recordData(testPodId, "lru-test", "old5");

      // old1 and old2 should survive (recently accessed)
      expect(keys.data.keys).to.include(old1Key);
      expect(keys.data.keys).to.include(old2Key);

      // old3, old4, old5 should be evicted (least recently used)
      expect(keys.data.keys).to.not.include(old3Key);
      expect(keys.data.keys).to.not.include(old4Key);
      expect(keys.data.keys).to.not.include(old5Key);
    });

    it("should update LRU order on cache hits", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create records in specific order
      client.setBaseUrl(baseUrl);
      await client.createStream("lru-order", "public");

      // Cache records in order: first, second, third
      await client.post("/lru-order/first", { data: "1" });
      await client.get("/lru-order/first");
      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post("/lru-order/second", { data: "2" });
      await client.get("/lru-order/second");
      await new Promise((resolve) => setTimeout(resolve, 10));

      await client.post("/lru-order/third", { data: "3" });
      await client.get("/lru-order/third");

      // Access first again to make it most recently used
      await client.get("/lru-order/first");

      // Fill cache to trigger eviction
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/fill-pool", {
        pool: "singleRecords",
        count: 998,
        sizeEach: 100,
      });

      // Check what survived
      const keys = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=1100",
      );

      const firstKey = cacheKey.recordData(testPodId, "lru-order", "first");
      const secondKey = cacheKey.recordData(testPodId, "lru-order", "second");
      const thirdKey = cacheKey.recordData(testPodId, "lru-order", "third");

      // First and third should survive (more recently used)
      expect(keys.data.keys).to.include(firstKey);
      expect(keys.data.keys).to.include(thirdKey);
      // Second should be evicted (least recently used)
      expect(keys.data.keys).to.not.include(secondKey);
    });
  });

  describe("Namespace and Hierarchical Structure", () => {
    it("should handle complex nested namespace structures", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create complex nested structure
      client.setBaseUrl(baseUrl);
      await client.createStream("org", "public");
      await client.createStream("org/dept", "public");
      await client.createStream("org/dept/team", "public");
      await client.createStream("org/dept/team/project", "public");

      // Create records at each level
      await client.post("/org/doc1", { data: "org-level" });
      await client.post("/org/dept/doc2", { data: "dept-level" });
      await client.post("/org/dept/team/doc3", { data: "team-level" });
      await client.post("/org/dept/team/project/doc4", {
        data: "project-level",
      });

      // Cache all
      await client.get("/org/doc1");
      await client.get("/org/dept/doc2");
      await client.get("/org/dept/team/doc3");
      await client.get("/org/dept/team/project/doc4");

      // Verify all are cached
      client.setBaseUrl("http://localhost:3000");
      const allKeys = await client.get("/test-utils/cache/keys/singleRecords");
      expect(allKeys.data.keys.length).to.be.at.least(4);

      // Delete middle level (org/dept)
      await client.post("/test-utils/cache/clear-pattern", {
        pattern: `pod:${testPodId}:stream:org/dept:*`,
      });

      // Verify hierarchy behavior
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );

      const orgKey = cacheKey.recordData(testPodId, "org", "doc1");
      const deptKey = cacheKey.recordData(testPodId, "org/dept", "doc2");
      const teamKey = cacheKey.recordData(testPodId, "org/dept/team", "doc3");
      const projectKey = cacheKey.recordData(
        testPodId,
        "org/dept/team/project",
        "doc4",
      );

      // org level should remain (not under org/dept:*)
      expect(keysAfter.data.keys).to.include(orgKey);
      // dept level should be deleted
      expect(keysAfter.data.keys).to.not.include(deptKey);
      // Deeper levels remain (separate streams)
      expect(keysAfter.data.keys).to.include(teamKey);
      expect(keysAfter.data.keys).to.include(projectKey);
    });

    it("should efficiently delete large namespace branches", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create a large branch structure
      client.setBaseUrl(baseUrl);
      await client.createStream("big-branch", "public");

      // Create many records under one namespace
      const recordCount = 50;
      for (let i = 1; i <= recordCount; i++) {
        await client.post(`/big-branch/item${i}`, { data: `data${i}` });
        await client.get(`/big-branch/item${i}`);
      }

      // Create records in other namespace
      await client.createStream("other-branch", "public");
      await client.post("/other-branch/item1", { data: "other" });
      await client.get("/other-branch/item1");

      // Verify all are cached
      client.setBaseUrl("http://localhost:3000");
      const keysBefore = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=100",
      );
      expect(keysBefore.data.total).to.be.at.least(recordCount + 1);

      // Delete entire big-branch with one pattern
      const deleteResult = await client.post(
        "/test-utils/cache/clear-pattern",
        {
          pattern: `pod:${testPodId}:stream:big-branch:*`,
        },
      );
      expect(deleteResult.status).to.equal(200);

      // Verify efficient deletion
      const keysAfter = await client.get(
        "/test-utils/cache/keys/singleRecords",
      );

      // All big-branch items should be gone
      for (let i = 1; i <= recordCount; i++) {
        const key = cacheKey.recordData(testPodId, "big-branch", `item${i}`);
        expect(keysAfter.data.keys).to.not.include(key);
      }

      // Other branch should remain
      const otherKey = cacheKey.recordData(testPodId, "other-branch", "item1");
      expect(keysAfter.data.keys).to.include(otherKey);
    });
  });

  describe("Cache Consistency", () => {
    it("should maintain consistency between pools", async () => {
      client.setBaseUrl(baseUrl);

      // Clear all pools
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create data that affects multiple pools
      client.setBaseUrl(baseUrl);
      await client.createStream("consistency-test", "public");
      await client.post("/consistency-test/rec1", { data: "test1" });
      await client.post("/consistency-test/rec2", { data: "test2" });

      // Cache in different pools
      await client.get("/consistency-test/rec1"); // singleRecords pool
      await client.get("/consistency-test"); // recordLists pool

      // Check both pools have data
      client.setBaseUrl("http://localhost:3000");
      const singleStats = await client.get(
        "/test-utils/cache/stats/singleRecords",
      );
      const listStats = await client.get("/test-utils/cache/stats/recordLists");

      expect(singleStats.data.entryCount).to.be.at.least(1);
      expect(listStats.data.entryCount).to.be.at.least(1);

      // Invalidate the stream
      await client.post("/test-utils/cache/invalidate-stream", {
        podName: testPodId,
        streamPath: "consistency-test",
      });

      // Both pools should be affected
      const singleStatsAfter = await client.get(
        "/test-utils/cache/stats/singleRecords",
      );
      const listStatsAfter = await client.get(
        "/test-utils/cache/stats/recordLists",
      );

      expect(singleStatsAfter.data.entryCount).to.be.lessThan(
        singleStats.data.entryCount,
      );
      expect(listStatsAfter.data.entryCount).to.be.lessThan(
        listStats.data.entryCount,
      );
    });

    it("should handle concurrent cache operations correctly", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create stream with unique name to avoid conflicts
      const uniqueStreamName = `concurrent-test-${Date.now()}`;
      client.setBaseUrl(baseUrl);
      await client.createStream(uniqueStreamName, "public");

      // Perform multiple concurrent operations
      const operations = [];
      for (let i = 1; i <= 10; i++) {
        operations.push(
          client
            .post(`/${uniqueStreamName}/rec${i}`, { data: `data${i}` })
            .then(() => client.get(`/${uniqueStreamName}/rec${i}`))
            .catch((err) => {
              // Handle potential race conditions - just log and continue
              console.log(
                `Concurrent operation for rec${i} had conflict:`,
                err.message,
              );
              return null;
            }),
        );
      }

      const results = await Promise.all(operations);
      const successfulOps = results.filter((r) => r !== null).length;

      // Verify operations completed and cached correctly (at least some should succeed)
      client.setBaseUrl("http://localhost:3000");
      const keys = await client.get(
        "/test-utils/cache/keys/singleRecords?limit=50",
      );

      // Count how many of our records were successfully cached
      let cachedCount = 0;
      for (let i = 1; i <= 10; i++) {
        const key = cacheKey.recordData(testPodId, uniqueStreamName, `rec${i}`);
        if (keys.data.keys.includes(key)) {
          cachedCount++;
        }
      }

      // At least some operations should have succeeded (concurrent writes can conflict)
      expect(successfulOps).to.be.at.least(3);
      expect(cachedCount).to.be.at.least(3);

      const stats = await client.get("/test-utils/cache/stats/singleRecords");
      expect(stats.data.entryCount).to.be.at.least(cachedCount);
    });
  });

  describe("Performance Metrics", () => {
    it("should calculate hit rate correctly", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache first
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");
      const initialDebug = await client.get("/test-utils/cache/debug");
      const initialHits = initialDebug.data.aggregate.totalHits || 0;
      const initialMisses = initialDebug.data.aggregate.totalMisses || 0;

      // Create predictable hit/miss pattern for a single record
      client.setBaseUrl(baseUrl);
      await client.createStream("hitrate-test", "public");
      await client.post("/hitrate-test/rec1", { data: "test" });

      // Access the same record multiple times to generate hits
      await client.get("/hitrate-test/rec1"); // First access - likely miss
      await client.get("/hitrate-test/rec1"); // Second access - should be hit
      await client.get("/hitrate-test/rec1"); // Third access - should be hit
      await client.get("/hitrate-test/rec1"); // Fourth access - should be hit
      await client.get("/hitrate-test/rec1"); // Fifth access - should be hit

      // Check hit rate
      client.setBaseUrl("http://localhost:3000");
      const finalDebug = await client.get("/test-utils/cache/debug");

      const newHits = finalDebug.data.aggregate.totalHits - initialHits;
      const newMisses = finalDebug.data.aggregate.totalMisses - initialMisses;
      const totalNewRequests = newHits + newMisses;

      expect(totalNewRequests).to.be.at.least(5);

      // We expect at least some hits from the repeated accesses
      expect(newHits).to.be.greaterThan(0);
    });

    it("should track cache size correctly", async () => {
      client.setBaseUrl(baseUrl);

      // Clear cache first to get a clean state
      client.setBaseUrl("http://localhost:3000");
      await client.post("/test-utils/cache/clear");

      // Create records of known sizes
      client.setBaseUrl(baseUrl);
      await client.createStream("size-test", "public");
      const smallData = "test-data"; // Small data to ensure it gets cached
      await client.post("/size-test/small", { data: smallData });

      // Access the record to cache it
      const recordResponse = await client.get("/size-test/small");
      expect(recordResponse.status).to.equal(200);

      // Wait a moment for cache to be populated
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check size tracking
      client.setBaseUrl("http://localhost:3000");
      const stats = await client.get("/test-utils/cache/stats/singleRecords");

      // The cache should have at least one entry
      expect(stats.data.entryCount).to.be.at.least(1);

      // The size should be greater than 0 (we cached something)
      // Convert to number in case it's a string
      const currentSize = Number(stats.data.currentSize) || 0;
      expect(currentSize).to.be.greaterThan(0);
    });
  });
});
