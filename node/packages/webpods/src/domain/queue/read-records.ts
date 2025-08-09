// Read records from queue
import { Knex } from 'knex';
import { Result, success, failure } from '../../types.js';
import { createLogger } from '../../logger.js';
import { checkReadPermission } from '../permissions/check-permission.js';

const logger = createLogger('webpods:domain:read');

interface ListRecordsResult {
  records: any[];
  total: number;
  has_more: boolean;
  next_id?: number;
}

export async function listRecords(
  db: Knex,
  qId: string,
  userId?: string,
  limit: number = 100,
  after?: number
): Promise<Result<ListRecordsResult>> {
  try {
    // Get queue
    const queue = await db('queue')
      .where('q_id', qId)
      .first();
    
    if (!queue) {
      return failure({
        message: 'Queue not found',
        code: 'NOT_FOUND'
      });
    }
    
    // Check read permissions
    const hasPermission = await checkReadPermission(db, userId || undefined, queue);
    if (!hasPermission) {
      return failure({
        message: 'You do not have permission to read this queue',
        code: 'FORBIDDEN'
      });
    }
    
    // Build query
    let query = db('record')
      .where('queue_id', queue.id)
      .orderBy('sequence_num', 'asc');
    
    if (after) {
      query = query.where('id', '>', after);
    }
    
    // Get records
    const records = await query.limit(limit + 1);
    
    // Get total count
    const [countResult] = await db('record')
      .where('queue_id', queue.id)
      .count('* as count');
    const count = countResult?.count || 0;
    
    // Check if there are more records
    const hasMore = records.length > limit;
    if (hasMore) {
      records.pop(); // Remove the extra record
    }
    
    // Extract content from records
    const contents = records.map(r => {
      if (r.content_type === 'text/plain' && r.content.value !== undefined) {
        return r.content.value;
      }
      return r.content;
    });
    
    const result: ListRecordsResult = {
      records: contents,
      total: parseInt(count as string),
      has_more: hasMore,
      next_id: hasMore ? records[records.length - 1]?.id : undefined
    };
    
    return success(result);
  } catch (error: any) {
    logger.error('Failed to list records', { error, qId });
    return failure({
      message: 'Failed to list records',
      code: 'INTERNAL_ERROR'
    });
  }
}

export async function getRecord(
  db: Knex,
  qId: string,
  index: number,
  userId?: string | null
): Promise<Result<any>> {
  try {
    // Get queue
    const queue = await db('queue')
      .where('q_id', qId)
      .first();
    
    if (!queue) {
      return failure({
        message: 'Queue not found',
        code: 'NOT_FOUND'
      });
    }
    
    // Check read permissions
    const hasPermission = await checkReadPermission(db, userId || undefined, queue);
    if (!hasPermission) {
      return failure({
        message: 'You do not have permission to read this queue',
        code: 'FORBIDDEN'
      });
    }
    
    let record;
    
    if (index < 0) {
      // Negative indexing: -1 = last, -2 = second to last, etc.
      const offset = Math.abs(index) - 1;
      record = await db('record')
        .where('queue_id', queue.id)
        .orderBy('sequence_num', 'desc')
        .offset(offset)
        .first();
    } else {
      // Positive indexing: 0-based
      record = await db('record')
        .where('queue_id', queue.id)
        .orderBy('sequence_num', 'asc')
        .offset(index)
        .first();
    }
    
    if (!record) {
      return failure({
        message: 'Record not found',
        code: 'NOT_FOUND'
      });
    }
    
    // Return raw content
    if (record.content_type === 'text/plain' && record.content.value !== undefined) {
      return success({
        content: record.content.value,
        contentType: record.content_type,
        metadata: record.metadata
      });
    }
    
    return success({
      content: record.content,
      contentType: record.content_type,
      metadata: record.metadata
    });
  } catch (error: any) {
    logger.error('Failed to get record', { error, qId, index });
    return failure({
      message: 'Failed to get record',
      code: 'INTERNAL_ERROR'
    });
  }
}