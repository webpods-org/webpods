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
import { checkRateLimit } from '../domain/ratelimit.js';

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
 * Pod-specific login endpoint
 * GET {pod}.webpods.org/login
 */
router.get('/login', extractPod, (req: Request, res: Response) => {
  if (!req.pod_id) {
    res.status(400).json({
      error: {
        code: 'INVALID_POD',
        message: 'Could not determine pod from request'
      }
    });
    return;
  }
  
  // Get redirect path from query or referer
  const redirect = req.query.redirect as string || req.get('referer') || '/';
  
  // Redirect to main domain authorization with pod info
  const protocol = process.env.NODE_ENV === 'test' ? 'http' : 'https';
  const domain = process.env.DOMAIN || 'webpods.org';
  const port = process.env.NODE_ENV === 'test' && process.env.WEBPODS_PORT ? `:${process.env.WEBPODS_PORT}` : '';
  const authUrl = `${protocol}://${domain}${port}/auth/authorize?pod=${req.pod_id}&redirect=${encodeURIComponent(redirect)}`;
  
  logger.info('Pod login initiated', { pod: req.pod_id, redirect });
  res.redirect(authUrl);
});

/**
 * Pod-specific auth callback
 * GET {pod}.webpods.org/auth/callback
 */
router.get('/auth/callback', extractPod, (req: Request, res: Response) => {
  const token = req.query.token as string;
  const redirect = req.query.redirect as string || '/';
  
  if (!token) {
    res.status(400).json({
      error: {
        code: 'MISSING_TOKEN',
        message: 'Authorization token is required'
      }
    });
    return;
  }
  
  // Set cookie for this pod subdomain
  const isProduction = process.env.NODE_ENV === 'production';
  res.cookie('pod_token', token, {
    httpOnly: true,
    secure: isProduction,
    sameSite: isProduction ? 'strict' : 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    path: '/',
    domain: `.${req.pod_id}.${process.env.DOMAIN || 'webpods.org'}` // Scoped to pod subdomain
  });
  
  logger.info('Pod auth callback successful', { pod: req.pod_id });
  
  // Redirect to final destination
  res.redirect(redirect);
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
  if (!req.pod_id || !req.auth) {
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
  if (!req.pod_id || !req.auth) {
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
  if (!req.pod_id || !req.auth) {
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
    
    const result = await updateLinks(db, req.pod_id, data, req.auth.user_id, req.auth.auth_id);
    
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
  if (!req.pod_id || !req.auth) {
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
    
    const result = await updateCustomDomains(db, req.pod_id, data.domains, req.auth.user_id, req.auth.auth_id);
    
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
  if (!req.pod_id || !req.auth) {
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
    const accessPermission = req.query.access as string | undefined;
    
    const db = getDb();
    
    // Create pod if it doesn't exist
    if (!req.pod && req.pod_id) {
      // Check pod creation rate limit first
      const podLimitResult = await checkRateLimit(db, req.auth.auth_id, 'pod_create');
      
      if (!podLimitResult.success || !podLimitResult.data.allowed) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many pods created'
          }
        });
        return;
      }
      
      const podResult = await createPod(db, req.auth.user_id, req.pod_id);
      if (!podResult.success) {
        res.status(500).json({
          error: podResult.error
        });
        return;
      }
      req.pod = podResult.data;
    }
    
    // Check if stream exists first
    const existingStream = await getStream(db, req.pod!.id, streamId);
    
    // If stream doesn't exist, check rate limit before creating
    if (!existingStream.success) {
      const streamLimitResult = await checkRateLimit(db, req.auth.auth_id, 'stream_create');
      
      if (!streamLimitResult.success || !streamLimitResult.data.allowed) {
        res.status(429).json({
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many streams created'
          }
        });
        return;
      }
    }
    
    // Get or create stream
    const streamResult = await getOrCreateStream(
      db,
      req.pod!.id,
      streamId,
      req.auth!.user_id,
      accessPermission
    );
    
    if (!streamResult.success) {
      res.status(500).json({
        error: streamResult.error
      });
      return;
    }
    
    // Check write permission
    const canWriteResult = await canWrite(db, streamResult.data.stream, req.auth.auth_id, req.auth.user_id);
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
      streamResult.data.stream.id,
      content,
      contentType,
      req.auth.auth_id,
      alias
    );
    
    if (!recordResult.success) {
      // Check for specific error codes
      const status = recordResult.error.code === 'ALIAS_EXISTS' ? 409 : 500;
      res.status(status).json({
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
    if (target && target.startsWith('?')) {
      // Handle query parameters (e.g., "?i=-1")
      req.url = `/${streamId}${target}`;
      req.query = Object.fromEntries(new URLSearchParams(target.substring(1)));
    } else if (target) {
      // Handle path targets (e.g., "my-post")
      req.url = `/${streamId}/${target}`;
    } else {
      // Just the stream
      req.url = `/${streamId}`;
    }
    
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
  const canReadResult = await canRead(db, streamResult.data, req.auth?.auth_id || null, req.auth?.user_id || null);
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
      // Single record by index (don't prefer alias when using ?i=)
      const result = await getRecord(db, streamResult.data.id, parsed.start.toString(), false);
      
      if (!result.success) {
        res.status(404).json({
          error: result.error
        });
        return;
      }
      
      // Return raw content for single records
      const record = result.data;
      // Set headers
      res.setHeader('X-Hash', record.hash);
      res.setHeader('X-Previous-Hash', record.previous_hash || '');
      res.setHeader('X-Author', record.author_id);
      res.setHeader('X-Timestamp', record.created_at.toISOString());
      
      // Set content type and send response
      res.type(record.content_type);
      
      // Parse JSON content if needed
      if (record.content_type === 'application/json' && typeof record.content === 'string') {
        try {
          res.send(JSON.parse(record.content));
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
    // Get by alias (prefer alias over index for path-based access)
    const result = await getRecord(db, streamResult.data.id, alias, true);
    
    if (!result.success) {
      res.status(404).json({
        error: result.error
      });
      return;
    }
    
    // Return raw content for single records
    const record = result.data;
    // Set headers
    res.setHeader('X-Hash', record.hash);
    res.setHeader('X-Previous-Hash', record.previous_hash || '');
    res.setHeader('X-Author', record.author_id);
    res.setHeader('X-Timestamp', record.created_at.toISOString());
    
    // Set content type and send response
    res.type(record.content_type);
    
    // Parse JSON content if needed
    if (record.content_type === 'application/json' && typeof record.content === 'string') {
      try {
        res.send(JSON.parse(record.content));
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
      next_index: result.data.hasMore ? result.data.records[result.data.records.length - 1]?.index : null
    });
  }
});

/**
 * Delete stream
 * DELETE {pod}.webpods.org/{stream_path}
 */
router.delete('/*', extractPod, authenticate, async (req: Request, res: Response) => {
  if (!req.pod_id || !req.auth) {
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

export default router;