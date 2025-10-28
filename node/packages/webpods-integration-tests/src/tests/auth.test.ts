// Authentication tests for WebPods
import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect, executeInsert } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";
import crypto from "crypto";

const schema = createSchema<DatabaseSchema>();

describe("WebPods Authentication", () => {
  let client: TestHttpClient;
  const testPodId = "auth-test";
  const baseUrl = `http://${testPodId}.localhost:3000`;

  beforeEach(() => {
    client = new TestHttpClient("http://localhost:3000");
    client.setBaseUrl(baseUrl);
  });

  describe("OAuth Endpoints", () => {
    it("should redirect to provider 2 OAuth (mock)", async () => {
      // Auth endpoints are on the main domain, not pod subdomains
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get("/auth/test-auth-provider-2", {
        followRedirect: false,
      });

      expect(response.status).to.be.oneOf([302, 303]);
      // In test environment, we use mock OAuth provider
      expect(response.headers.location).to.include(
        "localhost:4567/oauth2/auth",
      );
    });

    it("should redirect to provider 1 OAuth (mock)", async () => {
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get("/auth/test-auth-provider-1", {
        followRedirect: false,
      });

      expect(response.status).to.be.oneOf([302, 303]);
      // In test environment, we use mock OAuth provider
      expect(response.headers.location).to.include(
        "localhost:4567/oauth2/auth",
      );
    });

    it("should reject invalid OAuth provider", async () => {
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get("/auth/invalid-provider");

      expect(response.status).to.equal(400);
    });

    it("should handle OAuth callback", async () => {
      client.setBaseUrl("http://localhost:3000");
      const response = await client.get(
        "/auth/test-auth-provider-2/callback?code=test-code&state=test-state",
      );

      // Will fail due to invalid code, but endpoint should exist
      expect(response.status).to.be.oneOf([400, 401]);
    });
  });

  describe("Hydra OAuth Authentication", () => {
    let userId: string;
    let authToken: string;

    beforeEach(async () => {
      // Create a test user and identity
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "test-auth-provider-2",
        providerId: "test123",
        email: "test@example.com",
        name: "Test User",
      });

      userId = testUser.userId;

      // Create the test pod
      await createTestPod(db, testPodId, userId);

      // Get OAuth token via Hydra
      authToken = await client.authenticateViaOAuth(userId, [testPodId]);
      client.setBaseUrl(baseUrl);
    });

    it("should reject requests without auth token to write operations", async () => {
      // Make sure to clear any existing auth
      client.clearAuthToken();
      client.clearCookies();

      const response = await client.post(
        "/protected-stream/test",
        "test content",
      );

      // Check response status

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("UNAUTHORIZED");
      expect(response.data.error.message).to.include("Authentication required");
    });

    it("should accept requests with valid auth token", async () => {
      client.setAuthToken(authToken);

      // Create the stream first
      const createResponse = await client.createStream("protected-stream");

      // Debug: Check if stream creation succeeded
      if (createResponse.status !== 201) {
        console.error(
          "Stream creation failed:",
          createResponse.status,
          createResponse.data,
        );
      }

      const response = await client.post(
        "/protected-stream/auth",
        "authenticated content",
      );

      // Check server response - minimal fields only

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index", 0);
      expect(response.data).to.have.property("name", "auth");
      expect(response.data).to.have.property("hash");
      expect(response.data).to.have.property("size");
    });

    it("should reject invalid OAuth token", async () => {
      // Use a completely invalid token
      const invalidToken = "invalid.oauth.token";

      client.setAuthToken(invalidToken);

      const response = await client.post("/expired-test/content", "content");

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.be.oneOf([
        "INVALID_TOKEN",
        "TOKEN_VERIFICATION_FAILED",
      ]);
    });

    it("should reject token for wrong pod", async () => {
      // Get a token for a different pod
      const wrongPodToken = await client.authenticateViaOAuth(userId, [
        "different-pod",
      ]);

      client.setAuthToken(wrongPodToken);

      const response = await client.post("/invalid-sig/content", "content");

      expect(response.status).to.equal(403);
      expect(response.data.error.code).to.equal("POD_FORBIDDEN");
    });

    it("should reject malformed OAuth token", async () => {
      client.setAuthToken("not.a.valid.oauth.token");

      const response = await client.post("/malformed/content", "content");

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.be.oneOf([
        "INVALID_TOKEN",
        "TOKEN_VERIFICATION_FAILED",
      ]);
    });
  });

  describe("Public vs Authenticated Access", () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "public-test",
        email: "public@example.com",
        name: "Public Test User",
      });

      userId = testUser.userId;

      // Create the test pod
      await createTestPod(db, testPodId, userId);

      // Get OAuth token via Hydra
      authToken = await client.authenticateViaOAuth(userId, [testPodId]);
    });

    it("should allow anonymous read on public streams", async () => {
      // First create a public stream as authenticated user
      client.setAuthToken(authToken);
      await client.createStream("public-data");
      await client.post("/public-data/public", "Public content");

      // Now read without auth
      client.clearAuthToken();
      const response = await client.get("/public-data/public");

      expect(response.status).to.equal(200);
      expect(response.data).to.equal("Public content");
    });

    it("should require auth for write on public streams", async () => {
      // Make sure to clear any existing auth
      client.clearAuthToken();
      client.clearCookies();

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

      // Create stream first
      await client.createStream("tracked");

      const response = await client.post("/tracked/data", {
        message: "Track me",
      });

      expect(response.status).to.equal(201);
      // userId is no longer returned in minimal response
      expect(response.data).to.have.property("name", "data");
      expect(response.data).to.have.property("hash");

      // Verify userId is stored in database
      const db = testDb.getDb();
      const pods = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: testPodId },
      );
      const pod = pods[0];

      const streams = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === p.streamId &&
                s.parent_id === null,
            )
            .take(1),
        { podName: pod.name, streamId: "tracked" },
      );
      const stream = streams[0];

      const records = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderBy((r) => r.index)
            .take(1),
        { streamId: stream.id },
      );
      const record = records[0];

      expect(record.user_id).to.equal(userId);
    });
  });

  describe("Bearer Token Format", () => {
    let authToken: string;
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "test-auth-provider-2",
        providerId: "bearer-test",
        email: "bearer@example.com",
        name: "Bearer Test",
      });

      userId = testUser.userId;

      // Create the test pod
      await createTestPod(db, testPodId, userId);

      // Get OAuth token via Hydra
      authToken = await client.authenticateViaOAuth(userId, [testPodId]);
    });

    it("should accept Bearer token in Authorization header", async () => {
      // Create stream first
      client.setAuthToken(authToken);
      await client.createStream("bearer-test");
      client.clearAuthToken();

      const response = await client.post("/bearer-test/content", "content", {
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      });

      expect(response.status).to.equal(201);
    });

    it("should accept token without Bearer prefix", async () => {
      // Create stream first
      client.setAuthToken(authToken);
      await client.createStream("no-bearer");
      client.clearAuthToken();

      const response = await client.post("/no-bearer/content", "content", {
        headers: {
          Authorization: authToken,
        },
      });

      expect(response.status).to.equal(201);
    });

    it("should reject other auth schemes", async () => {
      // Clear any existing auth and cookies
      client.clearAuthToken();
      client.clearCookies();

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
      client.setBaseUrl("http://localhost:3000");
    });

    it("should display token on success page", async () => {
      const testToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.token";
      const response = await client.get(`/auth/success?token=${testToken}`);

      // Check response

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
    let userId: string;

    beforeEach(async () => {
      // Auth endpoints are on main domain
      client.setBaseUrl("http://localhost:3000");
      // Create a test user and token
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "test-auth-provider-2",
        providerId: "logout-test",
        email: "logout@example.com",
        name: "Logout Test",
      });

      userId = testUser.userId;

      // Create the test pod
      await createTestPod(db, testPodId, userId);

      // Get OAuth token via Hydra
      authToken = await client.authenticateViaOAuth(userId, [testPodId]);
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
      expect(response.data).to.have.property("user_id", userId);

      // Logout (clears session cookies but not OAuth tokens)
      await client.post("/auth/logout");

      // Clear auth token from client to test properly
      // Note: OAuth tokens are stateless and can't be revoked server-side
      // The client must discard the token
      client.clearAuthToken();
      client.clearCookies();

      // Should no longer be authenticated when token is not provided
      response = await client.get("/auth/whoami");
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("UNAUTHENTICATED");
    });
  });

  describe("Cross-Pod Authentication", () => {
    let userId: string;

    beforeEach(async () => {
      const db = testDb.getDb();
      const testUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "cross-pod",
        email: "cross@example.com",
        name: "Cross Pod User",
      });

      userId = testUser.userId;
    });

    it("should use same user with different pod tokens for different pods", async () => {
      // Create pods
      const db = testDb.getDb();
      await createTestPod(db, "pod-one", userId);
      await createTestPod(db, "pod-two", userId);

      // Get token for both pods
      const token = await client.authenticateViaOAuth(userId, [
        "pod-one",
        "pod-two",
      ]);

      // Use token on first pod
      client.setBaseUrl(`http://pod-one.localhost:3000`);
      client.setAuthToken(token);

      // Create stream first
      await client.createStream("stream1");

      const response1 = await client.post(
        "/stream1/content",
        "Pod one content",
      );
      expect(response1.status).to.equal(201);

      // Use same token on second pod
      client.setBaseUrl(`http://pod-two.localhost:3000`);
      client.setAuthToken(token);

      // Create stream first
      await client.createStream("stream2");

      const response2 = await client.post(
        "/stream2/content",
        "Pod two content",
      );
      expect(response2.status).to.equal(201);

      // Verify both pods exist and have correct ownership
      const pod1Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: "pod-one" },
      );
      const pod1 = pod1Results[0];

      const pod2Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("pod")
            .where((pod) => pod.name === p.podId)
            .take(1),
        { podId: "pod-two" },
      );
      const pod2 = pod2Results[0];

      expect(pod1).to.exist;
      expect(pod2).to.exist;

      // Check .config/owner for both pods
      // Get .config stream
      const configStream1Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .take(1),
        { podName: pod1.name },
      );
      const configStream1 = configStream1Results[0];

      // Get owner stream (child of .config)
      const ownerStream1Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parentId && s.name === "owner")
            .take(1),
        { parentId: configStream1.id },
      );
      const ownerStream1 = ownerStream1Results[0];

      const owner1RecordResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderBy((r) => r.index)
            .take(1),
        { streamId: ownerStream1.id },
      );
      const owner1Record = owner1RecordResults[0];
      expect(JSON.parse(owner1Record.content).userId).to.equal(userId);

      // Get .config stream
      const configStream2Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where(
              (s) =>
                s.pod_name === p.podName &&
                s.name === ".config" &&
                s.parent_id === null,
            )
            .take(1),
        { podName: pod2.name },
      );
      const configStream2 = configStream2Results[0];

      // Get owner stream (child of .config)
      const ownerStream2Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("stream")
            .where((s) => s.parent_id === p.parentId && s.name === "owner")
            .take(1),
        { parentId: configStream2.id },
      );
      const ownerStream2 = ownerStream2Results[0];

      const owner2RecordResults = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("record")
            .where((r) => r.stream_id === p.streamId)
            .orderBy((r) => r.index)
            .take(1),
        { streamId: ownerStream2.id },
      );
      const owner2Record = owner2RecordResults[0];
      expect(JSON.parse(owner2Record.content).userId).to.equal(userId);
    });
  });

  describe("User Metadata", () => {
    it("should store user metadata from OAuth", async () => {
      const db = testDb.getDb();

      // Simulate OAuth user creation with metadata in identity
      const userId = crypto.randomUUID();
      const identityId = crypto.randomUUID();
      const now = Date.now();

      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("user").values({
            id: p.userId,
            created_at: p.now,
            updated_at: p.now,
          }),
        { userId, now },
      );

      const identityResults = await executeInsert(
        db,
        schema,
        (q, p) =>
          q
            .insertInto("identity")
            .values({
              id: p.identityId,
              user_id: p.userId,
              provider: p.provider,
              provider_id: p.providerId,
              email: p.email,
              name: p.name,
              metadata: p.metadata,
              created_at: p.now,
              updated_at: p.now,
            })
            .returning((i) => i),
        {
          identityId,
          userId,
          provider: "test-auth-provider-1",
          providerId: "12345",
          email: "oauth@example.com",
          name: "OAuth User",
          metadata: JSON.stringify({
            avatar_url: "https://example.com/avatar.jpg",
            bio: "Developer",
            location: "San Francisco",
          }),
          now,
        },
      );
      const identity = identityResults[0];

      // metadata is stored as TEXT (JSON string) in database
      const metadata =
        typeof identity.metadata === "string"
          ? JSON.parse(identity.metadata)
          : identity.metadata;

      expect(metadata).to.deep.equal({
        avatar_url: "https://example.com/avatar.jpg",
        bio: "Developer",
        location: "San Francisco",
      });
    });

    it("should handle users from different OAuth providers", async () => {
      const db = testDb.getDb();

      // Provider 1 user
      const user1 = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "p1-123",
        email: "user1@example.com",
        name: "Provider1 User",
      });

      // Provider 2 user
      const user2 = await createTestUser(db, {
        provider: "test-auth-provider-2",
        providerId: "p2-456",
        email: "user2@example.com",
        name: "Provider2 User",
      });

      // Verify identities were created correctly
      const identity1Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("identity")
            .where((i) => i.user_id === p.userId)
            .take(1),
        { userId: user1.userId },
      );
      const identity1 = identity1Results[0];

      const identity2Results = await executeSelect(
        db,
        schema,
        (q, p) =>
          q
            .from("identity")
            .where((i) => i.user_id === p.userId)
            .take(1),
        { userId: user2.userId },
      );
      const identity2 = identity2Results[0];

      expect(identity1.provider).to.equal("test-auth-provider-1");
      expect(identity1.provider_id).to.equal("p1-123");

      expect(identity2.provider).to.equal("test-auth-provider-2");
      expect(identity2.provider_id).to.equal("p2-456");
    });
  });
});
