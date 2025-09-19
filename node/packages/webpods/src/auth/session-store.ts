/**
 * PostgreSQL session store for SSO
 */

import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { getDb } from "../db/index.js";
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
export async function getUserSessions(userId: string): Promise<
  {
    id: string;
    user: { id: string; email?: string; name?: string; provider?: string };
    createdAt: Date | null;
    expiresAt: Date;
  }[]
> {
  const db = getDb();

  const now = new Date().toISOString();
  const sessions = await db.manyOrNone<{
    sid: string;
    sess: Record<string, unknown>;
    expire: Date;
  }>(
    `SELECT sid, sess, expire
     FROM session
     WHERE expire > $(now)`,
    { now },
  );

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

  const result = await db.result(
    `DELETE FROM session WHERE sid = $(sessionId)`,
    { sessionId },
    (r) => r.rowCount,
  );

  return result > 0;
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

  logger.info("Revoked user sessions", { count: revokedCount });
  return revokedCount;
}

/**
 * Clean up expired sessions
 */
export async function cleanupExpiredSessions(): Promise<number> {
  const db = getDb();

  const now = new Date().toISOString();
  const result = await db.result(
    `DELETE FROM session WHERE expire < $(now)`,
    { now },
    (r) => r.rowCount,
  );

  if (result > 0) {
    logger.info("Cleaned up expired sessions", { count: result });
  }

  return result;
}
