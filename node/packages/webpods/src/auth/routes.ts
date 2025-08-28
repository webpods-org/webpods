/**
 * OAuth authentication routes
 */

import { Router, Request, Response } from "express";
import { getDb } from "../db/index.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";
import { findOrCreateUser } from "../domain/users/find-or-create-user.js";
import { verifyHydraToken } from "../oauth/jwt-validator.js";
import type {
  OAuthProvider as OAuthProviderType,
  RequestWithSession,
} from "../types.js";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
  validateProvider,
} from "./oauth-handlers.js";
import { getConfiguredProviders, getDefaultProvider } from "./oauth-config.js";
import { generateWebPodsToken } from "./jwt-generator.js";

type OAuthProvider = string;
import {
  storePKCEState,
  retrievePKCEState,
  generatePKCE,
} from "./pkce-store.js";
import sessionRouter from "./session-routes.js";

const logger = createLogger("webpods:auth:routes");
const router = Router();

// Mount session management routes
router.use("/", sessionRouter);

// ===== SPECIFIC ROUTES FIRST =====

/**
 * List available OAuth providers
 * GET /auth/providers
 */
router.get("/providers", (_req: Request, res: Response) => {
  const providers = getConfiguredProviders();
  res.json({
    providers: providers.map((id) => ({
      id,
      name: id.charAt(0).toUpperCase() + id.slice(1),
      login_url: `/auth/${id}`,
    })),
  });
});

/**
 * Success page - displays token after OAuth
 * GET /auth/success
 */
