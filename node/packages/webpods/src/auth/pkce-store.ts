/**
 * PKCE state storage in PostgreSQL
 */

import { getDb } from "../db.js";
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

  await db("oauth_state").insert({
    state,
    code_verifier: codeVerifier,
    pod,
    redirect_url: redirect,
    expires_at: expiresAt,
  });

  logger.info("PKCE state stored", { state, pod, expiresAt });
}

/**
 * Retrieve and delete PKCE state (one-time use)
 */
export async function retrievePKCEState(
  state: string,
): Promise<PKCEState | null> {
  const db = getDb();

  // Get the state if not expired
  const result = await db("oauth_state")
    .where("state", state)
    .where("expires_at", ">", new Date())
    .first();

  if (!result) {
    logger.warn("PKCE state not found or expired", { state });
    return null;
  }

  // Delete the state (one-time use)
  await db("oauth_state").where("state", state).delete();

  logger.info("PKCE state retrieved and deleted", { state });

  return {
    state: result.state,
    codeVerifier: result.code_verifier,
    pod: result.pod,
    redirect: result.redirect_url,
  };
}

/**
 * Generate new PKCE challenge
 */
export function generatePKCEChallenge(): {
  verifier: string;
  challenge: string;
  state: string;
} {
  const verifier = generators.codeVerifier();
  const challenge = generators.codeChallenge(verifier);
  const state = generators.state();

  return { verifier, challenge, state };
}

/**
 * Clean up expired PKCE states
 */
export async function cleanupExpiredStates(): Promise<number> {
  const db = getDb();

  const deleted = await db("oauth_state")
    .where("expires_at", "<", new Date())
    .delete();

  if (deleted > 0) {
    logger.info("Cleaned up expired PKCE states", { count: deleted });
  }

  return deleted;
}

/**
 * Start periodic cleanup of expired states
 */
export function startStateCleanup(): void {
  // Run cleanup every hour
  setInterval(
    async () => {
      try {
        await cleanupExpiredStates();
      } catch (error) {
        logger.error("Failed to cleanup expired states", { error });
      }
    },
    60 * 60 * 1000,
  );

  logger.info("PKCE state cleanup scheduled");
}
