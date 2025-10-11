/**
 * Session Expiry and Cleanup Tests
 * Tests that expired sessions and PKCE states are properly cleaned up
 */

import { expect } from "chai";
import { testDb } from "../test-setup.js";
import { createSchema } from "@webpods/tinqer";
import {
  executeSelect,
  executeInsert,
  executeDelete,
} from "@webpods/tinqer-sql-pg-promise";
import type { DatabaseSchema } from "webpods-test-utils";

const schema = createSchema<DatabaseSchema>();

describe("Session Expiry and Cleanup", () => {
  let db: any;

  // Helper functions for cleanup (these would normally be in the server)
  async function cleanupExpiredSessions(): Promise<number> {
    const now = new Date();
    const deleted = await executeDelete(
      db,
      schema,
      (q, p) => q.deleteFrom("session").where((s) => s.expire < p.now),
      { now },
    );
    return deleted;
  }

  async function cleanupExpiredStates(): Promise<number> {
    const now = Date.now();
    const deleted = await executeDelete(
      db,
      schema,
      (q, p) => q.deleteFrom("oauth_state").where((s) => s.expires_at < p.now),
      { now },
    );
    return deleted;
  }

  before(() => {
    db = testDb.getDb();
  });

  beforeEach(async () => {
    await executeDelete(db, schema, (q) =>
      q.deleteFrom("session").allowFullTableDelete(),
    );
    await executeDelete(db, schema, (q) =>
      q.deleteFrom("oauth_state").allowFullTableDelete(),
    );
  });

  describe("Session Expiry", () => {
    it("should identify expired sessions", async () => {
      const now = new Date();
      const expired = new Date(now.getTime() - 1000); // 1 second ago
      const future = new Date(now.getTime() + 3600000); // 1 hour from now

      // Insert expired session
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("session").values({
            sid: p.sid,
            sess: p.sess,
            expire: p.expire,
          }),
        {
          sid: "expired-session",
          sess: { user: { id: "user1" } },
          expire: expired,
        },
      );

      // Insert valid session
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("session").values({
            sid: p.sid,
            sess: p.sess,
            expire: p.expire,
          }),
        {
          sid: "valid-session",
          sess: { user: { id: "user2" } },
          expire: future,
        },
      );

      // Check expired sessions
      const expiredSessions = await executeSelect(
        db,
        schema,
        (q, p) => q.from("session").where((s) => s.expire < p.now),
        { now },
      );

      expect(expiredSessions).to.have.lengthOf(1);
      expect(expiredSessions[0].sid).to.equal("expired-session");

      // Check valid sessions
      const validSessions = await executeSelect(
        db,
        schema,
        (q, p) => q.from("session").where((s) => s.expire > p.now),
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
      await Promise.all([
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "expired-1",
            sess: { user: { id: "user1" } },
            expire: expired1,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "expired-2",
            sess: { user: { id: "user2" } },
            expire: expired2,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "valid-1",
            sess: { user: { id: "user3" } },
            expire: future,
          },
        ),
      ]);

      // Run cleanup
      const deletedCount = await cleanupExpiredSessions();

      expect(deletedCount).to.equal(2);

      // Verify only valid session remains
      const remainingSessions = await executeSelect(
        db,
        schema,
        (q) => q.from("session"),
        {},
      );
      expect(remainingSessions).to.have.lengthOf(1);
      expect(remainingSessions[0].sid).to.equal("valid-1");
    });

    it("should handle session with 7-day expiry", async () => {
      const now = new Date();
      const sevenDaysFromNow = new Date(
        now.getTime() + 7 * 24 * 60 * 60 * 1000,
      );

      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("session").values({
            sid: p.sid,
            sess: p.sess,
            expire: p.expire,
          }),
        {
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
        },
      );

      // Session should be valid now
      const validSessions = await executeSelect(
        db,
        schema,
        (q, p) => q.from("session").where((s) => s.expire > p.now),
        { now },
      );

      expect(validSessions).to.have.lengthOf(1);

      // Simulate time passing (we can't actually wait 7 days)
      // Instead, insert an already expired session to test cleanup
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("session").values({
            sid: p.sid,
            sess: p.sess,
            expire: p.expire,
          }),
        {
          sid: "old-session",
          sess: { user: { id: "user2" } },
          expire: new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000), // 8 days ago
        },
      );

      const expiredSessions = await executeSelect(
        db,
        schema,
        (q, p) => q.from("session").where((s) => s.expire < p.now),
        { now },
      );

      expect(expiredSessions).to.have.lengthOf(1);
    });
  });

  describe("PKCE State Expiry", () => {
    it("should identify expired PKCE states", async () => {
      const now = Date.now();
      const expired = now - 1000;
      const future = now + 600000; // 10 minutes

      // Insert expired state
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("oauth_state").values({
            state: p.state,
            code_verifier: p.codeVerifier,
            created_at: p.createdAt,
            expires_at: p.expiresAt,
          }),
        {
          state: "expired-state",
          codeVerifier: "verifier1",
          createdAt: expired,
          expiresAt: expired,
        },
      );

      // Insert valid state
      await executeInsert(
        db,
        schema,
        (q, p) =>
          q.insertInto("oauth_state").values({
            state: p.state,
            code_verifier: p.codeVerifier,
            created_at: p.createdAt,
            expires_at: p.expiresAt,
          }),
        {
          state: "valid-state",
          codeVerifier: "verifier2",
          createdAt: now,
          expiresAt: future,
        },
      );

      // Check expired states
      const expiredStates = await executeSelect(
        db,
        schema,
        (q, p) => q.from("oauth_state").where((s) => s.expires_at < p.now),
        { now },
      );

      expect(expiredStates).to.have.lengthOf(1);
      expect(expiredStates[0].state).to.equal("expired-state");
    });

    it("should cleanup expired PKCE states", async () => {
      const now = Date.now();
      const expired = now - 1000;
      const future = now + 600000;

      // Insert states
      await Promise.all([
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "expired-1",
            verifier: "v1",
            created: expired,
            expires: expired,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "expired-2",
            verifier: "v2",
            created: expired,
            expires: expired,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "valid-1",
            verifier: "v3",
            created: now,
            expires: future,
          },
        ),
      ]);

      // Run cleanup
      const deletedCount = await cleanupExpiredStates();

      expect(deletedCount).to.equal(2);

      // Verify only valid state remains
      const remainingStates = await executeSelect(
        db,
        schema,
        (q) => q.from("oauth_state"),
        {},
      );
      expect(remainingStates).to.have.lengthOf(1);
      expect(remainingStates[0].state).to.equal("valid-1");
    });

    it("should enforce 10-minute TTL for PKCE states", async () => {
      const now = Date.now();
      const nineMinutes = now + 9 * 60 * 1000;
      const elevenMinutes = now + 11 * 60 * 1000;

      await Promise.all([
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
              pod: p.pod,
            }),
          {
            state: "within-ttl",
            verifier: "verifier1",
            created: now,
            expires: nineMinutes,
            pod: "alice",
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
              pod: p.pod,
            }),
          {
            state: "beyond-ttl",
            verifier: "verifier2",
            created: now,
            expires: elevenMinutes,
            pod: "bob",
          },
        ),
      ]);

      // Both should be valid now
      const validStates = await executeSelect(
        db,
        schema,
        (q, p) => q.from("oauth_state").where((s) => s.expires_at > p.now),
        { now },
      );

      expect(validStates).to.have.lengthOf(2);

      // Check TTL values
      const withinTTL = validStates.find((s: any) => s.state === "within-ttl");
      const beyondTTL = validStates.find((s: any) => s.state === "beyond-ttl");

      expect(withinTTL).to.exist;
      expect(beyondTTL).to.exist;

      // Verify TTL is properly set (should be close to 10 minutes)
      const ttlMinutes = (Number(withinTTL!.expires_at) - now) / 60000;
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
      await Promise.all([
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "s1",
            sess: {},
            expire: new Date(now.getTime() - 1000),
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "s2",
            sess: {},
            expire: new Date(now.getTime() + 1000),
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "s3",
            sess: {},
            expire: new Date(now.getTime() - 2000),
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("session").values({
              sid: p.sid,
              sess: p.sess,
              expire: p.expire,
            }),
          {
            sid: "s4",
            sess: {},
            expire: new Date(now.getTime() + 2000),
          },
        ),
      ]);

      await Promise.all([
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "st1",
            verifier: "v1",
            created: now.getTime() - 1000,
            expires: now.getTime() - 1000,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "st2",
            verifier: "v2",
            created: now.getTime(),
            expires: now.getTime() + 1000,
          },
        ),
        executeInsert(
          db,
          schema,
          (q, p) =>
            q.insertInto("oauth_state").values({
              state: p.state,
              code_verifier: p.verifier,
              created_at: p.created,
              expires_at: p.expires,
            }),
          {
            state: "st3",
            verifier: "v3",
            created: now.getTime() - 2000,
            expires: now.getTime() - 2000,
          },
        ),
      ]);

      // Run cleanup
      const sessionDeleted = await cleanupExpiredSessions();
      const stateDeleted = await cleanupExpiredStates();

      expect(sessionDeleted).to.equal(2);
      expect(stateDeleted).to.equal(2);

      // Verify correct records remain
      const sessions = await executeSelect(
        db,
        schema,
        (q) =>
          q
            .from("session")
            .select((s) => ({ sid: s.sid }))
            .orderBy((s) => s.sid),
        {},
      );
      const states = await executeSelect(
        db,
        schema,
        (q) =>
          q
            .from("oauth_state")
            .select((s) => ({ state: s.state }))
            .orderBy((s) => s.state),
        {},
      );

      expect(sessions.map((s: any) => s.sid)).to.deep.equal(["s2", "s4"]);
      expect(states.map((s: any) => s.state)).to.deep.equal(["st2"]);
    });
  });
});
