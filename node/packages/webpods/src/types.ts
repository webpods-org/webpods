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

export interface Queue {
  id: string;
  pod_id: string;
  queue_id: string; // Queue name within pod
  creator_id: string;
  read_permission: string;
  write_permission: string;
  is_permission_queue: boolean;
  metadata?: any;
  created_at: Date;
  updated_at: Date;
}

export interface QueueItem {
  id: number;
  queue_id: string;
  sequence_num: number;
  content: string | any; // Can be text or JSON
  content_type: string;
  alias: string | null;
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
  action: 'read' | 'write' | 'pod_create' | 'queue_create';
  count: number;
  window_start: Date;
  window_end: Date;
}

// API types
export interface QueueItemResponse {
  sequence_num: number;
  content: any;
  content_type: string;
  alias: string | null;
  hash: string;
  previous_hash: string | null;
  author: string;
  timestamp: string;
}

export interface QueueListResponse {
  records: QueueItemResponse[];
  total: number;
  has_more: boolean;
  next_id: number | null;
}

export interface PodListResponse {
  pod: string;
  queues: string[];
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

// System queue content types
export interface OwnerRecord {
  owner: string; // auth:provider:id
}

export interface LinksRecord {
  [path: string]: string; // Path to queue/record mapping
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
export interface AuthRequest extends Express.Request {
  auth?: JWTPayload;
  pod?: Pod;
  ip_address?: string;
}

// Input types
export interface CreatePodInput {
  pod_id: string;
}

export interface CreateQueueInput {
  queue_id: string;
  read_permission?: string;
  write_permission?: string;
}

export interface WriteRecordInput {
  content: any;
  content_type?: string;
  alias?: string;
}

export interface ListRecordsQuery {
  limit?: number;
  after?: number;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}