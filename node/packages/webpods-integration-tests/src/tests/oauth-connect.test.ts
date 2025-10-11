/**
 * Tests for the simplified OAuth /connect endpoint
 */

import { expect } from "chai";
import { TestHttpClient, createTestUser } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import jwt from "jsonwebtoken";
import { createSchema } from "@webpods/tinqer";
import { executeDelete } from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

// Helper to generate WebPods JWT tokens for testing
function generateWebPodsToken(userId: string): string {
  const payload = {
    sub: userId,
    iat: Math.floor(Date.now() / 1000),
    type: "webpods", // This identifies it as a WebPods token
  };

  // Use the test JWT secret from test-config.json
  const secret = "test-secret-key";
  return jwt.sign(payload, secret, { expiresIn: "7d" });
}

describe("OAuth Connect Endpoint", () => {
  let client: TestHttpClient;
  let webpodsToken: string;
  let userId: string;
  let testClientId: string;

  before(async () => {
    // Create test user
    const user = await createTestUser(testDb.getDb(), {
      email: "connect-test@example.com",
      name: "Connect Test User",
    });
    userId = user.userId;

    // Generate WebPods JWT for API access
    webpodsToken = generateWebPodsToken(userId);
  });

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");

    // Create a test OAuth client
    const response = await client.post(
      "/api/oauth/clients",
      {
        client_name: "Test Connect App",
        redirect_uris: ["https://testapp.com/callback"],
        requested_pods: ["alice", "bob", "work"],
        token_endpoint_auth_method: "client_secret_basic",
      },
      {
        headers: {
          Authorization: `Bearer ${webpodsToken}`,
        },
      },
    );

    if (response.status === 201) {
      testClientId = response.data.client_id;
    }
  });

  afterEach(async () => {
    // Clean up OAuth clients
    const db = testDb.getDb();
    await executeDelete(
      db,
      schema,
      (q, p) =>
        q.deleteFrom("oauth_client").where((c) => c.user_id === p.userId),
      { userId },
    );
  });

  describe("GET /connect", () => {
    it("should redirect to Hydra with client parameters", async () => {
      const response = await client.get(`/connect?client_id=${testClientId}`, {
        followRedirect: false,
      });

      expect(response.status).to.be.oneOf([302, 303]);

      const location = response.headers.location as string;
      expect(location).to.exist;

      // Should redirect to Hydra OAuth endpoint
      expect(location).to.include("/oauth2/auth");

      // Should include client_id
      expect(location).to.include(`client_id=${testClientId}`);

      // Should include redirect_uri from client registration
      expect(location).to.include(
        "redirect_uri=https%3A%2F%2Ftestapp.com%2Fcallback",
      );

      // Should include state with pods
      const url = new URL(location, "http://localhost:4444");
      const state = url.searchParams.get("state");
      expect(state).to.exist;

      // Decode state to verify pods
      const stateData = JSON.parse(Buffer.from(state!, "base64").toString());
      expect(stateData.pods).to.deep.equal(["alice", "bob", "work"]);
      expect(stateData.client_id).to.equal(testClientId);
      expect(stateData.nonce).to.exist;
    });

    it("should return 400 for missing client_id", async () => {
      const response = await client.get("/connect");

      expect(response.status).to.equal(400);
      expect(response.data.error.code).to.equal("MISSING_CLIENT_ID");
    });

    it("should return 404 for unknown client", async () => {
      const response = await client.get(
        "/connect?client_id=unknown-client-123",
      );

      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("UNKNOWN_CLIENT");
    });

    it("should only be available on main domain", async () => {
      const podClient = new TestHttpClient("http://alice.localhost:3000");
      const response = await podClient.get(
        `/connect?client_id=${testClientId}`,
      );

      expect(response.status).to.equal(404);
      expect(response.data.error.code).to.equal("NOT_FOUND");
      expect(response.data.error.message).to.include("main domain");
    });
  });
});
