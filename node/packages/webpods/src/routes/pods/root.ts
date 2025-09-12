/**
 * Root path handler with .config/routing support
 */

import {
  Response,
  NextFunction,
  AuthRequest,
  extractPod,
  optionalAuth,
} from "./shared.js";
import { getConfig } from "../../config-loader.js";

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
    if (!res.headersSent) {
      res.status(404).json({
        error: {
          code: "POD_NOT_FOUND",
          message: "Pod not found",
        },
      });
    }
    return;
  }

  // Check if the path was rewritten by the link resolution middleware
  if (
    (req as unknown as { wasRewritten?: boolean }).wasRewritten &&
    req.path !== "/"
  ) {
    // Path was rewritten, forward to the GET handler
    const { getHandler } = await import("./get.js");
    return getHandler(req, res, next);
  }

  // If we get here and the path is still "/", it means no link was found
  // No mapping, return 404
  if (!res.headersSent) {
    res.status(404).json({
      error: {
        code: "NOT_FOUND",
        message:
          "No content configured for root path. Use .config/routing to configure.",
      },
    });
  }
};

// Import resolveLinks
import { resolveLinks } from "../../middleware/resolve-links.js";

export const rootRoute = {
  path: "/",
  middleware: [extractPod, resolveLinks, optionalAuth] as const,
  handler: rootHandler,
};
