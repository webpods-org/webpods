/**
 * Pod operations domain logic
 */

import { Knex } from 'knex';
import { Pod, Stream, Result } from '../types.js';
import { isValidPodId, calculateRecordHash } from '../utils.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:pods');

/**
 * Create a new pod
 */
export async function createPod(
  db: Knex,
  userId: string,
  podId: string
): Promise<Result<Pod>> {
  // Validate pod ID
  if (!isValidPodId(podId)) {
    return {
      success: false,
      error: {
        code: 'INVALID_POD_ID',
        message: 'Pod ID must be lowercase alphanumeric with hyphens'
      }
    };
  }

  return await db.transaction(async (trx) => {
    try {
      // Check if pod already exists
      const existing = await trx('pod')
        .where('pod_id', podId)
        .first();
      
      if (existing) {
        return {
          success: false,
          error: {
            code: 'POD_EXISTS',
            message: 'Pod already exists'
          }
        };
      }

      // Create pod
      const [pod] = await trx('pod')
        .insert({
          id: crypto.randomUUID(),
          pod_id: podId,
          created_at: new Date()
        })
        .returning('*');

      // Create .meta/owner stream with initial owner record
      const [ownerStream] = await trx('stream')
        .insert({
          id: crypto.randomUUID(),
          pod_id: pod.id,
          stream_id: '.meta/owner',
          creator_id: userId,
          read_permission: 'public',
          write_permission: 'private',
          stream_type: 'system',
          created_at: new Date()
        })
        .returning('*');

      // Write initial owner record
      const ownerContent = { owner: userId };
      const timestamp = new Date().toISOString();
      const hash = calculateRecordHash(null, timestamp, ownerContent);
      
      await trx('record')
        .insert({
          stream_id: ownerStream.id,
          sequence_num: 0,
          content: JSON.stringify(ownerContent),
          content_type: 'application/json',
          hash: hash,
          previous_hash: null,
          author_id: userId,
          created_at: timestamp
        });

      logger.info('Pod created', { podId, userId });
      return { success: true, data: pod };
    } catch (error: any) {
      logger.error('Failed to create pod', { error, podId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to create pod'
        }
      };
    }
  });
}

/**
 * Get pod by ID
 */
export async function getPod(
  db: Knex,
  podId: string
): Promise<Result<Pod>> {
  try {
    const pod = await db('pod')
      .where('pod_id', podId)
      .first();

    if (!pod) {
      return {
        success: false,
        error: {
          code: 'POD_NOT_FOUND',
          message: 'Pod not found'
        }
      };
    }

    return { success: true, data: pod };
  } catch (error: any) {
    logger.error('Failed to get pod', { error, podId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get pod'
      }
    };
  }
}

/**
 * Get pod owner from .meta/owner stream
 */
export async function getPodOwner(
  db: Knex,
  podId: string
): Promise<Result<string>> {
  try {
    const record = await db('record')
      .join('stream', 'stream.id', 'record.stream_id')
      .join('pod', 'pod.id', 'stream.pod_id')
      .where('pod.pod_id', podId)
      .where('stream.stream_id', '.meta/owner')
      .orderBy('record.created_at', 'desc')
      .select('record.*')
      .first();

    if (!record) {
      return {
        success: false,
        error: {
          code: 'OWNER_NOT_FOUND',
          message: 'Pod owner not found'
        }
      };
    }

    const content = typeof record.content === 'string' 
      ? JSON.parse(record.content)
      : record.content;

    return { success: true, data: content.owner };
  } catch (error: any) {
    logger.error('Failed to get pod owner', { error, podId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get pod owner'
      }
    };
  }
}

/**
 * Transfer pod ownership
 */
export async function transferPodOwnership(
  db: Knex,
  podId: string,
  currentUserId: string,
  newOwnerId: string
): Promise<Result<void>> {
  return await db.transaction(async (trx) => {
    try {
      // Check current ownership
      const ownerResult = await getPodOwner(trx, podId);
      if (!ownerResult.success || ownerResult.data !== currentUserId) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only pod owner can transfer ownership'
          }
        };
      }

      // Get .meta/owner stream
      const ownerStream = await trx('stream')
        .join('pod', 'pod.id', 'stream.pod_id')
        .where('pod.pod_id', podId)
        .where('stream.stream_id', '.meta/owner')
        .select('stream.*')
        .first();

      if (!ownerStream) {
        return {
          success: false,
          error: {
            code: 'STREAM_NOT_FOUND',
            message: '.meta/owner stream not found'
          }
        };
      }

      // Get last record for hash chain
      const lastRecord = await trx('record')
        .where('stream_id', ownerStream.id)
        .orderBy('sequence_num', 'desc')
        .first();

      // Write new owner record
      const ownerContent = { owner: newOwnerId };
      const timestamp = new Date().toISOString();
      const hash = calculateRecordHash(lastRecord?.hash || null, timestamp, ownerContent);
      
      await trx('record')
        .insert({
          stream_id: ownerStream.id,
          sequence_num: (lastRecord?.sequence_num || 0) + 1,
          content: JSON.stringify(ownerContent),
          content_type: 'application/json',
          hash: hash,
          previous_hash: lastRecord?.hash || null,
          author_id: currentUserId,
          created_at: timestamp
        });

      logger.info('Pod ownership transferred', { podId, from: currentUserId, to: newOwnerId });
      return { success: true, data: undefined };
    } catch (error: any) {
      logger.error('Failed to transfer pod ownership', { error, podId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to transfer ownership'
        }
      };
    }
  });
}

/**
 * Delete pod and all its streams
 */
export async function deletePod(
  db: Knex,
  podId: string,
  userId: string
): Promise<Result<void>> {
  return await db.transaction(async (trx) => {
    try {
      // Check ownership
      const ownerResult = await getPodOwner(trx, podId);
      if (!ownerResult.success || ownerResult.data !== userId) {
        return {
          success: false,
          error: {
            code: 'FORBIDDEN',
            message: 'Only pod owner can delete pod'
          }
        };
      }

      // Get pod
      const pod = await trx('pod')
        .where('pod_id', podId)
        .first();

      if (!pod) {
        return {
          success: false,
          error: {
            code: 'POD_NOT_FOUND',
            message: 'Pod not found'
          }
        };
      }

      // Delete pod (cascades to streams and records)
      await trx('pod')
        .where('id', pod.id)
        .delete();

      // Delete custom domains
      await trx('custom_domain')
        .where('pod_id', pod.id)
        .delete();

      logger.info('Pod deleted', { podId, userId });
      return { success: true, data: undefined };
    } catch (error: any) {
      logger.error('Failed to delete pod', { error, podId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to delete pod'
        }
      };
    }
  });
}

/**
 * List all streams in a pod
 */
export async function listPodStreams(
  db: Knex,
  podId: string
): Promise<Result<Stream[]>> {
  try {
    const pod = await db('pod')
      .where('pod_id', podId)
      .first();

    if (!pod) {
      return {
        success: false,
        error: {
          code: 'POD_NOT_FOUND',
          message: 'Pod not found'
        }
      };
    }

    const streams = await db('stream')
      .where('pod_id', pod.id)
      .orderBy('created_at', 'asc');

    return { success: true, data: streams };
  } catch (error: any) {
    logger.error('Failed to list pod streams', { error, podId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to list streams'
      }
    };
  }
}