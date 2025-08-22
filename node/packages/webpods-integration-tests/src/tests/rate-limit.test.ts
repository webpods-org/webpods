// Rate limiting tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import crypto from "crypto";

describe("WebPods Rate Limiting", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "rate-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(async () => {
    // Create a new client instance for each test
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-2",
      providerId: "ratelimit",
      email: "ratelimit@example.com",
      name: "Rate Limit User",
    });

    userId = user.userId;

    // Create the test pod
    await createTestPod(db, testPodId, userId);

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  describe("Write Rate Limits", () => {
    it("should track write rate limits per user", async () => {
      // Make multiple write requests
      await client.post("/stream1/msg1", "Message 1");
      await client.post("/stream2/msg2", "Message 2");
      await client.post("/stream3/msg3", "Message 3");
      await client.post("/nested/stream4", "Message 4");

      // Check rate limit record was created
      const db = testDb.getDb();
      const rateLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "write" },
      );

      expect(rateLimit).to.exist;
      expect(rateLimit.count).to.equal(4);
      expect(rateLimit.window_end).to.be.instanceOf(Date);
    });

    it("should track pod creation rate limits separately", async () => {
      // Create a unique user for this test to avoid interference
      const db = testDb.getDb();
      const podTestUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "pod-creator-" + crypto.randomUUID(),
        email: "pod-creator@example.com",
        name: "Pod Creator User",
      });

      // Get tokens that allow access to multiple pods
      // Note: The pods don't exist yet, they'll be created on first POST
      const token1 = await client.authenticateViaOAuth(podTestUser.userId, [
        "pod-limit-1",
      ]);
      const token2 = await client.authenticateViaOAuth(podTestUser.userId, [
        "pod-limit-2",
      ]);

      // Create first pod by POSTing to it
      client.setBaseUrl(`http://pod-limit-1.localhost:3000`);
      client.setAuthToken(token1);
      const response1 = await client.post("/init/pod1", "Pod 1");
      expect(response1.status).to.equal(201);

      // Create second pod by POSTing to it
      client.setBaseUrl(`http://pod-limit-2.localhost:3000`);
      client.setAuthToken(token2);
      const response2 = await client.post("/init/pod2", "Pod 2");
      expect(response2.status).to.equal(201);

      // Verify pods were actually created in the database
      const pod1 = await db.oneOrNone(
        `SELECT * FROM pod WHERE name = $(podId)`,
        { podId: "pod-limit-1" },
      );
      const pod2 = await db.oneOrNone(
        `SELECT * FROM pod WHERE name = $(podId)`,
        { podId: "pod-limit-2" },
      );

      expect(pod1).to.exist;
      expect(pod2).to.exist;

      // Verify ownership via .meta/owner stream
      const owner1Record = await db.oneOrNone(
        `SELECT r.content FROM record r
         JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_id = $(podId) AND s.stream_id = '.meta/owner'
         ORDER BY r.index DESC LIMIT 1`,
        { podId: pod1.id },
      );
      const owner2Record = await db.oneOrNone(
        `SELECT r.content FROM record r
         JOIN stream s ON r.stream_id = s.id
         WHERE s.pod_id = $(podId) AND s.stream_id = '.meta/owner'
         ORDER BY r.index DESC LIMIT 1`,
        { podId: pod2.id },
      );

      expect(owner1Record).to.exist;
      expect(JSON.parse(owner1Record.content).owner).to.equal(
        podTestUser.userId,
      );
      expect(owner2Record).to.exist;
      expect(JSON.parse(owner2Record.content).owner).to.equal(
        podTestUser.userId,
      );

      // Check rate limit records
      const podLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: podTestUser.userId, action: "pod_create" },
      );

      expect(podLimit).to.exist;
      expect(podLimit.count).to.equal(2);

      // Now test that we can create more pods up to the limit (10)
      // We've created 2, so we can create 8 more
      for (let i = 3; i <= 10; i++) {
        const tokenN = await client.authenticateViaOAuth(podTestUser.userId, [
          `pod-limit-${i}`,
        ]);
        client.setBaseUrl(`http://pod-limit-${i}.localhost:3000`);
        client.setAuthToken(tokenN);
        const responseN = await client.post(`/init/pod${i}`, `Pod ${i}`);
        expect(responseN.status).to.equal(201, `Should create pod ${i}`);
      }

      // The 11th pod should be blocked
      const token11 = await client.authenticateViaOAuth(podTestUser.userId, [
        "pod-limit-11",
      ]);
      client.setBaseUrl(`http://pod-limit-11.localhost:3000`);
      client.setAuthToken(token11);
      const response11 = await client.post("/init/pod11", "Pod 11");
      expect(response11.status).to.equal(429);
      expect(response11.data.error.code).to.equal("RATE_LIMIT_EXCEEDED");
    });

    it("should track stream creation rate limits", async () => {
      // Create multiple streams in the same pod
      await client.post("/rate-stream-1/first", "First stream");
      await client.post("/rate-stream-2/second", "Second stream");
      await client.post("/rate-stream-3/third", "Third stream");
      await client.post("/blog/posts/2024", "Nested stream");

      const db = testDb.getDb();
      const streamLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "stream_create" },
      );

      expect(streamLimit).to.exist;
      expect(streamLimit.count).to.equal(4);
    });

    it("should not count writes to existing streams as stream creation", async () => {
      // Create one stream
      await client.post("/existing/first", "First message");

      // Write more to the same stream
      await client.post("/existing/second", "Second message");
      await client.post("/existing/third", "Third message");

      const db = testDb.getDb();
      const streamLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "stream_create" },
      );

      // Only one stream was created
      expect(streamLimit.count).to.equal(1);

      // But 3 writes were made
      const writeLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "write" },
      );
      expect(writeLimit.count).to.equal(3);
    });
  });

  describe("Read Rate Limits", () => {
    beforeEach(async () => {
      // Create some test data
      await client.post("/public-data/public", "Public content");
      await client.post("/public-data/more", "More content");
    });

    it("should track read rate limits separately from writes", async () => {
      // Make read requests
      await client.get("/public-data?i=0");
      await client.get("/public-data?i=1");
      await client.get("/public-data"); // List all

      // Check rate limit records
      const db = testDb.getDb();
      const writeLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "write" },
      );

      const readLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "read" },
      );

      expect(writeLimit.count).to.equal(2); // Two writes in beforeEach
      expect(readLimit.count).to.equal(3); // Three reads
    });

    it("should track anonymous read rate limits by IP", async () => {
      // First create a public stream with data
      await client.post("/public-data/first", "First");
      await client.post("/public-data/second", "Second");

      // Clear auth for anonymous requests
      client.clearAuthToken();

      // Make anonymous read requests
      await client.get("/public-data?i=0");
      await client.get("/public-data?i=1");

      // Check rate limit by IP
      const db = testDb.getDb();

      // Find any IP-based rate limit (could be ::1 or 127.0.0.1)
      const ipLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier LIKE 'ip:%' AND action = $(action)`,
        { action: "read" },
      );

      expect(ipLimit).to.exist;
      expect(ipLimit.count).to.equal(2);
    });
  });

  describe("Rate Limit Windows", () => {
    it("should use hourly windows for rate limiting", async () => {
      const db = testDb.getDb();

      // Make a request
      await client.post("/window-test/msg", "Message");

      // Check the window
      const rateLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "write" },
      );

      const windowStart = new Date(rateLimit.window_start);
      const windowEnd = new Date(rateLimit.window_end);
      const windowDuration = windowEnd.getTime() - windowStart.getTime();

      // Should be approximately 1 hour (3600000 ms)
      expect(windowDuration).to.be.closeTo(3600000, 1000);
    });

    it("should reset count when window expires", async () => {
      const db = testDb.getDb();
      const now = new Date();

      // Insert an expired window with high count
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES ($(id), $(identifier), $(action), $(count), $(windowStart), $(windowEnd))`,
        {
          id: crypto.randomUUID(),
          identifier: userId, // Rate limiting uses user_id
          action: "write",
          count: 999, // Just under limit
          windowStart: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          windowEnd: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
        },
      );

      // Make a new request (should start new window)
      const response = await client.post("/new-window/msg", "Message");
      expect(response.status).to.equal(201);

      // Check new window was created
      const newLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit 
         WHERE identifier = $(identifier) 
         AND action = $(action) 
         AND window_end > $(now)`,
        { identifier: userId, action: "write", now },
      );

      expect(newLimit.count).to.equal(1); // Reset to 1
    });

    it("should clean up old rate limit windows", async () => {
      const db = testDb.getDb();

      // Insert multiple old windows
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES 
         ($(id1), $(identifier1), $(action1), $(count1), $(windowStart1), $(windowEnd1)),
         ($(id2), $(identifier2), $(action2), $(count2), $(windowStart2), $(windowEnd2))`,
        {
          id1: crypto.randomUUID(),
          identifier1: "old-user-1",
          action1: "write",
          count1: 100,
          windowStart1: new Date(oldDate.getTime() - 60 * 60 * 1000),
          windowEnd1: oldDate,
          id2: crypto.randomUUID(),
          identifier2: "old-user-2",
          action2: "read",
          count2: 200,
          windowStart2: new Date(oldDate.getTime() - 60 * 60 * 1000),
          windowEnd2: oldDate,
        },
      );

      // Make a new request (triggers cleanup)
      await client.post("/cleanup-trigger/new", "New message");

      // Check that old windows are gone
      const oldLimits = await db.oneOrNone(
        `SELECT COUNT(*) as count FROM rate_limit WHERE window_end < $(cutoff)`,
        { cutoff: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      );

      expect(parseInt(oldLimits?.count || "0")).to.equal(0);
    });
  });

  describe("Rate Limit Headers", () => {
    it("should return rate limit headers in responses", async () => {
      const response = await client.post("/header-test/msg", "Message");

      expect(response.headers).to.have.property("x-ratelimit-limit");
      expect(response.headers).to.have.property("x-ratelimit-remaining");
      expect(response.headers).to.have.property("x-ratelimit-reset");

      const limit = parseInt(response.headers["x-ratelimit-limit"]);
      const remaining = parseInt(response.headers["x-ratelimit-remaining"]);

      expect(limit).to.be.greaterThan(0);
      expect(remaining).to.be.lessThan(limit);
    });

    it("should decrease remaining count with each request", async () => {
      const response1 = await client.post("/decrease-1/msg1", "Message 1");
      const remaining1 = parseInt(response1.headers["x-ratelimit-remaining"]);

      const response2 = await client.post("/decrease-2/msg2", "Message 2");
      const remaining2 = parseInt(response2.headers["x-ratelimit-remaining"]);

      expect(remaining2).to.equal(remaining1 - 1);
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should return 429 when rate limit is exceeded", async () => {
      const db = testDb.getDb();

      // Calculate proper window boundaries (same as rate limit code)
      const windowMs = 60 * 60 * 1000; // 1 hour
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

      // Set a rate limit that's already exceeded
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES ($(id), $(identifier), $(action), $(count), $(windowStart), $(windowEnd))`,
        {
          id: crypto.randomUUID(),
          identifier: userId, // Rate limiting uses user_id
          action: "write",
          count: 1001, // Over the default limit of 1000
          windowStart,
          windowEnd,
        },
      );

      // Try to make another request
      const response = await client.post("/over-limit/fail", "Should fail");

      expect(response.status).to.equal(429);
      expect(response.data.error.code).to.equal("RATE_LIMIT_EXCEEDED");
      expect(response.data.error.message).to.include("Too many requests");
    });

    it("should allow requests from different users independently", async () => {
      const db = testDb.getDb();

      // Create a second user
      const user2 = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "ratelimit2",
        email: "ratelimit2@example.com",
        name: "Rate Limit User 2",
      });

      // Get tokens for both users
      const token1 = await client.authenticateViaOAuth(userId, [testPodId]);
      const token2 = await client.authenticateViaOAuth(user2.userId, [
        testPodId,
      ]);

      // Start with user1's token
      client.setAuthToken(token1);

      // Calculate proper window boundaries - must match EXACTLY what the rate limit code uses
      const windowMs = 60 * 60 * 1000;
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

      // Clean up any existing rate limit records for user1
      await db.none(
        `DELETE FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "write" },
      );

      // Set user1 at limit
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES ($(id), $(identifier), $(action), $(count), $(windowStart), $(windowEnd))`,
        {
          id: crypto.randomUUID(),
          identifier: userId, // Rate limiting uses user_id
          action: "write",
          count: 1000, // At the limit
          windowStart,
          windowEnd,
        },
      );

      // Verify the rate limit was created
      const rateLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action) AND window_start = $(windowStart)`,
        { identifier: userId, action: "write", windowStart },
      );
      expect(rateLimit).to.exist;
      expect(rateLimit.count).to.equal(1000);

      // User1 should be blocked
      const response1 = await client.post("/user1-blocked/fail", "Should fail");

      // Check what happened to the rate limit after the request
      if (response1.status !== 429) {
        const afterLimit = await db.manyOrNone(
          `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action) ORDER BY window_start DESC`,
          { identifier: userId, action: "write" },
        );
        throw new Error(
          `Expected 429 but got ${response1.status}. Rate limits after request: ${JSON.stringify(afterLimit, null, 2)}. Headers: ${JSON.stringify(response1.headers)}`,
        );
      }

      expect(response1.status).to.equal(429);

      // User2 should still be able to post
      client.setAuthToken(token2);
      const response2 = await client.post(
        "/user2-allowed/succeed",
        "Should succeed",
      );
      expect(response2.status).to.equal(201);
    });
  });

  describe("Different Rate Limits by Action", () => {
    it("should apply different limits for different actions", async () => {
      // Assuming: write=1000/hour, read=10000/hour, pod_create=10/hour, stream_create=100/hour

      const db = testDb.getDb();

      // Create a unique user for this test to avoid rate limit conflicts
      const uniqueUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "ratelimit-unique",
        email: "ratelimit-unique@example.com",
        name: "Rate Limit Unique User",
      });

      const uniqueToken = await client.authenticateViaOAuth(uniqueUser.userId, [
        testPodId,
      ]);

      // Use the unique user for this test
      client.setAuthToken(uniqueToken);
      const testUserId = uniqueUser.userId;

      // Calculate proper window boundaries
      const windowMs = 60 * 60 * 1000;
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

      // Clear any existing rate limits for this user
      await db.none(`DELETE FROM rate_limit WHERE identifier = $(identifier)`, {
        identifier: testUserId,
      });

      // Set different counts for different actions
      await db.none(
        `INSERT INTO rate_limit (id, identifier, action, count, window_start, window_end)
         VALUES 
         ($(id1), $(identifier1), $(action1), $(count1), $(windowStart1), $(windowEnd1)),
         ($(id2), $(identifier2), $(action2), $(count2), $(windowStart2), $(windowEnd2))`,
        {
          id1: crypto.randomUUID(),
          identifier1: testUserId, // Rate limiting uses user_id
          action1: "stream_create", // Changed from pod_create since we're creating streams
          count1: 97, // Leave room for 3 stream creations (can-write, stream-99, stream-100)
          windowStart1: windowStart,
          windowEnd1: windowEnd,
          id2: crypto.randomUUID(),
          identifier2: testUserId, // Rate limiting uses user_id
          action2: "write",
          count2: 100, // Well under the limit of 1000
          windowStart2: windowStart,
          windowEnd2: windowEnd,
        },
      );

      // Can still write
      const writeResponse = await client.post("/can-write/msg", "Message");
      expect(writeResponse.status).to.equal(201);

      // Can create exactly one more stream (count will go from 98 to 99)
      const streamResponse1 = await client.post("/stream-99/test", "Stream 99");
      expect(streamResponse1.status).to.equal(201);

      // Can create one more stream (count will go from 99 to 100)
      const streamResponse2 = await client.post(
        "/stream-100/test",
        "Stream 100",
      );
      expect(streamResponse2.status).to.equal(201);

      // But creating another stream would exceed limit (would be 101, limit is 100)
      const exceededResponse = await client.post(
        "/stream-101/test",
        "Too many streams",
      );
      expect(exceededResponse.status).to.equal(429);
    });
  });
});
