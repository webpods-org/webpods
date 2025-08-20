/**
 * OAuth login endpoint - bridges WebPods auth to Hydra
 */

import { Router, Request, Response } from "express";
import { getHydraAdmin } from "./hydra-client.js";
import { verifyToken } from "../domain/auth.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";

const logger = createLogger("webpods:oauth:login");
const router = Router();

/**
 * Handle Hydra login challenge
 * GET /oauth/login?login_challenge=xxx
 */
router.get("/login", async (req: Request, res: Response) => {
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

    logger.info("Login request received", {
      challenge: loginChallenge,
      client: loginRequest.client?.client_id,
      requestedScope: loginRequest.requested_scope,
    });

    // Check if user has existing WebPods session
    const session = (req as any).session;

    // Also check for WebPods JWT in cookies or headers
    let webpodsUser = null;

    if (session?.user) {
      // User has session
      webpodsUser = session.user;
      logger.info("User has existing session", { userId: webpodsUser.id });
    } else {
      // Check for JWT token
      const token =
        (req as any).cookies?.token ||
        req.headers.authorization?.replace("Bearer ", "");

      if (token) {
        const result = verifyToken(token);
        if (result.success) {
          webpodsUser = {
            id: result.data.user_id,
            email: result.data.email,
            name: result.data.name,
          };
          logger.info("User authenticated via JWT", { userId: webpodsUser.id });
        }
      }
    }

    if (webpodsUser) {
      // User is authenticated, accept the login
      const { data: acceptResponse } =
        await hydraAdmin.acceptOAuth2LoginRequest({
          loginChallenge,
          acceptOAuth2LoginRequest: {
            subject: webpodsUser.id,
            remember: true,
            remember_for: 3600, // Remember for 1 hour
            context: {
              email: webpodsUser.email,
              name: webpodsUser.name,
            },
          },
        });

      logger.info("Login accepted", {
        userId: webpodsUser.id,
        redirectTo: acceptResponse.redirect_to,
      });

      // Redirect back to Hydra
      res.redirect(acceptResponse.redirect_to!);
    } else {
      // User not authenticated, redirect to WebPods login
      // After successful auth, return here with the same challenge
      const config = getConfig();
      const publicUrl = config.server.publicUrl || "http://localhost:3000";

      // Store challenge in session to return after auth
      if (!session) {
        (req as any).session = {};
      }
      (req as any).session.loginChallenge = loginChallenge;

      // Save session
      await new Promise<void>((resolve, reject) => {
        (req as any).session.save((err: any) => {
          if (err) reject(err);
          else resolve();
        });
      });

      // Redirect to OAuth provider (using default)
      const returnUrl = `${publicUrl}/oauth/login?login_challenge=${loginChallenge}`;
      const authUrl = `${publicUrl}/auth/github?redirect=${encodeURIComponent(returnUrl)}`;

      logger.info("Redirecting to authentication", { authUrl });
      res.redirect(authUrl);
    }
  } catch (error: any) {
    logger.error("Login handler error", {
      error: error.message,
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
