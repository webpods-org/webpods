/**
 * Queue operations domain logic
 */

import { Knex } from 'knex';
import { Queue, Result } from '../types.js';
import { isValidQueueId, isSystemQueue } from '../utils.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:queues');

/**
 * Get or create a queue
 */
export async function getOrCreateQueue(
  db: Knex,
  podId: string,
  queueId: string,
  userId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Queue>> {
  // Validate queue ID
  if (!isValidQueueId(queueId)) {
    return {
      success: false,
      error: {
        code: 'INVALID_QUEUE_ID',
        message: 'Invalid queue ID'
      }
    };
  }

  // Determine queue type
  let queueType: 'normal' | 'system' | 'permission' = 'normal';
  let actualQueueId = queueId;
  
  if (queueId.startsWith('_')) {
    queueType = 'system';
  } else if (queueId.startsWith('/') || queueId.startsWith('~/')) {
    queueType = 'permission';
    actualQueueId = queueId.startsWith('~/') ? queueId.substring(2) : queueId.substring(1);
  }

  try {
    // Try to find existing queue
    let queue = await db('queue')
      .where('pod_id', podId)
      .where('queue_id', actualQueueId)
      .first();

    if (queue) {
      return { success: true, data: queue };
    }

    // Create new queue
    [queue] = await db('queue')
      .insert({
        id: crypto.randomUUID(),
        pod_id: podId,
        queue_id: actualQueueId,
        creator_id: userId,
        read_permission: readPermission || 'public',
        write_permission: writePermission || 'public',
        queue_type: queueType,
        created_at: new Date()
      })
      .returning('*');

    logger.info('Queue created', { podId, queueId: actualQueueId, userId });
    return { success: true, data: queue };
  } catch (error: any) {
    logger.error('Failed to get/create queue', { error, podId, queueId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get/create queue'
      }
    };
  }
}

/**
 * Get queue by pod and queue ID
 */
export async function getQueue(
  db: Knex,
  podId: string,
  queueId: string
): Promise<Result<Queue>> {
  try {
    const queue = await db('queue')
      .where('pod_id', podId)
      .where('queue_id', queueId)
      .first();

    if (!queue) {
      return {
        success: false,
        error: {
          code: 'QUEUE_NOT_FOUND',
          message: 'Queue not found'
        }
      };
    }

    return { success: true, data: queue };
  } catch (error: any) {
    logger.error('Failed to get queue', { error, podId, queueId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get queue'
      }
    };
  }
}

/**
 * Delete a queue
 */
export async function deleteQueue(
  db: Knex,
  podId: string,
  queueId: string,
  userId: string
): Promise<Result<void>> {
  // Prevent deletion of system queues
  if (isSystemQueue(queueId)) {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'System queues cannot be deleted'
      }
    };
  }

  try {
    const queue = await db('queue')
      .where('pod_id', podId)
      .where('queue_id', queueId)
      .first();

    if (!queue) {
      return {
        success: false,
        error: {
          code: 'QUEUE_NOT_FOUND',
          message: 'Queue not found'
        }
      };
    }

    // Only creator can delete queue
    if (queue.creator_id !== userId) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only queue creator can delete queue'
        }
      };
    }

    // Delete queue (cascades to records)
    await db('queue')
      .where('id', queue.id)
      .delete();

    logger.info('Queue deleted', { podId, queueId, userId });
    return { success: true, data: undefined };
  } catch (error: any) {
    logger.error('Failed to delete queue', { error, podId, queueId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to delete queue'
      }
    };
  }
}

/**
 * Update queue permissions
 */
export async function updateQueuePermissions(
  db: Knex,
  queueId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Queue>> {
  try {
    const updates: any = {};
    if (readPermission !== undefined) updates.read_permission = readPermission;
    if (writePermission !== undefined) updates.write_permission = writePermission;

    const [queue] = await db('queue')
      .where('id', queueId)
      .update(updates)
      .returning('*');

    if (!queue) {
      return {
        success: false,
        error: {
          code: 'QUEUE_NOT_FOUND',
          message: 'Queue not found'
        }
      };
    }

    return { success: true, data: queue };
  } catch (error: any) {
    logger.error('Failed to update queue permissions', { error, queueId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to update queue permissions'
      }
    };
  }
}