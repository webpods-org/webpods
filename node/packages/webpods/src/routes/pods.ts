/**
 * Pod and stream routes
 */

import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { extractPod } from '../middleware/pod.js';
import { rateLimit } from '../middleware/ratelimit.js';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { 
  parseIndexQuery, 
  detectContentType,
  isSystemStream
} from '../utils.js';

// Import domain functions
import { createPod, deletePod, listPodStreams, transferPodOwnership, getPodOwner } from '../domain/pods.js';
import { getOrCreateStream, getStream, deleteStream } from '../domain/streams.js';
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
 * List streams in pod
 * GET {pod}.webpods.org/.meta/streams
 */
router.get('/.meta/streams', extractPod, async (req: Request, res: Response) => {
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
  const result = await listPodStreams(db, req.pod_id);
  
  if (!result.success) {
    res.status(500).json({
      error: result.error
    });
    return;
  }

  res.json({
    pod: req.pod_id,
    streams: result.data
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
 * Write to system streams
 * POST {pod}.webpods.org/.meta/owner
 * POST {pod}.webpods.org/.meta/links
 * POST {pod}.webpods.org/.meta/domains
 */
router.post('/.meta/owner', extractPod, authenticate, async (req: Request, res: Response) => {
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

router.post('/.meta/links', extractPod, authenticate, async (req: Request, res: Response) => {
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

router.post('/.meta/domains', extractPod, authenticate, async (req: Request, res: Response) => {
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
 * Write to stream
 * POST {pod}.webpods.org/{stream_path}?alias={alias}
 * Supports nested paths: /blog/posts/2024
 */
router.post('/*', extractPod, authenticate, rateLimit('write'), async (req: Request, res: Response) => {
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
    // Get stream path from URL (everything after domain)
    const streamId = req.path.substring(1); // Remove leading /
    const alias = req.query.alias as string | undefined;
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
    
    // Get or create stream
    const streamResult = await getOrCreateStream(
      db,
      req.pod!.id,
      streamId,
      req.auth!.user_id,
      readPermission,
      writePermission
    );
    
    if (!streamResult.success) {
      res.status(500).json({
        error: streamResult.error
      });
      return;
    }
    
    // Check write permission
    const canWriteResult = await canWrite(db, streamResult.data, req.auth.auth_id);
    if (!canWriteResult) {
      res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'No write permission for this stream'
        }
      });
      return;
    }
    
    // Write record
    const recordResult = await writeRecord(
      db,
      streamResult.data.id,
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
 * Read from stream
 * GET {pod}.webpods.org/{stream_path} - List records or get by query param
 * GET {pod}.webpods.org/{stream_path}?i=0 - Get by index
 * GET {pod}.webpods.org/{stream_path}?i=-1 - Get latest
 * GET {pod}.webpods.org/{stream_path}?i=10:20 - Get range
 * GET {pod}.webpods.org/{stream_path}/{alias} - Get by alias
 */
router.get('/*', extractPod, optionalAuth, rateLimit('read'), async (req: Request, res: Response) => {
  if (!req.pod) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const pathParts = req.path.substring(1).split('/'); // Remove leading /
  const db = getDb();
  
  // Check for index query parameter
  const indexQuery = req.query.i as string | undefined;
  
  // Determine if last part is an alias or part of stream path
  let streamId: string;
  let alias: string | undefined;
  
  if (indexQuery) {
    // If using index query, entire path is stream ID
    streamId = pathParts.join('/');
  } else if (pathParts.length > 1) {
    // Check if last part could be an alias (not using index query)
    // Try to find stream with full path first
    const fullPath = pathParts.join('/');
    const streamResult = await getStream(db, req.pod!.id, fullPath);
    
    if (streamResult.success) {
      streamId = fullPath;
    } else {
      // Assume last part is alias
      alias = pathParts.pop();
      streamId = pathParts.join('/');
    }
  } else {
    streamId = pathParts[0]!;
  }
  
  // Get stream
  const streamResult = await getStream(db, req.pod!.id, streamId);
  
  if (!streamResult.success) {
    res.status(404).json({
      error: {
        code: 'STREAM_NOT_FOUND',
        message: 'Stream not found'
      }
    });
    return;
  }
  
  // Check read permission
  const canReadResult = await canRead(db, streamResult.data, req.auth?.auth_id || null);
  if (!canReadResult) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'No read permission for this stream'
      }
    });
    return;
  }
  
  // Handle index query parameter
  if (indexQuery) {
    const parsed = parseIndexQuery(indexQuery);
    if (!parsed) {
      res.status(400).json({
        error: {
          code: 'INVALID_INDEX',
          message: 'Invalid index format. Use ?i=0, ?i=-1, or ?i=10:20'
        }
      });
      return;
    }
    
    if (parsed.type === 'single') {
      // Single record by index
      const result = await getRecord(db, streamResult.data.id, parsed.start.toString());
      
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
    } else {
      // Range of records
      const result = await getRecordRange(db, streamResult.data.id, parsed.start, parsed.end!);
      
      if (!result.success) {
        res.status(500).json({
          error: result.error
        });
        return;
      }
      
      res.json({
        records: result.data.map(recordToResponse),
        range: { start: parsed.start, end: parsed.end },
        total: result.data.length
      });
    }
  } else if (alias) {
    // Get by alias
    const result = await getRecord(db, streamResult.data.id, alias);
    
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
  } else {
    // List all records
    const limit = parseInt(req.query.limit as string) || 100;
    const after = req.query.after ? parseInt(req.query.after as string) : undefined;
    
    const result = await listRecords(db, streamResult.data.id, limit, after);
    
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
  }
});

/**
 * Delete stream
 * DELETE {pod}.webpods.org/{stream_path}
 */
router.delete('/*', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod || !req.auth) {
    res.status(404).json({
      error: {
        code: 'POD_NOT_FOUND',
        message: 'Pod not found'
      }
    });
    return;
  }

  const streamId = req.path.substring(1); // Remove leading /
  
  // Prevent deletion of system streams via this endpoint
  if (streamId && isSystemStream(streamId)) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'System streams cannot be deleted'
      }
    });
    return;
  }
  
  const db = getDb();
  const result = await deleteStream(db, req.pod!.id, streamId, req.auth!.user_id);
  
  if (!result.success) {
    const status = result.error.code === 'FORBIDDEN' ? 403 : 
                   result.error.code === 'STREAM_NOT_FOUND' ? 404 : 500;
    res.status(status).json({
      error: result.error
    });
    return;
  }

  res.status(204).send();
});

/**
 * Root path handler with .meta/links support
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
  
  // Check if path "/" is mapped in .meta/links
  const linkResult = await resolveLink(db, req.pod_id, '/');
  
  if (linkResult.success && linkResult.data) {
    // Redirect to the mapped stream/record
    const { streamId, target } = linkResult.data;
    
    // Rewrite URL and forward to the stream handler
    req.url = `/${streamId}${target ? `/${target}` : ''}`;
    req.params.stream = streamId;
    req.params.target = target;
    
    // Let Express router handle the rewritten request
    return router(req, res, () => {});
  }
  
  // No mapping, return 404
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: 'No content configured for root path. Use .meta/links to configure.'
    }
  });
});

export default router;