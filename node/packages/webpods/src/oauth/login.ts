/**
 * OAuth login endpoint - bridges WebPods auth to Hydra
 */

import { Router, Request, Response } from "express";
import { getHydraAdmin } from "./hydra-client.js";
import { isTestModeAllowed } from "./test-mode-guard.js";
// Removed old auth imports - using Hydra OAuth only
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";
import { rateLimit } from "../middleware/ratelimit.js";

const logger = createLogger("webpods:oauth:login");
const router = Router();

/**
 * Handle Hydra login challenge
 * GET /oauth/login?login_challenge=xxx
 */
router.get("/login", rateLimit("read"), async (req: Request, res: Response) => {
  const loginChallenge = req.query.login_challenge as string;

  if (!loginChallenge) {
    res.status(400).json({
      error: {
        code: "MISSING_CHALLENGE",
        message: "login_challenge parameter is required",
      },
    });
    return;
  }

  try {
    const hydraAdmin = getHydraAdmin();

    // Get login request details from Hydra
    const { data: loginRequest } = await hydraAdmin.getOAuth2LoginRequest({
      loginChallenge,
    });

    logger.info("Login request received");

    // Extract pods from the original OAuth request if present
    let requestedPods: string[] = [];
    const requestUrl = (loginRequest as { request_url?: string }).request_url;
    if (requestUrl) {
      try {
        const url = new URL(requestUrl, "http://example.com");
        const state = url.searchParams.get("state");
        if (state) {
          const stateData = JSON.parse(Buffer.from(state, "base64").toString());
          if (stateData.pods && Array.isArray(stateData.pods)) {
            requestedPods = stateData.pods;
          }
        }
      } catch {
        // Invalid state format, ignore
      }
    }

    // Test mode: auto-accept with test user (only in controlled environments)
    if (req.headers["x-test-user"]) {
      if (!isTestModeAllowed(req)) {
        // Test headers detected but not allowed
        res.status(403).json({
          error: {
            code: "FORBIDDEN",
            message: "Test mode is not enabled",
          },
        });
        return;
      }

      const testUserId = req.headers["x-test-user"] as string;
      logger.info("Test mode: auto-accepting login");

      const config = getConfig();
      const rememberForSeconds = (config.oauth.rememberShortHours ?? 1) * 3600;
      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2LoginRequest({
          loginChallenge,
          acceptOAuth2LoginRequest: {
            subject: testUserId,
            remember: true,
            remember_for: rememberForSeconds,
          },
        });

      res.redirect(acceptResponse.redirect_to!);
      return;
    }

    // Check if user has existing WebPods session
    const session = (
      req as {
        session?: {
          user?: {
            id: string;
            email?: string;
            name?: string;
            provider?: string;
          };
        };
      }
    ).session;

    // Also check for WebPods JWT in cookies or headers
    let webpodsUser = null;

    if (session?.user) {
      // User has session
      webpodsUser = session.user;
      logger.info("User has existing session");
    } else {
      // JWT tokens removed - using Hydra OAuth only
    }

    if (webpodsUser) {
      // User is authenticated, accept the login
      const config = getConfig();
      const rememberForSeconds = (config.oauth.rememberShortHours ?? 1) * 3600;
      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2LoginRequest({
          loginChallenge,
          acceptOAuth2LoginRequest: {
            subject: webpodsUser.id,
            remember: true,
            remember_for: rememberForSeconds,
            context: {
              email: webpodsUser.email,
              name: webpodsUser.name,
            },
          },
        });

      logger.info("Login accepted");

      // Redirect back to Hydra
      res.redirect(acceptResponse.redirect_to!);
    } else {
      // User not authenticated, redirect to WebPods login
      // After successful auth, return here with the same challenge
      const config = getConfig();
      const publicUrl = config.server.publicUrl || "http://localhost:3000";

      // Store challenge and pods in session to return after auth
      const sessionReq = req as unknown as {
        session?: {
          [key: string]: unknown;
          save?: (callback: (err?: Error) => void) => void;
        };
      };
      if (!sessionReq.session) {
        sessionReq.session = {};
      }
      sessionReq.session.loginChallenge = loginChallenge;
      if (requestedPods.length > 0) {
        sessionReq.session.requestedPods = requestedPods;
      }

      // Save session
      await new Promise<void>((resolve, reject) => {
        if (sessionReq.session?.save) {
          sessionReq.session.save((err?: Error) => {
            if (err) reject(err);
            else resolve();
          });
        } else {
          resolve();
        }
      });

      // Redirect to OAuth provider (using default or configured)
      const defaultProvider =
        config.oauth.defaultProvider ||
        config.oauth.providers[0]?.id ||
        "github";
      const returnUrl = `${publicUrl}/oauth/login?login_challenge=${loginChallenge}`;

      // Pass pods through the auth flow via query parameter
      let authUrl = `${publicUrl}/auth/${defaultProvider}?redirect=${encodeURIComponent(returnUrl)}`;
      if (requestedPods.length > 0) {
        authUrl += `&pods=${encodeURIComponent(requestedPods.join(","))}`;
      }

      logger.info("Redirecting to authentication", { authUrl });
      res.redirect(authUrl);
    }
  } catch (error: unknown) {
    logger.error("Login handler error", {
      error: (error as Error).message,
      challenge: loginChallenge,
    });

    // If we can't handle the login, reject it
    try {
      const hydraAdmin = getHydraAdmin();
      const { data: rejectResponse } =
        await hydraAdmin.rejectOAuth2LoginRequest({
          loginChallenge,
          rejectOAuth2Request: {
            error: "login_error",
            error_description: "Failed to process login request",
          },
        });

      res.redirect(rejectResponse.redirect_to!);
    } catch {
      res.status(500).json({
        error: {
          code: "LOGIN_ERROR",
          message: "Failed to process login request",
        },
      });
    }
  }
});

export default router;