router.get("/success", (req: Request, res: Response) => {
  const token = req.query.token as string;
  const redirect = (req.query.redirect as string) || "/";

  if (!token) {
    res.status(400).send("Missing token parameter");
    return;
  }

  // Return HTML page that displays the token
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Authentication Successful - WebPods</title>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <style>
        body {
          font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
          max-width: 600px;
          margin: 50px auto;
          padding: 20px;
          background: #f5f5f5;
        }
        .container {
          background: white;
          border-radius: 8px;
          padding: 30px;
          box-shadow: 0 2px 10px rgba(0,0,0,0.1);
        }
        h1 {
          color: #333;
          margin-bottom: 10px;
        }
        .success-icon {
          color: #22c55e;
          font-size: 48px;
          margin-bottom: 20px;
        }
        .token-container {
          background: #f8f9fa;
          border: 1px solid #dee2e6;
          border-radius: 4px;
          padding: 15px;
          margin: 20px 0;
          word-break: break-all;
          font-family: 'Courier New', monospace;
          font-size: 14px;
        }
        .token-label {
          font-weight: bold;
          margin-bottom: 10px;
          color: #666;
        }
        button {
          background: #007bff;
          color: white;
          border: none;
          padding: 10px 20px;
          border-radius: 4px;
          cursor: pointer;
          font-size: 16px;
          margin-right: 10px;
        }
        button:hover {
          background: #0056b3;
        }
        .redirect-notice {
          margin-top: 20px;
          padding: 15px;
          background: #e3f2fd;
          border-radius: 4px;
          color: #1976d2;
        }
        .instructions {
          margin-top: 20px;
          padding: 15px;
          background: #fff3cd;
          border-radius: 4px;
          color: #856404;
        }
        #copy-feedback {
          color: #22c55e;
          margin-left: 10px;
          display: none;
        }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="success-icon">✓</div>
        <h1>Authentication Successful!</h1>
        <p>You have successfully authenticated with WebPods.</p>
        
        <div class="token-label">Your Access Token:</div>
        <div class="token-container" id="token">${token}</div>
        
        <div>
          <button onclick="copyToken()">Copy Token</button>
          <button onclick="continueToApp()">Continue to App</button>
          <span id="copy-feedback">✓ Copied!</span>
        </div>
        
        <div class="instructions">
          <strong>For CLI/Desktop Apps:</strong> Copy the token above and paste it into your application.
          <br><br>
          <strong>For API Access:</strong> Include this token in your requests:
          <br>
          <code>Authorization: Bearer ${token.substring(0, 20)}...</code>
        </div>
        
        <div class="redirect-notice" id="redirect-notice">
          Redirecting to your application in <span id="countdown">5</span> seconds...
          <br>
          <a href="${redirect}">Click here if you're not redirected</a>
        </div>
      </div>
      
      <script>
        // Store token for programmatic access
        window.authToken = '${token}';
        
        // Post message to parent window if in popup
        if (window.opener) {
          window.opener.postMessage({ 
            type: 'auth_success',
            token: '${token}'
          }, '*');
        }
        
        // Copy token function
        function copyToken() {
          navigator.clipboard.writeText('${token}').then(() => {
            document.getElementById('copy-feedback').style.display = 'inline';
            setTimeout(() => {
              document.getElementById('copy-feedback').style.display = 'none';
            }, 2000);
          }).catch(() => {
            // Fallback for older browsers
            const tokenEl = document.getElementById('token');
            const range = document.createRange();
            range.selectNode(tokenEl);
            window.getSelection().removeAllRanges();
            window.getSelection().addRange(range);
            document.execCommand('copy');
            window.getSelection().removeAllRanges();
            
            document.getElementById('copy-feedback').style.display = 'inline';
            setTimeout(() => {
              document.getElementById('copy-feedback').style.display = 'none';
            }, 2000);
          });
        }
        
        // Continue to app function
        function continueToApp() {
          window.location.href = '${redirect}';
        }
        
        // Auto-redirect for web apps (can be disabled by CLI/desktop apps)
        const urlParams = new URLSearchParams(window.location.search);
        if (!urlParams.has('no_redirect')) {
          let countdown = 5;
          const countdownEl = document.getElementById('countdown');
          
          const timer = setInterval(() => {
            countdown--;
            if (countdownEl) countdownEl.textContent = countdown;
            
            if (countdown <= 0) {
              clearInterval(timer);
              window.location.href = '${redirect}';
            }
          }, 1000);
        } else {
          // Hide redirect notice for CLI/desktop flows
          document.getElementById('redirect-notice').style.display = 'none';
        }
      </script>
    </body>
    </html>
  `);
});

/**
 * Get current user
 * GET /auth/whoami
 */
router.get("/whoami", async (req: Request, res: Response) => {
  const token =
    (req as RequestWithSession).cookies?.token ||
    req.headers.authorization?.replace("Bearer ", "");

  if (!token) {
    res.status(401).json({
      error: {
        code: "UNAUTHENTICATED",
        message: "Not authenticated",
      },
    });
    return;
  }

  try {
    // Check if it's a WebPods JWT token first
    const { isWebPodsToken, verifyWebPodsToken } = await import("./jwt-generator.js");
    
    if (isWebPodsToken(token)) {
      const webpodsResult = verifyWebPodsToken(token);
      
      if (!webpodsResult.success) {
        res.status(401).json({
          error: webpodsResult.error,
        });
        return;
      }
      
      // Get user info using domain function
      const { getUserInfo } = await import("../domain/users/index.js");
      const db = getDb();
      const ctx = { db };
      
      const userInfoResult = await getUserInfo(ctx, webpodsResult.data.sub);
      
      if (!userInfoResult.success) {
        res.status(404).json({
          error: {
            code: "USER_NOT_FOUND",
            message: "User not found",
          },
        });
        return;
      }
      
      res.json(userInfoResult.data);
      return;
    }
    
    // Otherwise try as Hydra token
    const result = await verifyHydraToken(token);

    if (!result.success) {
      res.status(401).json({
        error: result.error,
      });
      return;
    }

    const payload = result.data;
    res.json({
      user_id: payload.sub,
      // Hydra tokens don't include email/name - would need userinfo endpoint
      email: null,
      name: null,
    });
  } catch {
    res.status(401).json({
      error: {
        code: "INVALID_TOKEN",
        message: "Invalid or expired token",
      },
    });
  }
});

/**
 * Pod-specific authorization endpoint with SSO support
 * GET /auth/authorize?pod=alice&redirect=/path
 */
router.get("/authorize", async (req: Request, res: Response) => {
  const pod = req.query.pod as string;
  const redirect = (req.query.redirect as string) || "/";

  if (!pod) {
    res.status(400).json({
      error: {
        code: "MISSING_POD",
        message: "Pod parameter is required",
      },
    });
    return;
  }

  // Check if user has a valid session (SSO)
  const reqWithSession = req as RequestWithSession;
  if (reqWithSession.session?.user) {
    try {
      // WebPods JWT tokens removed - using Hydra OAuth
      // Sessions are used for SSO across pods
      const podToken = "session"; // Placeholder for session-based auth

      // Redirect back to pod with token
      const config = getConfig();
      // Build callback URL for pod subdomain
      const publicConfig = config.server.public!;
      const podHost =
        publicConfig.port === 80 || publicConfig.port === 443
          ? `${pod}.${publicConfig.hostname}`
          : `${pod}.${publicConfig.hostname}:${publicConfig.port}`;
      const callbackUrl = `${publicConfig.protocol}://${podHost}/auth/callback?token=${encodeURIComponent(podToken)}&redirect=${encodeURIComponent(redirect)}`;

      logger.info("SSO authorization successful", {
        pod,
        userId: reqWithSession.session.user.id,
      });
      res.redirect(callbackUrl);
    } catch (error) {
      logger.error("Failed to generate pod token", {
        error: (error as Error).message,
        pod,
      });
      res.status(500).json({
        error: {
          code: "TOKEN_ERROR",
          message: "Failed to generate authorization token",
        },
      });
    }
  } else {
    // No session, redirect to OAuth with pod info
    const defaultProvider = getDefaultProvider();

    if (!defaultProvider) {
      res.status(500).json({
        error: {
          code: "NO_PROVIDERS",
          message: "No OAuth providers configured",
        },
      });
      return;
    }

    const { codeVerifier, codeChallenge, state } = generatePKCE();

    // Store state with pod info in database
    await storePKCEState(state, codeVerifier, pod, redirect);

    // Get authorization URL
    const authUrl = await getAuthorizationUrl(
      defaultProvider,
      state,
      codeChallenge,
    );

    logger.info("Redirecting to OAuth for pod authorization", {
      pod,
      provider: defaultProvider,
    });
    res.redirect(authUrl);
  }
});

