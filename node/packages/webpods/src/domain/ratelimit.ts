/**
 * Rate limiting domain logic
 */

import { Knex } from 'knex';
import { Result } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:ratelimit');

export type RateLimitType = 'read' | 'write' | 'pod_create' | 'queue_create';

interface RateLimitConfig {
  read: number;
  write: number;
  pod_create: number;
  queue_create: number;
}

// Default rate limits (per hour)
const DEFAULT_LIMITS: RateLimitConfig = {
  read: parseInt(process.env.RATE_LIMIT_READS || '10000'),
  write: parseInt(process.env.RATE_LIMIT_WRITES || '1000'),
  pod_create: parseInt(process.env.RATE_LIMIT_POD_CREATE || '10'),
  queue_create: parseInt(process.env.RATE_LIMIT_QUEUE_CREATE || '100')
};

/**
 * Check if request is rate limited
 */
export async function checkRateLimit(
  db: Knex,
  identifier: string,
  type: RateLimitType
): Promise<Result<{ allowed: boolean, remaining: number, resetAt: Date }>> {
  const limit = DEFAULT_LIMITS[type];
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    // Get recent requests
    const recentRequests = await db('rate_limit')
      .where('identifier', identifier)
      .where('type', type)
      .where('created_at', '>=', windowStart)
      .count('* as count')
      .first();

    const count = parseInt(recentRequests?.count as string || '0');
    const remaining = Math.max(0, limit - count);
    const resetAt = new Date(windowStart.getTime() + windowMs);

    if (count >= limit) {
      return {
        success: true,
        data: {
          allowed: false,
          remaining: 0,
          resetAt
        }
      };
    }

    // Record this request
    await db('rate_limit')
      .insert({
        id: crypto.randomUUID(),
        identifier,
        type,
        created_at: now
      });

    // Clean old entries (older than 1 hour)
    await db('rate_limit')
      .where('created_at', '<', windowStart)
      .delete();

    return {
      success: true,
      data: {
        allowed: true,
        remaining: remaining - 1,
        resetAt
      }
    };
  } catch (error: any) {
    logger.error('Failed to check rate limit', { error, identifier, type });
    // Allow request on error to avoid blocking users
    return {
      success: true,
      data: {
        allowed: true,
        remaining: limit,
        resetAt: new Date(now.getTime() + windowMs)
      }
    };
  }
}

/**
 * Get rate limit status without incrementing
 */
export async function getRateLimitStatus(
  db: Knex,
  identifier: string,
  type: RateLimitType
): Promise<Result<{ limit: number, used: number, remaining: number, resetAt: Date }>> {
  const limit = DEFAULT_LIMITS[type];
  const windowMs = 60 * 60 * 1000; // 1 hour
  const now = new Date();
  const windowStart = new Date(now.getTime() - windowMs);

  try {
    const recentRequests = await db('rate_limit')
      .where('identifier', identifier)
      .where('type', type)
      .where('created_at', '>=', windowStart)
      .count('* as count')
      .first();

    const used = parseInt(recentRequests?.count as string || '0');
    const remaining = Math.max(0, limit - used);
    const resetAt = new Date(windowStart.getTime() + windowMs);

    return {
      success: true,
      data: {
        limit,
        used,
        remaining,
        resetAt
      }
    };
  } catch (error: any) {
    logger.error('Failed to get rate limit status', { error, identifier, type });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get rate limit status'
      }
    };
  }
}