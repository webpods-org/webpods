/**
 * Login route handler
 */

import {
  ExpressRequest,
  Response,
  extractPod,
  getConfig,
  createRouteLogger,
} from "./shared.js";
import { rateLimit } from "../../middleware/ratelimit.js";

const logger = createRouteLogger("login");

/**
 * Pod-specific login endpoint
 * GET {pod}.webpods.org/login
 */
export const loginHandler = (req: ExpressRequest, res: Response) => {
  if (!req.podName) {
    res.status(400).json({
      error: {
        code: "INVALID_POD",
        message: "Could not determine pod from request",
      },
    });
    return;
  }

  // Get redirect path from query or referer
  const redirect = (req.query.redirect as string) || req.get("referer") || "/";

  // Redirect to main domain authorization with pod info
  const config = getConfig();
  const publicUrl = config.server.publicUrl || "http://localhost:3000";
  const authUrl = `${publicUrl}/auth/authorize?pod=${req.podName}&redirect=${encodeURIComponent(redirect)}`;

  logger.info("Pod login initiated", { pod: req.podName, redirect });
  res.redirect(authUrl);
};

export const loginRoute = {
  path: "/login",
  middleware: [extractPod, rateLimit("read")] as const,
  handler: loginHandler,
};
