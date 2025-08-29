/**
 * OAuth client management API tests
 */

import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import jwt from "jsonwebtoken";
import { generateWebPodsToken as generateWebPodsTokenFromModule } from "../../../webpods/dist/auth/jwt-generator.js";

// Helper to generate WebPods JWT tokens for testing
// This is a local implementation to avoid loading config in test process
function generateWebPodsToken(userId: string): string {
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    type: "webpods", // This identifies it as a WebPods token
  };

  // Use the test JWT secret from test-config.json
  // This matches what the server uses when started by TestServer
  const secret = "test-secret-key";
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

describe("OAuth Client Management API", () => {
  let client: TestHttpClient;
  let webpodsToken: string;
  let userId: string;
  let createdClientId: string;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");

    // Create test user for each test (since DB is truncated after each test)
    const user = await createTestUser(testDb.getDb(), {
      email: "oauth-api-test@example.com",
      name: "OAuth API Test User",
    });
    userId = user.userId;

    // Generate WebPods JWT for API access
    webpodsToken = generateWebPodsToken(userId);
    // Clean up any existing OAuth clients for this user
    if (webpodsToken && userId) {
      const db = testDb.getDb();

      // Get all client IDs for this user before deleting
      const existingClients = await db.manyOrNone(
        `SELECT client_id FROM oauth_client WHERE user_id = $(userId)`,
        { userId },
      );

      // Delete from database first
      await db.none(`DELETE FROM oauth_client WHERE user_id = $(userId)`, {
        userId,
      });

      // Also delete from Hydra - wait for each deletion to complete
      for (const client of existingClients) {
        try {
          await fetch(
            `http://localhost:4445/admin/clients/${client.client_id}`,
            {
              method: "DELETE",
            },
          );
          // Ignore if not successful (404 is expected if client doesn't exist)
        } catch {
          // Ignore errors - client might not exist in Hydra
        }
      }

      // Also cleanup any orphaned clients in Hydra that match our test pattern
      // This helps when tests were interrupted and left clients behind
      try {
        const response = await fetch(
          "http://localhost:4445/admin/clients?limit=500",
        );
        if (response.ok) {
          const clients = await response.json();
          for (const client of clients) {
            // Delete test clients that match our patterns
            if (
              client.client_id &&
              (client.client_id.includes("my-test-application") ||
                client.client_id.includes("my-spa-application") ||
                client.client_id.includes("test-app-"))
            ) {
              try {
                await fetch(
                  `http://localhost:4445/admin/clients/${client.client_id}`,
                  {
                    method: "DELETE",
                  },
                );
              } catch {
                // Ignore errors
              }
            }
          }
        }
      } catch {
        // Ignore errors in cleanup
      }
    }
  });

  describe("POST /api/oauth/clients", () => {
    it("should require authentication", async () => {
      const response = await client.post("/api/oauth/clients", {
        client_name: "Unauthorized App",
        redirect_uris: ["https://app.com/callback"],
      });

      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("MISSING_TOKEN");
    });

    it("should create a new OAuth client", async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "My Test Application",
          redirect_uris: ["https://myapp.example.com/callback"],
          requested_pods: ["alice", "bob", "test-pod"],
          grant_types: ["authorization_code", "refresh_token"],
          token_endpoint_auth_method: "client_secret_basic",
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("client_id");
      expect(response.data).to.have.property("client_secret");
      expect(response.data.client_name).to.equal("My Test Application");
      expect(response.data.redirect_uris).to.deep.equal([
        "https://myapp.example.com/callback",
      ]);
      expect(response.data.requested_pods).to.deep.equal([
        "alice",
        "bob",
        "test-pod",
      ]);

      // Client ID should follow the pattern: slug-suffix
      expect(response.data.client_id).to.match(
        /^my-test-application-[a-f0-9]{8}$/,
      );

      createdClientId = response.data.client_id;

      // Verify it was created in the database
      const db = testDb.getDb();
      const dbResult = await db.oneOrNone(
        `SELECT * FROM oauth_client WHERE client_id = $(clientId)`,
        { clientId: createdClientId },
      );
      expect(dbResult).to.exist;
      expect(dbResult.user_id).to.equal(userId);
    });

    it("should create a public client for SPAs", async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "My SPA Application",
          redirect_uris: ["https://spa.netlify.app/callback"],
          requested_pods: ["spa-pod"],
          token_endpoint_auth_method: "none", // Public client
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(201);
      expect(response.data.client_secret).to.be.null; // No secret for public clients
      expect(response.data.token_endpoint_auth_method).to.equal("none");
    });

    it("should validate redirect URIs", async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "Invalid App",
          redirect_uris: ["not-a-valid-url"], // Invalid URL
          requested_pods: ["test"],
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_REQUEST");
      expect(response.data.error.details).to.exist;
    });

    it("should require requested pods", async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "App Without Pods",
          redirect_uris: ["https://app.com/callback"],
          // Missing requested_pods
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_REQUEST");
    });

    it("should validate client name", async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "", // Empty name
          redirect_uris: ["https://app.com/callback"],
          requested_pods: ["test"],
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("INVALID_REQUEST");
    });

    it("should generate unique client IDs", async function () {
      const clientIds = new Set<string>();

      // Create multiple clients with the same name
      for (let i = 0; i < 3; i++) {
        const response = await client.post(
          "/api/oauth/clients",
          {
            client_name: "Duplicate Name App",
            redirect_uris: [`https://app${i}.com/callback`],
            requested_pods: ["dup-pod"],
          },
          {
            headers: {
              Authorization: `Bearer ${webpodsToken}`,
            },
          },
        );

        expect(response.status).to.equal(201);
        clientIds.add(response.data.client_id);
      }

      // All client IDs should be unique
      expect(clientIds.size).to.equal(3);

      // All should have the same slug but different suffixes
      clientIds.forEach((id) => {
        expect(id).to.match(/^duplicate-name-app-[a-f0-9]{8}$/);
      });
    });
  });

  describe("GET /api/oauth/clients", () => {
    beforeEach(async function () {
      // Create some test clients
      for (let i = 1; i <= 2; i++) {
        const response = await client.post(
          "/api/oauth/clients",
          {
            client_name: `Test App ${i}`,
            redirect_uris: [`https://app${i}.com/callback`],
            requested_pods: [`test-pod-${i}`],
          },
          {
            headers: {
              Authorization: `Bearer ${webpodsToken}`,
            },
          },
        );
        if (i === 1) {
          createdClientId = response.data.client_id;
        }
      }
    });

    it("should list user's OAuth clients", async function () {
      const response = await client.get("/api/oauth/clients", {
        headers: {
          Authorization: `Bearer ${webpodsToken}`,
        },
      });

      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("clients");
      expect(response.data.clients).to.be.an("array");
      expect(response.data.clients).to.have.length(2);
      expect(response.data.total).to.equal(2);

      // Should not include client secrets in the list
      response.data.clients.forEach((oauthClient: any) => {
        expect(oauthClient).to.not.have.property("client_secret");
        expect(oauthClient).to.have.property("client_id");
        expect(oauthClient).to.have.property("client_name");
        expect(oauthClient).to.have.property("redirect_uris");
      });
    });

    it("should only show user's own clients", async function () {
      // Create another user with their own client
      const db = testDb.getDb();
      const otherUser = await createTestUser(db, {
        email: "other@example.com",
        name: "Other User",
      });

      // Generate token for other user
      const otherTokenResult = generateWebPodsTokenFromModule(otherUser.userId);
      const otherToken = otherTokenResult.success ? otherTokenResult.data : "";

      // Create a client for the other user
      await client.post(
        "/api/oauth/clients",
        {
          client_name: "Other User App",
          redirect_uris: ["https://other.com/callback"],
          requested_pods: ["other-pod"],
        },
        {
          headers: {
            Authorization: `Bearer ${otherToken}`,
          },
        },
      );

      // Original user should only see their own clients
      const response = await client.get("/api/oauth/clients", {
        headers: {
          Authorization: `Bearer ${webpodsToken}`,
        },
      });

      expect(response.status).to.equal(200);
      expect(response.data.clients).to.have.length(2);

      const clientNames = response.data.clients.map((c: any) => c.client_name);
      expect(clientNames).to.not.include("Other User App");
      expect(clientNames).to.include("Test App 1");
      expect(clientNames).to.include("Test App 2");
    });
  });

  describe("GET /api/oauth/clients/:clientId", () => {
    beforeEach(async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "Test App for Get",
          redirect_uris: ["https://testapp.com/callback"],
          requested_pods: ["get-test-pod"],
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      createdClientId = response.data.client_id;
    });

    it("should get a specific OAuth client", async function () {
      const response = await client.get(
        `/api/oauth/clients/${createdClientId}`,
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(200);
      expect(response.data.client_id).to.equal(createdClientId);
      expect(response.data.client_name).to.equal("Test App for Get");
      expect(response.data).to.not.have.property("client_secret"); // Secret not returned on GET
    });

    it("should return 404 for non-existent client", async function () {
      const response = await client.get(
        "/api/oauth/clients/non-existent-client",
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("CLIENT_NOT_FOUND");
    });
  });

  describe("DELETE /api/oauth/clients/:clientId", () => {
    beforeEach(async function () {
      const response = await client.post(
        "/api/oauth/clients",
        {
          client_name: "App to Delete",
          redirect_uris: ["https://delete.com/callback"],
          requested_pods: ["delete-pod"],
        },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      createdClientId = response.data.client_id;
    });

    it("should delete an OAuth client", async function () {
      // Delete the client
      client.setAuthToken(webpodsToken);
      const deleteResponse = await client.delete(
        `/api/oauth/clients/${createdClientId}`,
      );

      expect(deleteResponse.status).to.equal(204);

      // Verify it's deleted
      const getResponse = await client.get(
        `/api/oauth/clients/${createdClientId}`,
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        },
      );

      expect(getResponse.status).to.equal(404);
      expect(getResponse.data.error.code).to.equal("CLIENT_NOT_FOUND");
    });

    it("should return 404 when deleting non-existent client", async function () {
      client.setAuthToken(webpodsToken);
      const response = await client.delete("/api/oauth/clients/non-existent");

      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("CLIENT_NOT_FOUND");
    });
  });
});
