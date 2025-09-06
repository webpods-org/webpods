/**
 * Root path handler with .config/routing support
 */

import {
  Response,
  NextFunction,
  AuthRequest,
  extractPod,
  optionalAuth,
  createRouteLogger,
} from "./shared.js";
import { getDb } from "../../db/index.js";
import { getConfig } from "../../config-loader.js";
import { resolveLink } from "../../domain/routing/resolve-link.js";

const logger = createRouteLogger("root");

/**
 * Root path handler with .config/routing support
 * GET {pod}.webpods.org/
 */
export const rootHandler = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction,
) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.podName) {
    return next();
  }

  if (!req.pod) {
    // On subdomains, return POD_NOT_FOUND
    // On main domain (even with rootPod), fall through to generic 404
    const hostname = req.hostname || req.headers.host?.split(":")[0] || "";
    const config = getConfig();
    const mainDomain = config.server.public?.hostname || "localhost";
    const port = config.server.public?.port || config.server.port;

    // Check if this is the main domain (with or without port)
    const isMainDomain =
      hostname === mainDomain ||
      hostname === `${mainDomain}:${port}` ||
      (hostname === "localhost" && mainDomain === "localhost");

    if (isMainDomain) {
      // Main domain - fall through to 404 handler
      return next();
    }

    // Subdomain - pod not found
    res.status(404).json({
      error: {
        code: "POD_NOT_FOUND",
        message: "Pod not found",
      },
    });
    return;
  }

  const db = getDb();

  // Check if path "/" is mapped in .config/routing
  const linkResult = await resolveLink({ db }, req.podName, "/");

  if (linkResult.success && linkResult.data) {
    // Redirect to the mapped stream/record
    const { streamPath, target } = linkResult.data;

    // Rewrite URL and forward to the stream handler
    if (target && target.startsWith("?")) {
      // Handle query parameters (e.g., "?i=-1")
      req.url = `/${streamPath}${target}`;
      req.query = Object.fromEntries(new URLSearchParams(target.substring(1)));
    } else if (target) {
      // Handle path targets (e.g., "/record-name")
      req.url = `/${streamPath}${target}`;
    } else {
      // Just stream name
      req.url = `/${streamPath}`;
    }

    // Let the router handle the rewritten request
    // This needs special handling in the index router
    logger.debug("Root path resolved to", { streamPath, target });

    // Instead of calling router directly, we'll need to handle this in index.ts
    // For now, mark that we need to re-route
    (req as any).needsReroute = true;
    return next();
  }

  // No mapping, return 404
  res.status(404).json({
    error: {
      code: "NOT_FOUND",
      message:
        "No content configured for root path. Use .config/routing to configure.",
    },
  });
};

export const rootRoute = {
  path: "/",
  middleware: [extractPod, optionalAuth] as const,
  handler: rootHandler,
};
