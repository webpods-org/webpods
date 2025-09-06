/**
 * OAuth callback route handler
 */

import {
  ExpressRequest,
  Response,
  extractPod,
  getConfig,
  createRouteLogger,
} from "./shared.js";

const logger = createRouteLogger("auth-callback");

/**
 * Pod-specific auth callback
 * GET {pod}.webpods.org/auth/callback
 */
export const authCallbackHandler = (req: ExpressRequest, res: Response) => {
  const token = req.query.token as string;
  const redirect = (req.query.redirect as string) || "/";

  logger.info("Auth callback on pod", {
    pod: req.podName,
    hasToken: !!token,
    redirect,
  });

  if (!token) {
    res.status(400).json({
      error: {
        code: "MISSING_TOKEN",
        message: "Authorization token is required",
      },
    });
    return;
  }

  // Set cookie for this pod subdomain
  const config = getConfig();
  const publicConfig = config.server.public;
  const isSecure = publicConfig?.isSecure || false;
  res.cookie("pod_token", token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? "strict" : "lax",
    maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
    path: "/",
    // Cookie domain cannot have port
    domain: `.${req.podName}.${publicConfig?.hostname || "localhost"}`, // Scoped to pod subdomain
  });

  logger.info("Pod auth callback successful", { pod: req.podName });

  // Redirect to final destination
  res.redirect(redirect);
};

export const authCallbackRoute = {
  path: "/auth/callback",
  middleware: [extractPod] as const,
  handler: authCallbackHandler,
};
