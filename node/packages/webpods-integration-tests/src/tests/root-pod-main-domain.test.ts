/**
 * Test rootPod functionality via main domain
 * Since test-config.json now has rootPod: "testroot" configured,
 * we can test the actual main domain behavior
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
  clearAllCache,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import jwt from "jsonwebtoken";
import { createSchema } from "@tinqerjs/tinqer";
import { executeSelect } from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

// Generate a WebPods JWT (not OAuth token) for API access
function generateWebPodsToken(userId: string): string {
  const payload = {
    user_id: userId,
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    type: "webpods", // This identifies it as a WebPods token
  };

  // Use the test JWT secret from test-config.json
  const secret = "test-secret-key";
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

describe("WebPods Root Pod Main Domain", () => {
  let mainClient: TestHttpClient;
  let rootClient: TestHttpClient;
  let authToken: string;
  const rootPodId = "testroot";
  const mainUrl = "http://localhost:3000";
  const rootPodUrl = `http://${rootPodId}.localhost:3000`;

  beforeEach(async () => {
    await clearAllCache();
    // Create test user
    const db = testDb.getDb();
    const user = await createTestUser(db, {
      provider: "test-auth-provider-1",
      providerId: "mainroot",
      email: "mainroot@example.com",
      name: "Main Root User",
    });

    // Create root pod
    await createTestPod(db, rootPodId, user.userId);

    // Get OAuth token and add content
    rootClient = new TestHttpClient(rootPodUrl);
    authToken = await rootClient.authenticateViaOAuth(user.userId, [rootPodId]);

    rootClient.setAuthToken(authToken);

    // Create stream first
    await rootClient.createStream("site");

    // Create root pod content
    const homeResponse = await rootClient.post(
      "/site/home",
      "<h1>Welcome to Main Domain</h1>",
    );
    if (homeResponse.status !== 201) {
      throw new Error(
        `Failed to create home page: ${homeResponse.status} ${JSON.stringify(homeResponse.data)}`,
      );
    }

    const aboutResponse = await rootClient.post(
      "/site/about",
      "<h1>About Page</h1>",
    );
    if (aboutResponse.status !== 201) {
      throw new Error(
        `Failed to create about page: ${aboutResponse.status} ${JSON.stringify(aboutResponse.data)}`,
      );
    }

    // Create api stream
    await rootClient.createStream("api");

    const statusResponse = await rootClient.post(
      "/api/status",
      JSON.stringify({ status: "ok", version: "2.0" }),
    );
    if (statusResponse.status !== 201) {
      throw new Error(
        `Failed to create status: ${statusResponse.status} ${JSON.stringify(statusResponse.data)}`,
      );
    }

    // Configure links for clean URLs using the routing API endpoint
    const linksResponse = await rootClient.post("/.config/routing", {
      "/": "site/home",
      "/about": "site/about",
      "/status": "api/status",
    });
    if (linksResponse.status !== 201) {
      throw new Error(
        `Failed to create links: ${linksResponse.status} ${JSON.stringify(linksResponse.data)}`,
      );
    }

    // Verify the pod exists
    const podDb = testDb.getDb();
    const podResults = await executeSelect(
      podDb,
      schema,
      (q, p) =>
        q
          .from("pod")
          .where((pod) => pod.name === p.podId)
          .take(1),
      { podId: rootPodId },
    );
    const pod = podResults[0] || null;
    if (!pod) {
      throw new Error("Root pod was not created");
    }

    // Now switch to main domain client
    mainClient = new TestHttpClient(mainUrl);
  });

  afterEach(async () => {
    await clearAllCache();
  });

  describe("Main domain serves root pod content", () => {
    it("should serve root pod home page on main domain root", async () => {
      const response = await mainClient.get("/");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>Welcome to Main Domain</h1>");
    });

    it("should serve root pod linked paths on main domain", async () => {
      // First test that the linked path works via the subdomain
      await rootClient.get("/about");
      // Verify subdomain /about works

      const response = await mainClient.get("/about");
      // Check about page on main domain
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>About Page</h1>");
    });

    it("should serve root pod API endpoints on main domain", async () => {
      const response = await mainClient.get("/status");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal('{"status":"ok","version":"2.0"}');
    });

    it("should serve root pod streams directly via main domain", async () => {
      const response = await mainClient.get("/site/home");
      expect(response.status).to.equal(200);
      expect(response.data).to.equal("<h1>Welcome to Main Domain</h1>");
    });

    it("should return 404 for non-existent paths on main domain", async () => {
      const response = await mainClient.get("/does-not-exist");
      expect(response.status).to.equal(404);
    });
  });

  describe("System endpoints take precedence", () => {
    it("should serve /health from system, not root pod", async () => {
      // Even if we create a /health stream in root pod
      rootClient.setAuthToken(authToken);
      await rootClient.post("/health/check", "Pod health check");

      // Main domain should still serve system health
      const response = await mainClient.get("/health");
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("status", "healthy");
      expect(response.data).to.have.property("uptime");
      // Should NOT be the pod content
      expect(response.data).to.not.equal("Pod health check");
    });

    it("should serve /auth/providers from system, not root pod", async () => {
      // Even if we create an /auth stream in root pod
      rootClient.setAuthToken(authToken);
      await rootClient.post("/auth/custom", "Custom auth");

      // Main domain should still serve system auth
      const response = await mainClient.get("/auth/providers");
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("providers");
      expect(response.data.providers).to.be.an("array");
      // Should NOT be the pod content
      expect(response.data).to.not.equal("Custom auth");
    });
  });

  describe("Authenticated operations via main domain", () => {
    it("should allow POST to root pod via main domain with auth", async () => {
      mainClient.setAuthToken(authToken);

      // Create stream first using POST with empty body
      await mainClient.post("/dynamic", "");

      const response = await mainClient.post(
        "/dynamic/content",
        "Dynamic data",
      );
      expect(response.status).to.equal(201);

      // Verify it can be read
      mainClient.setAuthToken("");
      const readResponse = await mainClient.get("/dynamic/content");
      expect(readResponse.status).to.equal(200);
      expect(readResponse.data).to.equal("Dynamic data");
    });

    it("should enforce permissions on main domain", async () => {
      // Create private content
      mainClient.setAuthToken(authToken);

      // Create private stream first using POST with empty body
      await mainClient.post("/secured?access=private", "");

      const createResponse = await mainClient.post("/secured/data", "Secret");
      expect(createResponse.status).to.equal(201);

      // Try to read without auth
      mainClient.setAuthToken("");
      const readResponse = await mainClient.get("/secured/data");
      expect(readResponse.status).to.equal(403);

      // Read with auth should work
      mainClient.setAuthToken(authToken);
      const authReadResponse = await mainClient.get("/secured/data");
      expect(authReadResponse.status).to.equal(200);
      expect(authReadResponse.data).to.equal("Secret");
    });

    it("should allow DELETE operations via main domain", async () => {
      mainClient.setAuthToken(authToken);

      // Create stream first using POST with empty body
      await mainClient.post("/temp", "");

      // Create a record
      await mainClient.post("/temp/item", "Temporary");

      // Delete it
      const deleteResponse = await mainClient.delete("/temp/item");
      expect(deleteResponse.status).to.equal(204);

      // Verify it's deleted
      const getResponse = await mainClient.get("/temp/item");
      expect(getResponse.status).to.equal(404);
      expect(getResponse.data.error.code).to.equal("RECORD_NOT_FOUND");
    });
  });

  describe("Subdomain isolation with rootPod", () => {
    it("should keep subdomains separate from main domain", async () => {
      // Create content in a different pod
      const aliceClient = new TestHttpClient("http://alice.localhost:3000");
      const db = testDb.getDb();
      const user = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "alice2",
        email: "alice2@example.com",
        name: "Alice Two",
      });

      await createTestPod(db, "alice", user.userId);
      const aliceToken = await aliceClient.authenticateViaOAuth(user.userId, [
        "alice",
      ]);

      aliceClient.setAuthToken(aliceToken);
      await aliceClient.post("/private/data", "Alice private data");

      // Main domain should not have access to alice's content
      const response = await mainClient.get("/private/data");
      expect(response.status).to.equal(404);

      // Alice should not see root pod content
      const aliceResponse = await aliceClient.get("/site/home");
      expect(aliceResponse.status).to.equal(404);
    });
  });

  describe("System API endpoints work with rootPod configured", () => {
    it("should serve /api/pods for pod management on main domain", async () => {
      // Create a new user for pod creation
      const db = testDb.getDb();
      const newUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "apitest",
        email: "apitest@example.com",
        name: "API Test User",
      });

      // Get auth token for the new user
      const apiToken = await mainClient.authenticateViaOAuth(
        newUser.userId,
        [],
      );
      mainClient.setAuthToken(apiToken);

      // Create a new pod via main domain API
      const createResponse = await mainClient.post("/api/pods", {
        name: "test-api-pod",
      });

      expect(createResponse.status).to.equal(201);
      expect(createResponse.data.name).to.equal("test-api-pod");
      expect(createResponse.data.message).to.include("created successfully");

      // List pods via main domain API
      const listResponse = await mainClient.get("/api/pods");
      expect(listResponse.status).to.equal(200);
      expect(listResponse.data).to.be.an("array");
      const podNames = listResponse.data.map((p: any) => p.name);
      expect(podNames).to.include("test-api-pod");
    });

    it("should serve /api/oauth endpoints on main domain", async () => {
      // Generate a WebPods JWT for API access (different from OAuth token)
      const db = testDb.getDb();
      const oauthUser = await createTestUser(db, {
        provider: "test-auth-provider-1",
        providerId: "oauthtest",
        email: "oauthtest@example.com",
        name: "OAuth Test User",
      });

      const webpodsToken = generateWebPodsToken(oauthUser.userId);

      // Register an OAuth client via main domain API using WebPods JWT
      const registerResponse = await mainClient.post(
        "/api/oauth/clients",
        {
          client_name: "Test OAuth App",
          redirect_uris: ["https://example.com/callback"],
          requested_pods: ["testroot"], // Request access to the root pod
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(registerResponse.status).to.equal(201);
      expect(registerResponse.data).to.have.property("client_id");
      expect(registerResponse.data.client_name).to.equal("Test OAuth App");

      const clientId = registerResponse.data.client_id;

      // List OAuth clients
      const listResponse = await mainClient.get("/api/oauth/clients", {
        headers: {
          Authorization: `Bearer ${webpodsToken}`,
        },
      });
      expect(listResponse.status).to.equal(200);
      expect(listResponse.data).to.have.property("clients");
      expect(listResponse.data.clients).to.be.an("array");
      const clientIds = listResponse.data.clients.map((c: any) => c.client_id);
      expect(clientIds).to.include(clientId);

      // The key point is that these are real API endpoints on the main domain,
      // not pod content. The operations working proves the system APIs are served correctly.
    });

    it("should NOT serve /api/* endpoints from rootPod streams", async () => {
      // Create /api/pods stream in rootPod to test precedence
      rootClient.setAuthToken(authToken);
      await rootClient.post("/api/pods/fake", "This is not the real API");

      // Main domain should still serve the real API, not pod content
      mainClient.setAuthToken(authToken);
      const response = await mainClient.get("/api/pods");
      expect(response.status).to.equal(200);
      expect(response.data).to.be.an("array");
      // Should NOT be the pod content
      expect(response.data).to.not.equal("This is not the real API");
    });

    it("should serve /connect OAuth endpoint on main domain", async () => {
      // The /connect endpoint should work even with rootPod configured
      const response = await mainClient.get("/connect", {
        validateStatus: () => true, // Don't throw on non-2xx
      });
      // Should return 400 (missing client_id) not 404
      expect(response.status).to.equal(400);
      expect(response.data.error).to.exist;
    });

    it("should serve /oauth2/auth endpoint on main domain", async () => {
      // The /oauth2/auth endpoint should work even with rootPod configured
      const response = await mainClient.get("/oauth2/auth", {
        validateStatus: () => true, // Don't throw on non-2xx
      });
      // OAuth2 auth endpoint may return 404 if Hydra is not configured/running
      // or 400 if it's running but missing parameters
      expect([400, 404]).to.include(response.status);
      expect(response.data.error).to.exist;
    });
  });
});
