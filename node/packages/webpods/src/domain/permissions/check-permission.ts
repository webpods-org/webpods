// Check permissions for queue access
import { Knex } from 'knex';
import { Queue } from '../../types.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('webpods:permissions');

export async function checkReadPermission(
  db: Knex,
  userId: string | undefined,
  queue: Queue
): Promise<boolean> {
  // Public queues can be read by anyone
  if (queue.read_permission === 'public') {
    return true;
  }
  
  // Private queues can only be read by creator
  if (queue.read_permission === 'private') {
    return userId === queue.creator_id;
  }
  
  // No user ID means not authenticated
  if (!userId) {
    return false;
  }
  
  // Parse permission lists
  return checkPermissionLists(db, userId, queue.read_permission);
}

export async function checkWritePermission(
  db: Knex,
  userId: string,
  queue: Queue
): Promise<boolean> {
  // Public queues can be written by any authenticated user
  if (queue.write_permission === 'public') {
    return true;
  }
  
  // Private queues can only be written by creator
  if (queue.write_permission === 'private') {
    return userId === queue.creator_id;
  }
  
  // Parse permission lists
  return checkPermissionLists(db, userId, queue.write_permission);
}

async function checkPermissionLists(
  db: Knex,
  userId: string,
  permission: string
): Promise<boolean> {
  // Permission format: "/allowed-queue,~/denied-queue"
  const parts = permission.split(',');
  
  for (const part of parts) {
    const trimmed = part.trim();
    
    if (trimmed.startsWith('~/')) {
      // Deny list
      const denyQueueId = trimmed.substring(2);
      const isDenied = await checkUserInQueue(db, userId, denyQueueId, false);
      if (isDenied) {
        return false; // User is in deny list
      }
    } else if (trimmed.startsWith('/')) {
      // Allow list
      const allowQueueId = trimmed.substring(1);
      const isAllowed = await checkUserInQueue(db, userId, allowQueueId, true);
      if (!isAllowed) {
        return false; // User is not in allow list
      }
    }
  }
  
  return true;
}

async function checkUserInQueue(
  db: Knex,
  userId: string,
  queueId: string,
  checkForPresence: boolean
): Promise<boolean> {
  try {
    // Get the permission queue
    const queue = await db('queue')
      .where('q_id', queueId)
      .first();
    
    if (!queue) {
      // Queue doesn't exist, treat as no permission
      return !checkForPresence;
    }
    
    // Get user record from the auth_id
    const user = await db('`user`')
      .where('id', userId)
      .first();
    
    if (!user) {
      return !checkForPresence;
    }
    
    // Get the last record for this user's auth_id in the permission queue
    const lastRecord = await db('record')
      .where('queue_id', queue.id)
      .whereRaw("content->>'id' = ?", [user.auth_id])
      .orderBy('sequence_num', 'desc')
      .first();
    
    if (!lastRecord) {
      // No record found
      return !checkForPresence;
    }
    
    // Check the permission based on the field we're checking
    const hasPermission = checkForPresence 
      ? lastRecord.content.read === true || lastRecord.content.write === true
      : lastRecord.content.read === false && lastRecord.content.write === false;
    
    return hasPermission;
  } catch (error) {
    logger.error('Failed to check user in queue', { error, userId, queueId });
    return false;
  }
}