// Write record to queue
import { Knex } from 'knex';
import { Result, success, failure, QueueRecord } from '../../types.js';
import { createLogger } from '../../logger.js';
import { checkWritePermission } from '../permissions/check-permission.js';

const logger = createLogger('webpods:domain:write');

export async function writeRecord(
  db: Knex,
  userId: string,
  qId: string,
  content: any,
  contentType?: string,
  metadata?: Record<string, any>
): Promise<Result<QueueRecord>> {
  const trx = await db.transaction();
  
  try {
    // Get or create queue
    let queue = await trx('queue')
      .where('q_id', qId)
      .first();
    
    if (!queue) {
      // Create new queue with default permissions
      [queue] = await trx('queue')
        .insert({
          q_id: qId,
          creator_id: userId,
          read_permission: 'public',
          write_permission: 'public',
          created_at: new Date(),
          updated_at: new Date()
        })
        .returning('*');
      
      logger.info('Queue created on first write', { qId, userId });
    }
    
    // Check write permissions
    const hasPermission = await checkWritePermission(trx, userId, queue);
    if (!hasPermission) {
      await trx.rollback();
      return failure({
        message: 'You do not have permission to write to this queue',
        code: 'FORBIDDEN'
      });
    }
    
    // Get next sequence number
    const lastRecord = await trx('record')
      .where('queue_id', queue.id)
      .orderBy('sequence_num', 'desc')
      .first();
    
    const nextSeq = lastRecord ? lastRecord.sequence_num + 1 : 1;
    
    // Detect content type if not provided
    let detectedContentType = contentType;
    if (!detectedContentType) {
      detectedContentType = typeof content === 'string' 
        ? 'text/plain' 
        : 'application/json';
    }
    
    // Insert new record
    const [record] = await trx('record')
      .insert({
        queue_id: queue.id,
        sequence_num: nextSeq,
        content: typeof content === 'string' ? { value: content } : content,
        content_type: detectedContentType,
        metadata: metadata || {},
        created_by: userId,
        created_at: new Date()
      })
      .returning('*');
    
    await trx.commit();
    
    logger.info('Record written to queue', { 
      qId, 
      recordId: record.id,
      sequenceNum: record.sequence_num 
    });
    
    return success(record);
  } catch (error: any) {
    await trx.rollback();
    logger.error('Failed to write record', { error, qId });
    return failure({
      message: 'Failed to write record to queue',
      code: 'INTERNAL_ERROR'
    });
  }
}