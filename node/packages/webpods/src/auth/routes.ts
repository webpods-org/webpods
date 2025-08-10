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
    
    // Set cookie and redirect
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
    
    // Redirect to original destination
    res.redirect(stateData.redirect);
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

/**
 * Logout
 * POST /auth/logout
 */
router.post('/logout', (_req: Request, res: Response) => {
  res.clearCookie('token');
  res.json({ success: true });
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

export default router;