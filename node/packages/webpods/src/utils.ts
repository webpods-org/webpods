/**
 * Utility functions for WebPods
 */

import { createHash } from "crypto";

/**
 * Validate pod name (subdomain)
 * Must be lowercase alphanumeric with hyphens, max 63 chars
 */
export function isValidPodName(podName: string): boolean {
  if (!podName || podName.length > 63) return false;
  return /^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(podName);
}

/**
 * Validate stream ID
 * Alphanumeric, underscore, hyphen, slash for nested paths, single dots allowed (no consecutive dots)
 * Max 256 chars
 */
export function isValidStreamId(streamId: string): boolean {
  if (!streamId || streamId.length > 256) return false;

  // Check for consecutive dots (not allowed)
  if (streamId.includes("..")) return false;

  // Cannot start or end with a dot
  if (streamId.startsWith(".") || streamId.endsWith(".")) return false;

  // Allow slashes for nested paths like blog/posts/2024, and single dots
  return /^[a-zA-Z0-9_\-/.]+$/.test(streamId);
}

/**
 * Check if stream ID is a system stream (starts with .config/ or /.config/)
 */
export function isSystemStream(streamId: string): boolean {
  return streamId.startsWith(".config/") || streamId.startsWith("/.config/");
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
  return (
    validPattern.test(name) && !name.startsWith(".") && !name.endsWith(".")
  );
}

/**
 * Parse index query parameter (e.g., "0", "-1", "10:20")
 */
export function parseIndexQuery(
  query: string,
): { type: "single" | "range"; start: number; end?: number } | null {
  // Single index (including negative)
  if (/^-?\d+$/.test(query)) {
    return { type: "single", start: parseInt(query, 10) };
  }

  // Range with colon (e.g., "10:20", "-10:-1")
  const match = query.match(/^(-?\d+):(-?\d+)$/);
  if (match) {
    const start = parseInt(match[1]!, 10);
    const end = parseInt(match[2]!, 10);
    return { type: "range", start, end };
  }

  return null;
}

/**
 * Calculate SHA-256 hash for content only
 */
export function calculateContentHash(content: unknown): string {
  const data = typeof content === "string" ? content : JSON.stringify(content);
  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

/**
 * Calculate SHA-256 hash for record (chain hash)
 */
export function calculateRecordHash(
  previousHash: string | null,
  contentHash: string,
  userId: string,
  timestamp: number,
): string {
  const data = JSON.stringify({
    previous_hash: previousHash,
    content_hash: contentHash,
    user_id: userId,
    timestamp: timestamp,
  });

  return "sha256:" + createHash("sha256").update(data).digest("hex");
}

/**
 * Check if a hostname is the main domain
 */
export function isMainDomain(
  hostname: string,
  configuredDomain: string,
): boolean {
  // Handle port numbers - strip them for comparison
  const hostWithoutPort = hostname.split(":")[0];
  const configWithoutPort = configuredDomain.split(":")[0];

  return hostWithoutPort === configWithoutPort;
}

/**
 * Check if a hostname is a subdomain of the main domain
 */
export function isSubdomainOf(hostname: string, mainDomain: string): boolean {
  const hostParts = hostname.split(".");
  const mainParts = mainDomain.split(".");

  // Must have more parts than main domain
  if (hostParts.length <= mainParts.length) {
    return false;
  }

  // Check if it ends with the main domain
  const hostSuffix = hostParts.slice(-mainParts.length).join(".");
  return hostSuffix === mainDomain;
}

/**
 * Extract pod name from hostname
 */
export function extractPodName(
  hostname: string,
  mainDomain?: string,
): string | null {
  // Get the main domain from config if not provided
  if (!mainDomain) {
    // This will be passed from the middleware which has access to config
    // For now, return null and let the middleware handle it
    return null;
  }

  // If it's the main domain itself, no pod
  if (isMainDomain(hostname, mainDomain)) {
    return null;
  }

  // If it's a subdomain, extract the pod name
  if (isSubdomainOf(hostname, mainDomain)) {
    // The first part is the pod name
    const podName = hostname.split(".")[0]!;
    return isValidPodName(podName) ? podName : null;
  }

  // Not a subdomain of the main domain - could be a custom domain
  return null;
}

/**
 * Parse permission string
 */
export function parsePermission(permission: string): {
  type: "public" | "private" | "allow" | "deny";
  streams: string[];
} {
  if (permission === "public") {
    return { type: "public", streams: [] };
  }

  if (permission === "private") {
    return { type: "private", streams: [] };
  }

  // Parse allow/deny lists
  const parts = permission.split(",").map((p) => p.trim());
  const allows: string[] = [];
  const denies: string[] = [];

  for (const part of parts) {
    if (part.startsWith("~/")) {
      denies.push(part.substring(2));
    } else if (part.startsWith("/")) {
      allows.push(part.substring(1));
    }
  }

  if (allows.length > 0) {
    return { type: "allow", streams: allows };
  }

  if (denies.length > 0) {
    return { type: "deny", streams: denies };
  }

  return { type: "public", streams: [] };
}

/**
 * Detect content type from headers
 */
export function detectContentType(
  headers: Record<string, string | string[] | undefined>,
): string {
  // Check standard Content-Type header
  const contentType = headers["content-type"];
  if (contentType) {
    const ct = Array.isArray(contentType) ? contentType[0]! : contentType;
    // Extract just the media type, ignore charset etc
    return ct.split(";")[0]!.trim();
  }

  // Default to text/plain
  return "text/plain";
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
export function getIpAddress(req: {
  headers: Record<string, string | string[] | undefined>;
  connection?: { remoteAddress?: string };
  socket?: { remoteAddress?: string };
}): string {
  const xForwardedFor = req.headers["x-forwarded-for"];
  const forwardedIp = Array.isArray(xForwardedFor)
    ? xForwardedFor[0]
    : xForwardedFor;
  const xRealIp = req.headers["x-real-ip"];
  const realIp = Array.isArray(xRealIp) ? xRealIp[0] : xRealIp;

  return (
    (forwardedIp && typeof forwardedIp === "string"
      ? forwardedIp.split(",")[0]?.trim()
      : undefined) ||
    (realIp && typeof realIp === "string" ? realIp : undefined) ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "127.0.0.1"
  );
}

/**
 * Supported content types for direct serving
 */
export const SERVABLE_CONTENT_TYPES = [
  "text/html",
  "text/css",
  "application/javascript",
  "application/json",
  "text/plain",
  // Image types
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "image/x-icon",
  "image/ico",
];

/**
 * Check if content type is servable
 */
export function isServableContentType(contentType: string): boolean {
  return SERVABLE_CONTENT_TYPES.includes(contentType.toLowerCase());
}
