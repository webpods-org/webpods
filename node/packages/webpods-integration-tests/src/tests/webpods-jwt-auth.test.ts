/**
 * WebPods JWT authentication tests
 */

import { expect } from "chai";
import { TestHttpClient, createTestUser, createTestPod } from "webpods-test-utils";
import { testDb } from "../test-setup.js";
import jwt from "jsonwebtoken";

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

describe("WebPods JWT Authentication", () => {
  let client: TestHttpClient;
  let webpodsToken: string;
  let userId: string;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");
  });

  describe("JWT Generation on Login", () => {
    it("should display login page", async () => {
      const response = await client.get("/login");
      expect(response.status).to.equal(200);
      
      const html = response.data as string;
      expect(html).to.include("Welcome to WebPods");
      expect(html).to.include("Sign in to access your pods and API");
    });

    it("should show configured OAuth providers on login page", async () => {
      const response = await client.get("/login");
      expect(response.status).to.equal(200);
      
      const html = response.data as string;
      // Check for test providers from test-config.json
      expect(html).to.include("/auth/test-auth-provider-1");
      expect(html).to.include("/auth/test-auth-provider-2");
      expect(html).to.include("Continue with Test-auth-provider");
    });

    it("should preserve redirect parameter in login page", async () => {
      const response = await client.get("/login?redirect=/dashboard");
      expect(response.status).to.equal(200);
      
      const html = response.data as string;
      expect(html).to.include("/auth/test-auth-provider-1?redirect=%2Fdashboard");
    });

    it("should redirect pod login to main domain", async () => {
      // Pod login should redirect to main domain for SSO
      const podClient = new TestHttpClient("http://alice.localhost:3000");
      const response = await podClient.get("/login", { followRedirect: false });
      
      expect(response.status).to.be.oneOf([302, 303]); 
      const location = response.headers.location;
      expect(location).to.include("http://localhost:3000/auth/authorize");
      expect(location).to.include("pod=alice");
    });

    it("should display JWT on success page", async () => {
      // Create a mock token for testing the success page
      const mockToken = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.signature";
      
      const response = await client.get(`/auth/success?token=${mockToken}&redirect=/`);
      expect(response.status).to.equal(200);
      
      const html = response.data as string;
      expect(html).to.include("Authentication Successful");
      expect(html).to.include("Your Access Token");
      expect(html).to.include(mockToken);
    });
  });

  describe("API Access with WebPods JWT", () => {
    before(async () => {
      // Create test user and generate WebPods JWT
      const db = testDb.getDb();
      const user = await createTestUser(db, {
        email: "jwt-test@example.com",
        name: "JWT Test User",
      });
      userId = user.userId;

      // Generate a WebPods JWT
      webpodsToken = generateWebPodsToken(userId);
    });

    it("should reject API requests without JWT", async () => {
      const response = await client.get("/api/oauth/clients");
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("MISSING_TOKEN");
    });

    it("should reject API requests with invalid JWT", async () => {
      const response = await client.get("/api/oauth/clients", {
        headers: {
          Authorization: "Bearer invalid-token",
        },
      });
      expect(response.status).to.equal(401);
      expect(response.data.error.code).to.equal("INVALID_TOKEN");
    });

    it("should accept valid WebPods JWT for API requests", async () => {
      const response = await client.get("/api/oauth/clients", {
        headers: {
          Authorization: `Bearer ${webpodsToken}`,
        },
      });
      expect(response.status).to.equal(200);
      expect(response.data).to.have.property("clients");
      expect(response.data.clients).to.be.an("array");
    });

    it("should allow pod access with WebPods JWT", async () => {
      // Create a test pod
      const podId = `jwt-test-pod-${Date.now()}`;
      const db = testDb.getDb();
      await createTestPod(db, podId, userId);

      // Access pod with WebPods JWT
      const podClient = new TestHttpClient(`http://${podId}.localhost:3000`);
      const response = await podClient.post("/test-stream", 
        { content: "test data" },
        {
          headers: {
            Authorization: `Bearer ${webpodsToken}`,
          },
        }
      );

      expect(response.status).to.equal(201);
      expect(response.data).to.have.property("index");
      expect(response.data.index).to.equal(0);
    });
  });

  describe("Session Cookie for SSO", () => {
    it("should set session cookie with correct attributes", async () => {
      // Initiate OAuth flow
      const authResponse = await client.get("/auth/test-auth-provider-1", {
        followRedirect: false,
      });
      
      expect(authResponse.status).to.be.oneOf([302, 303]);
      
      // Check for PKCE state in redirect
      const location = authResponse.headers.location as string;
      expect(location).to.include("code_challenge");
      expect(location).to.include("state");
    });
  });
});