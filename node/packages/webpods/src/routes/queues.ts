// Queue routes
import { Router } from 'express';
import { z } from 'zod';
import { getDb } from '../db.js';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { createLogger } from '../logger.js';
import { createOrUpdateQueue } from '../domain/queue/create-queue.js';
import { writeRecord } from '../domain/queue/write-record.js';
import { listRecords, getRecord } from '../domain/queue/read-records.js';
import { deleteQueue } from '../domain/queue/delete-queue.js';
import { checkRateLimit } from '../domain/rate-limit/check-rate-limit.js';

const logger = createLogger('webpods:routes:queues');
const router = Router();

// Validation schemas
const queueIdSchema = z.string().min(1).max(256).regex(/^[a-zA-Z0-9_-]+$/);

const writeSchema = z.union([
  z.string(),
  z.record(z.unknown()),
  z.array(z.unknown())
]);

const listSchema = z.object({
  limit: z.coerce.number().min(1).max(1000).default(100),
  after: z.coerce.number().optional()
});

/**
 * POST /q/:q_id - Write to queue or update permissions
 */
router.post('/q/:q_id', authenticate, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const db = getDb();
    
    // Check rate limit
    const rateLimit = await checkRateLimit(db, req.auth!.userId, 'write');
    if (!rateLimit.allowed) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many write requests'
        }
      });
      return;
    }
    
    // Parse query parameters for permissions
    const readPermission = req.query.read as string | undefined;
    const writePermission = req.query.write as string | undefined;
    
    // If no body, just create/update queue
    if (!req.body || Object.keys(req.body).length === 0) {
      const result = await createOrUpdateQueue(
        db,
        req.auth!.userId,
        qId,
        readPermission,
        writePermission
      );
      
      if (!result.success) {
        const code = result.error.code === 'FORBIDDEN' ? 403 : 400;
        res.status(code).json({ error: result.error });
        return;
      }
      
      res.status(201).json({
        id: result.data.id,
        q_id: result.data.q_id,
        created: true
      });
      return;
    }
    
    // Parse content and metadata
    const content = writeSchema.parse(req.body);
    const metadata: Record<string, any> = {};
    
    // Extract X-* headers as metadata
    for (const [key, value] of Object.entries(req.headers)) {
      if (key.toLowerCase().startsWith('x-') && 
          !key.toLowerCase().startsWith('x-forwarded') &&
          !key.toLowerCase().startsWith('x-real')) {
        metadata[key.substring(2)] = value;
      }
    }
    
    // Determine content type
    const contentType = req.headers['x-content-type'] as string || 
                       req.headers['content-type'] || 
                       (typeof content === 'string' ? 'text/plain' : 'application/json');
    
    // Write record
    const result = await writeRecord(
      db,
      req.auth!.userId,
      qId,
      content,
      contentType,
      metadata
    );
    
    if (!result.success) {
      const code = result.error.code === 'FORBIDDEN' ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }
    
    res.status(201).json({
      id: result.data.id,
      q_id: qId,
      created: true
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request',
          details: error.errors
        }
      });
      return;
    }
    logger.error('Failed to write to queue', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

/**
 * GET /q/:q_id - List queue records
 */
router.get('/q/:q_id', optionalAuth, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const query = listSchema.parse(req.query);
    const db = getDb();
    
    // Check rate limit if authenticated
    if (req.auth) {
      const rateLimit = await checkRateLimit(db, req.auth.userId, 'read');
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many read requests'
          }
        });
        return;
      }
    }
    
    const result = await listRecords(
      db,
      qId,
      req.auth?.userId,
      query.limit,
      query.after
    );
    
    if (!result.success) {
      const code = result.error.code === 'NOT_FOUND' ? 404 : 
                  result.error.code === 'FORBIDDEN' ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }
    
    res.json(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request',
          details: error.errors
        }
      });
      return;
    }
    logger.error('Failed to list queue records', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

/**
 * GET /q/:q_id/:index - Get single record
 */
router.get('/q/:q_id/:index', optionalAuth, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const index = parseInt(req.params.index || '');
    
    if (isNaN(index)) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INDEX',
          message: 'Index must be a number'
        }
      });
      return;
    }
    
    const db = getDb();
    
    // Check rate limit if authenticated
    if (req.auth) {
      const rateLimit = await checkRateLimit(db, req.auth.userId, 'read');
      if (!rateLimit.allowed) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many read requests'
          }
        });
        return;
      }
    }
    
    const result = await getRecord(
      db,
      qId,
      index,
      req.auth?.userId || null
    );
    
    if (!result.success) {
      const code = result.error.code === 'NOT_FOUND' ? 404 : 
                  result.error.code === 'FORBIDDEN' ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }
    
    // Set response headers
    res.set('Content-Type', result.data.contentType);
    if (result.data.metadata) {
      for (const [key, value] of Object.entries(result.data.metadata)) {
        res.set(`X-${key}`, String(value));
      }
    }
    
    // Send raw content
    if (result.data.contentType === 'text/plain') {
      res.send(result.data.content);
    } else {
      res.json(result.data.content);
    }
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request',
          details: error.errors
        }
      });
      return;
    }
    logger.error('Failed to get record', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

/**
 * DELETE /q/:q_id - Delete queue
 */
router.delete('/q/:q_id', authenticate, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const db = getDb();
    
    const result = await deleteQueue(
      db,
      req.auth!.userId,
      qId
    );
    
    if (!result.success) {
      const code = result.error.code === 'NOT_FOUND' ? 404 : 
                  result.error.code === 'FORBIDDEN' ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }
    
    res.json(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request',
          details: error.errors
        }
      });
      return;
    }
    logger.error('Failed to delete queue', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

// HEAD requests for hash checking
router.head('/q/:q_id', optionalAuth, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const db = getDb();
    
    const queue = await db('queue').where('q_id', qId).first();
    if (!queue) {
      res.status(404).end();
      return;
    }
    
    // Get queue stats
    const [countResult] = await db('record')
      .where('queue_id', queue.id)
      .count('* as count');
    const count = countResult?.count || 0;
    
    const lastRecord = await db('record')
      .where('queue_id', queue.id)
      .orderBy('created_at', 'desc')
      .first();
    
    // Set headers
    res.set('X-Total-Records', String(count));
    res.set('X-Last-Modified', lastRecord ? lastRecord.created_at.toISOString() : queue.created_at.toISOString());
    res.set('X-Hash', `${queue.id}-${count}`); // Simple hash
    
    res.status(200).end();
  } catch (error) {
    logger.error('Failed to get queue head', { error });
    res.status(500).end();
  }
});

export { router as queuesRouter };