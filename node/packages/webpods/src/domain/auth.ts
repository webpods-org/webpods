/**
 * Authentication domain logic
 */

import { Knex } from 'knex';
import jwt from 'jsonwebtoken';
import { User, Result, JWTPayload } from '../types.js';
import { createLogger } from '../logger.js';
import type { OAuthProvider } from '../auth/providers.js';

const logger = createLogger('webpods:domain:auth');

/**
 * Find or create user from OAuth profile
 */
export async function findOrCreateUser(
  db: Knex,
  provider: OAuthProvider,
  profile: any
): Promise<Result<User>> {
  const authId = `auth:${provider}:${profile.id}`;
  const email = profile.email || '';
  const name = profile.name || profile.username || email.split('@')[0];

  try {
    // Try to find existing user
    let user = await db('user')
      .where('auth_id', authId)
      .first();

    if (!user) {
      // Create new user
      [user] = await db('user')
        .insert({
          id: crypto.randomUUID(),
          auth_id: authId,
          email,
          name,
          provider,
          created_at: new Date()
        })
        .returning('*');
      
      logger.info('New user created', { authId, provider });
    } else {
      // Update user info if changed
      if (user.email !== email || user.name !== name) {
        [user] = await db('user')
          .where('id', user.id)
          .update({ email, name, updated_at: new Date() })
          .returning('*');
      }
    }

    return { success: true, data: user };
  } catch (error: any) {
    logger.error('Failed to find/create user', { error, authId });
    return {
      success: false,
      error: {
        code: 'AUTH_ERROR',
        message: 'Failed to authenticate user'
      }
    };
  }
}

/**
 * Generate JWT token for user
 */
export function generateToken(user: User): string {
  const payload: JWTPayload = {
    user_id: user.id,
    auth_id: user.auth_id,
    email: user.email,
    name: user.name,
    provider: user.provider
  };

  const secret = process.env.JWT_SECRET || 'dev-secret';
  const expiresIn = process.env.JWT_EXPIRY || '7d';
  
  return jwt.sign(payload, secret, { expiresIn: expiresIn as any });
}

/**
 * Verify JWT token
 */
export function verifyToken(token: string): Result<JWTPayload> {
  try {
    const secret = process.env.JWT_SECRET || 'dev-secret';
    const payload = jwt.verify(token, secret) as JWTPayload;
    return { success: true, data: payload };
  } catch {
    return {
      success: false,
      error: {
        code: 'INVALID_TOKEN',
        message: 'Invalid or expired token'
      }
    };
  }
}

/**
 * Get user by ID
 */
export async function getUserById(db: Knex, userId: string): Promise<Result<User>> {
  try {
    const user = await db('user')
      .where('id', userId)
      .first();

    if (!user) {
      return {
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      };
    }

    return { success: true, data: user };
  } catch (error: any) {
    logger.error('Failed to get user', { error, userId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get user'
      }
    };
  }
}