// ===== DYNAMIC ROUTES LAST =====

/**
 * Initiate OAuth flow
 * GET /auth/:provider
 */
router.get("/:provider", async (req: Request, res: Response) => {
  const provider = req.params.provider as OAuthProvider;

  // Check if provider is configured
  if (!validateProvider(provider)) {
    const available = getConfiguredProviders();
    res.status(400).json({
      error: {
        code: "INVALID_PROVIDER",
        message: `Invalid OAuth provider. Available providers: ${available.join(", ") || "none configured"}`,
      },
    });
    return;
  }

  try {
    // Get redirect URL from query or default to root
    const redirect = req.query.redirect ? String(req.query.redirect) : "/";

    // Get requested pods from query parameter
    const podsParam = req.query.pods as string | undefined;
    const requestedPods = podsParam
      ? podsParam.split(",").filter((p) => p)
      : undefined;

    // Generate PKCE and state
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    // Store state with codeVerifier, pods (as comma-separated), and redirect in database
    await storePKCEState(
      state,
      codeVerifier,
      requestedPods?.join(","),
      redirect,
    );

    // Get authorization URL
    const authUrl = await getAuthorizationUrl(provider, state, codeChallenge);

    logger.info("OAuth flow initiated", { provider, state });
    res.redirect(authUrl);
  } catch (error) {
    logger.error("Failed to initiate OAuth", {
      error: (error as Error).message,
      provider,
    });
    res.status(500).json({
      error: {
        code: "OAUTH_ERROR",
        message: "Failed to initiate authentication",
      },
    });
  }
});

/**
 * OAuth callback
 * GET /auth/:provider/callback
 */
