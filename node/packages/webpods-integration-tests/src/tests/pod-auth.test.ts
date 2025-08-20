// Pod-specific authentication tests
import { expect } from "chai";
import jwt from "jsonwebtoken";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Pod-Specific Authentication with SSO", () => {
  let client: TestHttpClient;
  const pod1 = "alice";
  const pod2 = "bob";
  const jwtSecret = "test-secret-key"; // Must match test-config.json

  // Helper to create a test user and pod-specific token
  function createPodToken(
    userId: string,
    authId: string,
    pod: string,
    email: string = "test@example.com",
  ) {
    return jwt.sign(
      {
        user_id: userId,
        auth_id: authId,
        email,
        name: "Test User",
        provider: "testprovider2",
        pod, // Pod-specific claim
      },
      jwtSecret,
      { expiresIn: "1h" },
    );
  }

  // Helper to create a global token (no pod claim)
  function createGlobalToken(
    userId: string,
    authId: string,
    email: string = "test@example.com",
  ) {
    return jwt.sign(
      {
        user_id: userId,
        auth_id: authId,
        email,
        name: "Test User",
        provider: "testprovider2",
      },
      jwtSecret,
      { expiresIn: "1h" },
    );
  }

  describe("Pod Login Flow", () => {
    beforeEach(() => {
      client = new TestHttpClient("http://localhost:3099");
    });

    it("should redirect from pod login to main domain authorize", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3099`);

      const response = await client.get("/login", {
        followRedirect: false,
      });

      expect(response.status).to.equal(302);
      expect(response.headers.location).to.include("/auth/authorize");
      expect(response.headers.location).to.include(`pod=${pod1}`);
    });

    it("should include redirect parameter in login flow", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3099`);

      const response = await client.get("/login?redirect=/dashboard", {
        followRedirect: false,
      });

      expect(response.status).to.equal(302);
      expect(response.headers.location).to.include(
        `redirect=${encodeURIComponent("/dashboard")}`,
      );
    });
  });

  describe("Pod Token Validation", () => {
    let user: any;
    let aliceToken: string;
    let globalToken: string;

    beforeEach(async () => {
      client = new TestHttpClient("http://localhost:3099");
      const db = testDb.getDb();

      // Create test user
      [user] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:12345",
          email: "pod-test@example.com",
          name: "Pod Test User",
          provider: "testprovider2",
        })
        .returning("*");

      // Create tokens
      aliceToken = createPodToken(user.id, user.auth_id, pod1);
      globalToken = createGlobalToken(user.id, user.auth_id);
    });

    it("should accept pod-specific token on correct pod", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3099`);

      // Create a stream with alice's token
      const response = await client.post("/test-stream/test", "Test content", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      expect(response.status).to.equal(201);
    });

    it("should reject pod-specific token on wrong pod", async () => {
      client.setBaseUrl(`http://${pod2}.localhost:3099`);

      // Try to use alice's token on bob's pod
      const response = await client.post("/test-stream/test", "Test content", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("POD_MISMATCH");
    });

    it("should reject global token on pod subdomains", async () => {
      // Global tokens (without pod claim) should not work on pod subdomains
      // Test on pod1
      client.setBaseUrl(`http://${pod1}.localhost:3099`);
      let response = await client.post("/stream1/content1", "Content 1", {
        headers: {
          Authorization: `Bearer ${globalToken}`,
          "Content-Type": "text/plain",
        },
      });
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("POD_MISMATCH");

      // Test on pod2
      client.setBaseUrl(`http://${pod2}.localhost:3099`);
      response = await client.post("/stream2/content2", "Content 2", {
        headers: {
          Authorization: `Bearer ${globalToken}`,
          "Content-Type": "text/plain",
        },
      });
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("POD_MISMATCH");
    });
  });

  describe("SSO Behavior", () => {
    let client: TestHttpClient;

    beforeEach(() => {
      client = new TestHttpClient("http://localhost:3099");
    });

    it("should share session across OAuth flow", async () => {
      // This would require mocking OAuth flow or using a test OAuth provider
      // For now, we verify the authorize endpoint exists and behaves correctly

      client.setBaseUrl("http://localhost:3099");

      const response = await client.get("/auth/authorize?pod=alice", {
        followRedirect: false,
      });

      // Without session, should redirect to OAuth (mock provider in test)
      expect(response.status).to.equal(302);
      expect(response.headers.location).to.include(
        "localhost:4567/oauth/authorize",
      );
    });
  });

  describe("Pod Isolation", () => {
    let user: any;
    let aliceToken: string;

    beforeEach(async () => {
      client = new TestHttpClient("http://localhost:3099");
      const db = testDb.getDb();

      // Create test user
      [user] = await db("user")
        .insert({
          id: crypto.randomUUID(),
          auth_id: "auth:provider:67890",
          email: "isolation-test@example.com",
          name: "Isolation Test User",
          provider: "testprovider2",
        })
        .returning("*");

      // Create pod-specific tokens
      aliceToken = createPodToken(user.id, user.auth_id, pod1);
    });

    it("should isolate data between pods", async () => {
      // Write to alice's pod
      client.setBaseUrl(`http://${pod1}.localhost:3099`);
      await client.post("/secret-data/secret", "Alice secret", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      // Try to read from bob's pod with bob's token
      client.setBaseUrl(`http://${pod2}.localhost:3099`);
      const response = await client.get("/secret-data", {
        validateStatus: () => true,
      });

      // Should not find alice's data
      expect(response.status).to.equal(404);
    });

    it("should prevent cross-pod token usage for writes", async () => {
      // Try to write to bob's pod with alice's token
      client.setBaseUrl(`http://${pod2}.localhost:3099`);
      const response = await client.post("/malicious-write/evil", "Evil data", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("POD_MISMATCH");
    });
  });

  describe("Auth Callback on Pods", () => {
    it("should handle auth callback with token", async () => {
      const token = createPodToken("user123", "auth:provider:123", pod1);
      client.setBaseUrl(`http://${pod1}.localhost:3099`);

      const response = await client.get(
        `/auth/callback?token=${token}&redirect=/dashboard`,
        {
          followRedirect: false,
        },
      );

      // Should redirect to the final destination
      expect(response.status).to.equal(302);
      expect(response.headers.location).to.equal("/dashboard");

      // Should set pod_token cookie (we can't directly verify httpOnly cookies)
    });

    it("should reject callback without token", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3099`);

      const response = await client.get("/auth/callback", {
        validateStatus: () => true,
      });

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("MISSING_TOKEN");
    });
  });
});
