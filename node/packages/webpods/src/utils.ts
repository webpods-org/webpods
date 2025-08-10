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
 * Validate stream ID
 * Alphanumeric, underscore, hyphen, slash for nested paths, max 256 chars
 */
export function isValidStreamId(streamId: string): boolean {
  if (!streamId || streamId.length > 256) return false;
  // Allow slashes for nested paths like blog/posts/2024
  return /^[a-zA-Z0-9_\-\/\.]+$/.test(streamId);
}

/**
 * Check if stream ID is a system stream (starts with .system/)
 */
export function isSystemStream(streamId: string): boolean {
  return streamId.startsWith('.system/');
}

/**
 * Validate alias (any string is valid now, including numbers)
 */
export function isValidAlias(alias: string): boolean {
  if (!alias || alias.length > 256) return false;
  // Any non-empty string is valid as an alias
  return true;
}

/**
 * Parse index query parameter (e.g., "0", "-1", "10:20")
 */
export function parseIndexQuery(query: string): { type: 'single' | 'range'; start: number; end?: number } | null {
  // Single index (including negative)
  if (/^-?\d+$/.test(query)) {
    return { type: 'single', start: parseInt(query, 10) };
  }
  
  // Range with colon (e.g., "10:20", "-10:-1")
  const match = query.match(/^(-?\d+):(-?\d+)$/);
  if (match) {
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    return { type: 'range', start, end };
  }
  
  return null;
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
  streams: string[];
} {
  if (permission === 'public') {
    return { type: 'public', streams: [] };
  }
  
  if (permission === 'private') {
    return { type: 'private', streams: [] };
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
    return { type: 'allow', streams: allows };
  }
  
  if (denies.length > 0) {
    return { type: 'deny', streams: denies };
  }
  
  return { type: 'public', streams: [] };
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