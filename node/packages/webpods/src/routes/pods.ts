/**
 * Pod and stream routes
 */

import { Router, Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { authenticate, optionalAuth } from '../middleware/auth.js';
import { extractPod } from '../middleware/pod.js';
import { rateLimit } from '../middleware/ratelimit.js';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { getConfig } from '../config-loader.js';
import { 
  parseIndexQuery, 
  detectContentType,
  isSystemStream,
  isBinaryContentType,
  isValidBase64,
  parseDataUrl,
  isValidName
} from '../utils.js';

// Import domain functions
import { createPod, deletePod, listPodStreams, transferPodOwnership, getPodOwner } from '../domain/pods.js';
import { getOrCreateStream, getStream, deleteStream } from '../domain/streams.js';
import { writeRecord, getRecord, getRecordRange, listRecords, recordToResponse } from '../domain/records.js';
import { canRead, canWrite } from '../domain/permissions.js';
import { resolveLink, updateLinks, updateCustomDomains } from '../domain/routing.js';
import { checkRateLimit } from '../domain/ratelimit.js';

const logger = createLogger('webpods:routes:pods');
const router = Router({ mergeParams: true });

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
  const config = getConfig();
  const publicUrl = config.server.publicUrl || 'http://localhost:3000';
  const authUrl = `${publicUrl}/auth/authorize?pod=${req.pod_id}&redirect=${encodeURIComponent(redirect)}`;
  
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
  
  logger.info('Auth callback on pod', { pod: req.pod_id, hasToken: !!token, redirect });
  
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
  const config = getConfig();
  const publicConfig = config.server.public;
  const isSecure = publicConfig?.isSecure || false;
  res.cookie('pod_token', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: isSecure ? 'strict' : 'lax',
    maxAge: 10 * 365 * 24 * 60 * 60 * 1000, // 10 years (effectively unlimited)
    path: '/',
    // Cookie domain cannot have port
    domain: `.${req.pod_id}.${publicConfig?.hostname || 'localhost'}` // Scoped to pod subdomain
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
 * Write to stream with required name
 * POST {pod}.webpods.org/{stream_path}/{name}
 * Example: POST alice.webpods.org/blog/posts/first.md
 */
router.post('/*', extractPod, authenticate, rateLimit('write'), async (req: Request, res: Response, next: NextFunction) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.pod_id) {
    return next();
  }
  
  if (!req.auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }

  try {
    // Extract stream path and name from URL
    const fullPath = req.path.substring(1); // Remove leading /
    
    // Check for trailing slash which means empty name
    if (fullPath.endsWith('/') || fullPath === '') {
      res.status(400).json({
        error: {
          code: 'MISSING_NAME',
          message: 'Record name is required'
        }
      });
      return;
    }
    
    const pathParts = fullPath.split('/');
    
    // Last segment is always the name (required)
    if (pathParts.length === 0 || !pathParts[pathParts.length - 1]) {
      res.status(400).json({
        error: {
          code: 'MISSING_NAME',
          message: 'Record name is required'
        }
      });
      return;
    }
    
    const name = pathParts.pop()!;
    
    // Express might normalize single dot to empty, check for this
    if (!name || name === '') {
      res.status(400).json({
        error: {
          code: 'MISSING_NAME', 
          message: 'Record name is required'
        }
      });
      return;
    }
    
    // Validate name early to provide better error messages
    if (!isValidName(name)) {
      res.status(400).json({
        error: {
          code: 'INVALID_NAME',
          message: 'Name can only contain letters, numbers, hyphens, underscores, and periods. Cannot start or end with a period.'
        }
      });
      return;
    }
    
    const streamId = pathParts.join('/') || 'default'; // Use 'default' if no stream path
    let content = writeSchema.parse(req.body);
    let contentType = detectContentType(req.headers);
    const accessPermission = req.query.access as string | undefined;
    
    // Check if content is a data URL first (before checking content type)
    if (typeof content === 'string' && content.startsWith('data:')) {
      const parsed = parseDataUrl(content);
      if (!parsed) {
        res.status(400).json({
          error: {
            code: 'INVALID_CONTENT',
            message: 'Invalid data URL format'
          }
        });
        return;
      }
      // Use the content type from data URL if not explicitly set
      if (!req.headers['x-content-type']) {
        contentType = parsed.contentType;
      }
      content = parsed.data;
    }
    
    // Handle binary content (images)
    if (isBinaryContentType(contentType)) {
      // For binary content, expect base64 encoded string
      if (typeof content !== 'string') {
        res.status(400).json({
          error: {
            code: 'INVALID_CONTENT',
            message: 'Binary content must be provided as base64 encoded string'
          }
        });
        return;
      }
      
      // Validate base64
      if (!isValidBase64(content)) {
        res.status(400).json({
          error: {
            code: 'INVALID_CONTENT',
            message: 'Invalid base64 encoding'
          }
        });
        return;
      }
      
      // Check size limit (base64 is ~33% larger than binary)
      // Get max payload size from config (e.g., "10mb" -> 10 * 1024 * 1024)
      const config = getConfig();
      const maxSizeStr = config.server.maxPayloadSize || '10mb';
      const maxSizeMatch = maxSizeStr.match(/^(\d+)(mb|kb|gb)?$/i);
      const maxSizeNum = maxSizeMatch ? parseInt(maxSizeMatch[1]!) : 10;
      const unit = maxSizeMatch?.[2]?.toLowerCase() || 'mb';
      const multiplier = unit === 'kb' ? 1024 : unit === 'mb' ? 1024 * 1024 : unit === 'gb' ? 1024 * 1024 * 1024 : 1024 * 1024;
      const maxBinarySize = maxSizeNum * multiplier;
      
      const estimatedBinarySize = (content.length * 3) / 4;
      if (estimatedBinarySize > maxBinarySize) {
        res.status(413).json({
          error: {
            code: 'CONTENT_TOO_LARGE',
            message: `Content exceeds maximum size of ${maxSizeStr}`
          }
        });
        return;
      }
    }
    
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
      name
    );
    
    if (!recordResult.success) {
      // Check for specific error codes
      let status = 500;
      if (recordResult.error.code === 'NAME_EXISTS') {
        status = 409;
      } else if (recordResult.error.code === 'INVALID_NAME') {
        status = 400;
      }
      
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
router.get('/', extractPod, optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.pod_id) {
    return next();
  }
  
  if (!req.pod) {
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
 * GET {pod}.webpods.org/{stream_path}/{name} - Get by name
 */
router.get('/*', extractPod, optionalAuth, rateLimit('read'), async (req: Request, res: Response, next: NextFunction) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.pod_id) {
    return next();
  }
  
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
  
  // Determine if last part is a name or part of stream path
  let streamId: string;
  let name: string | undefined;
  
  if (indexQuery) {
    // If using index query, entire path is stream ID
    streamId = pathParts.join('/');
  } else if (pathParts.length > 1) {
    // Check if last part could be a name (not using index query)
    // Try to find stream with full path first
    const fullPath = pathParts.join('/');
    const streamResult = await getStream(db, req.pod!.id, fullPath);
    
    if (streamResult.success) {
      streamId = fullPath;
    } else {
      // Assume last part is name
      name = pathParts.pop();
      streamId = pathParts.join('/');
    }
  } else {
    streamId = pathParts[0]!;
  }
  
  // Get stream
  const streamResult = await getStream(db, req.pod!.id, streamId);
  
  if (!streamResult.success) {
    // Provide more informative error message
    const fullPath = req.path.substring(1);
    if (name) {
      // We were looking for a record in a stream that doesn't exist
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Not found: no stream '${fullPath}' and no stream '${streamId}' with record '${name}'`
        }
      });
    } else {
      // We were looking for a stream
      res.status(404).json({
        error: {
          code: 'STREAM_NOT_FOUND',
          message: `Stream '${streamId}' not found`
        }
      });
    }
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
      // Single record by index (don't prefer name when using ?i=)
      const result = await getRecord(db, streamResult.data.id, parsed.start.toString(), false);
      
      if (!result.success) {
        res.status(404).json({
          error: result.error
        });
        return;
      }
      
      // Check if record is deleted
      const record = result.data;
      try {
        const content = typeof record.content === 'string' && record.content_type === 'application/json'
          ? JSON.parse(record.content)
          : record.content;
        
        if (typeof content === 'object' && content !== null && content.deleted === true) {
          res.status(404).json({
            error: {
              code: 'RECORD_DELETED',
              message: 'Record has been deleted'
            }
          });
          return;
        }
      } catch {
        // Not JSON or can't parse, continue normally
      }
      
      // Return raw content for single records
      // Set headers
      res.setHeader('X-Hash', record.hash);
      res.setHeader('X-Previous-Hash', record.previous_hash || '');
      res.setHeader('X-Author', record.author_id);
      res.setHeader('X-Timestamp', record.created_at.toISOString());
      
      // Set content type and send response
      res.type(record.content_type);
      
      // Handle different content types
      if (isBinaryContentType(record.content_type)) {
        // Decode base64 for binary content
        const buffer = Buffer.from(record.content, 'base64');
        res.send(buffer);
      } else if (record.content_type === 'application/json' && typeof record.content === 'string') {
        // Parse JSON content if needed
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
  } else if (name) {
    // Get by name (prefer name over index for path-based access)
    const result = await getRecord(db, streamResult.data.id, name, true);
    
    if (!result.success) {
      res.status(404).json({
        error: result.error
      });
      return;
    }
    
    // Check if there's a tombstone record for this name that's newer than the current record
    const tombstonePattern = `${name}.deleted.%`;
    const tombstones = await db('record')
      .where('stream_id', streamResult.data.id)
      .where('name', 'like', tombstonePattern)
      .where('index', '>', result.data.index)  // Only tombstones newer than our record
      .orderBy('index', 'desc')
      .limit(1);
    
    if (tombstones.length > 0) {
      // Found a newer tombstone, so this record is considered deleted
      res.status(404).json({
        error: {
          code: 'RECORD_DELETED',
          message: 'Record has been deleted'
        }
      });
      return;
    }
    
    // Check if record itself is a purged record
    const record = result.data;
    try {
      const content = typeof record.content === 'string' && record.content_type === 'application/json'
        ? JSON.parse(record.content)
        : record.content;
      
      if (typeof content === 'object' && content !== null && (content.deleted === true || content.purged === true)) {
        res.status(404).json({
          error: {
            code: 'RECORD_DELETED',
            message: 'Record has been deleted'
          }
        });
        return;
      }
    } catch {
      // Not JSON or can't parse, continue normally
    }
    
    // Return raw content for single records
    // Set headers
    res.setHeader('X-Hash', record.hash);
    res.setHeader('X-Previous-Hash', record.previous_hash || '');
    res.setHeader('X-Author', record.author_id);
    res.setHeader('X-Timestamp', record.created_at.toISOString());
    
    // Set content type and send response
    res.type(record.content_type);
    
    // Handle different content types
    if (isBinaryContentType(record.content_type)) {
      // Decode base64 for binary content
      const buffer = Buffer.from(record.content, 'base64');
      res.send(buffer);
    } else if (record.content_type === 'application/json' && typeof record.content === 'string') {
      // Parse JSON content if needed
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
 * Delete stream or record
 * DELETE {pod}.webpods.org/{stream_path} - Delete stream
 * DELETE {pod}.webpods.org/{stream_path}/{name} - Delete record (soft delete)
 * DELETE {pod}.webpods.org/{stream_path}/{name}?purge=true - Purge record (hard delete)
 */
router.delete('/*', extractPod, authenticate, async (req: Request, res: Response, next: NextFunction) => {
  // If no pod_id was extracted, this is the main domain - skip to next handler
  if (!req.pod_id) {
    return next();
  }
  
  if (!req.auth) {
    res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required'
      }
    });
    return;
  }

  const db = getDb();
  const pathParts = req.path.substring(1).split('/'); // Remove leading /
  const purge = req.query.purge === 'true';
  
  // Check if we're trying to delete a record or a stream
  // Similar logic to GET - check if full path is a stream first
  let streamId: string;
  let recordName: string | undefined;
  
  if (pathParts.length > 1) {
    const fullPath = pathParts.join('/');
    const streamResult = await getStream(db, req.pod!.id, fullPath);
    
    if (streamResult.success) {
      // Full path is a stream, delete the stream
      streamId = fullPath;
    } else {
      // Try as record in parent stream
      recordName = pathParts.pop();
      streamId = pathParts.join('/');
    }
  } else {
    streamId = pathParts[0]!;
  }
  
  // Prevent deletion of system streams via this endpoint
  if (!recordName && streamId && isSystemStream(streamId)) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'System streams cannot be deleted'
      }
    });
    return;
  }
  
  // Check ownership - only pod owner can delete
  const ownerResult = await getPodOwner(db, req.pod_id);
  if (!ownerResult.success || ownerResult.data !== req.auth.user_id) {
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Only pod owner can delete streams or records'
      }
    });
    return;
  }
  
  if (recordName) {
    // Delete or purge a record
    const streamResult = await getStream(db, req.pod!.id, streamId);
    
    if (!streamResult.success) {
      const fullPath = req.path.substring(1);
      res.status(404).json({
        error: {
          code: 'NOT_FOUND',
          message: `Not found: no stream '${fullPath}' and no stream '${streamId}' with record '${recordName}'`
        }
      });
      return;
    }
    
    if (purge) {
      // Hard delete - physically overwrite the content
      const updateResult = await db('record')
        .where('stream_id', streamResult.data.id)
        .where('name', recordName)
        .update({
          content: JSON.stringify({ deleted: true, purged: true, purgedAt: new Date().toISOString(), purgedBy: req.auth.auth_id }),
          content_type: 'application/json'
        });
      
      if (updateResult === 0) {
        res.status(404).json({
          error: {
            code: 'RECORD_NOT_FOUND',
            message: `Record '${recordName}' not found in stream '${streamId}'`
          }
        });
        return;
      }
      
      logger.info('Record purged', { podId: req.pod_id, streamId, recordName, userId: req.auth.user_id });
      res.status(204).send();
    } else {
      // Soft delete - add a tombstone record with a unique name
      // Get the next index for the tombstone
      const lastRecord = await db('record')
        .where('stream_id', streamResult.data.id)
        .orderBy('index', 'desc')
        .first();
      
      const nextIndex = (lastRecord?.index ?? -1) + 1;
      const tombstoneName = `${recordName}.deleted.${nextIndex}`;
      
      const deletionRecord = {
        deleted: true,
        deletedAt: new Date().toISOString(),
        deletedBy: req.auth.auth_id,
        originalName: recordName
      };
      
      const writeResult = await writeRecord(
        db,
        streamResult.data.id,
        deletionRecord,
        'application/json',
        req.auth.auth_id,
        tombstoneName
      );
      
      if (!writeResult.success) {
        res.status(500).json({
          error: writeResult.error
        });
        return;
      }
      
      logger.info('Record soft deleted', { podId: req.pod_id, streamId, recordName, userId: req.auth.user_id });
      res.status(204).send();
    }
  } else {
    // Delete entire stream
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
  }
});

export default router;