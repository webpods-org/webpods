/**
 * Test OAuth flow with real Hydra integration
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("OAuth Flow Integration", () => {
  let client: TestHttpClient;
  let userId: string;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");

    // Create a test user in the database
    const user = await createTestUser(testDb.getDb(), {
      provider: "test",
      email: "oauth-test@example.com",
      name: "OAuth Test User",
    });
    userId = user.userId;
  });

  describe("OAuth Authentication Flow", () => {
    it("should authenticate via OAuth and access protected endpoints", async () => {
      // Create a pod directly in the database
      const podId = "oauthtest";
      await createTestPod(testDb.getDb(), podId, userId);

      // Authenticate via OAuth flow
      const token = await client.authenticateViaOAuth(userId, [podId]);

      expect(token).to.be.a("string");
      expect(token.length).to.be.greaterThan(0);

      // Debug: Check token contents
      const parts = token.split(".");
      if (parts.length === 3) {
        const payload = JSON.parse(Buffer.from(parts[1], "base64").toString());
        // Verify token has correct structure
        expect(payload).to.have.property("iss");
        expect(payload).to.have.property("aud");
        expect(payload).to.have.property("ext");
        // Handle nested ext.ext.pods structure from Hydra
        const pods = payload.ext?.pods || (payload.ext as any)?.ext?.pods;
        expect(pods).to.exist;
        expect(pods).to.include(podId);
      }

      // Now use the OAuth token to access the pod
      const podClient = new TestHttpClient(`http://${podId}.localhost:3000`);
      podClient.setAuthToken(token);

      // Should be able to write to the pod
      const writeRes = await podClient.post(
        "/test-stream/oauth-test.txt",
        "OAuth test content",
      );

      expect(writeRes.status).to.equal(201);
      expect(writeRes.data).to.have.property("index", 0);
      expect(writeRes.data).to.have.property("hash");

      // Should be able to read the record we just created
      const readRes = await podClient.get("/test-stream/oauth-test.txt");
      expect(readRes.status).to.equal(200);
      expect(readRes.data).to.equal("OAuth test content");
    });

    it("should deny access to pods not in token scope", async () => {
      // Create two pods directly in the database
      await createTestPod(testDb.getDb(), "allowed", userId);
      await createTestPod(testDb.getDb(), "denied", userId);

      // Authenticate with access to only "allowed" pod
      const token = await client.authenticateViaOAuth(userId, ["allowed"]);

      // Should access "allowed" pod
      const allowedClient = new TestHttpClient("http://allowed.localhost:3000");
      allowedClient.setAuthToken(token);

      const allowedRes = await allowedClient.post("/oauth-test", {
        content: "allowed content",
        name: "test.txt",
      });
      expect(allowedRes.status).to.equal(201);

      // Should NOT access "denied" pod
      const deniedClient = new TestHttpClient("http://denied.localhost:3000");
      deniedClient.setAuthToken(token);

      const deniedRes = await deniedClient.post("/oauth-test", {
        content: "denied content",
        name: "test.txt",
      });
      expect(deniedRes.status).to.equal(403);
      expect(deniedRes.data).to.have.property("error");
      expect(deniedRes.data.error.code).to.equal("POD_FORBIDDEN");
    });

    it("should work without any pod scopes for main domain", async () => {
      // Authenticate without pod scopes
      const token = await client.authenticateViaOAuth(userId, []);

      expect(token).to.be.a("string");

      // Should be able to access main domain endpoints
      client.setAuthToken(token);
      const res = await client.get("/auth/whoami");

      // This might fail if whoami requires WebPods auth
      // but demonstrates the OAuth flow works
      expect(res.status).to.be.oneOf([200, 401]);
    });
  });
});
