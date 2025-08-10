/**
 * Record operations domain logic
 */

import { Knex } from 'knex';
import { QueueItem, Result, QueueItemResponse } from '../types.js';
import { calculateRecordHash, isValidAlias, isNumericIndex } from '../utils.js';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:domain:records');

/**
 * Write a record to a queue
 */
export async function writeRecord(
  db: Knex,
  queueId: string,
  content: any,
  contentType: string,
  authorId: string,
  alias?: string | null
): Promise<Result<QueueItem>> {
  // Validate alias if provided
  if (alias && !isValidAlias(alias)) {
    return {
      success: false,
      error: {
        code: 'INVALID_ALIAS',
        message: 'Alias must contain at least one non-numeric character'
      }
    };
  }

  return await db.transaction(async (trx) => {
    try {
      // Get the previous record for hash chain
      const previousRecord = await trx('record')
        .where('queue_id', queueId)
        .orderBy('sequence_num', 'desc')
        .first();

      const sequenceNum = (previousRecord?.sequence_num ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, content);

      // Prepare content for storage
      let storedContent = content;
      if (typeof content === 'object' && contentType === 'application/json') {
        storedContent = JSON.stringify(content);
      }

      // Insert new record
      const [record] = await trx('record')
        .insert({
          queue_id: queueId,
          sequence_num: sequenceNum,
          content: storedContent,
          content_type: contentType,
          alias: alias || null,
          hash: hash,
          previous_hash: previousHash,
          author_id: authorId,
          created_at: timestamp
        })
        .returning('*');

      logger.info('Record written', { queueId, sequenceNum, alias, hash });
      return { success: true, data: record };
    } catch (error: any) {
      if (error.code === '23505' && error.constraint?.includes('alias')) {
        return {
          success: false,
          error: {
            code: 'ALIAS_EXISTS',
            message: 'Alias already exists in this queue'
          }
        };
      }
      logger.error('Failed to write record', { error, queueId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to write record'
        }
      };
    }
  });
}

/**
 * Get a record by index or alias
 */
export async function getRecord(
  db: Knex,
  queueId: string,
  target: string
): Promise<Result<QueueItem>> {
  try {
    let record: QueueItem | undefined;

    // Check if target is numeric (index)
    if (isNumericIndex(target)) {
      let index = parseInt(target);
      
      // Handle negative indexing
      if (index < 0) {
        const countResult = await db('record')
          .where('queue_id', queueId)
          .count('* as count')
          .first();
        
        const count = countResult?.count as string | number;
        index = (typeof count === 'string' ? parseInt(count) : count) + index;
        
        if (index < 0) {
          return {
            success: false,
            error: {
              code: 'INVALID_INDEX',
              message: 'Index out of range'
            }
          };
        }
      }

      record = await db('record')
        .where('queue_id', queueId)
        .where('sequence_num', index)
        .first();
    } else {
      // Get by alias
      record = await db('record')
        .where('queue_id', queueId)
        .where('alias', target)
        .first();
    }

    if (!record) {
      return {
        success: false,
        error: {
          code: 'RECORD_NOT_FOUND',
          message: 'Record not found'
        }
      };
    }

    return { success: true, data: record };
  } catch (error: any) {
    logger.error('Failed to get record', { error, queueId, target });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get record'
      }
    };
  }
}

/**
 * Get a range of records
 */
export async function getRecordRange(
  db: Knex,
  queueId: string,
  start: number,
  end: number
): Promise<Result<QueueItem[]>> {
  try {
    // Get total count for negative index handling
    const countResult = await db('record')
      .where('queue_id', queueId)
      .count('* as count')
      .first();
    
    const count = countResult?.count as string | number;
    const total = typeof count === 'string' ? parseInt(count) : count;
    
    // Handle negative indices
    if (start < 0) start = total + start;
    if (end < 0) end = total + end;
    
    // Validate range
    if (start < 0 || end < 0 || start > end) {
      return {
        success: false,
        error: {
          code: 'INVALID_RANGE',
          message: 'Invalid range specified'
        }
      };
    }

    const records = await db('record')
      .where('queue_id', queueId)
      .whereBetween('sequence_num', [start, end])
      .orderBy('sequence_num', 'asc');

    return { success: true, data: records };
  } catch (error: any) {
    logger.error('Failed to get record range', { error, queueId, start, end });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to get record range'
      }
    };
  }
}

/**
 * List records in a queue
 */
export async function listRecords(
  db: Knex,
  queueId: string,
  limit: number = 100,
  after?: number
): Promise<Result<{ records: QueueItem[], total: number, hasMore: boolean }>> {
  try {
    const query = db('record')
      .where('queue_id', queueId);

    if (after !== undefined) {
      query.where('sequence_num', '>', after);
    }

    const records = await query
      .orderBy('sequence_num', 'asc')
      .limit(limit + 1);

    const countResult = await db('record')
      .where('queue_id', queueId)
      .count('* as count')
      .first();

    const count = countResult?.count as string | number;
    const total = typeof count === 'string' ? parseInt(count) : count;
    const hasMore = records.length > limit;
    
    if (hasMore) {
      records.pop(); // Remove the extra record
    }

    return {
      success: true,
      data: { records, total, hasMore }
    };
  } catch (error: any) {
    logger.error('Failed to list records', { error, queueId });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to list records'
      }
    };
  }
}

/**
 * Convert record to API response format
 */
export function recordToResponse(record: QueueItem): QueueItemResponse {
  let content = record.content;
  
  // Parse JSON content if needed
  if (record.content_type === 'application/json' && typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      // Keep as string if parse fails
    }
  }

  return {
    sequence_num: record.sequence_num,
    content: content,
    content_type: record.content_type,
    alias: record.alias,
    hash: record.hash,
    previous_hash: record.previous_hash,
    author: record.author_id,
    timestamp: record.created_at.toISOString()
  };
}