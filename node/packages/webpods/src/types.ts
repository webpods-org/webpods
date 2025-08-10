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
  auth_id: string; // Format: auth:provider:id
  email: string | null;
  name: string | null;
  provider: 'github' | 'google';
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

export interface Pod {
  id: string;
  pod_id: string; // Subdomain (e.g., 'alice')
  owner_id: string;
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

export interface Stream {
  id: string;
  pod_id: string;
  stream_id: string; // Stream path within pod (can include slashes)
  creator_id: string;
  access_permission: string; // 'public', 'private', or '/streamname'
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

export interface StreamRecord {
  id: number;
  stream_id: string;
  index: number; // Position in stream (0-based)
  content: string | any; // Can be text or JSON
  content_type: string;
  alias: string | null; // Can be any string including numbers
  hash: string;
  previous_hash: string | null;
  author_id: string; // Format: auth:provider:id
  metadata?: any;
  created_at: Date;
}

export interface CustomDomain {
  id: string;
  pod_id: string;
  domain: string;
  ssl_provisioned: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface RateLimit {
  id: string;
  key: string; // user_id or ip_address
  action: 'read' | 'write' | 'pod_create' | 'stream_create';
  count: number;
  window_start: Date;
  window_end: Date;
}

// API types
export interface StreamRecordResponse {
  index: number; // Position in stream (0-based)
  content: any;
  content_type: string;
  alias: string | null;
  hash: string;
  previous_hash: string | null;
  author: string;
  timestamp: string;
}

export interface StreamListResponse {
  records: StreamRecordResponse[];
  total: number;
  has_more: boolean;
  next_index: number | null; // Next index to fetch
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
  user_id: string;
  email: string | null;
  name: string | null;
  provider: string;
}

// Permission types
export type Permission = 'public' | 'private' | string; // Can be /allow-list or ~/deny-list

export interface PermissionRecord {
  id: string; // User auth_id
  read: boolean;
  write: boolean;
}

// System stream content types
export interface OwnerRecord {
  owner: string; // auth:provider:id
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
  auth_id: string;
  email: string | null;
  name: string | null;
  provider: string;
  iat?: number;
  exp?: number;
}

// Express extensions
import { Request } from 'express';
export interface AuthRequest extends Request {
  auth?: JWTPayload;
  pod?: Pod;
  ip_address?: string;
}

// Input types
export interface CreatePodInput {
  pod_id: string;
}

export interface CreateStreamInput {
  stream_id: string;
  access_permission?: string;
}

export interface WriteRecordInput {
  content: any;
  content_type?: string;
  alias?: string;
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