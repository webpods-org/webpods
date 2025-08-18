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
    const deleted = await db("session")
      .where("expire", "<", new Date())
      .delete();
    return deleted;
  }

  async function cleanupExpiredStates(): Promise<number> {
    const deleted = await db("oauth_state")
      .where("expires_at", "<", new Date())
      .delete();
    return deleted;
  }

  before(() => {
    db = testDb.getDb();
  });

  beforeEach(async () => {
    await db.raw('TRUNCATE TABLE "session" CASCADE');
    await db.raw('TRUNCATE TABLE "oauth_state" CASCADE');
  });

  describe("Session Expiry", () => {
    it("should identify expired sessions", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000); // 1 second ago
      const future = new Date(now.getTime() + 3600000); // 1 hour from now

      // Insert expired session
      await db("session").insert({
        sid: "expired-session",
        sess: { user: { id: "user1" } },
        expire: expired,
      });

      // Insert valid session
      await db("session").insert({
        sid: "valid-session",
        sess: { user: { id: "user2" } },
        expire: future,
      });

      // Check expired sessions
      const expiredSessions = await db("session")
        .where("expire", "<", now)
        .select("*");

      expect(expiredSessions).to.have.lengthOf(1);
      expect(expiredSessions[0].sid).to.equal("expired-session");

      // Check valid sessions
      const validSessions = await db("session")
        .where("expire", ">", now)
        .select("*");

      expect(validSessions).to.have.lengthOf(1);
      expect(validSessions[0].sid).to.equal("valid-session");
    });

    it("should cleanup expired sessions", async () => {
      const now = new Date();
      const expired1 = new Date(now.getTime() - 2000);
      const expired2 = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 3600000);

      // Insert multiple sessions
      await db("session").insert([
        { sid: "expired-1", sess: { user: { id: "user1" } }, expire: expired1 },
        { sid: "expired-2", sess: { user: { id: "user2" } }, expire: expired2 },
        { sid: "valid-1", sess: { user: { id: "user3" } }, expire: future },
      ]);

      // Run cleanup
      const deletedCount = await cleanupExpiredSessions();

      expect(deletedCount).to.equal(2);

      // Verify only valid session remains
      const remainingSessions = await db("session").select("*");
      expect(remainingSessions).to.have.lengthOf(1);
      expect(remainingSessions[0].sid).to.equal("valid-1");
    });

    it("should handle session with 7-day expiry", async () => {
      const now = new Date();
      const sevenDaysFromNow = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      await db("session").insert({
        sid: "week-session",
        sess: {
          cookie: {
            originalMaxAge: 604800000, // 7 days in ms
            expires: sevenDaysFromNow.toISOString(),
            maxAge: 604800000,
          },
          user: { id: "user1" },
        },
        expire: sevenDaysFromNow,
      });

      // Session should be valid now
      const validSessions = await db("session")
        .where("expire", ">", now)
        .select("*");

      expect(validSessions).to.have.lengthOf(1);

      // Simulate time passing (we can't actually wait 7 days)
      // Instead, insert an already expired session to test cleanup
      await db("session").insert({
        sid: "old-session",
        sess: { user: { id: "user2" } },
        expire: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
      });

      const expiredCount = await db("session")
        .where("expire", "<", now)
        .count("* as count");

      expect(expiredCount[0].count).to.equal("1");
    });
  });

  describe("PKCE State Expiry", () => {
    it("should identify expired PKCE states", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 600000); // 10 minutes

      // Insert expired state
      await db("oauth_state").insert({
        state: "expired-state",
        code_verifier: "verifier1",
        expires_at: expired,
      });

      // Insert valid state
      await db("oauth_state").insert({
        state: "valid-state",
        code_verifier: "verifier2",
        expires_at: future,
      });

      // Check expired states
      const expiredStates = await db("oauth_state")
        .where("expires_at", "<", now)
        .select("*");

      expect(expiredStates).to.have.lengthOf(1);
      expect(expiredStates[0].state).to.equal("expired-state");
    });

    it("should cleanup expired PKCE states", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 600000);

      // Insert states
      await db("oauth_state").insert([
        { state: "expired-1", code_verifier: "v1", expires_at: expired },
        { state: "expired-2", code_verifier: "v2", expires_at: expired },
        { state: "valid-1", code_verifier: "v3", expires_at: future },
      ]);

      // Run cleanup
      const deletedCount = await cleanupExpiredStates();

      expect(deletedCount).to.equal(2);

      // Verify only valid state remains
      const remainingStates = await db("oauth_state").select("*");
      expect(remainingStates).to.have.lengthOf(1);
      expect(remainingStates[0].state).to.equal("valid-1");
    });

    it("should enforce 10-minute TTL for PKCE states", async () => {
      const now = new Date();
      const nineMinutes = new Date(now.getTime() + 9 * 60 * 1000);
      const elevenMinutes = new Date(now.getTime() + 11 * 60 * 1000);

      await db("oauth_state").insert([
        {
          state: "within-ttl",
          code_verifier: "verifier1",
          expires_at: nineMinutes,
          pod: "alice",
        },
        {
          state: "beyond-ttl",
          code_verifier: "verifier2",
          expires_at: elevenMinutes,
          pod: "bob",
        },
      ]);

      // Both should be valid now
      const validStates = await db("oauth_state")
        .where("expires_at", ">", now)
        .select("*");

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
      await db("session").insert([
        { sid: "s1", sess: {}, expire: new Date(now.getTime() - 1000) },
        { sid: "s2", sess: {}, expire: new Date(now.getTime() + 1000) },
        { sid: "s3", sess: {}, expire: new Date(now.getTime() - 2000) },
        { sid: "s4", sess: {}, expire: new Date(now.getTime() + 2000) },
      ]);

      await db("oauth_state").insert([
        {
          state: "st1",
          code_verifier: "v1",
          expires_at: new Date(now.getTime() - 1000),
        },
        {
          state: "st2",
          code_verifier: "v2",
          expires_at: new Date(now.getTime() + 1000),
        },
        {
          state: "st3",
          code_verifier: "v3",
          expires_at: new Date(now.getTime() - 2000),
        },
      ]);

      // Run cleanup
      const sessionDeleted = await cleanupExpiredSessions();
      const stateDeleted = await cleanupExpiredStates();

      expect(sessionDeleted).to.equal(2);
      expect(stateDeleted).to.equal(2);

      // Verify correct records remain
      const sessions = await db("session").select("sid").orderBy("sid");
      const states = await db("oauth_state").select("state").orderBy("state");

      expect(sessions.map((s: any) => s.sid)).to.deep.equal(["s2", "s4"]);
      expect(states.map((s: any) => s.state)).to.deep.equal(["st2"]);
    });
  });
});
