// OAuth callback handler
import { Knex } from 'knex';
import jwt from 'jsonwebtoken';
import { Result, success, failure, User } from '../../types.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('webpods:auth:oauth');

export interface OAuthProfile {
  id: string;
  email?: string;
  name?: string;
  provider: string;
}

export async function handleOAuthCallback(
  db: Knex,
  profile: OAuthProfile
): Promise<Result<{ token: string; user: User }>> {
  try {
    const authId = `auth:${profile.provider}:${profile.id}`;
    
    // Check if user exists
    let user = await db('`user`')
      .where('auth_id', authId)
      .first();
    
    if (!user) {
      // Create new user
      [user] = await db('`user`')
        .insert({
          auth_id: authId,
          email: profile.email,
          name: profile.name,
          provider: profile.provider,
          metadata: {},
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');
      
      logger.info('New user created via OAuth', { 
        authId, 
        provider: profile.provider 
      });
    } else {
      // Update user info if changed
      if (profile.email !== user.email || profile.name !== user.name) {
        [user] = await db('`user`')
          .where('id', user.id)
          .update({
            email: profile.email,
            name: profile.name,
            updated_at: new Date()
          })
          .returning('*');
        
        logger.info('User info updated via OAuth', { authId });
      }
    }
    
    // Generate JWT token
    const jwtSecret = process.env.JWT_SECRET;
    if (!jwtSecret) {
      return failure({
        message: 'JWT secret not configured',
        code: 'INTERNAL_ERROR'
      });
    }
    
    const token = jwt.sign(
      {
        userId: user.id,
        authId: user.auth_id,
        email: user.email,
        name: user.name,
        provider: user.provider
      },
      jwtSecret,
      {
        expiresIn: '30d'
      }
    );
    
    return success({ token, user });
  } catch (error: any) {
    logger.error('OAuth callback failed', { error });
    return failure({
      message: 'Failed to process OAuth callback',
      code: 'INTERNAL_ERROR'
    });
  }
}