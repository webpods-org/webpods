/**
 * URL routing and custom domain logic
 */

import { Knex } from 'knex';
import { Result } from '../types.js';
import { createLogger } from '../logger.js';
import { calculateRecordHash } from '../utils.js';

const logger = createLogger('webpods:domain:routing');

interface LinkMapping {
  queueId: string;
  target: string;
}

/**
 * Resolve a path using _links configuration
 */
export async function resolveLink(
  db: Knex,
  podId: string,
  path: string
): Promise<Result<LinkMapping | null>> {
  try {
    // Get the latest _links record
    const record = await db('record')
      .join('queue', 'queue.id', 'record.queue_id')
      .join('pod', 'pod.id', 'queue.pod_id')
      .where('pod.pod_id', podId)
      .where('queue.queue_id', '_links')
      .orderBy('record.created_at', 'desc')
      .select('record.*')
      .first();

    if (!record) {
      return { success: true, data: null };
    }

    const links = typeof record.content === 'string' 
      ? JSON.parse(record.content)
      : record.content;

    if (!links[path]) {
      return { success: true, data: null };
    }

    // Parse the mapping (e.g., "homepage/-1" or "blog/my-post")
    const mapping = links[path];
    const parts = mapping.split('/');
    
    if (parts.length !== 2) {
      logger.warn('Invalid link mapping', { podId, path, mapping });
      return { success: true, data: null };
    }

    return {
      success: true,
      data: {
        queueId: parts[0],
        target: parts[1]
      }
    };
  } catch (error: any) {
    logger.error('Failed to resolve link', { error, podId, path });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to resolve link'
      }
    };
  }
}

/**
 * Update _links configuration
 */
export async function updateLinks(
  db: Knex,
  podId: string,
  links: Record<string, string>,
  authorId: string
): Promise<Result<void>> {
  return await db.transaction(async (trx) => {
    try {
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

      // Get or create _links queue
      let linksQueue = await trx('queue')
        .where('pod_id', pod.id)
        .where('queue_id', '_links')
        .first();

      if (!linksQueue) {
        [linksQueue] = await trx('queue')
          .insert({
            id: crypto.randomUUID(),
            pod_id: pod.id,
            queue_id: '_links',
            creator_id: authorId.split(':').pop()!, // Extract user ID from auth ID
            read_permission: 'public',
            write_permission: 'private',
            queue_type: 'system',
            created_at: new Date()
          })
          .returning('*');
      }

      // Get previous record for hash chain
      const previousRecord = await trx('record')
        .where('queue_id', linksQueue.id)
        .orderBy('sequence_num', 'desc')
        .first();

      const sequenceNum = (previousRecord?.sequence_num ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, links);

      // Write new links record
      await trx('record')
        .insert({
          queue_id: linksQueue.id,
          sequence_num: sequenceNum,
          content: JSON.stringify(links),
          content_type: 'application/json',
          hash: hash,
          previous_hash: previousHash,
          author_id: authorId,
          created_at: timestamp
        });

      logger.info('Links updated', { podId, paths: Object.keys(links) });
      return { success: true, data: undefined };
    } catch (error: any) {
      logger.error('Failed to update links', { error, podId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to update links'
        }
      };
    }
  });
}

/**
 * Find pod by custom domain
 */
export async function findPodByDomain(
  db: Knex,
  domain: string
): Promise<Result<string | null>> {
  try {
    const customDomain = await db('custom_domain')
      .where('domain', domain)
      .where('verified', true)
      .first();

    if (!customDomain) {
      return { success: true, data: null };
    }

    const pod = await db('pod')
      .where('id', customDomain.pod_id)
      .first();

    if (!pod) {
      return { success: true, data: null };
    }

    return { success: true, data: pod.pod_id };
  } catch (error: any) {
    logger.error('Failed to find pod by domain', { error, domain });
    return {
      success: false,
      error: {
        code: 'DATABASE_ERROR',
        message: 'Failed to find pod by domain'
      }
    };
  }
}

/**
 * Update custom domains for a pod
 */
export async function updateCustomDomains(
  db: Knex,
  podId: string,
  domains: string[],
  authorId: string
): Promise<Result<void>> {
  return await db.transaction(async (trx) => {
    try {
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

      // Get or create _domains queue
      let domainsQueue = await trx('queue')
        .where('pod_id', pod.id)
        .where('queue_id', '_domains')
        .first();

      if (!domainsQueue) {
        [domainsQueue] = await trx('queue')
          .insert({
            id: crypto.randomUUID(),
            pod_id: pod.id,
            queue_id: '_domains',
            creator_id: authorId.split(':').pop()!, // Extract user ID from auth ID
            read_permission: 'public',
            write_permission: 'private',
            queue_type: 'system',
            created_at: new Date()
          })
          .returning('*');
      }

      // Get previous record for hash chain
      const previousRecord = await trx('record')
        .where('queue_id', domainsQueue.id)
        .orderBy('sequence_num', 'desc')
        .first();

      const sequenceNum = (previousRecord?.sequence_num ?? -1) + 1;
      const previousHash = previousRecord?.hash || null;
      const timestamp = new Date().toISOString();

      // Calculate hash
      const hash = calculateRecordHash(previousHash, timestamp, { domains });

      // Write new domains record
      await trx('record')
        .insert({
          queue_id: domainsQueue.id,
          sequence_num: sequenceNum,
          content: JSON.stringify({ domains }),
          content_type: 'application/json',
          hash: hash,
          previous_hash: previousHash,
          author_id: authorId,
          created_at: timestamp
        });

      // Update custom_domain table (for faster lookups)
      // Remove old domains
      await trx('custom_domain')
        .where('pod_id', pod.id)
        .delete();

      // Add new domains
      if (domains.length > 0) {
        await trx('custom_domain')
          .insert(domains.map(domain => ({
            id: crypto.randomUUID(),
            pod_id: pod.id,
            domain: domain,
            verified: false, // Needs CNAME verification
            created_at: new Date()
          })));
      }

      logger.info('Custom domains updated', { podId, domains });
      return { success: true, data: undefined };
    } catch (error: any) {
      logger.error('Failed to update custom domains', { error, podId });
      return {
        success: false,
        error: {
          code: 'DATABASE_ERROR',
          message: 'Failed to update custom domains'
        }
      };
    }
  });
}