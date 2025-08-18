/**
 * PostgreSQL session store for SSO
 */

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { getDb } from "../db.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:auth:session");
const PgSession = connectPgSimple(session);

let sessionStore: session.Store | null = null;

/**
 * Get or create PostgreSQL session store
 */
export function getSessionStore(): session.Store {
  if (!sessionStore) {
    // Build connection string from config
    const config = getConfig();
    const { host, port, database, user, password } = config.database;

    const conString = `postgresql://${user}:${password}@${host}:${port}/${database}`;

    sessionStore = new PgSession({
      conString,
      tableName: "session",
      createTableIfMissing: false, // We create it via migrations
      pruneSessionInterval: 60 * 60, // Prune expired sessions every hour (seconds)
      errorLog: (error: Error) => {
        logger.error("Session store error", { error });
      },
    });

    logger.info("PostgreSQL session store initialized");
  }

  return sessionStore!;
}

/**
 * Get session middleware configuration
 */
export function getSessionConfig(): session.SessionOptions {
  const config = getConfig();
  return {
    store: getSessionStore(),
    secret: config.auth.sessionSecret,
    resave: false,
    saveUninitialized: false,
    rolling: true, // Reset expiry on activity
    cookie: {
      secure: config.server.public?.isSecure || false, // Use HTTPS from public URL
      httpOnly: true,
      sameSite: "lax",
      maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
      // Set domain to share across subdomains
      // Cookie domain cannot have port
      domain: `.${config.server.public?.hostname || "localhost"}`,
    },
    name: "webpods.sid", // Custom session cookie name
  };
}

/**
 * List all active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<any[]> {
  const db = getDb();

  const sessions = await db("session")
    .where("expire", ">", new Date())
    .select("sid", "sess", "expire");

  // Filter sessions that belong to the user
  const userSessions = [];
  for (const session of sessions) {
    const sessionData =
      typeof session.sess === "string"
        ? JSON.parse(session.sess)
        : session.sess;

    if (sessionData.user?.id === userId) {
      userSessions.push({
        id: session.sid,
        user: sessionData.user,
        createdAt: sessionData.cookie?.originalMaxAge
          ? new Date(
              session.expire.getTime() - sessionData.cookie.originalMaxAge,
            )
          : null,
        expiresAt: session.expire,
      });
    }
  }

  return userSessions;
}

/**
 * Revoke a specific session
 */
export async function revokeSession(sessionId: string): Promise<boolean> {
  const db = getDb();

  const deleted = await db("session").where("sid", sessionId).delete();

  return deleted > 0;
}

/**
 * Revoke all sessions for a user
 */
export async function revokeUserSessions(userId: string): Promise<number> {
  const sessions = await getUserSessions(userId);
  let revokedCount = 0;

  for (const session of sessions) {
    if (await revokeSession(session.id)) {
      revokedCount++;
    }
  }

  logger.info("Revoked user sessions", { userId, count: revokedCount });
  return revokedCount;
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDb();

  const deleted = await db("session").where("expire", "<", new Date()).delete();

  if (deleted > 0) {
    logger.info("Cleaned up expired sessions", { count: deleted });
  }

  return deleted;
}
