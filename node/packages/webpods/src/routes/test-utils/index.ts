/**
 * Test utilities router - only available when --enable-test-utils flag is set
 * All endpoints require localhost access
 */

import { Router, Request, Response, NextFunction } from "express";
import { createCacheTestRouter } from "./cache.js";
import rateLimitRouter from "./ratelimit.js";
import { createLogger } from "../../logger.js";

const logger = createLogger("test-utils");

/**
 * Middleware to ensure request is from localhost
 */
function requireLocalhost(
  req: Request,
  res: Response,
  next: NextFunction,
): void {
  const clientIP = req.ip || req.connection.remoteAddress || "";

  const isLocalhost =
    ["127.0.0.1", "::1", "localhost"].includes(clientIP) ||
    clientIP.startsWith("127.") ||
    clientIP === "::ffff:127.0.0.1" ||
    clientIP.startsWith("::ffff:127.");

  if (!isLocalhost) {
    logger.warn("Test utilities access denied from non-localhost", {
      clientIP,
    });
    res.status(403).json({
      error: {
        code: "FORBIDDEN",
        message: "Test utilities only available on localhost",
      },
    });
    return;
  }

  // Optional: Check for test token if configured
  const testToken = process.env.TEST_UTILS_TOKEN;
  if (testToken) {
    const providedToken = req.headers["x-test-token"];
    if (providedToken !== testToken) {
      logger.warn("Test utilities access denied - invalid token", { clientIP });
      res.status(403).json({
        error: {
          code: "FORBIDDEN",
          message: "Invalid test token",
        },
      });
      return;
    }
  }

  next();
}

/**
 * Create the main test utilities router
 */
export function createTestUtilsRouter(): Router {
  const router = Router();

  // Apply localhost check to all routes
  router.use(requireLocalhost);

  // Log all test utility access
  router.use((req, _res, next) => {
    logger.info("Test utility accessed", {
      path: req.path,
      method: req.method,
    });
    next();
  });

  // Root health check - shows available namespaces
  router.get("/health", (_req, res) => {
    res.json({
      available: true,
      namespaces: {
        cache: "Cache testing utilities",
        ratelimit: "Rate limit testing utilities",
        // Future namespaces can be added here
        // db: "Database testing utilities",
        // auth: "Authentication testing utilities",
        // streams: "Stream testing utilities",
        // perf: "Performance testing utilities",
      },
      protection: {
        localhost: true,
        tokenRequired: !!process.env.TEST_UTILS_TOKEN,
      },
    });
  });

  // Mount namespace routers
  router.use("/cache", createCacheTestRouter());
  router.use("/ratelimit", rateLimitRouter);

  // Future namespace routers can be added here:
  // router.use("/db", createDbTestRouter());
  // router.use("/auth", createAuthTestRouter());
  // router.use("/streams", createStreamsTestRouter());
  // router.use("/perf", createPerfTestRouter());

  // 404 for unknown test utility endpoints
  router.use((_req, res) => {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message: "Unknown test utility endpoint",
        availableNamespaces: ["cache", "ratelimit"],
      },
    });
  });

  return router;
}
