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
 * Alphanumeric, underscore, hyphen, slash for nested paths, single dots allowed (no consecutive dots)
 * Max 256 chars
 */
export function isValidStreamId(streamId: string): boolean {
  if (!streamId || streamId.length > 256) return false;
  
  // Check for consecutive dots (not allowed)
  if (streamId.includes('..')) return false;
  
  // Cannot start or end with a dot
  if (streamId.startsWith('.') || streamId.endsWith('.')) return false;
  
  // Allow slashes for nested paths like blog/posts/2024, and single dots
  return /^[a-zA-Z0-9_\-/.]+$/.test(streamId);
}

/**
 * Check if stream ID is a system stream (starts with .meta/)
 */
export function isSystemStream(streamId: string): boolean {
  return streamId.startsWith('.meta/');
}

/**
 * Validate name - must be like a filename
 * Allowed characters: a-z, A-Z, 0-9, hyphen (-), underscore (_), period (.)
 * Cannot start or end with a period (to avoid . and .. confusion)
 * Cannot contain slashes or other special characters
 */
export function isValidName(name: string): boolean {
  // Check for empty, null, or too long
  if (!name || name.length === 0 || name.length > 256) return false;
  
  // Only allow: a-z, A-Z, 0-9, hyphen, underscore, period
  // Pattern: starts with alphanumeric/underscore/hyphen, 
  // can have periods in middle but not at start/end
  const validPattern = /^[a-zA-Z0-9_-]+(\.[a-zA-Z0-9_-]+)*$/;
  
  // Check pattern and ensure no leading/trailing periods
  return validPattern.test(name) && 
         !name.startsWith('.') && 
         !name.endsWith('.');
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
  // For now, handle standard format: {pod_id}.webpods.org or {pod_id}.localhost
  
  const parts = hostname.split('.');
  if (parts.length < 2) return null;
  
  // Check if it's a webpods.org subdomain
  if (parts[parts.length - 2] === 'webpods' && parts[parts.length - 1] === 'org') {
    if (parts.length === 3) {
      const podId = parts[0]!;
      return isValidPodId(podId) ? podId : null;
    }
  }
  
  // Check if it's a localhost subdomain (for testing)
  if (parts[parts.length - 1] === 'localhost') {
    if (parts.length === 2) {
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

/**
 * Supported content types for direct serving
 */
export const SERVABLE_CONTENT_TYPES = [
  'text/html',
  'text/css',
  'application/javascript',
  'application/json',
  'text/plain',
  // Image types
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/svg+xml',
  'image/x-icon',
  'image/ico'
];

/**
 * Binary content types that need base64 encoding
 */
export const BINARY_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/gif',
  'image/webp',
  'image/x-icon',
  'image/ico'
];

/**
 * Check if content type is servable
 */
export function isServableContentType(contentType: string): boolean {
  return SERVABLE_CONTENT_TYPES.includes(contentType.toLowerCase());
}

/**
 * Check if content type is binary
 */
export function isBinaryContentType(contentType: string): boolean {
  return BINARY_CONTENT_TYPES.includes(contentType.toLowerCase());
}

/**
 * Validate base64 string
 */
export function isValidBase64(str: string): boolean {
  if (!str || str.length === 0) return false;
  
  // Check if it's a data URL
  if (str.startsWith('data:')) {
    const matches = str.match(/^data:([^;]+);base64,(.+)$/);
    if (!matches) return false;
    str = matches[2]!;
  }
  
  // Basic base64 validation
  const base64Regex = /^[A-Za-z0-9+/]*={0,2}$/;
  return base64Regex.test(str) && str.length % 4 === 0;
}

/**
 * Extract base64 data and content type from data URL
 */
export function parseDataUrl(dataUrl: string): { contentType: string; data: string } | null {
  const matches = dataUrl.match(/^data:([^;]+);base64,(.+)$/);
  if (!matches) return null;
  
  return {
    contentType: matches[1]!,
    data: matches[2]!
  };
}