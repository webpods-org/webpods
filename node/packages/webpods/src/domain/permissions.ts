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
export function parsePermission(permission: string): { type: 'allow' | 'deny' | 'direct', stream?: string } {
  if (permission === 'public' || permission === 'private') {
    return { type: 'direct' };
  }
  
  if (permission.startsWith('~/')) {
    return { type: 'deny', stream: permission.substring(2) };
  }
  
  if (permission.startsWith('/')) {
    return { type: 'allow', stream: permission.substring(1) };
  }
  
  return { type: 'direct' };
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
    // Get the latest permission record for this user
    const record = await db('record')
      .join('stream', 'stream.id', 'record.stream_id')
      .join('pod', 'pod.id', 'stream.pod_id')
      .where('pod.pod_id', podId)
      .where('stream.stream_id', streamId)
      // Don't require stream_type - any stream can hold permissions
      .whereRaw(`content->>'id' = ?`, [authId])
      .orderBy('record.created_at', 'desc')
      .select('record.*')
      .first();
    
    if (!record) {
      return false;
    }
    
    // Check if action is allowed
    const permissions = typeof record.content === 'string' 
      ? JSON.parse(record.content)
      : record.content;
    
    return permissions[action] === true;
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
  // Public read access
  if (stream.read_permission === 'public') {
    return true;
  }
  
  // Creator always has access (check by user_id)
  if (userId && userId === stream.creator_id) {
    return true;
  }
  
  // Private access - only creator
  if (stream.read_permission === 'private') {
    return userId === stream.creator_id;
  }
  
  // No auth means no access for non-public
  if (!authId) {
    return false;
  }
  
  // Parse permission
  const perm = parsePermission(stream.read_permission);
  
  if (perm.type === 'allow' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    return await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'read');
  }
  
  if (perm.type === 'deny' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    const denied = await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'read');
    return !denied;
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
  // Creator always has access (check by user_id)
  if (userId && userId === stream.creator_id) {
    return true;
  }
  
  // Public write access (authenticated users only)
  if (stream.write_permission === 'public') {
    return true;
  }
  
  // Private access - only creator
  if (stream.write_permission === 'private') {
    return userId === stream.creator_id;
  }
  
  // Parse permission
  const perm = parsePermission(stream.write_permission);
  
  if (perm.type === 'allow' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    return await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'write');
  }
  
  if (perm.type === 'deny' && perm.stream) {
    // Get pod for this stream
    const pod = await db('pod')
      .where('id', stream.pod_id)
      .first();
    
    if (!pod) return false;
    
    const denied = await checkPermissionStream(db, pod.pod_id, perm.stream, authId, 'write');
    return !denied;
  }
  
  return false;
}