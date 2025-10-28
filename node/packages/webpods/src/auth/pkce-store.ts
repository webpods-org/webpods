/**
 * PKCE state storage in PostgreSQL
 */

import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { generators } from "openid-client";
import { getConfig } from "../config-loader.js";
import { createSchema } from "@tinqerjs/tinqer";
import {
  executeSelect,
  executeInsert,
  executeDelete,
} from "@tinqerjs/pg-promise-adapter";
import type { DatabaseSchema } from "../db/schema.js";

const logger = createLogger("webpods:auth:pkce");
const schema = createSchema<DatabaseSchema>();

export interface PKCEState {
  state: string;
  codeVerifier: string;
  pod?: string;
  redirect?: string;
}

/**
 * Store PKCE state in database
 */
export async function storePKCEState(
  state: string,
  codeVerifier: string,
  pod?: string,
  redirect?: string,
): Promise<void> {
  const db = getDb();

  const config = getConfig();
  const ttlMinutes = config.oauth.pkceStateExpiryMinutes ?? 10;
  const now = Date.now();
  const expiresAt = now + ttlMinutes * 60 * 1000;

  await executeInsert(
    db,
    schema,
    (q, p) =>
      q.insertInto("oauth_state").values({
        state: p.state,
        code_verifier: p.codeVerifier,
        pod: p.pod,
        redirect_uri: p.redirectUri,
        created_at: p.createdAt,
        expires_at: p.expiresAt,
      }),
    {
      state,
      codeVerifier,
      pod: pod || null,
      redirectUri: redirect || null,
      createdAt: now,
      expiresAt,
    },
  );

  logger.info("PKCE state stored", { expiresAt });
}

/**
 * Retrieve and delete PKCE state (one-time use)
 */
export async function retrievePKCEState(
  state: string,
): Promise<PKCEState | null> {
  const db = getDb();

  const now = Date.now();
  const rows = await executeSelect(
    db,
    schema,
    (q, p) =>
      q
        .from("oauth_state")
        .where((s) => s.state === p.state && s.expires_at > p.now)
        .select((s) => ({
          state: s.state,
          code_verifier: s.code_verifier,
          pod: s.pod,
          redirect_uri: s.redirect_uri,
        })),
    { state, now },
  );

  const row = rows[0] || null;

  if (!row) {
    logger.warn("PKCE state not found or expired", { state });
    return null;
  }

  // Delete the state (one-time use)
  await executeDelete(
    db,
    schema,
    (q, p) => q.deleteFrom("oauth_state").where((s) => s.state === p.state),
    { state },
  );

  logger.info("PKCE state retrieved and deleted");

  return {
    state: row.state,
    codeVerifier: row.code_verifier,
    pod: row.pod || undefined,
    redirect: row.redirect_uri || undefined,
  };
}

/**
 * Generate PKCE challenge and verifier
 */
export function generatePKCE(): {
  codeVerifier: string;
  codeChallenge: string;
  state: string;
} {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  const state = generators.state();

  return { codeVerifier, codeChallenge, state };
}

/**
 * Clean up expired states
 */
export async function cleanupExpiredStates(): Promise<void> {
  const db = getDb();

  const now = Date.now();
  const result = await executeDelete(
    db,
    schema,
    (q, p) => q.deleteFrom("oauth_state").where((s) => s.expires_at < p.now),
    { now },
  );

  if (result > 0) {
    logger.info("Cleaned up expired PKCE states", { count: result });
  }
}
