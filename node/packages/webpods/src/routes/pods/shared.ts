/**
 * Shared utilities and imports for pod routes
 */

import type {
  Request as ExpressRequest,
  Response,
  NextFunction,
} from "express";
import type { AuthRequest, StreamRecord } from "../../types.js";
import type { CodedError } from "../../utils/errors.js";
import { z } from "zod";
import {
  authenticateHybrid as authenticate,
  optionalAuthHybrid as optionalAuth,
} from "../../middleware/hybrid-auth.js";
import { extractPod } from "../../middleware/pod.js";
import { rateLimit } from "../../middleware/ratelimit.js";
import { createLogger } from "../../logger.js";
import { getConfig } from "../../config-loader.js";
import {
  parseIndexQuery,
  detectContentType,
  isSystemStream,
  isBinaryContentType,
  isValidBase64,
  parseDataUrl,
  isValidName,
} from "../../utils.js";

// Re-export middleware chains for common use
export const readMiddleware = [
  extractPod,
  optionalAuth,
  rateLimit("read"),
] as const;
export const writeMiddleware = [
  extractPod,
  authenticate,
  rateLimit("write"),
] as const;
export const deleteMiddleware = [
  extractPod,
  authenticate,
  rateLimit("write"),
] as const;
export const configMiddleware = [extractPod, optionalAuth] as const;

// Validation schemas
export const writeSchema = z.union([z.string(), z.object({}).passthrough()]);

export const ownerSchema = z.object({
  owner: z.string(),
});

export const linksSchema = z.record(z.string());

export const domainsSchema = z.object({
  domains: z.array(z.string()),
});

// Logger factory
export function createRouteLogger(routeName: string) {
  return createLogger(`webpods:routes:pods:${routeName}`);
}

// Re-export commonly used imports
export {
  authenticate,
  optionalAuth,
  extractPod,
  rateLimit,
  getConfig,
  parseIndexQuery,
  detectContentType,
  isSystemStream,
  isBinaryContentType,
  isValidBase64,
  parseDataUrl,
  isValidName,
};

export type {
  ExpressRequest,
  Response,
  NextFunction,
  AuthRequest,
  StreamRecord,
  CodedError,
};
