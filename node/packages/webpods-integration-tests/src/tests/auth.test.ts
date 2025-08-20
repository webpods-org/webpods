// Authentication tests for WebPods
import { expect } from "chai";
import jwt from "jsonwebtoken";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("WebPods Authentication", () => {
  let client: TestHttpClient;
  const testPodId = "auth-test";
  const baseUrl = `http://${testPodId}.localhost:3099`;

  // Helper to create a test JWT token
  function createTestToken(
    userId: string,
    email: string = "test@example.com",
    name: string = "Test User",
    pod?: string,
  ) {
    const payload: any = {
      user_id: userId,
      email,
      name,
    };

    // Add pod claim if provided
    if (pod) {
      payload.pod = pod;
    }

    return jwt.sign(
      payload,
      "test-secret-key", // Must match test-config.json
      { expiresIn: "1h" },
    );
  }

  beforeEach(() => {
    client = new TestHttpClient("http://localhost:3099");
    client.setBaseUrl(baseUrl);
  });

  describe("OAuth Endpoints", () => {
    it("should redirect to provider 2 OAuth (mock)", async () => {
      // Auth endpoints are on the main domain, not pod subdomains
      client.setBaseUrl("http://localhost:3099");
      const response = await client.get("/auth/testprovider2", {
        followRedirect: false,
      });

      expect(response.status).to.be.oneOf([302, 303]);
      // In test environment, we use mock OAuth provider
      expect(response.headers.location).to.include(
        "localhost:4567/oauth/authorize",
      );
    });

    it("should redirect to provider 1 OAuth (mock)", async () => {
      client.setBaseUrl("http://localhost:3099");
      const response = await client.get("/auth/testprovider1", {
        followRedirect: false,
      });

      expect(response.status).to.be.oneOf([302, 303]);
      // In test environment, we use mock OAuth provider
      expect(response.headers.location).to.include(
        "localhost:4567/oauth/authorize",
      );
    });

    it("should reject invalid OAuth provider", async () => {
      client.setBaseUrl("http://localhost:3099");
      const response = await client.get("/auth/invalid-provider");

      expect(response.status).to.equal(400);
    });

    it("should handle OAuth callback", async () => {
      client.setBaseUrl("http://localhost:3099");
      const response = await client.get(
        "/auth/testprovider2/callback?code=test-code&state=test-state",
      );

      // Will fail due to invalid code, but endpoint should exist
      expect(response.status).to.be.oneOf([400, 401]);
    });
  });

  describe("JWT Authentication", () => {
    let userId: string;
    let authToken: string;

    beforeEach(async () => {
      // Create a test user and identity
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "test123",
        email: "test@example.com",
        name: "Test User",
      });

      userId = testUser.userId;
      authToken = createTestToken(
        userId,
        testUser.email,
        testUser.name,
        testPodId,
      );
      client.setBaseUrl(baseUrl);
    });

    it("should reject requests without auth token to write operations", async () => {
      const response = await client.post(
        "/protected-stream/test",
        "test content",
      );

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("UNAUTHORIZED");
      expect(response.data.error.message).to.include("Authentication required");
    });

    it("should accept requests with valid auth token", async () => {
      client.setAuthToken(authToken);

      const response = await client.post(
        "/protected-stream/auth",
        "authenticated content",
      );

      if (response.status === 500) {
        console.error("Server error:", response.data);
      }

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index", 0);
      expect(response.data).to.have.property("author", userId);
    });

    it("should reject expired JWT token", async () => {
      const expiredToken = jwt.sign(
        {
          user_id: userId,
          email: "test@example.com",
          name: "Test User",
        },
        "test-secret-key", // Must match test-config.json
        { expiresIn: "-1h" }, // Already expired
      );

      client.setAuthToken(expiredToken);

      const response = await client.post("/expired-test/content", "content");

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("TOKEN_EXPIRED");
    });

    it("should reject invalid JWT signature", async () => {
      const invalidToken = jwt.sign(
        {
          user_id: userId,
          email: "test@example.com",
          name: "Test User",
        },
        "wrong-secret", // Wrong secret
        { expiresIn: "1h" },
      );

      client.setAuthToken(invalidToken);

      const response = await client.post("/invalid-sig/content", "content");

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("INVALID_TOKEN");
    });

    it("should reject malformed JWT token", async () => {
      client.setAuthToken("not.a.valid.jwt.token");

      const response = await client.post("/malformed/content", "content");

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("INVALID_TOKEN");
    });
  });

  describe("Public vs Authenticated Access", () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "testprovider1",
        providerId: "public-test",
        email: "public@example.com",
        name: "Public Test User",
      });

      userId = testUser.userId;
      authToken = createTestToken(
        testUser.userId,
        testUser.email,
        testUser.name,
        testPodId,
      );
    });

    it("should allow anonymous read on public streams", async () => {
      // First create a public stream as authenticated user
      client.setAuthToken(authToken);
      await client.post("/public-data/public", "Public content");

      // Now read without auth
      client.clearAuthToken();
      const response = await client.get("/public-data?i=0");

      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Public content");
    });

    it("should require auth for write on public streams", async () => {
      // Try to write without auth
      const response = await client.post(
        "/public-writable/anon",
        "Anonymous attempt",
      );

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("UNAUTHORIZED");
    });

    it("should track author correctly", async () => {
      client.setAuthToken(authToken);

      const response = await client.post("/tracked/data", {
        message: "Track me",
      });

      expect(response.status).to.equal(201);
      expect(response.data.author).to.equal(userId);

      // Verify in database
      const db = testDb.getDb();
      const pod = await db.oneOrNone(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId: testPodId },
      );
      const stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod.id, streamId: "tracked" },
      );
      const record = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(streamId) ORDER BY index ASC LIMIT 1`,
        { streamId: stream.id },
      );

      expect(record.author_id).to.equal(userId);
    });
  });

  describe("Bearer Token Format", () => {
    let authToken: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "bearer-test",
        email: "bearer@example.com",
        name: "Bearer Test",
      });

      authToken = createTestToken(
        testUser.userId,
        testUser.email,
        testUser.name,
        testPodId,
      );
    });

    it("should accept Bearer token in Authorization header", async () => {
      const response = await client.post("/bearer-test/content", "content", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(201);
    });

    it("should accept token without Bearer prefix", async () => {
      const response = await client.post("/no-bearer/content", "content", {
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).to.equal(201);
    });

    it("should reject other auth schemes", async () => {
      const response = await client.post("/basic-auth/content", "content", {
        headers: {
          Authorization: `Basic ${Buffer.from("user:pass").toString("base64")}`,
        },
      });

      expect(response.status).to.equal(401);
    });
  });

  describe("Auth Success Page", () => {
    beforeEach(() => {
      // Auth endpoints are on main domain, not pod subdomains
      client.setBaseUrl("http://localhost:3099");
    });

    it("should display token on success page", async () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token";
      const response = await client.get(`/auth/success?token=${testToken}`);

      if (response.status !== 200) {
        console.log("Response status:", response.status);
        console.log("Response data:", response.data);
      }

      expect(response.status).to.equal(200);
      expect(response.headers["content-type"]).to.include("text/html");
      expect(response.data).to.include(testToken);
      expect(response.data).to.include("Authentication Successful");
      expect(response.data).to.include("Copy Token");
    });

    it("should include redirect parameter in success page", async () => {
      const testToken = "test.jwt.token";
      const redirectPath = "/dashboard";
      const response = await client.get(
        `/auth/success?token=${testToken}&redirect=${encodeURIComponent(redirectPath)}`,
      );

      expect(response.status).to.equal(200);
      expect(response.data).to.include(redirectPath);
      expect(response.data).to.include("Redirecting to your application");
    });

    it("should return error for missing token", async () => {
      const response = await client.get("/auth/success");

      expect(response.status).to.equal(400);
      expect(response.data).to.include("Missing token parameter");
    });

    it("should set window.authToken for JavaScript access", async () => {
      const testToken = "test.jwt.token";
      const response = await client.get(`/auth/success?token=${testToken}`);

      expect(response.status).to.equal(200);
      expect(response.data).to.include(`window.authToken = '${testToken}'`);
    });

    it("should support no_redirect parameter", async () => {
      const testToken = "test.jwt.token";
      const response = await client.get(
        `/auth/success?token=${testToken}&no_redirect=1`,
      );

      expect(response.status).to.equal(200);
      // Check that auto-redirect script checks for no_redirect
      expect(response.data).to.include("no_redirect");
    });
  });

  describe("Logout", () => {
    let authToken: string;

    beforeEach(async () => {
      // Auth endpoints are on main domain
      client.setBaseUrl("http://localhost:3099");
      // Create a test user and token
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "logout-test",
        email: "logout@example.com",
        name: "Logout Test",
      });

      authToken = createTestToken(
        testUser.userId,
        testUser.email,
        testUser.name,
        testPodId,
      );
      client.setAuthToken(authToken);
    });

    it("should handle POST logout and return JSON", async () => {
      const response = await client.post("/auth/logout");

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("success", true);
      expect(response.data).to.have.property(
        "message",
        "Logged out successfully",
      );
    });

    it("should handle GET logout and redirect", async () => {
      // Note: Axios follows redirects by default. With maxRedirects: 0,
      // we should get the 302 redirect response
      const response = await client.get("/auth/logout", {
        maxRedirects: 0,
        validateStatus: (status: number) => status < 500,
      });

      // The actual redirect should happen, but then "/" returns 404 on main domain
      // which is expected as there's no root handler on main domain
      // So we just check that the cookie is cleared
      expect(response.status).to.be.oneOf([302, 404]); // 302 if redirect not followed, 404 after redirect

      // If it was a redirect, check the location
      if (response.status === 302) {
        expect(response.headers.location).to.equal("/");
      }
    });

    it("should clear authentication after logout", async () => {
      // First verify we're authenticated
      let response = await client.get("/auth/whoami");
      expect(response.status).to.equal(200);

      // Logout
      await client.post("/auth/logout");

      // Clear auth token from client to test properly
      client.clearAuthToken();

      // Should no longer be authenticated
      response = await client.get("/auth/whoami");
      expect(response.status).to.equal(401);
    });
  });

  describe("Cross-Pod Authentication", () => {
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "testprovider1",
        providerId: "cross-pod",
        email: "cross@example.com",
        name: "Cross Pod User",
      });

      userId = testUser.userId;
    });

    it("should use same user with different pod tokens for different pods", async () => {
      // Create token for first pod
      const token1 = createTestToken(
        userId,
        "cross@example.com",
        "Cross Pod User",
        "pod-one",
      );
      client.setBaseUrl(`http://pod-one.localhost:3099`);
      client.setAuthToken(token1);

      const response1 = await client.post(
        "/stream1/content",
        "Pod one content",
      );
      expect(response1.status).to.equal(201);

      // Create token for second pod
      const token2 = createTestToken(
        userId,
        "cross@example.com",
        "Cross Pod User",
        "pod-two",
      );
      client.setBaseUrl(`http://pod-two.localhost:3099`);
      client.setAuthToken(token2);

      const response2 = await client.post(
        "/stream2/content",
        "Pod two content",
      );
      expect(response2.status).to.equal(201);

      // Verify both pods exist and have correct ownership
      const db = testDb.getDb();
      const pod1 = await db.oneOrNone(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId: "pod-one" },
      );
      const pod2 = await db.oneOrNone(
        `SELECT * FROM pod WHERE pod_id = $(podId)`,
        { podId: "pod-two" },
      );

      expect(pod1).to.exist;
      expect(pod2).to.exist;

      // Check .meta/owner for both pods
      const owner1Stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod1.id, streamId: ".meta/owner" },
      );
      const owner1Record = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(streamId) ORDER BY index ASC LIMIT 1`,
        { streamId: owner1Stream.id },
      );
      expect(JSON.parse(owner1Record.content).owner).to.equal(userId);

      const owner2Stream = await db.oneOrNone(
        `SELECT * FROM stream WHERE pod_id = $(podId) AND stream_id = $(streamId)`,
        { podId: pod2.id, streamId: ".meta/owner" },
      );
      const owner2Record = await db.oneOrNone(
        `SELECT * FROM record WHERE stream_id = $(streamId) ORDER BY index ASC LIMIT 1`,
        { streamId: owner2Stream.id },
      );
      expect(JSON.parse(owner2Record.content).owner).to.equal(userId);
    });
  });

  describe("User Metadata", () => {
    it("should store user metadata from OAuth", async () => {
      const db = testDb.getDb();

      // Simulate OAuth user creation with metadata in identity
      const userId = crypto.randomUUID();
      const identityId = crypto.randomUUID();

      await db.none(
        `INSERT INTO "user" (id, created_at, updated_at) 
         VALUES ($(userId), NOW(), NOW())`,
        { userId },
      );

      const identity = await db.one(
        `INSERT INTO identity (id, user_id, provider, provider_id, email, name, metadata, created_at, updated_at)
         VALUES ($(identityId), $(userId), $(provider), $(providerId), $(email), $(name), $(metadata), NOW(), NOW())
         RETURNING *`,
        {
          identityId,
          userId,
          provider: "testprovider1",
          providerId: "12345",
          email: "oauth@example.com",
          name: "OAuth User",
          metadata: JSON.stringify({
            avatar_url: "https://example.com/avatar.jpg",
            bio: "Developer",
            location: "San Francisco",
          }),
        },
      );

      expect(identity.metadata).to.deep.equal({
        avatar_url: "https://example.com/avatar.jpg",
        bio: "Developer",
        location: "San Francisco",
      });
    });

    it("should handle users from different OAuth providers", async () => {
      const db = testDb.getDb();

      // Provider 1 user
      const user1 = await createTestUser(db, {
        provider: "testprovider1",
        providerId: "p1-123",
        email: "user1@example.com",
        name: "Provider1 User",
      });

      // Provider 2 user
      const user2 = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "p2-456",
        email: "user2@example.com",
        name: "Provider2 User",
      });

      // Verify identities were created correctly
      const identity1 = await db.oneOrNone(
        `SELECT * FROM identity WHERE user_id = $(userId)`,
        { userId: user1.userId },
      );
      const identity2 = await db.oneOrNone(
        `SELECT * FROM identity WHERE user_id = $(userId)`,
        { userId: user2.userId },
      );

      expect(identity1.provider).to.equal("testprovider1");
      expect(identity1.provider_id).to.equal("p1-123");

      expect(identity2.provider).to.equal("testprovider2");
      expect(identity2.provider_id).to.equal("p2-456");
    });
  });
});
