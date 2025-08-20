// Rate limiting tests for WebPods
import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import crypto from "crypto";

describe("WebPods Rate Limiting", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  let testUser: any; // Store user for token generation
  const testPodId = "rate-test";
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    // Create a new client instance for each test
    client = new TestHttpClient("http://localhost:3099");
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "testprovider2",
      providerId: "ratelimit",
      email: "ratelimit@example.com",
      name: "Rate Limit User",
    });

    testUser = user; // Save for later use
    userId = user.userId;

    client.setBaseUrl(baseUrl);

    // Generate pod-specific token for rate-test pod
    authToken = client.generatePodToken(
      {
        user_id: user.userId,
        email: user.email,
        name: user.name,
      },
      testPodId,
    );

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
      // Create multiple pods with proper tokens for each
      client.setBaseUrl(`http://pod-limit-1.localhost:3099`);
      const token1 = client.generatePodToken(
        {
          user_id: testUser.userId,
          email: testUser.email,
          name: testUser.name,
        },
        "pod-limit-1",
      );
      client.setAuthToken(token1);
      await client.post("/init/pod1", "Pod 1");

      client.setBaseUrl(`http://pod-limit-2.localhost:3099`);
      const token2 = client.generatePodToken(
        {
          user_id: testUser.userId,
          email: testUser.email,
          name: testUser.name,
        },
        "pod-limit-2",
      );
      client.setAuthToken(token2);
      await client.post("/init/pod2", "Pod 2");

      // Check rate limit records
      const db = testDb.getDb();
      const podLimit = await db.oneOrNone(
        `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
        { identifier: userId, action: "pod_create" },
      );

      expect(podLimit).to.exist;
      expect(podLimit.count).to.equal(2);
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
        provider: "testprovider1",
        providerId: "ratelimit2",
        email: "ratelimit2@example.com",
        name: "Rate Limit User 2",
      });

      const token2 = client.generatePodToken(
        {
          user_id: user2.userId,
          email: user2.email,
          name: user2.name,
        },
        testPodId,
      );

      // Calculate proper window boundaries
      const windowMs = 60 * 60 * 1000;
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

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

      // User1 should be blocked
      const response1 = await client.post("/user1-blocked/fail", "Should fail");
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
        provider: "testprovider1",
        providerId: "ratelimit-unique",
        email: "ratelimit-unique@example.com",
        name: "Rate Limit Unique User",
      });

      const uniqueToken = client.generatePodToken(
        {
          user_id: uniqueUser.userId,
          email: uniqueUser.email,
          name: uniqueUser.name,
        },
        testPodId,
      );

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
          action1: "pod_create",
          count1: 8, // Leave room for 2 more (checkRateLimit will increment to 9, then 10)
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

      // Can create one more pod
      client.setBaseUrl(`http://pod-limit-final.localhost:3099`);
      const finalToken = client.generatePodToken(
        {
          user_id: uniqueUser.userId,
          email: uniqueUser.email,
          name: uniqueUser.name,
        },
        "pod-limit-final",
      );
      client.setAuthToken(finalToken);
      const podResponse = await client.post("/init/final", "Final pod");
      if (podResponse.status !== 201) {
        console.log("Pod creation failed:", podResponse.data);
        const currentLimits = await db.oneOrNone(
          `SELECT * FROM rate_limit WHERE identifier = $(identifier) AND action = $(action)`,
          { identifier: testUserId, action: "pod_create" },
        );
        console.log("Current pod_create limit:", currentLimits);
      }
      expect(podResponse.status).to.equal(201);

      // But creating another pod would exceed limit
      client.setBaseUrl(`http://pod-limit-exceed.localhost:3099`);
      const exceedToken = client.generatePodToken(
        {
          user_id: uniqueUser.userId,
          email: uniqueUser.email,
          name: uniqueUser.name,
        },
        "pod-limit-exceed",
      );
      client.setAuthToken(exceedToken);
      const exceededResponse = await client.post(
        "/init/toomany",
        "Too many pods",
      );
      expect(exceededResponse.status).to.equal(429);
    });
  });
});
