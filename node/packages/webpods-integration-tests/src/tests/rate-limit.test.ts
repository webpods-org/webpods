// Rate limiting tests for WebPods
import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Rate Limiting", () => {
  let client: TestHttpClient;
  let authId: string;
  let authToken: string;
  let testUser: any; // Store user for token generation
  const testPodId = "rate-test";
  const baseUrl = `http://${testPodId}.localhost:3099`;

  beforeEach(async () => {
    // Create a new client instance for each test
    client = new TestHttpClient("http://localhost:3099");
    const db = testDb.getDb();
    const [user] = await db("user")
      .insert({
        id: crypto.randomUUID(),
        auth_id: "auth:provider:ratelimit",
        email: "ratelimit@example.com",
        name: "Rate Limit User",
        provider: "testprovider2",
      })
      .returning("*");

    testUser = user; // Save for later use
    authId = user.auth_id;

    client.setBaseUrl(baseUrl);

    // Generate pod-specific token for rate-test pod
    authToken = client.generatePodToken(
      {
        user_id: user.id,
        auth_id: user.auth_id,
        email: user.email,
        name: user.name,
        provider: "testprovider2",
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
      const rateLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "write")
        .first();

      expect(rateLimit).to.exist;
      expect(rateLimit.count).to.equal(4);
      expect(rateLimit.window_end).to.be.instanceOf(Date);
    });

    it("should track pod creation rate limits separately", async () => {
      // Create multiple pods with proper tokens for each
      client.setBaseUrl(`http://pod-limit-1.localhost:3099`);
      const token1 = client.generatePodToken(
        {
          user_id: testUser.id,
          auth_id: testUser.auth_id,
          email: testUser.email,
          name: testUser.name,
          provider: testUser.provider,
        },
        "pod-limit-1",
      );
      client.setAuthToken(token1);
      await client.post("/init/pod1", "Pod 1");

      client.setBaseUrl(`http://pod-limit-2.localhost:3099`);
      const token2 = client.generatePodToken(
        {
          user_id: testUser.id,
          auth_id: testUser.auth_id,
          email: testUser.email,
          name: testUser.name,
          provider: testUser.provider,
        },
        "pod-limit-2",
      );
      client.setAuthToken(token2);
      await client.post("/init/pod2", "Pod 2");

      // Check rate limit records
      const db = testDb.getDb();
      const podLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "pod_create")
        .first();

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
      const streamLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "stream_create")
        .first();

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
      const streamLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "stream_create")
        .first();

      // Only one stream was created
      expect(streamLimit.count).to.equal(1);

      // But 3 writes were made
      const writeLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "write")
        .first();
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
      const writeLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "write")
        .first();

      const readLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "read")
        .first();

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
      const ipLimit = await db("rate_limit")
        .where("identifier", "like", "ip:%")
        .where("action", "read")
        .first();

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
      const rateLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "write")
        .first();

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
      await db("rate_limit").insert({
        id: crypto.randomUUID(),
        identifier: authId, // Rate limiting uses auth_id
        action: "write",
        count: 999, // Just under limit
        window_start: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
        window_end: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
      });

      // Make a new request (should start new window)
      const response = await client.post("/new-window/msg", "Message");
      expect(response.status).to.equal(201);

      // Check new window was created
      const newLimit = await db("rate_limit")
        .where("identifier", authId)
        .where("action", "write")
        .where("window_end", ">", now)
        .first();

      expect(newLimit.count).to.equal(1); // Reset to 1
    });

    it("should clean up old rate limit windows", async () => {
      const db = testDb.getDb();

      // Insert multiple old windows
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago
      await db("rate_limit").insert([
        {
          id: crypto.randomUUID(),
          identifier: "old-user-1",
          action: "write",
          count: 100,
          window_start: new Date(oldDate.getTime() - 60 * 60 * 1000),
          window_end: oldDate,
        },
        {
          id: crypto.randomUUID(),
          identifier: "old-user-2",
          action: "read",
          count: 200,
          window_start: new Date(oldDate.getTime() - 60 * 60 * 1000),
          window_end: oldDate,
        },
      ]);

      // Make a new request (triggers cleanup)
      await client.post("/cleanup-trigger/new", "New message");

      // Check that old windows are gone
      const oldLimits = await db("rate_limit")
        .where("window_end", "<", new Date(Date.now() - 2 * 60 * 60 * 1000))
        .count("* as count");

      expect(parseInt(oldLimits[0]?.count as string)).to.equal(0);
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
      await db("rate_limit").insert({
        id: crypto.randomUUID(),
        identifier: authId, // Rate limiting uses auth_id, not user_id
        action: "write",
        count: 1001, // Over the default limit of 1000
        window_start: windowStart,
        window_end: windowEnd,
      });

      // Try to make another request
      const response = await client.post("/over-limit/fail", "Should fail");

      expect(response.status).to.equal(429);
      expect(response.data.error.code).to.equal("RATE_LIMIT_EXCEEDED");
      expect(response.data.error.message).to.include("Too many requests");
    });

    it("should allow requests from different users independently", async () => {
      const db = testDb.getDb();

      // Create a second user
      const [user2] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:ratelimit2",
          email: "ratelimit2@example.com",
          name: "Rate Limit User 2",
          provider: "testprovider1",
        })
        .returning("*");

      const token2 = client.generatePodToken({
        user_id: user2.id,
        auth_id: user2.auth_id,
        email: user2.email,
        name: user2.name,
        provider: "testprovider1",
      });

      // Calculate proper window boundaries
      const windowMs = 60 * 60 * 1000;
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

      // Set user1 at limit
      await db("rate_limit").insert({
        id: crypto.randomUUID(),
        identifier: authId, // Rate limiting uses auth_id
        action: "write",
        count: 1000, // At the limit
        window_start: windowStart,
        window_end: windowEnd,
      });

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
      const [uniqueUser] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:ratelimit-unique",
          email: "ratelimit-unique@example.com",
          name: "Rate Limit Unique User",
          provider: "testprovider1",
        })
        .returning("*");

      const uniqueToken = client.generatePodToken({
        user_id: uniqueUser.id,
        auth_id: uniqueUser.auth_id,
        email: uniqueUser.email,
        name: uniqueUser.name,
        provider: "testprovider1",
      });

      // Use the unique user for this test
      client.setAuthToken(uniqueToken);
      const testAuthId = uniqueUser.auth_id;

      // Calculate proper window boundaries
      const windowMs = 60 * 60 * 1000;
      const now = Date.now();
      const windowEnd = new Date(Math.ceil(now / windowMs) * windowMs);
      const windowStart = new Date(windowEnd.getTime() - windowMs);

      // Clear any existing rate limits for this user
      await db("rate_limit").where("identifier", testAuthId).delete();

      // Set different counts for different actions
      await db("rate_limit").insert([
        {
          id: crypto.randomUUID(),
          identifier: testAuthId, // Rate limiting uses auth_id
          action: "pod_create",
          count: 8, // Leave room for 2 more (checkRateLimit will increment to 9, then 10)
          window_start: windowStart,
          window_end: windowEnd,
        },
        {
          id: crypto.randomUUID(),
          identifier: testAuthId, // Rate limiting uses auth_id
          action: "write",
          count: 100, // Well under the limit of 1000
          window_start: windowStart,
          window_end: windowEnd,
        },
      ]);

      // Can still write
      const writeResponse = await client.post("/can-write/msg", "Message");
      expect(writeResponse.status).to.equal(201);

      // Can create one more pod
      client.setBaseUrl(`http://pod-limit-final.localhost:3099`);
      const finalToken = client.generatePodToken(
        {
          user_id: uniqueUser.id,
          auth_id: uniqueUser.auth_id,
          email: uniqueUser.email,
          name: uniqueUser.name,
          provider: uniqueUser.provider,
        },
        "pod-limit-final",
      );
      client.setAuthToken(finalToken);
      const podResponse = await client.post("/init/final", "Final pod");
      if (podResponse.status !== 201) {
        console.log("Pod creation failed:", podResponse.data);
        const currentLimits = await db("rate_limit")
          .where("identifier", testAuthId)
          .where("action", "pod_create")
          .first();
        console.log("Current pod_create limit:", currentLimits);
      }
      expect(podResponse.status).to.equal(201);

      // But creating another pod would exceed limit
      client.setBaseUrl(`http://pod-limit-exceed.localhost:3099`);
      const exceedToken = client.generatePodToken(
        {
          user_id: uniqueUser.id,
          auth_id: uniqueUser.auth_id,
          email: uniqueUser.email,
          name: uniqueUser.name,
          provider: uniqueUser.provider,
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
