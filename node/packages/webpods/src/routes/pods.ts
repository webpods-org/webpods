/**
 * Pod and queue routes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { extractPod } from '../middleware/pod.js';
import { rateLimit } from '../middleware/ratelimit.js';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { 
  parseRange, 
  detectContentType,
  isSystemQueue
} from '../utils.js';

// Import domain functions
import { createPod, deletePod, listPodQueues, transferPodOwnership, getPodOwner } from '../domain/pods.js';
import { getOrCreateQueue, getQueue, deleteQueue } from '../domain/queues.js';
import { writeRecord, getRecord, getRecordRange, listRecords, recordToResponse } from '../domain/records.js';
import { canRead, canWrite } from '../domain/permissions.js';
import { resolveLink, updateLinks, updateCustomDomains } from '../domain/routing.js';

const logger = createLogger('webpods:routes:pods');
const router = Router();

// Validation schemas
const writeSchema = z.union([
  z.string(),
  z.object({}).passthrough()
]);


const ownerSchema = z.object({
  owner: z.string()
});

const linksSchema = z.record(z.string());

const domainsSchema = z.object({
  domains: z.array(z.string())
});

/**
 * List queues in pod
 * GET {pod}.webpods.org/_queues
 */
router.get('/_queues', extractPod, async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const db = getDb();
  const result = await listPodQueues(db, req.pod_id);
  
  if (!result.success) {
    res.status(500).json({
      error: result.error
    });
    return;
  }

  res.json({
    pod: req.pod_id,
    queues: result.data
  });
});

/**
 * Delete entire pod
 * DELETE {pod}.webpods.org/
 */
router.delete('/', extractPod, authenticate, rateLimit('pod_create'), async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const db = getDb();
  const result = await deletePod(db, req.pod_id, req.auth.user_id);
  
  if (!result.success) {
    const status = result.error.code === 'FORBIDDEN' ? 403 : 500;
    res.status(status).json({
      error: result.error
    });
    return;
  }

  res.status(204).send();
});

/**
 * Write to system queues
 * POST {pod}.webpods.org/_owner
 * POST {pod}.webpods.org/_links
 * POST {pod}.webpods.org/_domains
 */
router.post('/_owner', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  try {
    const data = ownerSchema.parse(req.body);
    const db = getDb();
    
    const result = await transferPodOwnership(db, req.pod_id, req.auth.user_id, data.owner);
    
    if (!result.success) {
      const status = result.error.code === 'FORBIDDEN' ? 403 : 500;
      res.status(status).json({
        error: result.error
      });
      return;
    }

    res.status(201).json({ success: true });
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
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

router.post('/_links', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  try {
    const data = linksSchema.parse(req.body);
    const db = getDb();
    
    // Check ownership
    const ownerResult = await getPodOwner(db, req.pod_id);
    if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only pod owner can update links'
        }
      });
      return;
    }
    
    const result = await updateLinks(db, req.pod_id, data, req.auth.auth_id);
    
    if (!result.success) {
      res.status(500).json({
        error: result.error
      });
      return;
    }

    res.status(201).json({ success: true });
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
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

router.post('/_domains', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  try {
    const data = domainsSchema.parse(req.body);
    const db = getDb();
    
    // Check ownership
    const ownerResult = await getPodOwner(db, req.pod_id);
    if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'Only pod owner can update domains'
        }
      });
      return;
    }
    
    const result = await updateCustomDomains(db, req.pod_id, data.domains, req.auth.auth_id);
    
    if (!result.success) {
      res.status(500).json({
        error: result.error
      });
      return;
    }

    res.status(201).json({ success: true });
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
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

/**
 * Write to queue (with optional alias)
 * POST {pod}.webpods.org/{queue}
 * POST {pod}.webpods.org/{queue}/{alias}
 */
router.post('/:queue/:alias?', extractPod, authenticate, rateLimit('write'), async (req: Request, res: Response) => {
  if (!req.pod || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  try {
    const queueId = req.params.queue!;
    const alias = req.params.alias || null;
    const content = writeSchema.parse(req.body);
    const contentType = detectContentType(req.headers);
    const readPermission = req.query.read as string | undefined;
    const writePermission = req.query.write as string | undefined;
    
    const db = getDb();
    
    // Create pod if it doesn't exist
    if (!req.pod && req.pod_id) {
      const podResult = await createPod(db, req.auth.user_id, req.pod_id);
      if (!podResult.success) {
        res.status(500).json({
          error: podResult.error
        });
        return;
      }
      req.pod = podResult.data;
    }
    
    // Get or create queue
    const queueResult = await getOrCreateQueue(
      db,
      req.pod!.id,
      queueId,
      req.auth!.user_id,
      readPermission,
      writePermission
    );
    
    if (!queueResult.success) {
      res.status(500).json({
        error: queueResult.error
      });
      return;
    }
    
    // Check write permission
    const canWriteResult = await canWrite(db, queueResult.data, req.auth.auth_id);
    if (!canWriteResult) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'No write permission for this queue'
        }
      });
      return;
    }
    
    // Write record
    const recordResult = await writeRecord(
      db,
      queueResult.data.id,
      content,
      contentType,
      req.auth.auth_id,
      alias
    );
    
    if (!recordResult.success) {
      res.status(500).json({
        error: recordResult.error
      });
      return;
    }
    
    res.status(201).json(recordToResponse(recordResult.data));
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
    logger.error('Write error', { error });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});