router.get("/:provider/callback", async (req: Request, res: Response) => {
  const provider = req.params.provider as OAuthProvider;
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).json({
      error: {
        code: "INVALID_CALLBACK",
        message: "Missing code or state parameter",
      },
    });
    return;
  }

  try {
    // Retrieve and validate state from database
    const stateData = await retrievePKCEState(state as string);

    if (!stateData) {
      res.status(400).json({
        error: {
          code: "INVALID_STATE",
          message: "Invalid or expired state",
        },
      });
      return;
    }

    // Exchange code for tokens
    const tokenSet = await exchangeCodeForTokens(
      provider,
      code as string,
      stateData.codeVerifier,
    );

    // Get user info
    const tokenSetTyped = tokenSet as Record<string, unknown>;
    if (
      !tokenSetTyped.access_token ||
      typeof tokenSetTyped.access_token !== "string"
    ) {
      logger.error("Invalid token response from OAuth provider", {
        provider,
        tokenStructure: Object.keys(tokenSetTyped),
      });
      throw new Error(
        `Invalid token response: missing or invalid access_token from ${provider}`,
      );
    }
    const userInfo = await getUserInfo(provider, tokenSetTyped.access_token);

    // Find or create user
    const db = getDb();
    const appConfig = getConfig();
    const providerConfigData = appConfig.oauth.providers.find(
      (p) => p.id === provider,
    );
    if (!providerConfigData) {
      res.status(500).json({
        error: {
          code: "PROVIDER_NOT_FOUND",
          message: "OAuth provider not configured",
        },
      });
      return;
    }

    // Create provider object for user creation
    const providerConfig: OAuthProviderType = {
      provider: provider,
      clientId: providerConfigData.clientId,
      clientSecret: providerConfigData.clientSecret,
    };

    const userResult = await findOrCreateUser({ db }, providerConfig, userInfo);

    if (!userResult.success) {
      logger.error("Failed to create/find user", {
        error: userResult.error,
        provider,
      });
      res.status(500).json({
        error: userResult.error,
      });
      return;
    }

    // Store user in session for SSO
    const reqWithSession = req as RequestWithSession;
    reqWithSession.session = reqWithSession.session || {};
    reqWithSession.session.user = userResult.data.user;
    reqWithSession.session.identity = userResult.data.identity;

    // Save session to ensure it's persisted
    await new Promise<void>((resolve, reject) => {
      const reqWithSession = req as RequestWithSession;
      reqWithSession.session?.save?.((err?: Error) => {
        if (err) {
          logger.error("Failed to save session", { error: err });
          reject(err);
        } else {
          logger.info("Session saved", { userId: userResult.data.user.id });
          resolve();
        }
      });
    });

    // Get config for redirect URLs
    const config = getConfig();

    // Generate WebPods JWT for API access
    const tokenResult = generateWebPodsToken(userResult.data.user.id);

    if (!tokenResult.success) {
      logger.error("Failed to generate WebPods JWT", {
        error: tokenResult.error,
        userId: userResult.data.user.id,
      });
      res.status(500).json({
        error: {
          code: "TOKEN_GENERATION_ERROR",
          message: "Failed to generate authentication token",
        },
      });
      return;
    }

    const webpodsToken = tokenResult.data;

    // Check if this is pod-specific auth
    if (stateData.pod) {
      // Build callback URL for pod subdomain
      const publicConfig = config.server.public!;
      const podHost =
        publicConfig.port === 80 || publicConfig.port === 443
          ? `${stateData.pod}.${publicConfig.hostname}`
          : `${stateData.pod}.${publicConfig.hostname}:${publicConfig.port}`;
      const callbackUrl = `${publicConfig.protocol}://${podHost}/auth/callback?token=${encodeURIComponent(webpodsToken)}&redirect=${encodeURIComponent(stateData.redirect || "/")}`;

      logger.info("Pod authentication successful", {
        userId: userResult.data.user.id,
        provider,
        pod: stateData.pod,
        redirect: stateData.redirect,
      });

      res.redirect(callbackUrl);
    } else {
      // Set session cookie for SSO (domain cookie for all subdomains)
      const isSecure = config.server.public?.isSecure || false;
      const cookieDomain = config.server.public?.hostname?.startsWith(
        "localhost",
      )
        ? undefined // Don't set domain for localhost
        : `.${config.server.public?.hostname}`; // Set to .webpods.org for SSO

      const sessionId = reqWithSession.session?.id;
      if (!sessionId) {
        logger.error("Session ID missing after authentication", {
          userId: userResult.data.user.id,
          provider,
        });
        throw new Error("Failed to create session: no session ID");
      }

      res.cookie("webpods_session", sessionId, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "strict" : "lax",
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
        path: "/",
        domain: cookieDomain,
      });

      logger.info("User authenticated", {
        userId: userResult.data.user.id,
        provider,
        redirect: stateData.redirect,
        tokenGenerated: true,
        sessionCreated: true,
      });

      // Redirect to success page with WebPods JWT
      const redirectUrl = stateData.redirect || "/";
      const successUrl = `/auth/success?token=${encodeURIComponent(webpodsToken)}&redirect=${encodeURIComponent(redirectUrl)}`;
      res.redirect(successUrl);
    }
  } catch (error) {
    logger.error("OAuth callback error", {
      error: (error as Error).message,
      provider,
    });
    res.status(500).json({
      error: {
        code: "OAUTH_ERROR",
        message: "Authentication failed",
      },
    });
  }
});

export default router;
