/**
 * Test mode security guard
 * Ensures test headers can only be used in controlled test environments
 */

import { Request } from "express";
import { createLogger } from "../logger.js";

const logger = createLogger("webpods:oauth:test-mode");

/**
 * Check if test mode is allowed for this request
 * Requires ALL three conditions:
 * 1. NODE_ENV must be 'test'
 * 2. WEBPODS_TEST_MODE must be 'enabled'
 * 3. Request must come from localhost
 */
export function isTestModeAllowed(req: Request): boolean {
  // Control 1: Environment must be test
  const isTestEnv = process.env.NODE_ENV === "test";

  // Control 2: Test mode must be explicitly enabled
  const isTestModeEnabled = process.env.WEBPODS_TEST_MODE === "enabled";

  // Control 3: Request must come from localhost
  const clientIP = req.ip || req.connection.remoteAddress || "";
  const isLocalhost =
    ["127.0.0.1", "::1", "localhost"].includes(clientIP) ||
    clientIP.startsWith("127.") ||
    clientIP === "::ffff:127.0.0.1" || // IPv4-mapped IPv6
    clientIP.startsWith("::ffff:127."); // IPv4-mapped localhost range

  // Check if test headers are present
  const hasTestHeaders =
    req.headers["x-test-user"] || req.headers["x-test-consent"];

  if (hasTestHeaders) {
    const allowed = isTestEnv && isTestModeEnabled && isLocalhost;

    // Always log test header attempts
    const logData = {
      allowed,
      env: process.env.NODE_ENV,
      testMode: process.env.WEBPODS_TEST_MODE,
      ip: clientIP,
      url: req.url,
      headers: {
        "x-test-user": req.headers["x-test-user"] ? "present" : "absent",
        "x-test-consent": req.headers["x-test-consent"] ? "present" : "absent",
      },
    };

    if (allowed) {
      logger.info("Test mode headers accepted", logData);
    } else {
      logger.error("SECURITY: Test mode headers blocked", {
        ...logData,
        userAgent: req.headers["user-agent"],
        host: req.headers["host"],
        reason: {
          isTestEnv,
          isTestModeEnabled,
          isLocalhost,
        },
      });
    }

    return allowed;
  }

  return false;
}
