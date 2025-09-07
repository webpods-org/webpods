/**
 * PKCE state storage in PostgreSQL
 */

import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { generators } from "openid-client";

const logger = createLogger("webpods:auth:pkce");

// State expires after 10 minutes
const STATE_TTL_MINUTES = 10;

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

  const expiresAt = new Date();
  expiresAt.setMinutes(expiresAt.getMinutes() + STATE_TTL_MINUTES);

  await db.none(
    `INSERT INTO oauth_state (state, code_verifier, pod, redirect_uri, expires_at)
     VALUES ($(state), $(codeVerifier), $(pod), $(redirectUri), $(expiresAt))`,
    {
      state,
      codeVerifier,
      pod: pod || null,
      redirectUri: redirect || null,
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

  const row = await db.oneOrNone<{
    state: string;
    code_verifier: string;
    pod: string | null;
    redirect_uri: string | null;
  }>(
    `SELECT state, code_verifier, pod, redirect_uri 
     FROM oauth_state 
     WHERE state = $(state) 
       AND expires_at > NOW()`,
    { state },
  );

  if (!row) {
    logger.warn("PKCE state not found or expired", { state });
    return null;
  }

  // Delete the state (one-time use)
  await db.none(`DELETE FROM oauth_state WHERE state = $(state)`, { state });

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

  const result = await db.result(
    `DELETE FROM oauth_state WHERE expires_at < NOW()`,
    [],
    (r) => r.rowCount,
  );

  if (result > 0) {
    logger.info("Cleaned up expired PKCE states", { count: result });
  }
}
