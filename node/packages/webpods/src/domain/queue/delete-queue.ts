// Delete queue
import { Knex } from 'knex';
import { Result, success, failure } from '../../types.js';
import { createLogger } from '../../logger.js';

const logger = createLogger('webpods:domain:delete');

export async function deleteQueue(
  db: Knex,
  userId: string,
  qId: string
): Promise<Result<{ q_id: string; deleted: boolean; records_deleted: number }>> {
  const trx = await db.transaction();
  
  try {
    // Get queue
    const queue = await trx('queue')
      .where('q_id', qId)
      .first();
    
    if (!queue) {
      await trx.rollback();
      return failure({
        message: 'Queue not found',
        code: 'NOT_FOUND'
      });
    }
    
    // Check if user is the creator
    if (queue.creator_id !== userId) {
      await trx.rollback();
      return failure({
        message: 'Only the queue creator can delete the queue',
        code: 'FORBIDDEN'
      });
    }
    
    // Count records before deletion
    const [countResult] = await trx('record')
      .where('queue_id', queue.id)
      .count('* as count');
    
    const recordCount = parseInt(countResult?.count as string || '0');
    
    // Delete queue (cascade will delete records)
    await trx('queue')
      .where('id', queue.id)
      .delete();
    
    await trx.commit();
    
    logger.info('Queue deleted', { qId, userId, recordsDeleted: recordCount });
    
    return success({
      q_id: qId,
      deleted: true,
      records_deleted: recordCount
    });
  } catch (error: any) {
    await trx.rollback();
    logger.error('Failed to delete queue', { error, qId });
    return failure({
      message: 'Failed to delete queue',
      code: 'INTERNAL_ERROR'
    });
  }
}