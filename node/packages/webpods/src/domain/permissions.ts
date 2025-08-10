/**
 * Permission checking domain logic
 */

import { Knex } from 'knex';
import { Stream } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:permissions');

/**
 * Parse permission string into components
 */
export function parsePermission(permission: string): { type: 'basic' | 'stream', stream?: string } {
  if (permission === 'public' || permission === 'private') {
    return { type: 'basic' };
  }
  
  if (permission.startsWith('/')) {
    return { type: 'stream', stream: permission.substring(1) };
  }
  
  return { type: 'basic' };
}


/**
 * Check if user exists in permission stream
 */
async function checkPermissionStream(
  db: Knex,
  podId: string,
  streamId: string,
  authId: string,
  action: 'read' | 'write'
): Promise<boolean> {
  try {
    logger.debug('Checking permission stream', { podId, streamId, authId, action });
    
    // First check if the stream exists
    const stream = await db('stream')
      .join('pod', 'pod.id', 'stream.pod_id')
      .where('pod.pod_id', podId)
      .where('stream.stream_id', streamId)
      .select('stream.*')
      .first();
    
    if (!stream) {
      logger.warn('Permission stream not found', { podId, streamId });
      return false;
    }
    
    logger.info('Permission stream found', { 
      streamId: stream.stream_id, 
      streamType: stream.stream_type,
      id: stream.id 
    });
    
    // Get the latest permission record for this user
    // Note: content is stored as text, need to cast to jsonb for querying
    const record = await db('record')
      .where('stream_id', stream.id)
      .whereRaw(`content::jsonb->>'id' = ?`, [authId])
      .orderBy('created_at', 'desc')
      .select('*')
      .first();
    
    logger.info('Permission record query result', { 
      found: !!record, 
      authId, 
      streamId,
      recordContent: record?.content 
    });
    
    if (!record) {
      return false;
    }
    
    // Check if action is allowed
    const permissions = typeof record.content === 'string' 
      ? JSON.parse(record.content)
      : record.content;
    
    const allowed = permissions[action] === true;
    logger.debug('Permission check result', { authId, action, allowed, permissions });
    
    return allowed;
  } catch (error) {
    logger.error('Failed to check permission stream', { error, podId, streamId, authId });
    return false;
  }
}

/**
 * Check if user can read from stream
 */
export async function canRead(
  db: Knex,
  stream: Stream,
  authId: string | null,
  userId?: string | null
): Promise<boolean> {
  logger.info('canRead check', { 
    streamId: stream.stream_id, 
    accessPermission: stream.access_permission,
    authId,
    userId,
    creatorId: stream.creator_id
  });
  
  // Creator always has access
  if (userId && userId === stream.creator_id) {
    return true;
  }
  
  // Public read access - anyone can read
  if (stream.access_permission === 'public') {
    return true;
  }
  
  // Private access - only creator
  if (stream.access_permission === 'private') {
    return userId === stream.creator_id;
  }
  
  // No auth means no access for non-public
  if (!authId) {
    return false;
  }
  
  // Parse permission
  const perm = parsePermission(stream.access_permission);
  logger.debug('Parsed permission', { perm, accessPermission: stream.access_permission });
  
  if (perm.type === 'stream' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    // Check if user has read permission in the permission stream
    return await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'read');
  }
  
  return false;
}

/**
 * Check if user can write to stream
 */
export async function canWrite(
  db: Knex,
  stream: Stream,
  authId: string,
  userId?: string | null
): Promise<boolean> {
  // Creator always has access
  if (userId && userId === stream.creator_id) {
    return true;
  }
  
  // Public write access - authenticated users can write
  if (stream.access_permission === 'public') {
    return true;
  }
  
  // Private access - only creator
  if (stream.access_permission === 'private') {
    return userId === stream.creator_id;
  }
  
  // Parse permission
  const perm = parsePermission(stream.access_permission);
  
  if (perm.type === 'stream' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    // Check if user has write permission in the permission stream
    return await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'write');
  }
  
  return false;
}