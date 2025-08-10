/**
 * Authentication middleware for WebPods
 */

import { Request, Response, NextFunction } from 'express';
import { verifyToken } from '../domain/auth.js';
import { JWTPayload } from '../types.js';
import { createLogger } from '../logger.js';
import { getIpAddress } from '../utils.js';

const logger = createLogger('webpods:auth');

// Extend Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    auth?: JWTPayload;
    ip_address?: string;
  }
}

/**
 * JWT authentication middleware
 */
export async function authenticate(
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Get token from cookie or Authorization header
    let token = (req as any).cookies?.token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7); // Remove 'Bearer ' prefix
      }
    }
    
    if (!token) {
      res.status(401).json({ 
        error: {
          code: 'UNAUTHORIZED',
          message: 'Token required but not provided'
        }
      });
      return;
    }
    
    // Verify JWT token
    const result = verifyToken(token);
    
    if (!result.success) {
      logger.warn('Invalid JWT token', { error: result.error });
      res.status(401).json({ 
        error: {
          code: 'UNAUTHORIZED',
          message: result.error.message
        }
      });
      return;
    }
    
    // Attach user info to request
    req.auth = result.data;
    req.ip_address = getIpAddress(req);
    
    logger.debug('User authenticated', { 
      userId: result.data.user_id,
      provider: result.data.provider,
      ip: req.ip_address
    });
    
    next();
  } catch (error) {
    logger.error('Authentication error', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
}

/**
 * Optional authentication middleware - doesn't require auth but extracts it if present
 */
export async function optionalAuth(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  try {
    req.ip_address = getIpAddress(req);
    
    // Get token from cookie or Authorization header
    let token = (req as any).cookies?.token;
    
    if (!token) {
      const authHeader = req.headers.authorization;
      if (authHeader && authHeader.startsWith('Bearer ')) {
        token = authHeader.substring(7);
      }
    }
    
    if (!token) {
      // No auth provided, continue without it
      next();
      return;
    }
    const result = verifyToken(token);
    
    if (result.success) {
      req.auth = result.data;
    }
    
    next();
  } catch (error) {
    logger.error('Optional auth error', { error });
    next();
  }
}