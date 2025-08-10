/**
 * Utility functions for WebPods
 */

import { createHash } from 'crypto';

/**
 * Validate pod ID (subdomain)
 * Must be lowercase alphanumeric with hyphens, max 63 chars
 */
export function isValidPodId(podId: string): boolean {
  if (!podId || podId.length > 63) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(podId);
}

/**
 * Validate queue ID
 * Alphanumeric, underscore, hyphen, max 256 chars
 */
export function isValidQueueId(queueId: string): boolean {
  if (!queueId || queueId.length > 256) return false;
  return /^[a-zA-Z0-9_-]+$/.test(queueId);
}

/**
 * Check if queue ID is a system queue (starts with _)
 */
export function isSystemQueue(queueId: string): boolean {
  return queueId.startsWith('_');
}

/**
 * Validate alias (must contain at least one non-numeric character)
 */
export function isValidAlias(alias: string): boolean {
  if (!alias || alias.length > 256) return false;
  // Must contain at least one non-numeric character
  return /[^0-9-]/.test(alias);
}

/**
 * Parse range string (e.g., "10-20", "-5--1")
 */
export function parseRange(range: string): { start: number; end: number } | null {
  const match = range.match(/^(-?\d+)-(-?\d+)$/);
  if (!match) return null;
  
  const start = parseInt(match[1]!, 10);
  const end = parseInt(match[2]!, 10);
  
  return { start, end };
}

/**
 * Calculate SHA-256 hash for record
 */
export function calculateRecordHash(
  previousHash: string | null,
  timestamp: string,
  content: any
): string {
  const data = JSON.stringify({
    previous_hash: previousHash,
    timestamp: timestamp,
    content: content
  });
  
  return 'sha256:' + createHash('sha256').update(data).digest('hex');
}

/**
 * Extract pod ID from hostname
 */
export function extractPodId(hostname: string): string | null {
  // Handle custom domains first (check database)
  // For now, handle standard format: {pod_id}.webpods.org
  
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  
  // Check if it's a webpods.org subdomain
  if (parts[parts.length - 2] === 'webpods' && parts[parts.length - 1] === 'org') {
    if (parts.length === 3) {
      const podId = parts[0]!;
      return isValidPodId(podId) ? podId : null;
    }
  }
  
  // For custom domains, we'll need to check the database
  return null;
}

/**
 * Parse permission string
 */
export function parsePermission(permission: string): {
  type: 'public' | 'private' | 'allow' | 'deny';
  queues: string[];
} {
  if (permission === 'public') {
    return { type: 'public', queues: [] };
  }
  
  if (permission === 'private') {
    return { type: 'private', queues: [] };
  }
  
  // Parse allow/deny lists
  const parts = permission.split(',').map(p => p.trim());
  const allows: string[] = [];
  const denies: string[] = [];
  
  for (const part of parts) {
    if (part.startsWith('~/')) {
      denies.push(part.substring(2));
    } else if (part.startsWith('/')) {
      allows.push(part.substring(1));
    }
  }
  
  if (allows.length > 0) {
    return { type: 'allow', queues: allows };
  }
  
  if (denies.length > 0) {
    return { type: 'deny', queues: denies };
  }
  
  return { type: 'public', queues: [] };
}

/**
 * Detect content type from headers
 */
export function detectContentType(headers: Record<string, string | string[] | undefined>): string {
  // 1. Check X-Content-Type header (highest priority)
  const xContentType = headers['x-content-type'];
  if (xContentType) {
    return Array.isArray(xContentType) ? xContentType[0]! : xContentType;
  }
  
  // 2. Check standard Content-Type header
  const contentType = headers['content-type'];
  if (contentType) {
    const ct = Array.isArray(contentType) ? contentType[0]! : contentType;
    // Extract just the media type, ignore charset etc
    return ct.split(';')[0]!.trim();
  }
  
  // 3. Default to text/plain
  return 'text/plain';
}

/**
 * Format auth ID
 */
export function formatAuthId(provider: string, id: string): string {
  return `auth:${provider}:${id}`;
}

/**
 * Parse auth ID
 */
export function parseAuthId(authId: string): { provider: string; id: string } | null {
  const match = authId.match(/^auth:([^:]+):(.+)$/);
  if (!match) return null;
  return { provider: match[1]!, id: match[2]! };
}

/**
 * Check if a string is a valid index (numeric)
 */
export function isNumericIndex(str: string): boolean {
  return /^-?\d+$/.test(str);
}

/**
 * Get IP address from request
 */
export function getIpAddress(req: any): string {
  return req.headers['x-forwarded-for']?.split(',')[0].trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         '127.0.0.1';
}