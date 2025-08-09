// Rate limiting using PostgreSQL
import { Knex } from 'knex';
import { createLogger } from '../../logger.js';

const logger = createLogger('webpods:rate-limit');

const RATE_LIMITS = {
  write: {
    limit: parseInt(process.env.RATE_LIMIT_WRITES || '2000'),
    windowMs: 60 * 60 * 1000 // 1 hour
  },
  read: {
    limit: parseInt(process.env.RATE_LIMIT_READS || '10000'),
    windowMs: 60 * 60 * 1000 // 1 hour
  }
};

export async function checkRateLimit(
  db: Knex,
  userId: string,
  action: 'read' | 'write'
): Promise<{ allowed: boolean; remaining: number; resetAt: Date }> {
  const now = new Date();
  const windowStart = new Date(now.getTime() - RATE_LIMITS[action].windowMs);
  
  const trx = await db.transaction();
  
  try {
    // Clean up old rate limit entries
    await trx('rate_limit')
      .where('window_end', '<', windowStart)
      .delete();
    
    // Get current window record
    let rateLimit = await trx('rate_limit')
      .where('user_id', userId)
      .where('action', action)
      .where('window_end', '>', now)
      .first();
    
    if (!rateLimit) {
      // Create new window
      [rateLimit] = await trx('rate_limit')
        .insert({
          user_id: userId,
          action: action,
          count: 1,
          window_start: now,
          window_end: new Date(now.getTime() + RATE_LIMITS[action].windowMs)
        })
        .returning('*');
      
      await trx.commit();
      
      return {
        allowed: true,
        remaining: RATE_LIMITS[action].limit - 1,
        resetAt: rateLimit.window_end
      };
    }
    
    // Check if limit exceeded
    if (rateLimit.count >= RATE_LIMITS[action].limit) {
      await trx.rollback();
      
      logger.warn('Rate limit exceeded', { 
        userId, 
        action, 
        count: rateLimit.count,
        limit: RATE_LIMITS[action].limit
      });
      
      return {
        allowed: false,
        remaining: 0,
        resetAt: rateLimit.window_end
      };
    }
    
    // Increment counter
    await trx('rate_limit')
      .where('id', rateLimit.id)
      .increment('count', 1);
    
    await trx.commit();
    
    return {
      allowed: true,
      remaining: RATE_LIMITS[action].limit - (rateLimit.count + 1),
      resetAt: rateLimit.window_end
    };
  } catch (error) {
    await trx.rollback();
    logger.error('Rate limit check failed', { error, userId, action });
    
    // On error, allow the request but log it
    return {
      allowed: true,
      remaining: -1,
      resetAt: new Date()
    };
  }
}