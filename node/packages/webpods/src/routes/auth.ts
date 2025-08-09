// OAuth authentication routes
import { Router } from 'express';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { getDb } from '../db.js';
import { handleOAuthCallback } from '../domain/auth/oauth-callback.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:routes:auth');
const router = Router();

// Configure passport
passport.use(new GoogleStrategy({
  clientID: process.env.GOOGLE_CLIENT_ID || '',
  clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
  callbackURL: process.env.GOOGLE_CALLBACK_URL || '/auth/google/callback'
}, async (_accessToken, _refreshToken, profile, done) => {
  return done(null, {
    id: profile.id,
    email: profile.emails?.[0]?.value,
    name: profile.displayName,
    provider: 'google'
  });
}));

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user as any);
});

/**
 * GET /auth/:provider - Initiate OAuth flow
 */
router.get('/auth/:provider', (req, res, next) => {
  const provider = req.params.provider;
  const redirectUri = req.query.redirect_uri as string;
  
  if (provider !== 'google') {
    res.status(400).json({
      error: {
        code: 'INVALID_PROVIDER',
        message: 'Unsupported OAuth provider'
      }
    });
    return;
  }
  
  // Store redirect URI in session or state
  const state = redirectUri ? Buffer.from(redirectUri).toString('base64') : '';
  
  passport.authenticate(provider, {
    scope: ['profile', 'email'],
    state
  })(req, res, next);
});

/**
 * GET /auth/:provider/callback - OAuth callback
 */
router.get('/auth/:provider/callback', 
  (req, res, next) => {
    const provider = req.params.provider;
    
    if (provider !== 'google') {
      res.status(400).json({
        error: {
          code: 'INVALID_PROVIDER',
          message: 'Unsupported OAuth provider'
        }
      });
      return;
    }
    
    passport.authenticate(provider, { session: false }, async (err, user) => {
      if (err || !user) {
        logger.error('OAuth authentication failed', { error: err });
        res.status(401).json({
          error: {
            code: 'AUTH_FAILED',
            message: 'Authentication failed'
          }
        });
        return;
      }
      
      try {
        const db = getDb();
        const result = await handleOAuthCallback(db, user);
        
        if (!result.success) {
          res.status(500).json({ error: result.error });
          return;
        }
        
        // Get redirect URI from state
        const state = req.query.state as string;
        const redirectUri = state ? Buffer.from(state, 'base64').toString() : null;
        
        // If redirect URI provided, redirect with token
        if (redirectUri) {
          const url = new URL(redirectUri);
          url.searchParams.set('token', result.data.token);
          res.redirect(url.toString());
        } else {
          // Return JSON response
          res.json({
            token: result.data.token,
            user: {
              email: result.data.user.email,
              name: result.data.user.name,
              provider: result.data.user.provider
            }
          });
        }
      } catch (error) {
        logger.error('OAuth callback processing failed', { error });
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Failed to process authentication'
          }
        });
      }
    })(req, res, next);
  }
);

export { router as authRouter };