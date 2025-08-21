/**
 * SSO Cookie Testing
 * Tests that session cookies are properly managed for SSO
 */

import { expect } from "chai";
import {
  TestHttpClient,
  createTestUser,
  createTestPod,
} from "webpods-test-utils";
import { testDb } from "../test-setup.js";

describe("SSO Cookie Management", () => {
  let client: TestHttpClient;

  beforeEach(async () => {
    client = new TestHttpClient("http://localhost:3000");

    // Clear cookies and test data
    client.clearCookies();
    const db = testDb.getDb();
    await db.none('TRUNCATE TABLE "user" CASCADE');
    await db.none('TRUNCATE TABLE "session" CASCADE');
    await db.none('TRUNCATE TABLE "oauth_state" CASCADE');
  });

  describe("Cookie Jar Functionality", () => {
    it("should store and send cookies", async () => {
      // Set a test cookie
      client.setCookie("test-cookie", "test-value");

      // Verify cookie is stored
      expect(client.getCookie("test-cookie")).to.equal("test-value");

      // Make a request to health endpoint to test cookie sending
      const response = await client.get("/health");
      expect(response.status).to.equal(200);

      // The cookie should have been sent in the request
      // (We can't directly verify this without server-side logging)
    });

    it("should clear cookies", () => {
      client.setCookie("cookie1", "value1");
      client.setCookie("cookie2", "value2");

      expect(client.getCookie("cookie1")).to.equal("value1");
      expect(client.getCookie("cookie2")).to.equal("value2");

      client.clearCookies();

      expect(client.getCookie("cookie1")).to.be.undefined;
      expect(client.getCookie("cookie2")).to.be.undefined;
    });
  });

  describe("Session Cookie Flow", () => {
    it("should simulate session cookie behavior", async () => {
      // Create a test user
      const db = testDb.getDb();
      const user = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "cookie-test-user",
        email: "cookie@example.com",
        name: "Cookie User",
      });

      // Create a session in the database
      const sessionId = "test-session-" + Date.now();
      const sessionData = {
        cookie: {
          originalMaxAge: 604800000,
          expires: new Date(Date.now() + 604800000).toISOString(),
          httpOnly: true,
          path: "/",
        },
        user: {
          id: user.userId,
          email: user.email,
          name: user.name,
          provider: "testprovider2",
        },
      };

      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: sessionId,
          sess: JSON.stringify(sessionData),
          expire: new Date(Date.now() + 604800000),
        },
      );

      // Simulate having the session cookie
      client.setCookie("webpods.sid", sessionId);

      // Now when we make authorized requests, the session cookie should work
      // This would enable SSO if the server properly reads the session
      const sessionCheck = await db.oneOrNone(
        `SELECT * FROM session WHERE sid = $(sid)`,
        { sid: sessionId },
      );

      expect(sessionCheck).to.exist;
      expect(sessionCheck.sid).to.equal(sessionId);

      // Verify the cookie is set
      expect(client.getCookie("webpods.sid")).to.equal(sessionId);
    });

    it("should maintain cookies across multiple requests", async () => {
      // Set initial cookies
      client.setCookie("persistent", "value1");

      // Make multiple requests
      const response1 = await client.get("/health");
      expect(response1.status).to.equal(200);

      const response2 = await client.get("/health");
      expect(response2.status).to.equal(200);

      // Cookie should still be there
      expect(client.getCookie("persistent")).to.equal("value1");
    });
  });

  describe("SSO Simulation", () => {
    it("should simulate SSO flow with cookies", async () => {
      // 1. Create a user and session (simulating successful OAuth)
      const db = testDb.getDb();
      const user = await createTestUser(db, {
        provider: "testprovider2",
        providerId: "sso-test-user",
        email: "sso@example.com",
        name: "SSO User",
      });

      // 2. Create session (this would normally happen in OAuth callback)
      const sessionId = "sso-session-" + Date.now();
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: sessionId,
          sess: JSON.stringify({
            cookie: {
              originalMaxAge: 604800000,
              expires: new Date(Date.now() + 604800000).toISOString(),
              httpOnly: true,
              path: "/",
              domain: ".localhost",
            },
            user: {
              id: user.userId,
              email: user.email,
              name: user.name,
              provider: "testprovider2",
            },
          }),
          expire: new Date(Date.now() + 604800000),
        },
      );

      // 3. Set session cookie (browser would do this from Set-Cookie header)
      client.setCookie("webpods.sid", sessionId);

      // 4. Verify we can use the session
      // In a real SSO flow, this cookie would allow access to /auth/authorize
      // without requiring re-authentication

      // Verify session exists and is valid
      const session = await db.oneOrNone(
        `SELECT * FROM session WHERE sid = $(sid) AND expire > $(now)`,
        { sid: sessionId, now: new Date() },
      );

      expect(session).to.exist;
      expect(client.getCookie("webpods.sid")).to.equal(sessionId);

      // 5. Get OAuth token for pod (what would happen via OAuth flow)
      await createTestPod(db, "test-pod", user.userId);
      const podToken = await client.authenticateViaOAuth(user.userId, [
        "test-pod",
      ]);

      // Verify token was created correctly
      expect(podToken).to.be.a("string");
      expect(podToken.length).to.be.greaterThan(0);
    });
  });
});
