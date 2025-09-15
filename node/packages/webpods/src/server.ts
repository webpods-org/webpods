/**
 * WebPods server factory
 */

import express, { Express, Request, Response, NextFunction } from "express";
import session from "express-session";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import cookieParser from "cookie-parser";
import { createLogger } from "./logger.js";
import { getSessionConfig } from "./auth/session-store.js";
import { getConfig } from "./config-loader.js";
import { getVersion } from "./version.js";
import { isMainDomain, isSubdomainOf } from "./utils.js";
import { isBinaryContentType } from "./utils/content-type-detection.js";
import { getDb } from "./db/index.js";
import authRouter from "./auth/routes.js";
import loginRouter from "./auth/login-page.js";
import oauthRouter from "./oauth/routes.js";
import connectRouter from "./oauth/connect.js";
import oauthClientsApi from "./api/oauth-clients.js";
import podsApi from "./api/pods.js";
import podsRouter from "./routes/pods/index.js";
import { createTestUtilsRouter } from "./routes/test-utils/index.js";

const logger = createLogger("webpods");

export function createApp(): Express {
  const app = express();
  const config = getConfig();
  const startTime = Date.now();

  // Security middleware
  app.use(helmet());
  app.use(
    cors({
      origin: config.server.corsOrigin?.split(",") || "*",
      credentials: true,
    }),
  );

  // Request parsing with configurable payload size
  const payloadLimit = config.server.maxPayloadSize || "10mb";
  app.use(express.json({ limit: payloadLimit }));
  app.use(
    express.raw({
      limit: payloadLimit,
      type: (req) => isBinaryContentType(req.headers["content-type"] || ""),
    }),
  );
  app.use(
    express.text({
      limit: payloadLimit,
      type: "*/*", // Everything else is text (including SVG, XML, HTML, etc.)
    }),
  );
  app.use(express.urlencoded({ extended: true, limit: payloadLimit }));
  app.use(compression());
  app.use(cookieParser());

  // Session management for SSO (works on all domains but only used for auth)
  const sessionMiddleware = session(getSessionConfig());
  app.use(sessionMiddleware);

  // Health check endpoint (main domain only)
  app.get("/health", async (req, res) => {
    // Only allow health checks on main domain
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (!isMainDomain(hostname, mainDomain)) {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Health endpoint is only available on the main domain",
        },
      });
      return;
    }

    const uptime = Math.floor((Date.now() - startTime) / 1000);

    // Check database connection
    let dbStatus = "disconnected";
    try {
      const db = getDb();
      await db.one("SELECT 1 as result");
      dbStatus = "connected";
    } catch {
      dbStatus = "disconnected";
    }

    res.json({
      status: "healthy",
      uptime_seconds: uptime,
      uptime,
      timestamp: new Date().toISOString(),
      version: getVersion(),
      services: {
        database: dbStatus,
        cache: "not_configured",
      },
    });
  });

  // Test utilities router (only when explicitly enabled)
  const enableTestUtils =
    process.argv.includes("--enable-test-utils") ||
    process.env.ENABLE_TEST_UTILS === "true";

  if (enableTestUtils) {
    logger.warn("Test utilities enabled via --enable-test-utils flag");
    logger.warn(
      "DO NOT USE IN PRODUCTION - Test utilities provide cache and system access",
    );

    const testUtilsRouter = createTestUtilsRouter();
    app.use("/test-utils", testUtilsRouter);

    logger.info("Test utilities available at /test-utils/health");
  }

  // Login page (main domain only)
  app.use("/", (req, res, next) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain) && req.path === "/login") {
      loginRouter(req, res, next);
    } else {
      next();
    }
  });

  // OAuth routes (main domain only)
  app.use("/oauth", (req, res, next) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain)) {
      oauthRouter(req, res, next);
    } else {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "OAuth endpoints are only available on the main domain",
        },
      });
    }
  });

  // Connect endpoint for simplified OAuth (main domain only)
  app.use("/connect", (req, res, next) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain)) {
      connectRouter(req, res, next);
    } else {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Connect endpoint is only available on the main domain",
        },
      });
    }
  });

  // API routes (main domain only)
  app.use("/api/oauth", (req, res, next) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain)) {
      oauthClientsApi(req, res, next);
    } else {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "API endpoints are only available on the main domain",
        },
      });
    }
  });

  app.use("/api/pods", (req, res, next) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain)) {
      podsApi(req, res, next);
    } else {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "API endpoints are only available on the main domain",
        },
      });
    }
  });

  // Auth routes (main domain only, except /auth/callback which pods handle)
  app.use("/auth", (req, res, next) => {
    // Check if this is the main domain
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isMainDomain(hostname, mainDomain)) {
      // On main domain, use auth router
      authRouter(req, res, next);
    } else {
      // On subdomains, /auth/callback is handled by pod router
      // Skip this middleware and let it fall through
      if (req.path === "/callback") {
        next("route"); // Skip to next route handler
      } else {
        // Other /auth routes return 404 on subdomains
        res.status(404).json({
          error: {
            code: "NOT_FOUND",
            message:
              "Authentication endpoints are only available on the main domain",
          },
        });
      }
    }
  });

  // Pod routes (subdomain-based and rootPod)
  app.use(podsRouter);

  // 404 handler
  app.use((req, res) => {
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const mainDomain = config.server.public?.hostname || "localhost";

    if (isSubdomainOf(hostname, mainDomain)) {
      const podId = hostname.split(".")[0];
      res.status(404).json({
        error: {
          code: "STREAM_NOT_FOUND",
          message: `Stream not found in pod '${podId}'`,
        },
      });
    } else {
      res.status(404).json({
        error: {
          code: "NOT_FOUND",
          message: "Resource not found",
        },
      });
    }
  });

  // Error handler
  app.use((err: Error, req: Request, res: Response, _next: NextFunction) => {
    logger.error("Unhandled error", {
      error: err.message,
      stack: err.stack,
      url: req.url,
      method: req.method,
    });

    const showDetails = process.env.LOG_LEVEL === "debug";
    const statusCode =
      "status" in err && typeof err.status === "number" ? err.status : 500;
    res.status(statusCode).json({
      error: {
        code: "INTERNAL_ERROR",
        message: showDetails ? err.message : "An error occurred",
      },
    });
  });

  return app;
}
