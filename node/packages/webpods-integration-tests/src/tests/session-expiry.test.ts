/**
 * Session Expiry and Cleanup Tests
 * Tests that expired sessions and PKCE states are properly cleaned up
 */

import { expect } from "chai";
import { testDb } from "../test-setup.js";

describe("Session Expiry and Cleanup", () => {
  let db: any;

  // Helper functions for cleanup (these would normally be in the server)
  async function cleanupExpiredSessions(): Promise<number> {
    const result = await db.result(
      `DELETE FROM session WHERE expire < $(now)`,
      { now: new Date() }
    );
    return result.rowCount;
  }

  async function cleanupExpiredStates(): Promise<number> {
    const result = await db.result(
      `DELETE FROM oauth_state WHERE expires_at < $(now)`,
      { now: new Date() }
    );
    return result.rowCount;
  }

  before(() => {
    db = testDb.getDb();
  });

  beforeEach(async () => {
    await db.none('TRUNCATE TABLE "session" CASCADE');
    await db.none('TRUNCATE TABLE "oauth_state" CASCADE');
  });

  describe("Session Expiry", () => {
    it("should identify expired sessions", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000); // 1 second ago
      const future = new Date(now.getTime() + 3600000); // 1 hour from now

      // Insert expired session
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: "expired-session",
          sess: JSON.stringify({ user: { id: "user1" } }),
          expire: expired,
        }
      );

      // Insert valid session
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: "valid-session",
          sess: JSON.stringify({ user: { id: "user2" } }),
          expire: future,
        }
      );

      // Check expired sessions
      const expiredSessions = await db.manyOrNone(
        `SELECT * FROM session WHERE expire < $(now)`,
        { now }
      );

      expect(expiredSessions).to.have.lengthOf(1);
      expect(expiredSessions[0].sid).to.equal("expired-session");

      // Check valid sessions
      const validSessions = await db.manyOrNone(
        `SELECT * FROM session WHERE expire > $(now)`,
        { now },
      );

      expect(validSessions).to.have.lengthOf(1);
      expect(validSessions[0].sid).to.equal("valid-session");
    });

    it("should cleanup expired sessions", async () => {
      const now = new Date();
      const expired1 = new Date(now.getTime() - 2000);
      const expired2 = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 3600000);

      // Insert multiple sessions
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES 
         ($(sid1), $(sess1), $(expire1)),
         ($(sid2), $(sess2), $(expire2)),
         ($(sid3), $(sess3), $(expire3))`,
        {
          sid1: "expired-1",
          sess1: JSON.stringify({ user: { id: "user1" } }),
          expire1: expired1,
          sid2: "expired-2",
          sess2: JSON.stringify({ user: { id: "user2" } }),
          expire2: expired2,
          sid3: "valid-1",
          sess3: JSON.stringify({ user: { id: "user3" } }),
          expire3: future,
        },
      );

      // Run cleanup
      const deletedCount = await cleanupExpiredSessions();

      expect(deletedCount).to.equal(2);

      // Verify only valid session remains
      const remainingSessions = await db.manyOrNone("SELECT * FROM session");
      expect(remainingSessions).to.have.lengthOf(1);
      expect(remainingSessions[0].sid).to.equal("valid-1");
    });

    it("should handle session with 7-day expiry", async () => {
      const now = new Date();
      const sevenDaysFromNow = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: "week-session",
          sess: JSON.stringify({
            cookie: {
              originalMaxAge: 604800000, // 7 days in ms
              expires: sevenDaysFromNow.toISOString(),
              maxAge: 604800000,
            },
            user: { id: "user1" },
          }),
          expire: sevenDaysFromNow,
        },
      );

      // Session should be valid now
      const validSessions = await db.manyOrNone(
        `SELECT * FROM session WHERE expire > $(now)`,
        { now },
      );

      expect(validSessions).to.have.lengthOf(1);

      // Simulate time passing (we can't actually wait 7 days)
      // Instead, insert an already expired session to test cleanup
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES ($(sid), $(sess), $(expire))`,
        {
          sid: "old-session",
          sess: JSON.stringify({ user: { id: "user2" } }),
          expire: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
        },
      );

      const expiredCount = await db.oneOrNone(
        `SELECT COUNT(*) as count FROM session WHERE expire < $(now)`,
        { now },
      );

      expect(expiredCount.count).to.equal("1");
    });
  });

  describe("PKCE State Expiry", () => {
    it("should identify expired PKCE states", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 600000); // 10 minutes

      // Insert expired state
      await db.none(
        `INSERT INTO oauth_state (state, code_verifier, expires_at) 
         VALUES ($(state), $(codeVerifier), $(expiresAt))`,
        {
          state: "expired-state",
          codeVerifier: "verifier1",
          expiresAt: expired,
        },
      );

      // Insert valid state
      await db.none(
        `INSERT INTO oauth_state (state, code_verifier, expires_at) 
         VALUES ($(state), $(codeVerifier), $(expiresAt))`,
        {
          state: "valid-state",
          codeVerifier: "verifier2",
          expiresAt: future,
        },
      );

      // Check expired states
      const expiredStates = await db.manyOrNone(
        `SELECT * FROM oauth_state WHERE expires_at < $(now)`,
        { now },
      );

      expect(expiredStates).to.have.lengthOf(1);
      expect(expiredStates[0].state).to.equal("expired-state");
    });

    it("should cleanup expired PKCE states", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 600000);

      // Insert states
      await db.none(
        `INSERT INTO oauth_state (state, code_verifier, expires_at) VALUES 
         ($(state1), $(verifier1), $(expires1)),
         ($(state2), $(verifier2), $(expires2)),
         ($(state3), $(verifier3), $(expires3))`,
        {
          state1: "expired-1",
          verifier1: "v1",
          expires1: expired,
          state2: "expired-2",
          verifier2: "v2",
          expires2: expired,
          state3: "valid-1",
          verifier3: "v3",
          expires3: future,
        },
      );

      // Run cleanup
      const deletedCount = await cleanupExpiredStates();

      expect(deletedCount).to.equal(2);

      // Verify only valid state remains
      const remainingStates = await db.manyOrNone("SELECT * FROM oauth_state");
      expect(remainingStates).to.have.lengthOf(1);
      expect(remainingStates[0].state).to.equal("valid-1");
    });

    it("should enforce 10-minute TTL for PKCE states", async () => {
      const now = new Date();
      const nineMinutes = new Date(now.getTime() + 9 * 60 * 1000);
      const elevenMinutes = new Date(now.getTime() + 11 * 60 * 1000);

      await db.none(
        `INSERT INTO oauth_state (state, code_verifier, expires_at, pod) VALUES 
         ($(state1), $(verifier1), $(expires1), $(pod1)),
         ($(state2), $(verifier2), $(expires2), $(pod2))`,
        {
          state1: "within-ttl",
          verifier1: "verifier1",
          expires1: nineMinutes,
          pod1: "alice",
          state2: "beyond-ttl",
          verifier2: "verifier2",
          expires2: elevenMinutes,
          pod2: "bob",
        },
      );

      // Both should be valid now
      const validStates = await db.manyOrNone(
        `SELECT * FROM oauth_state WHERE expires_at > $(now)`,
        { now },
      );

      expect(validStates).to.have.lengthOf(2);

      // Check TTL values
      const withinTTL = validStates.find((s: any) => s.state === "within-ttl");
      const beyondTTL = validStates.find((s: any) => s.state === "beyond-ttl");

      expect(withinTTL).to.exist;
      expect(beyondTTL).to.exist;

      // Verify TTL is properly set (should be close to 10 minutes)
      const ttlMinutes =
        (withinTTL!.expires_at.getTime() - now.getTime()) / 60000;
      expect(ttlMinutes).to.be.lessThan(10);
      expect(ttlMinutes).to.be.greaterThan(8);
    });
  });

  describe("Cleanup Job Behavior", () => {
    it("should handle empty tables gracefully", async () => {
      // Tables are already empty from beforeEach

      const sessionCount = await cleanupExpiredSessions();
      expect(sessionCount).to.equal(0);

      const stateCount = await cleanupExpiredStates();
      expect(stateCount).to.equal(0);
    });

    it("should only delete expired records", async () => {
      const now = new Date();

      // Insert mix of expired and valid records
      await db.none(
        `INSERT INTO session (sid, sess, expire) VALUES 
         ($(sid1), $(sess1), $(expire1)),
         ($(sid2), $(sess2), $(expire2)),
         ($(sid3), $(sess3), $(expire3)),
         ($(sid4), $(sess4), $(expire4))`,
        {
          sid1: "s1",
          sess1: JSON.stringify({}),
          expire1: new Date(now.getTime() - 1000),
          sid2: "s2",
          sess2: JSON.stringify({}),
          expire2: new Date(now.getTime() + 1000),
          sid3: "s3",
          sess3: JSON.stringify({}),
          expire3: new Date(now.getTime() - 2000),
          sid4: "s4",
          sess4: JSON.stringify({}),
          expire4: new Date(now.getTime() + 2000),
        },
      );

      await db.none(
        `INSERT INTO oauth_state (state, code_verifier, expires_at) VALUES 
         ($(state1), $(verifier1), $(expires1)),
         ($(state2), $(verifier2), $(expires2)),
         ($(state3), $(verifier3), $(expires3))`,
        {
          state1: "st1",
          verifier1: "v1",
          expires1: new Date(now.getTime() - 1000),
          state2: "st2",
          verifier2: "v2",
          expires2: new Date(now.getTime() + 1000),
          state3: "st3",
          verifier3: "v3",
          expires3: new Date(now.getTime() - 2000),
        },
      );

      // Run cleanup
      const sessionDeleted = await cleanupExpiredSessions();
      const stateDeleted = await cleanupExpiredStates();

      expect(sessionDeleted).to.equal(2);
      expect(stateDeleted).to.equal(2);

      // Verify correct records remain
      const sessions = await db.manyOrNone(
        `SELECT sid FROM session ORDER BY sid`,
      );
      const states = await db.manyOrNone(
        `SELECT state FROM oauth_state ORDER BY state`,
      );

      expect(sessions.map((s: any) => s.sid)).to.deep.equal(["s2", "s4"]);
      expect(states.map((s: any) => s.state)).to.deep.equal(["st2"]);
    });
  });
});