/**
 * Read from queue
 * GET {pod}.webpods.org/{queue} - List records
 * GET {pod}.webpods.org/{queue}/{index} - Get single record
 * GET {pod}.webpods.org/{queue}/{range} - Get range
 * GET {pod}.webpods.org/{queue}/{alias} - Get by alias
 */
router.get('/:queue/:target?', extractPod, optionalAuth, rateLimit('read'), async (req: Request, res: Response) => {
  if (!req.pod) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const queueId = req.params.queue;
  const target = req.params.target;
  const db = getDb();
  
  // Get queue
  const queueResult = await getQueue(db, req.pod!.id, queueId!);
  
  if (!queueResult.success) {
    res.status(404).json({
      error: {
        code: 'QUEUE_NOT_FOUND',
        message: 'Queue not found'
      }
    });
    return;
  }
  
  // Check read permission
  const canReadResult = await canRead(db, queueResult.data, req.auth?.auth_id || null);
  if (!canReadResult) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'No read permission for this queue'
      }
    });
    return;
  }
  
  // Handle different target types
  if (!target) {
    // List all records
    const limit = parseInt(req.query.limit as string) || 100;
    const after = req.query.after ? parseInt(req.query.after as string) : undefined;
    
    const result = await listRecords(db, queueResult.data.id, limit, after);
    
    if (!result.success) {
      res.status(500).json({
        error: result.error
      });
      return;
    }
    
    res.json({
      records: result.data.records.map(recordToResponse),
      total: result.data.total,
      has_more: result.data.hasMore,
      next_id: result.data.hasMore ? result.data.records[result.data.records.length - 1]?.sequence_num : null
    });
  } else {
    // Check if it's a range
    const range = parseRange(target);
    if (range) {
      const result = await getRecordRange(db, queueResult.data.id, range.start, range.end);
      
      if (!result.success) {
        res.status(500).json({
          error: result.error
        });
        return;
      }
      
      res.json({
        records: result.data.map(recordToResponse),
        total: result.data.length,
        has_more: false,
        next_id: null
      });
    } else {
      // Single record (by index or alias)
      const result = await getRecord(db, queueResult.data.id, target);
      
      if (!result.success) {
        res.status(404).json({
          error: result.error
        });
        return;
      }
      
      // Return raw content for single records
      const record = result.data;
      res.setHeader('Content-Type', record.content_type);
      res.setHeader('X-Hash', record.hash);
      res.setHeader('X-Previous-Hash', record.previous_hash || '');
      res.setHeader('X-Author', record.author_id);
      res.setHeader('X-Timestamp', record.created_at.toISOString());
      
      // Parse JSON content if needed
      if (record.content_type === 'application/json' && typeof record.content === 'string') {
        try {
          res.json(JSON.parse(record.content));
        } catch {
          res.send(record.content);
        }
      } else {
        res.send(record.content);
      }
    }
  }
});

/**
 * Delete queue
 * DELETE {pod}.webpods.org/{queue}
 */
router.delete('/:queue', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const queueId = req.params.queue;
  
  // Prevent deletion of system queues via this endpoint
  if (queueId && isSystemQueue(queueId)) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'System queues cannot be deleted'
      }
    });
    return;
  }
  
  const db = getDb();
  const result = await deleteQueue(db, req.pod!.id, queueId!, req.auth!.user_id);
  
  if (!result.success) {
    const status = result.error.code === 'FORBIDDEN' ? 403 : 
                   result.error.code === 'QUEUE_NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      error: result.error
    });
    return;
  }

  res.status(204).send();
});

/**
 * Root path handler with _links support
 * GET {pod}.webpods.org/
 */
router.get('/', extractPod, optionalAuth, async (req: Request, res: Response) => {
  if (!req.pod || !req.pod_id) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const db = getDb();
  
  // Check if path "/" is mapped in _links
  const linkResult = await resolveLink(db, req.pod_id, '/');
  
  if (linkResult.success && linkResult.data) {
    // Redirect to the mapped queue/record
    const { queueId, target } = linkResult.data;
    
    // Rewrite URL and forward to the queue handler
    req.url = `/${queueId}${target ? `/${target}` : ''}`;
    req.params.queue = queueId;
    req.params.target = target;
    
    // Let Express router handle the rewritten request
    return router(req, res, () => {});
  }
  
  // No mapping, return 404
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'No content configured for root path. Use _links to configure.'
    }
  });
});

export default router;