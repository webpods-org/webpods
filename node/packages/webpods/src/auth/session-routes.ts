/**
 * Session management routes
 */

import { Router, Request, Response } from 'express';
import { createLogger } from '../logger.js';
import { authenticate } from '../middleware/auth.js';
import { 
  getUserSessions, 
  revokeSession, 
  revokeUserSessions 
} from './session-store.js';

const logger = createLogger('webpods:auth:sessions');
const router = Router();

/**
 * Get current session info
 * GET /auth/session
 */
router.get('/session', (req: Request, res: Response) => {
  const session = (req as any).session;
  
  if (!session || !session.user) {
    res.status(401).json({
      error: {
        code: 'NO_SESSION',
        message: 'No active session'
      }
    });
    return;
  }
  
  res.json({
    user: session.user,
    sessionId: session.id,
    createdAt: new Date(session.cookie.originalMaxAge ? 
      Date.now() - (session.cookie.maxAge - session.cookie.originalMaxAge) : 
      Date.now()),
    expiresAt: session.cookie.expires || 
      new Date(Date.now() + session.cookie.maxAge)
  });
});

/**
 * List all active sessions for the authenticated user
 * GET /auth/sessions
 */
router.get('/sessions', authenticate, async (req: Request, res: Response) => {
  if (!req.auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }
  
  try {
    const sessions = await getUserSessions(req.auth!.user_id);
    
    res.json({
      sessions,
      count: sessions.length
    });
  } catch (error: any) {
    logger.error('Failed to list sessions', { error, userId: req.auth!.user_id });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to retrieve sessions'
      }
    });
  }
});

/**
 * Revoke a specific session
 * DELETE /auth/sessions/:sessionId
 */
router.delete('/sessions/:sessionId', authenticate, async (req: Request, res: Response) => {
  if (!req.auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }
  
  const sessionId = req.params.sessionId;
  
  if (!sessionId) {
    res.status(400).json({
      error: {
        code: 'INVALID_REQUEST',
        message: 'Session ID is required'
      }
    });
    return;
  }
  
  try {
    // Verify the session belongs to the user
    const sessions = await getUserSessions(req.auth!.user_id);
    const session = sessions.find(s => s.id === sessionId);
    
    if (!session) {
      res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found or does not belong to user'
        }
      });
      return;
    }
    
    const revoked = await revokeSession(sessionId);
    
    if (revoked) {
      logger.info('Session revoked', { sessionId, userId: req.auth!.user_id });
      res.json({
        success: true,
        message: 'Session revoked successfully'
      });
    } else {
      res.status(404).json({
        error: {
          code: 'SESSION_NOT_FOUND',
          message: 'Session not found'
        }
      });
    }
  } catch (error: any) {
    logger.error('Failed to revoke session', { error, sessionId, userId: req.auth!.user_id });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to revoke session'
      }
    });
  }
});

/**
 * Revoke all sessions for the authenticated user
 * DELETE /auth/sessions
 */
router.delete('/sessions', authenticate, async (req: Request, res: Response) => {
  if (!req.auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }
  
  try {
    const count = await revokeUserSessions(req.auth!.user_id);
    
    logger.info('All sessions revoked', { userId: req.auth!.user_id, count });
    
    res.json({
      success: true,
      message: `Revoked ${count} session(s)`,
      count
    });
  } catch (error: any) {
    logger.error('Failed to revoke all sessions', { error, userId: req.auth!.user_id });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to revoke sessions'
      }
    });
  }
});

/**
 * Logout current session
 * POST /auth/logout
 */
router.post('/logout', (req: Request, res: Response) => {
  const session = (req as any).session;
  
  if (!session) {
    res.json({
      success: true,
      message: 'No active session'
    });
    return;
  }
  
  session.destroy((err: any) => {
    if (err) {
      logger.error('Failed to destroy session', { 
        error: err?.message || err,
        sessionId: session?.id 
      });
      // Even if destroy fails, clear the cookie
      res.clearCookie('webpods.sid');
      res.status(500).json({
        error: {
          code: 'LOGOUT_ERROR',
          message: 'Failed to logout completely'
        }
      });
    } else {
      res.clearCookie('webpods.sid');
      res.json({
        success: true,
        message: 'Logged out successfully'
      });
    }
  });
});

/**
 * Logout current session (GET for browser convenience)
 * GET /auth/logout
 */
router.get('/logout', (req: Request, res: Response) => {
  const session = (req as any).session;
  const redirect = req.query.redirect as string || '/';
  
  if (!session) {
    res.redirect(redirect);
    return;
  }
  
  session.destroy((err: any) => {
    if (err) {
      logger.error('Failed to destroy session', { 
        error: err?.message || err,
        sessionId: session?.id 
      });
    }
    res.clearCookie('webpods.sid');
    res.redirect(redirect);
  });
});

export default router;