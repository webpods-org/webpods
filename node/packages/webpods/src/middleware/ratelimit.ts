/**
 * Rate limiting middleware
 */

import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../domain/ratelimit.js';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { getIpAddress } from '../utils.js';

const logger = createLogger('webpods:ratelimit');

/**
 * Rate limiting middleware factory
 */
export function rateLimit(action: 'read' | 'write' | 'pod_create' | 'stream_create') {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const db = getDb();
      
      // Use auth ID if authenticated, otherwise IP address
      const key = (req as any).auth ? (req as any).auth.auth_id : getIpAddress(req);
      
      const result = await checkRateLimit(db, key, action);
      
      if (!result.success) {
        logger.error('Rate limit check failed', { error: result.error });
        res.status(500).json({
          error: {
            code: 'INTERNAL_ERROR',
            message: 'Rate limit check failed'
          }
        });
        return;
      }
      
      // Set rate limit headers
      res.setHeader('X-RateLimit-Limit', LIMITS[action].toString());
      res.setHeader('X-RateLimit-Remaining', result.data.remaining.toString());
      res.setHeader('X-RateLimit-Reset', result.data.resetAt.toISOString());
      
      if (!result.data.allowed) {
        logger.warn('Rate limit exceeded', { key, action });
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests'
          }
        });
        return;
      }
      
      next();
    } catch (error) {
      logger.error('Rate limit middleware error', { error });
      // On error, allow the request to proceed
      next();
    }
  };
}

// Rate limit values (same as in domain/ratelimit.ts)
const LIMITS = {
  write: parseInt(process.env.RATE_LIMIT_WRITES || '1000'),
  read: parseInt(process.env.RATE_LIMIT_READS || '10000'),
  pod_create: parseInt(process.env.RATE_LIMIT_POD_CREATE || '10'),
  stream_create: parseInt(process.env.RATE_LIMIT_STREAM_CREATE || '100')
};