// Create or update queue
import { Knex } from 'knex';
import { Result, success, failure, Queue } from '../../types.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('webpods:domain:queue');

export async function createOrUpdateQueue(
  db: Knex,
  userId: string,
  qId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Queue>> {
  try {
    // Check if queue already exists
    const existing = await db('queue')
      .where('q_id', qId)
      .first();
    
    if (existing) {
      // Check if user is the creator
      if (existing.creator_id !== userId) {
        return failure({
          message: 'Only the queue creator can update permissions',
          code: 'FORBIDDEN'
        });
      }
      
      // Update permissions if provided
      if (readPermission !== undefined || writePermission !== undefined) {
        const updates: any = {
          updated_at: new Date()
        };
        
        if (readPermission !== undefined) {
          updates.read_permission = readPermission;
        }
        if (writePermission !== undefined) {
          updates.write_permission = writePermission;
        }
        
        const [updated] = await db('queue')
          .where('id', existing.id)
          .update(updates)
          .returning('*');
        
        logger.info('Queue permissions updated', { 
          qId, 
          readPermission: updated.read_permission,
          writePermission: updated.write_permission 
        });
        
        return success(updated);
      }
      
      return success(existing);
    }
    
    // Create new queue
    const [queue] = await db('queue')
      .insert({
        q_id: qId,
        creator_id: userId,
        read_permission: readPermission || 'public',
        write_permission: writePermission || 'public',
        created_at: new Date(),
        updated_at: new Date()
      })
      .returning('*');
    
    logger.info('Queue created', { qId, userId });
    
    return success(queue);
  } catch (error: any) {
    logger.error('Failed to create/update queue', { error, qId });
    return failure({
      message: 'Failed to create or update queue',
      code: 'INTERNAL_ERROR'
    });
  }
}