/**
 * OAuth authentication routes
 */

import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { getDb } from "../db.js";
import { createLogger } from "../logger.js";
import { getConfig } from "../config-loader.js";
import { findOrCreateUser } from "../domain/users.js";
import { verifyHydraToken } from "../oauth/jwt-validator.js";
import type { OAuthProvider as OAuthProviderType } from "../types.js";
import {
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo,
  validateProvider,
} from "./oauth-handlers.js";
import { getConfiguredProviders, getDefaultProvider } from "./oauth-config.js";

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
    (req as any).cookies?.token ||
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
      email: payload.email,
      name: payload.name,
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
  if ((req as any).session?.user) {
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
        userId: (req as any).session.user.id,
      });
      res.redirect(callbackUrl);
    } catch (error: any) {
      logger.error("Failed to generate pod token", { error, pod });
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

    // Generate PKCE and state
    const { codeVerifier, codeChallenge, state } = generatePKCE();

    // Store state with codeVerifier and redirect in database
    await storePKCEState(state, codeVerifier, undefined, redirect);

    // Get authorization URL
    const authUrl = await getAuthorizationUrl(provider, state, codeChallenge);

    logger.info("OAuth flow initiated", { provider, state });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error("Failed to initiate OAuth", { error, provider });
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
    const userInfo = await getUserInfo(provider, tokenSet.access_token);

    // Find or create user
    const db = getDb();
    const appConfig = getConfig();
    const providerConfigData = appConfig.oauth.providers.find(p => p.id === provider);
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
    
    const userResult = await findOrCreateUser(db, providerConfig, userInfo);

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
    (req as any).session = (req as any).session || {};
    (req as any).session.user = userResult.data.user;
    (req as any).session.identity = userResult.data.identity;

    // Save session to ensure it's persisted
    await new Promise<void>((resolve, reject) => {
      (req as any).session.save((err: any) => {
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

    // Check if this is pod-specific auth
    if (stateData.pod) {
      // WebPods JWT tokens removed - using Hydra OAuth
      const podToken = "session"; // Placeholder for session-based auth
      // Build callback URL for pod subdomain
      const publicConfig = config.server.public!;
      const podHost =
        publicConfig.port === 80 || publicConfig.port === 443
          ? `${stateData.pod}.${publicConfig.hostname}`
          : `${stateData.pod}.${publicConfig.hostname}:${publicConfig.port}`;
      const callbackUrl = `${publicConfig.protocol}://${podHost}/auth/callback?token=${encodeURIComponent(podToken)}&redirect=${encodeURIComponent(stateData.redirect || "/")}`;

      logger.info("Pod authentication successful", {
        userId: userResult.data.user.id,
        provider,
        pod: stateData.pod,
        redirect: stateData.redirect,
      });

      res.redirect(callbackUrl);
    } else {
      // WebPods JWT tokens removed - using Hydra OAuth
      const token = "session"; // Placeholder for session-based auth

      // Set cookie for web apps
      const isSecure = config.server.public?.isSecure || false;
      res.cookie("token", token, {
        httpOnly: true,
        secure: isSecure,
        sameSite: isSecure ? "strict" : "lax",
        maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
        path: "/",
      });

      logger.info("User authenticated", {
        userId: userResult.data.user.id,
        provider,
        redirect: stateData.redirect,
      });

      // Redirect to success page with token
      const redirectUrl = stateData.redirect || "/";
      const successUrl = `/auth/success?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirectUrl)}`;
      res.redirect(successUrl);
    }
  } catch (error: any) {
    logger.error("OAuth callback error", { error, provider });
    res.status(500).json({
      error: {
        code: "OAUTH_ERROR",
        message: "Authentication failed",
      },
    });
  }
});

export default router;
