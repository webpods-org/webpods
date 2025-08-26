/**
 * Core types for WebPods
 */

// Result type for error handling
export interface DomainError {
  code: string;
  message: string;
  details?: any;
}

export type Result<T, E = DomainError> =
  | { success: true; data: T }
  | { success: false; error: E };

export function success<T>(data: T): Result<T> {
  return { success: true, data };
}

export function failure(error: DomainError): Result<never> {
  return { success: false, error };
}

// Database entities
export interface User {
  id: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface Identity {
  id: string;
  userId: string;
  provider: string; // OAuth provider ID from config.json
  providerId: string; // ID from the provider
  email: string | null;
  name: string | null;
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface Pod {
  name: string; // Primary key - Subdomain (e.g., 'alice')
  userId: string; // Owner ID from .meta/owner stream
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface Stream {
  podName: string; // Part of composite primary key
  name: string; // Part of composite primary key - Stream path within pod (can include slashes)
  userId: string;
  accessPermission: string; // 'public', 'private', or '/streamname'
  metadata?: any;
  createdAt: Date;
  updatedAt: Date;
}

export interface StreamRecord {
  id: number;
  podName: string; // References stream.podName
  streamName: string; // References stream.name
  index: number; // Position in stream (0-based)
  content: string | any; // Can be text or JSON
  contentType: string;
  name: string; // Required name (like a filename)
  hash: string;
  previousHash: string | null;
  userId: string; // User ID who created the record
  metadata?: any;
  createdAt: Date;
}

export interface CustomDomain {
  id: number; // bigserial
  podName: string;
  domain: string;
  sslProvisioned: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface RateLimit {
  id: number; // bigserial
  key: string; // userId or ipAddress
  action: "read" | "write" | "pod_create" | "stream_create";
  count: number;
  windowStart: Date;
  windowEnd: Date;
}

// API types
export interface StreamRecordResponse {
  index: number; // Position in stream (0-based)
  content: any;
  contentType: string;
  name: string;
  hash: string;
  previousHash: string | null;
  author: string;
  timestamp: string;
}

export interface StreamListResponse {
  records: StreamRecordResponse[];
  total: number;
  hasMore: boolean;
  nextIndex: number | null; // Next index to fetch
}

export interface PodListResponse {
  pod: string;
  streams: string[];
}

export interface AuthResponse {
  token: string;
  user: {
    email: string | null;
    name: string | null;
    provider: string;
  };
}

export interface WhoAmIResponse {
  userId: string;
  email: string | null;
  name: string | null;
  provider: string;
}

// OAuth Provider type
export interface OAuthProvider {
  provider: string;
  clientId: string;
  clientSecret: string;
  authorizationURL?: string;
  tokenURL?: string;
  userInfoURL?: string;
  scope?: string;
}

// Permission types
export type Permission = "public" | "private" | string; // Can be /allow-list or ~/deny-list

export interface PermissionRecord {
  id: string; // User ID
  read: boolean;
  write: boolean;
}

// System stream content types
export interface OwnerRecord {
  owner: string; // User ID
}

export interface LinksRecord {
  [path: string]: string; // Path to stream/record mapping
}

export interface DomainsRecord {
  domains: string[];
}

// JWT payload
export interface JWTPayload {
  user_id: string;
  email?: string | null;
  name?: string | null;
  pod?: string; // Optional pod claim for pod-specific tokens
  iat?: number;
  exp?: number;
}

// Hydra OAuth token payload
export interface HydraAuth {
  user_id: string;
  email?: string | null;
  name?: string | null;
  client_id?: string;
  pods?: string[]; // List of pods with full access
  scope?: string;
}

// Combined auth type
export type AuthPayload = JWTPayload | HydraAuth;

// Express extensions
import { Request } from "express";
export interface AuthRequest extends Request {
  auth?: AuthPayload;
  authType?: "webpods" | "hydra";
  pod?: Pod;
  podName?: string;
  ipAddress?: string;
}

// Input types
export interface CreatePodInput {
  name: string;
}

export interface CreateStreamInput {
  name: string;
  accessPermission?: string;
}

export interface WriteRecordInput {
  content: any;
  contentType?: string;
  name: string;
}

export interface ListRecordsQuery {
  limit?: number;
  after?: number;
  index?: string; // For ?i= query parameter (e.g., "0", "-1", "10:20")
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}
