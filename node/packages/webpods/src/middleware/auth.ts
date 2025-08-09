// Authentication middleware for WebPods
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:auth');

// Extend Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    auth?: {
      userId: string;
      authId: string;
    };
  }
}

interface JwtPayload {
  userId: string;
  authId: string;
  email?: string;
  name?: string;
  provider: string;
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
    // Get token from Authorization header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ 
        error: {
          code: 'UNAUTHORIZED',
          message: 'Missing or invalid authorization header'
        }
      });
      return;
    }
    
    const token = authHeader.substring(7); // Remove 'Bearer ' prefix
    
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
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      logger.error('JWT_SECRET not configured');
      res.status(500).json({ 
        error: {
          code: 'INTERNAL_ERROR',
          message: 'Authentication not properly configured'
        }
      });
      return;
    }
    
    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      
      // Attach user info to request
      req.auth = {
        userId: decoded.userId,
        authId: decoded.authId
      };
      
      logger.debug('User authenticated', { 
        userId: decoded.userId,
        provider: decoded.provider,
        ip: req.ip || req.socket.remoteAddress
      });
      
      next();
    } catch (jwtError) {
      logger.warn('Invalid JWT token', { error: jwtError });
      res.status(401).json({ 
        error: {
          code: 'UNAUTHORIZED',
          message: 'Invalid or expired token'
        }
      });
      return;
    }
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
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      // No auth provided, continue without it
      next();
      return;
    }
    
    const token = authHeader.substring(7);
    const jwtSecret = process.env.JWT_SECRET;
    
    if (!jwtSecret) {
      // Auth not configured, continue without it
      next();
      return;
    }
    
    try {
      const decoded = jwt.verify(token, jwtSecret) as JwtPayload;
      req.auth = {
        userId: decoded.userId,
        authId: decoded.authId
      };
    } catch {
      // Invalid token, continue without auth
    }
    
    next();
  } catch (error) {
    logger.error('Optional auth error', { error });
    next();
  }
}