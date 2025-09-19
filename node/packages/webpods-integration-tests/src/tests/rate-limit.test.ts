// Rate limiting tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  generateTestWebPodsToken,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import crypto from "crypto";

describe("WebPods Rate Limiting", () => {
  let client: TestHttpClient;
  let userId: string;
  let authToken: string;
  const testPodId = "rate-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  // Helper to get rate limit status via test utility
  async function getRateLimitStatus(identifier: string, action: string) {
    const testClient = new TestHttpClient("http://localhost:3000");
    const response = await testClient.get(
      `/test-utils/ratelimit/status?identifier=${identifier}&action=${action}`,
    );
    return response.data;
  }

  // Helper to set rate limit count via test utility
  async function setRateLimitCount(
    identifier: string,
    action: string,
    count: number,
  ) {
    const testClient = new TestHttpClient("http://localhost:3000");
    const response = await testClient.post("/test-utils/ratelimit/set", {
      identifier,
      action,
      count,
    });
    return response.data;
  }

  // Helper to reset rate limit via test utility
  async function resetRateLimit(identifier: string, action?: string) {
    const testClient = new TestHttpClient("http://localhost:3000");
    const response = await testClient.post("/test-utils/ratelimit/reset", {
      identifier,
      action,
    });
    return response.data;
  }

  beforeEach(async () => {
    // Create a new client instance for each test
    client = new TestHttpClient("http://localhost:3000");
    const db = testDb.getDb();

    // Note: Rate limits are now handled by the adapter and cleared
    // automatically between tests via test environment reset
    const user = await createTestUser(db, {
      provider: "test-auth-provider-2",
      providerId: "ratelimit",
      email: "ratelimit@example.com",
      name: "Rate Limit User",
    });

    userId = user.userId;

    // Create the test pod
    await createTestPod(db, testPodId, userId);

    // Pre-create streams that will be used in various tests
    // This is needed because only pod owners can create streams
    const streamsToCreate = [
      // Basic test streams
      "stream1",
      "stream2",
      "stream3",
      "nested",
      // Pod creation test streams
      "init",
      // NOTE: rate-stream-1, rate-stream-2, rate-stream-3, blog are NOT pre-created
      // because the "should track stream creation rate limits" test needs to create them
      // NOTE: 'existing' is NOT pre-created because the test needs to create it first
      // Public/anonymous test streams
      "public-data",
      // Window test streams
      "window-test",
      "new-window",
      "cleanup-trigger",
      // Header test stream
      "header-test",
      // Decrease test streams
      "decrease-1",
      "decrease-2",
      // Over limit test
      "over-limit",
      // User-specific test streams
      "user1-blocked",
      "user2-allowed",
      // Different rate limits test streams
      "can-write",
      "stream-99",
      "stream-100",
      "stream-101",
    ];

    for (const streamName of streamsToCreate) {
      // Check if stream already exists at root level
      const existing = await db.oneOrNone(
        `SELECT id FROM stream 
         WHERE pod_name = $(podName) 
           AND name = $(streamName) 
           AND parent_id IS NULL`,
        { podName: testPodId, streamName },
      );

      if (!existing) {
        const now = Date.now();
        await db.none(
          `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, metadata, has_schema, created_at, updated_at)
           VALUES ($(podName), $(streamName), $(streamName), NULL, $(userId), 'public', '{}', false, $(now), $(now))`,
          { podName: testPodId, streamName, userId, now },
        );
      }
    }

    // Get OAuth token
    authToken = await client.authenticateViaOAuth(userId, [testPodId]);

    client.setBaseUrl(baseUrl);
    client.setAuthToken(authToken);
  });

  describe("Write Rate Limits", () => {
    it("should track write rate limits per user", async () => {
      // Make multiple write requests (streams are pre-created in beforeEach)
      await client.post("/stream1/msg1", "Message 1");
      await client.post("/stream2/msg2", "Message 2");
      await client.post("/stream3/msg3", "Message 3");
      await client.post("/nested/stream4", "Message 4");

      // Check rate limit record using test utility
      const status = await getRateLimitStatus(userId, "write");

      expect(status.enabled).to.be.true;
      // At least 4 writes (might be more due to other tests in same window)
      expect(status.count).to.be.at.least(4);
      expect(status.resetAt).to.exist;
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

      // Get a WebPods JWT token for the user
      const webpodsToken = generateTestWebPodsToken(podTestUser.userId);

      // Create pods using the API (which triggers rate limiting)
      client.setBaseUrl("http://localhost:3000");
      client.setAuthToken(webpodsToken);

      // Create first pod via API
      const createResponse1 = await client.post("/api/pods", {
        name: "pod-limit-1",
      });
      expect(createResponse1.status).to.equal(201);

      // Create second pod via API
      const createResponse2 = await client.post("/api/pods", {
        name: "pod-limit-2",
      });
      expect(createResponse2.status).to.equal(201);

      // Now get OAuth tokens to write to the pods
      const token1 = await client.authenticateViaOAuth(podTestUser.userId, [
        "pod-limit-1",
      ]);
      const token2 = await client.authenticateViaOAuth(podTestUser.userId, [
        "pod-limit-2",
      ]);

      // Write to the pods (streams auto-create on first write)
      client.setBaseUrl(`http://pod-limit-1.localhost:3000`);
      client.setAuthToken(token1);
      const response1 = await client.post("/init/pod1", "Pod 1");
      expect(response1.status).to.equal(201);

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

      // Verify ownership via .config/owner stream
      // Get .config stream for pod1
      const configStream1 = await db.oneOrNone(
        `SELECT id FROM stream WHERE pod_name = $(pod_name) AND name = '.config' AND parent_id IS NULL`,
        { pod_name: pod1.name },
      );
      const ownerStream1 = await db.oneOrNone(
        `SELECT id FROM stream WHERE parent_id = $(parent_id) AND name = 'owner'`,
        { parent_id: configStream1.id },
      );
      const owner1Record = await db.oneOrNone(
        `SELECT content FROM record WHERE stream_id = $(stream_id) AND name = 'owner' ORDER BY index DESC LIMIT 1`,
        { stream_id: ownerStream1.id },
      );
      // Get .config stream for pod2
      const configStream2 = await db.oneOrNone(
        `SELECT id FROM stream WHERE pod_name = $(pod_name) AND name = '.config' AND parent_id IS NULL`,
        { pod_name: pod2.name },
      );
      const ownerStream2 = await db.oneOrNone(
        `SELECT id FROM stream WHERE parent_id = $(parent_id) AND name = 'owner'`,
        { parent_id: configStream2.id },
      );
      const owner2Record = await db.oneOrNone(
        `SELECT content FROM record WHERE stream_id = $(stream_id) AND name = 'owner' ORDER BY index DESC LIMIT 1`,
        { stream_id: ownerStream2.id },
      );

      expect(owner1Record).to.exist;
      expect(JSON.parse(owner1Record.content).userId).to.equal(
        podTestUser.userId,
      );
      expect(owner2Record).to.exist;
      expect(JSON.parse(owner2Record.content).userId).to.equal(
        podTestUser.userId,
      );

      // Check rate limit records using test utility
      const podLimit = await getRateLimitStatus(
        podTestUser.userId,
        "pod_create",
      );

      expect(podLimit.enabled).to.be.true;
      expect(podLimit.count).to.equal(2);

      // Now test that we can create more pods up to the limit (10)
      // We've created 2, so we can create 8 more
      client.setBaseUrl("http://localhost:3000");
      client.setAuthToken(webpodsToken);

      for (let i = 3; i <= 10; i++) {
        const createResponseN = await client.post("/api/pods", {
          name: `pod-limit-${i}`,
        });
        expect(createResponseN.status).to.equal(201, `Should create pod ${i}`);
      }

      // The 11th pod should be blocked (rate limit exceeded)
      const createResponse11 = await client.post("/api/pods", {
        name: "pod-limit-11",
      });
      expect(createResponse11.status).to.equal(429);
      expect(createResponse11.data.error.code).to.equal("RATE_LIMIT_EXCEEDED");
    });

    it("should track stream creation rate limits", async () => {
      // Create streams that auto-create on first write
      await client.post("/rate-stream-1/msg1", "Message 1");
      await client.post("/rate-stream-2/msg2", "Message 2");
      await client.post("/rate-stream-3/msg3", "Message 3");
      await client.post("/blog/first", "First post");

      // Use test utility to check rate limit
      const streamLimit = await getRateLimitStatus(userId, "stream_create");

      expect(streamLimit.enabled).to.be.true;
      // At least 4 stream creations (might be more due to other tests in same window)
      expect(streamLimit.count).to.be.at.least(4);
    });

    it("should not count writes to existing streams as stream creation", async () => {
      // Create one stream explicitly (to test the difference)
      await client.createStream("existing");

      // Write multiple records to the same stream
      await client.post("/existing/first", "First message");
      await client.post("/existing/second", "Second message");
      await client.post("/existing/third", "Third message");

      // Use test utility to check rate limit
      const streamLimit = await getRateLimitStatus(userId, "stream_create");

      // Stream creation count depends on test order and hour window
      // Should be at least 1 (from this test) but could be more
      expect(streamLimit.enabled).to.be.true;
      expect(streamLimit.count).to.be.at.least(1);

      // But at least 3 writes were made
      const writeLimit = await getRateLimitStatus(userId, "write");
      expect(writeLimit.enabled).to.be.true;
      expect(writeLimit.count).to.be.at.least(3);
    });
  });

  describe("Read Rate Limits", () => {
    beforeEach(async () => {
      // Create test data (stream auto-creates with public permission by default)
      await client.post("/public-data/public", "Public content");
      await client.post("/public-data/more", "More content");
    });

    it("should track read rate limits separately from writes", async () => {
      // Make read requests
      await client.get("/public-data?i=0");
      await client.get("/public-data?i=1");
      await client.get("/public-data"); // List all

      // Check rate limit records using test utilities
      const writeLimit = await getRateLimitStatus(userId, "write");
      const readLimit = await getRateLimitStatus(userId, "read");

      expect(writeLimit.enabled).to.be.true;
      expect(readLimit.enabled).to.be.true;
      expect(writeLimit.count).to.equal(2); // Two writes in beforeEach
      expect(readLimit.count).to.equal(3); // Three reads
    });

    it("should track anonymous read rate limits by IP", async () => {
      // Public stream created in beforeEach, just add more data
      await client.post("/public-data/first", "First");
      await client.post("/public-data/second", "Second");

      // Clear auth for anonymous requests
      client.clearAuthToken();

      // Reset IP-based rate limits for clean test
      // Note: IP could be ::1 or 127.0.0.1
      await resetRateLimit("ip:127.0.0.1", "read");
      await resetRateLimit("ip:::1", "read");

      // Make anonymous read requests
      await client.get("/public-data?i=0");
      await client.get("/public-data?i=1");

      // Check rate limit by IP
      // Try both possible IP formats
      let ipLimit = await getRateLimitStatus("ip:127.0.0.1", "read");
      if (!ipLimit.enabled || ipLimit.count === 0) {
        ipLimit = await getRateLimitStatus("ip:::1", "read");
      }

      expect(ipLimit.enabled).to.be.true;
      expect(ipLimit.count).to.equal(2);
    });
  });

  describe("Rate Limit Windows", () => {
    it("should use hourly windows for rate limiting", async () => {
      // Make a request (stream auto-creates)
      await client.post("/window-test/msg", "Message");

      // Get window info via test utility
      const testClient = new TestHttpClient("http://localhost:3000");
      const response = await testClient.get(
        `/test-utils/ratelimit/window-info?identifier=${userId}&action=write`,
      );

      if (!response.data.success) {
        // Adapter doesn't support window info, skip test
        return;
      }

      const windowStart = new Date(response.data.windowStart);
      const windowEnd = new Date(response.data.windowEnd);
      const windowDuration = windowEnd.getTime() - windowStart.getTime();

      // Should be approximately 1 hour (3600000 ms)
      expect(windowDuration).to.be.closeTo(3600000, 1000);
    });

    it("should reset count when window expires", async () => {
      const testClient = new TestHttpClient("http://localhost:3000");
      const now = new Date();

      // Set an expired window with high count via test utility
      const setResponse = await testClient.post(
        "/test-utils/ratelimit/set-window",
        {
          identifier: userId,
          action: "write",
          count: 999, // Just under limit
          windowStart: new Date(now.getTime() - 2 * 60 * 60 * 1000), // 2 hours ago
          windowEnd: new Date(now.getTime() - 60 * 60 * 1000), // 1 hour ago
        },
      );

      if (!setResponse.data.success) {
        // Adapter doesn't support set window, skip test
        return;
      }

      // Make a new request (should start new window, stream auto-creates)
      const response = await client.post("/new-window/msg", "Message");
      expect(response.status).to.equal(201);

      // Check the status - should have reset to 1
      const status = await getRateLimitStatus(userId, "write");
      expect(status.count).to.equal(1); // Reset to 1
    });

    it("should clean up old rate limit windows", async () => {
      const testClient = new TestHttpClient("http://localhost:3000");
      const oldDate = new Date(Date.now() - 24 * 60 * 60 * 1000); // 24 hours ago

      // Set multiple old windows via test utility
      const setResponse1 = await testClient.post(
        "/test-utils/ratelimit/set-window",
        {
          identifier: "old-user-1",
          action: "write",
          count: 100,
          windowStart: new Date(oldDate.getTime() - 60 * 60 * 1000),
          windowEnd: oldDate,
        },
      );

      const setResponse2 = await testClient.post(
        "/test-utils/ratelimit/set-window",
        {
          identifier: "old-user-2",
          action: "read",
          count: 200,
          windowStart: new Date(oldDate.getTime() - 60 * 60 * 1000),
          windowEnd: oldDate,
        },
      );

      if (!setResponse1.data.success || !setResponse2.data.success) {
        // Adapter doesn't support set window, skip test
        return;
      }

      // Make a new request (stream auto-creates)
      await client.post("/cleanup-trigger/new", "New message");

      // Manually trigger cleanup for in-memory adapter
      await testClient.post("/test-utils/ratelimit/cleanup");

      // Check all windows via test utility
      const windowsResponse = await testClient.get(
        "/test-utils/ratelimit/all-windows",
      );

      if (!windowsResponse.data.success) {
        // Adapter doesn't support get all windows, skip test
        return;
      }

      // Check that old windows are gone (only recent windows should exist)
      const cutoff = Date.now() - 2 * 60 * 60 * 1000;
      const oldWindows = windowsResponse.data.windows.filter(
        (w: any) => new Date(w.windowEnd).getTime() < cutoff,
      );

      expect(oldWindows.length).to.equal(0);
    });
  });

  describe("Rate Limit Headers", () => {
    it("should return rate limit headers in responses", async () => {
      await client.createStream("header-test");
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
      // Streams auto-create on first write
      const response1 = await client.post("/decrease-1/msg1", "Message 1");
      const remaining1 = parseInt(response1.headers["x-ratelimit-remaining"]);

      const response2 = await client.post("/decrease-2/msg2", "Message 2");
      const remaining2 = parseInt(response2.headers["x-ratelimit-remaining"]);

      expect(remaining2).to.equal(remaining1 - 1);
    });
  });

  describe("Rate Limit Enforcement", () => {
    it("should return 429 when rate limit is exceeded", async () => {
      // Use test utility to set rate limit to exceeded state
      // Set count to limit (1000) - this will max out the rate limit
      const result = await setRateLimitCount(userId, "write", 1000);

      expect(result.count).to.equal(1000);
      expect(result.remaining).to.equal(0);

      // Try to make another request (should be blocked)
      // Note: createStream might succeed if it's counted separately as stream_create
      // So we'll just do a direct write which should definitely fail
      const response = await client.post("/stream1/should-fail", "Should fail");

      expect(response.status).to.equal(429);
      expect(response.data.error.code).to.equal("RATE_LIMIT_EXCEEDED");
      expect(response.data.error.message).to.include("Too many requests");

      // Verify the count is still at 1000 (the failed request shouldn't increment)
      const finalStatus = await getRateLimitStatus(userId, "write");
      expect(finalStatus.count).to.equal(1000);
      expect(finalStatus.remaining).to.equal(0);
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

      // Create a separate pod for user2
      const user2PodId = "rate-test-user2";
      await createTestPod(db, user2PodId, user2.userId);

      // Pre-create streams for user2's pod
      await db.none(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), $(streamName), $(streamName), NULL, $(userId), 'public', NOW())`,
        {
          podName: user2PodId,
          streamName: "user2-allowed",
          userId: user2.userId,
        },
      );

      // Get tokens for both users
      const token1 = await client.authenticateViaOAuth(userId, [testPodId]);
      const token2 = await client.authenticateViaOAuth(user2.userId, [
        user2PodId,
      ]);

      // Start with user1's token
      client.setAuthToken(token1);

      // Use test utility to set user1 at limit
      await setRateLimitCount(userId, "write", 1000);

      // Verify the rate limit was set
      const rateLimit = await getRateLimitStatus(userId, "write");
      expect(rateLimit.enabled).to.be.true;
      expect(rateLimit.count).to.equal(1000);
      expect(rateLimit.remaining).to.equal(0);

      // User1 should be blocked (but create stream first)
      await client.createStream("user1-blocked");
      const response1 = await client.post("/user1-blocked/fail", "Should fail");

      // Check what happened to the rate limit after the request
      if (response1.status !== 429) {
        const afterLimit = await getRateLimitStatus(userId, "write");
        throw new Error(
          `Expected 429 but got ${response1.status}. Rate limits after request: ${JSON.stringify(afterLimit, null, 2)}. Headers: ${JSON.stringify(response1.headers)}`,
        );
      }

      expect(response1.status).to.equal(429);

      // User2 should still be able to post to their own pod
      client.setAuthToken(token2);
      client.setBaseUrl(`http://${user2PodId}.localhost:3000`);
      const response2 = await client.post(
        "/user2-allowed/succeed",
        "Should succeed",
      );
      expect(response2.status).to.equal(201);
      // Reset base URL for next tests
      client.setBaseUrl(baseUrl);
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

      // Create a separate pod for the unique user so they can create streams
      const uniquePodId = "rate-test-unique";
      await createTestPod(db, uniquePodId, uniqueUser.userId);

      // Pre-create ONLY the can-write stream (stream-99, stream-100, stream-101 need to be created during test)
      await db.none(
        `INSERT INTO stream (pod_name, name, path, parent_id, user_id, access_permission, created_at)
         VALUES ($(podName), $(streamName), $(streamName), NULL, $(userId), 'public', NOW())`,
        {
          podName: uniquePodId,
          streamName: "can-write",
          userId: uniqueUser.userId,
        },
      );

      const uniqueToken = await client.authenticateViaOAuth(uniqueUser.userId, [
        uniquePodId,
      ]);

      // Use the unique user for this test
      client.setAuthToken(uniqueToken);
      client.setBaseUrl(`http://${uniquePodId}.localhost:3000`);
      const testUserId = uniqueUser.userId;

      // Use test utilities to set different counts for different actions
      // Reset any existing rate limits for this user
      await resetRateLimit(testUserId, "write");
      await resetRateLimit(testUserId, "stream_create");

      // Set different counts for different actions using test utilities
      await setRateLimitCount(testUserId, "write", 100); // Well under write limit (1000)
      await setRateLimitCount(testUserId, "stream_create", 98); // Leave room for 2 stream creations

      // Can still write
      const writeResponse = await client.post("/can-write/msg", "Message");
      expect(writeResponse.status).to.equal(201);

      // Can create exactly one more stream (count will go from 98 to 99)
      const streamResponse1 = await client.createStream("stream-99");
      expect(streamResponse1.status).to.equal(201);
      await client.post("/stream-99/test", "Stream 99");

      // Can create one more stream (count will go from 99 to 100)
      const streamResponse2 = await client.createStream("stream-100");
      expect(streamResponse2.status).to.equal(201);
      await client.post("/stream-100/test", "Stream 100");

      // But creating another stream would exceed limit (would be 101, limit is 100)
      const exceededResponse = await client.createStream("stream-101");
      expect(exceededResponse.status).to.equal(429);

      // Reset base URL for next tests
      client.setBaseUrl(baseUrl);
    });
  });
});
