// Pod-specific authentication tests
import { expect } from "chai";
import { TestHttpClient, createTestUser, createTestPod } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("Pod-Specific Authentication with SSO", () => {
  let client: TestHttpClient;
  const pod1 = "alice";
  const pod2 = "bob";

  describe("Pod Login Flow", () => {
    beforeEach(() => {
      client = new TestHttpClient("http://localhost:3000");
    });

    it("should redirect from pod login to main domain authorize", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3000`);

      const response = await client.get("/login", {
        followRedirect: false,
      });

      expect(response.status).to.equal(302);
      expect(response.headers.location).to.include("/auth/authorize");
      expect(response.headers.location).to.include(`pod=${pod1}`);
    });

    it("should include redirect parameter in login flow", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3000`);

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
    let bothPodsToken: string;

    beforeEach(async () => {
      client = new TestHttpClient("http://localhost:3000");
      const db = testDb.getDb();

      // Create test user
      user = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "12345",
        email: "pod-test@example.com",
        name: "Pod Test User",
      });

      // Create pods
      await createTestPod(db, pod1, user.userId);
      await createTestPod(db, pod2, user.userId);

      // Get OAuth tokens
      aliceToken = await client.authenticateViaOAuth(user.userId, [pod1]);
      bothPodsToken = await client.authenticateViaOAuth(user.userId, [pod1, pod2]);
    });

    it("should accept pod-specific token on correct pod", async () => {
      client.setBaseUrl(`http://${pod1}.localhost:3000`);

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
      client.setBaseUrl(`http://${pod2}.localhost:3000`);
      
      // Clear cookies to avoid authentication leakage
      client.clearCookies();

      // Debug: decode the token to see what pods it has
      const tokenParts = aliceToken.split('.');
      if (tokenParts.length === 3) {
        const payload = JSON.parse(Buffer.from(tokenParts[1], 'base64').toString());
        console.log("Alice token payload:", JSON.stringify(payload, null, 2));
      }

      // Try to use alice's token on bob's pod
      console.log("Testing on pod2 URL:", `http://${pod2}.localhost:3000`, "pod2 is:", pod2);
      const response = await client.post("/test-stream/test", "Test content", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      if (response.status !== 403) {
        console.log("Unexpected response:", response.status, response.data);
        console.log("Used token for pod:", pod1, "on pod:", pod2);
      }

      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("POD_FORBIDDEN");
    });

    it("should reject token without pod scope on pod subdomains", async () => {
      // Get a token without any pod scopes
      const noPodToken = await client.authenticateViaOAuth(user.userId, []);
      
      // Test on pod1
      client.setBaseUrl(`http://${pod1}.localhost:3000`);
      let response = await client.post("/stream1/content1", "Content 1", {
        headers: {
          Authorization: `Bearer ${noPodToken}`,
          "Content-Type": "text/plain",
        },
      });
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("POD_FORBIDDEN");

      // Test on pod2
      client.setBaseUrl(`http://${pod2}.localhost:3000`);
      response = await client.post("/stream2/content2", "Content 2", {
        headers: {
          Authorization: `Bearer ${noPodToken}`,
          "Content-Type": "text/plain",
        },
      });
      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("POD_FORBIDDEN");
    });
  });

  describe("SSO Behavior", () => {
    let client: TestHttpClient;

    beforeEach(() => {
      client = new TestHttpClient("http://localhost:3000");
    });

    it("should share session across OAuth flow", async () => {
      // This would require mocking OAuth flow or using a test OAuth provider
      // For now, we verify the authorize endpoint exists and behaves correctly

      client.setBaseUrl("http://localhost:3000");

      const response = await client.get("/auth/authorize?pod=alice", {
        followRedirect: false,
      });

      // Without session, should redirect to OAuth (Hydra provider in test)
      expect(response.status).to.equal(302);
      expect(response.headers.location).to.include(
        "localhost:4444/oauth2/auth",
      );
    });
  });

  describe("Pod Isolation", () => {
    let user: any;
    let aliceToken: string;

    beforeEach(async () => {
      client = new TestHttpClient("http://localhost:3000");
      const db = testDb.getDb();

      // Create test user
      user = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "67890",
        email: "isolation-test@example.com",
        name: "Isolation Test User",
      });

      // Create pod
      await createTestPod(db, pod1, user.userId);

      // Get OAuth token
      aliceToken = await client.authenticateViaOAuth(user.userId, [pod1]);
    });

    it("should isolate data between pods", async () => {
      // Write to alice's pod
      client.setBaseUrl(`http://${pod1}.localhost:3000`);
      await client.post("/secret-data/secret", "Alice secret", {
        headers: {
          Authorization: `Bearer ${aliceToken}`,
          "Content-Type": "text/plain",
        },
      });

      // Try to read from bob's pod with bob's token
      client.setBaseUrl(`http://${pod2}.localhost:3000`);
      const response = await client.get("/secret-data", {
        validateStatus: () => true,
      });

      // Should not find alice's data
      expect(response.status).to.equal(404);
    });

    it("should prevent cross-pod token usage for writes", async () => {
      // Try to write to bob's pod with alice's token
      client.setBaseUrl(`http://${pod2}.localhost:3000`);
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
      // Create a test user and pod
      const db = testDb.getDb();
      const user = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "callback-test",
        email: "callback@example.com",
        name: "Callback Test User",
      });
      
      await createTestPod(db, pod1, user.userId);
      
      // Get OAuth token
      const token = await client.authenticateViaOAuth(user.userId, [pod1]);
      client.setBaseUrl(`http://${pod1}.localhost:3000`);

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
      client.setBaseUrl(`http://${pod1}.localhost:3000`);

      const response = await client.get("/auth/callback", {
        validateStatus: () => true,
      });

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("MISSING_TOKEN");
    });
  });
});
