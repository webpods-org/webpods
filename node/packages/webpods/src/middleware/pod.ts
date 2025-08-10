/**
 * Pod extraction middleware
 */

import { Request, Response, NextFunction } from 'express';
import { extractPodId } from '../utils.js';
import { findPodByDomain } from '../domain/routing.js';
import { getPod } from '../domain/pods.js';
import { getDb } from '../db.js';
import { createLogger } from '../logger.js';
import { Pod } from '../types.js';

const logger = createLogger('webpods:pod');

// Extend Express Request type
declare module 'express-serve-static-core' {
  interface Request {
    pod?: Pod;
    pod_id?: string;
  }
}

/**
 * Extract pod from hostname
 */
export async function extractPod(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
    const db = getDb();
    
    // First try standard subdomain format
    let podId = extractPodId(hostname);
    
    // If not found, check custom domains
    if (!podId) {
      const result = await findPodByDomain(db, hostname);
      if (result.success && result.data) {
        podId = result.data;
      }
    }
    
    if (!podId) {
      res.status(404).json({
        error: {
          code: 'POD_NOT_FOUND',
          message: 'Pod not found'
        }
      });
      return;
    }
    
    // Get the pod
    const podResult = await getPod(db, podId);
    
    if (!podResult.success) {
      res.status(404).json({
        error: {
          code: 'POD_NOT_FOUND',
          message: 'Pod not found'
        }
      });
      return;
    }
    
    req.pod = podResult.data;
    req.pod_id = podId;
    
    logger.debug('Pod extracted', { podId, hostname });
    next();
  } catch (error) {
    logger.error('Pod extraction error', { error });
    res.status(500).json({
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Failed to extract pod'
      }
    });
  }
}

/**
 * Optional pod extraction - doesn't fail if no pod found
 */
export async function optionalExtractPod(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const hostname = req.hostname || req.headers.host?.split(':')[0] || '';
    const db = getDb();
    
    // First try standard subdomain format
    let podId = extractPodId(hostname);
    
    // If not found, check custom domains
    if (!podId) {
      const result = await findPodByDomain(db, hostname);
      if (result.success && result.data) {
        podId = result.data;
      }
    }
    
    if (podId) {
      // Get the pod
      const podResult = await getPod(db, podId);
      
      if (podResult.success) {
        req.pod = podResult.data;
        req.pod_id = podId;
      }
    }
    
    next();
  } catch (error) {
    logger.error('Optional pod extraction error', { error });
    next();
  }
}