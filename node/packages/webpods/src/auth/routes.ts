/**
 * OAuth authentication routes
 */

import { Router, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { findOrCreateUser, generateToken } from '../domain/auth.js';
import {
  OAuthProvider,
  generatePKCE,
  generateState,
  getAuthorizationUrl,
  exchangeCodeForTokens,
  getUserInfo
} from './providers.js';

const logger = createLogger('webpods:auth:routes');
const router = Router();

// Store PKCE verifiers and redirect paths (in production, use Redis)
const stateStore = new Map<string, { codeVerifier: string; redirect: string; provider: OAuthProvider }>();

// Clean up old state entries periodically
setInterval(() => {
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  for (const [state, data] of stateStore.entries()) {
    // Store timestamp in the data for cleanup
    if ((data as any).timestamp && (data as any).timestamp < fiveMinutesAgo) {
      stateStore.delete(state);
    }
  }
}, 60 * 1000); // Clean every minute

// ===== SPECIFIC ROUTES FIRST =====

/**
 * Success page - displays token after OAuth
 * GET /auth/success
 */
router.get('/success', (req: Request, res: Response) => {
  const token = req.query.token as string;
  const redirect = req.query.redirect as string || '/';
  
  if (!token) {
    res.status(400).send('Missing token parameter');
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
 * Logout
 * POST /auth/logout
 * GET /auth/logout (for convenience)
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  res.json({ success: true, message: 'Logged out successfully' });
});

router.get('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token', { path: '/' });
  // Redirect to home page after logout
  res.redirect('/');
});

/**
 * Get current user
 * GET /auth/whoami
 */
router.get('/whoami', async (req: Request, res: Response) => {
  const token = (req as any).cookies?.token || req.headers.authorization?.replace('Bearer ', '');
  
  if (!token) {
    res.status(401).json({
      error: {
        code: 'UNAUTHENTICATED',
        message: 'Not authenticated'
      }
    });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const payload = jwt.verify(token, secret) as any;
    
    res.json({
      user_id: payload.user_id,
      auth_id: payload.auth_id,
      email: payload.email,
      name: payload.name,
      provider: payload.provider
    });
  } catch {
    res.status(401).json({
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      }
    });
  }
});

// ===== DYNAMIC ROUTES LAST =====

/**
 * Initiate OAuth flow
 * GET /auth/:provider
 */
router.get('/:provider', async (req: Request, res: Response) => {
  const provider = req.params.provider as OAuthProvider;
  
  if (provider !== 'github' && provider !== 'google') {
    res.status(400).json({
      error: {
        code: 'INVALID_PROVIDER',
        message: 'Invalid OAuth provider'
      }
    });
    return;
  }

  try {
    // Get redirect URL from query or default to root
    const redirect = req.query.redirect ? String(req.query.redirect) : '/';
    
    // Generate PKCE and state
    const { codeVerifier, codeChallenge } = generatePKCE();
    const state = generateState();
    
    // Store state with verifier and redirect
    stateStore.set(state, {
      codeVerifier,
      redirect,
      provider,
      timestamp: Date.now()
    } as any);
    
    // Get authorization URL
    const authUrl = await getAuthorizationUrl(provider, state, codeChallenge);
    
    logger.info('OAuth flow initiated', { provider, state });
    res.redirect(authUrl);
  } catch (error: any) {
    logger.error('Failed to initiate OAuth', { error, provider });
    res.status(500).json({
      error: {
        code: 'OAUTH_ERROR',
        message: 'Failed to initiate authentication'
      }
    });
  }
});

/**
 * OAuth callback
 * GET /auth/:provider/callback
 */
router.get('/:provider/callback', async (req: Request, res: Response) => {
  const provider = req.params.provider as OAuthProvider;
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).json({
      error: {
        code: 'INVALID_CALLBACK',
        message: 'Missing code or state parameter'
      }
    });
    return;
  }

  try {
    // Retrieve and validate state
    const stateData = stateStore.get(state as string);
    
    if (!stateData || stateData.provider !== provider) {
      res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: 'Invalid or expired state'
        }
      });
      return;
    }
    
    // Clean up state
    stateStore.delete(state as string);
    
    // Exchange code for tokens
    const tokenSet = await exchangeCodeForTokens(
      provider,
      code as string,
      stateData.codeVerifier
    );
    
    // Get user info
    const userInfo = await getUserInfo(provider, tokenSet.access_token);
    
    // Find or create user
    const db = getDb();
    const userResult = await findOrCreateUser(db, provider, userInfo);
    
    if (!userResult.success) {
      logger.error('Failed to create/find user', { error: userResult.error, provider });
      res.status(500).json({
        error: userResult.error
      });
      return;
    }
    
    // Generate JWT
    const token = generateToken(userResult.data);
    
    // Set cookie for web apps
    const isProduction = process.env.NODE_ENV === 'production';
    res.cookie('token', token, {
      httpOnly: true,
      secure: isProduction,
      sameSite: isProduction ? 'strict' : 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
      path: '/'
    });
    
    logger.info('User authenticated', { 
      userId: userResult.data.id, 
      provider,
      redirect: stateData.redirect 
    });
    
    // Redirect to success page with token
    // The success page will handle final redirect after showing token
    const redirectUrl = stateData.redirect || '/';
    const successUrl = `/auth/success?token=${encodeURIComponent(token)}&redirect=${encodeURIComponent(redirectUrl)}`;
    res.redirect(successUrl);
  } catch (error: any) {
    logger.error('OAuth callback error', { error, provider });
    res.status(500).json({
      error: {
        code: 'OAUTH_ERROR',
        message: 'Authentication failed'
      }
    });
  }
});

export default router;