/**
 * Permission checking domain logic
 */

import { Knex } from 'knex';
import { Queue } from '../types.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:permissions');

/**
 * Parse permission string into components
 */
export function parsePermission(permission: string): { type: 'allow' | 'deny' | 'direct', queue?: string } {
  if (permission === 'public' || permission === 'private') {
    return { type: 'direct' };
  }
  
  if (permission.startsWith('~/')) {
    return { type: 'deny', queue: permission.substring(2) };
  }
  
  if (permission.startsWith('/')) {
    return { type: 'allow', queue: permission.substring(1) };
  }
  
  return { type: 'direct' };
}

/**
 * Check if user exists in permission queue
 */
async function checkPermissionQueue(
  db: Knex,
  podId: string,
  queueId: string,
  authId: string,
  action: 'read' | 'write'
): Promise<boolean> {
  try {
    // Get the latest permission record for this user
    const record = await db('record')
      .join('queue', 'queue.id', 'record.queue_id')
      .join('pod', 'pod.id', 'queue.pod_id')
      .where('pod.pod_id', podId)
      .where('queue.queue_id', queueId)
      .where('queue.queue_type', 'permission')
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
    logger.error('Failed to check permission queue', { error, podId, queueId, authId });
    return false;
  }
}

/**
 * Check if user can read from queue
 */
export async function canRead(
  db: Knex,
  queue: Queue,
  authId: string | null
): Promise<boolean> {
  // Public read access
  if (queue.read_permission === 'public') {
    return true;
  }
  
  // Private access - only creator
  if (queue.read_permission === 'private') {
    return authId === queue.creator_id;
  }
  
  // No auth means no access for non-public
  if (!authId) {
    return false;
  }
  
  // Parse permission
  const perm = parsePermission(queue.read_permission);
  
  if (perm.type === 'allow' && perm.queue) {
    // Get pod for this queue
    const pod = await db('pod')
      .where('id', queue.pod_id)
      .first();
    
    if (!pod) return false;
    
    return await checkPermissionQueue(db, pod.pod_id, perm.queue, authId, 'read');
  }
  
  if (perm.type === 'deny' && perm.queue) {
    // Get pod for this queue
    const pod = await db('pod')
      .where('id', queue.pod_id)
      .first();
    
    if (!pod) return false;
    
    const denied = await checkPermissionQueue(db, pod.pod_id, perm.queue, authId, 'read');
    return !denied;
  }
  
  return false;
}

/**
 * Check if user can write to queue
 */
export async function canWrite(
  db: Knex,
  queue: Queue,
  authId: string
): Promise<boolean> {
  // Public write access (authenticated users only)
  if (queue.write_permission === 'public') {
    return true;
  }
  
  // Private access - only creator
  if (queue.write_permission === 'private') {
    return authId === queue.creator_id;
  }
  
  // Parse permission
  const perm = parsePermission(queue.write_permission);
  
  if (perm.type === 'allow' && perm.queue) {
    // Get pod for this queue
    const pod = await db('pod')
      .where('id', queue.pod_id)
      .first();
    
    if (!pod) return false;
    
    return await checkPermissionQueue(db, pod.pod_id, perm.queue, authId, 'write');
  }
  
  if (perm.type === 'deny' && perm.queue) {
    // Get pod for this queue
    const pod = await db('pod')
      .where('id', queue.pod_id)
      .first();
    
    if (!pod) return false;
    
    const denied = await checkPermissionQueue(db, pod.pod_id, perm.queue, authId, 'write');
    return !denied;
  }
  
  return false;
}