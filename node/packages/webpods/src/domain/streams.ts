/**
 * Stream operations domain logic
 */

import { Knex } from 'knex';
import { Stream, Result } from '../types.js';
import { isValidStreamId, isSystemStream } from '../utils.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:streams');

/**
 * Get or create a stream
 */
export async function getOrCreateStream(
  db: Knex,
  podId: string,
  streamId: string,
  userId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Stream>> {
  // Validate stream ID
  if (!isValidStreamId(streamId)) {
    return {
      success: false,
      error: {
        code: 'INVALID_STREAM_ID',
        message: 'Invalid stream ID'
      }
    };
  }

  // Determine stream type
  let streamType: 'normal' | 'system' | 'permission' = 'normal';
  let actualStreamId = streamId;
  
  if (streamId.startsWith('.meta/')) {
    streamType = 'system';
  }

  try {
    // Try to find existing stream
    let stream = await db('stream')
      .where('pod_id', podId)
      .where('stream_id', actualStreamId)
      .first();

    if (stream) {
      return { success: true, data: stream };
    }

    // Create new stream
    [stream] = await db('stream')
      .insert({
        id: crypto.randomUUID(),
        pod_id: podId,
        stream_id: actualStreamId,
        creator_id: userId,
        read_permission: readPermission || 'public',
        write_permission: writePermission || 'public',
        stream_type: streamType,
        created_at: new Date()
      })
      .returning('*');

    logger.info('Stream created', { podId, streamId: actualStreamId, userId });
    return { success: true, data: stream };
  } catch (error: any) {
    logger.error('Failed to get/create stream', { error, podId, streamId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get/create stream'
      }
    };
  }
}

/**
 * Get stream by pod and stream ID
 */
export async function getStream(
  db: Knex,
  podId: string,
  streamId: string
): Promise<Result<Stream>> {
  try {
    const stream = await db('stream')
      .where('pod_id', podId)
      .where('stream_id', streamId)
      .first();

    if (!stream) {
      return {
        success: false,
        error: {
          code: 'STREAM_NOT_FOUND',
          message: 'Stream not found'
        }
      };
    }

    return { success: true, data: stream };
  } catch (error: any) {
    logger.error('Failed to get stream', { error, podId, streamId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get stream'
      }
    };
  }
}

/**
 * Delete a stream
 */
export async function deleteStream(
  db: Knex,
  podId: string,
  streamId: string,
  userId: string
): Promise<Result<void>> {
  // Prevent deletion of system streams
  if (isSystemStream(streamId)) {
    return {
      success: false,
      error: {
        code: 'FORBIDDEN',
        message: 'System streams cannot be deleted'
      }
    };
  }

  try {
    const stream = await db('stream')
      .where('pod_id', podId)
      .where('stream_id', streamId)
      .first();

    if (!stream) {
      return {
        success: false,
        error: {
          code: 'STREAM_NOT_FOUND',
          message: 'Stream not found'
        }
      };
    }

    // Only creator can delete stream
    if (stream.creator_id !== userId) {
      return {
        success: false,
        error: {
          code: 'FORBIDDEN',
          message: 'Only stream creator can delete stream'
        }
      };
    }

    // Delete stream (cascades to records)
    await db('stream')
      .where('id', stream.id)
      .delete();

    logger.info('Stream deleted', { podId, streamId, userId });
    return { success: true, data: undefined };
  } catch (error: any) {
    logger.error('Failed to delete stream', { error, podId, streamId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to delete stream'
      }
    };
  }
}

/**
 * Update stream permissions
 */
export async function updateStreamPermissions(
  db: Knex,
  streamId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Stream>> {
  try {
    const updates: any = {};
    if (readPermission !== undefined) updates.read_permission = readPermission;
    if (writePermission !== undefined) updates.write_permission = writePermission;

    const [stream] = await db('stream')
      .where('id', streamId)
      .update(updates)
      .returning('*');

    if (!stream) {
      return {
        success: false,
        error: {
          code: 'STREAM_NOT_FOUND',
          message: 'Stream not found'
        }
      };
    }

    return { success: true, data: stream };
  } catch (error: any) {
    logger.error('Failed to update stream permissions', { error, streamId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to update stream permissions'
      }
    };
  }
}