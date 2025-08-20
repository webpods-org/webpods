/**
 * Hydra OAuth integration test
 * Tests the OAuth 2.0 flow with Ory Hydra
 */

import { expect } from "chai";
import { TestHttpClient } from "webpods-test-utils";

describe("Hydra OAuth Integration", () => {
  let client: TestHttpClient;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3099");
  });

  describe("OAuth Client Registration", () => {
    it("should register a new OAuth client", async () => {
      const clientData = {
        client_name: "Test OAuth Client",
        redirect_uris: ["http://localhost:8080/callback"],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        scope: "openid offline pod:read pod:write",
        token_endpoint_auth_method: "none",
        application_type: "web",
      };

      const res = await client.post("/oauth/register", clientData);
      expect(res.status).to.equal(201);
      
      const body = res.data;
      expect(body).to.have.property("client_id");
      expect(body).to.have.property("client_name", "Test OAuth Client");
      expect(body).to.have.property("redirect_uris");
      expect(body.redirect_uris).to.include("http://localhost:8080/callback");
      expect(body).to.have.property("grant_types");
      expect(body).to.have.property("scope");
    });

    it("should get client information", async () => {
      // First register a client
      const clientData = {
        client_name: "Test Client for Info",
        redirect_uris: ["http://localhost:8080/callback"],
      };

      const registerRes = await client.post("/oauth/register", clientData);
      const { client_id } = registerRes.data;

      // Now get client info
      const res = await client.get(`/oauth/client/${client_id}`);
      expect(res.status).to.equal(200);
      
      const body = res.data;
      expect(body).to.have.property("client_id", client_id);
      expect(body).to.have.property("client_name", "Test Client for Info");
      expect(body).to.not.have.property("client_secret"); // Should not expose secret
    });

    it("should reject invalid registration request", async () => {
      const invalidData = {
        client_name: "", // Invalid: empty name
        redirect_uris: ["not-a-url"], // Invalid: not a valid URL
      };

      const res = await client.post("/oauth/register", invalidData);
      expect(res.status).to.equal(400);
      
      const body = res.data;
      expect(body).to.have.property("error");
      expect(body.error).to.have.property("code", "INVALID_REQUEST");
    });

    it("should return 404 for non-existent client", async () => {
      const res = await client.get("/oauth/client/non-existent-client-id");
      expect(res.status).to.equal(404);
      
      const body = res.data;
      expect(body).to.have.property("error");
      expect(body.error).to.have.property("code", "CLIENT_NOT_FOUND");
    });
  });

  describe("OAuth Login Endpoint", () => {
    it("should handle login challenge", async () => {
      // This tests the login endpoint exists and handles requests
      // In a real scenario, Hydra would provide the login_challenge
      const res = await client.get("/oauth/login");
      expect(res.status).to.be.oneOf([200, 400]); // 400 if no challenge provided
    });
  });

  describe("OAuth Consent Endpoint", () => {
    it("should handle consent challenge", async () => {
      // This tests the consent endpoint exists and handles requests
      // In a real scenario, Hydra would provide the consent_challenge
      const res = await client.get("/oauth/consent");
      expect(res.status).to.be.oneOf([200, 400]); // 400 if no challenge provided
    });
  });

  describe("Hybrid Authentication", () => {
    it("should reject requests without token to protected endpoints", async () => {
      const res = await client.post("/alice/test-stream", {
        content: "test",
        name: "test.txt",
      });
      expect(res.status).to.equal(401);
      
      const body = res.data;
      expect(body).to.have.property("error");
      expect(body.error).to.have.property("code", "UNAUTHORIZED");
    });

    // Note: Full OAuth flow testing with Hydra requires either:
    // 1. Mocking Hydra's responses
    // 2. Actually running through the OAuth flow with a test client
    // 3. Creating test tokens signed with Hydra's keys
    // This would be more complex and might require additional test utilities
  });
});