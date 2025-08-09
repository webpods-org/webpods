// Core types for WebPods

export interface DomainError {
  code: string;
  message: string;
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

export interface User {
  id: string;
  auth_id: string;
  email?: string;
  name?: string;
  provider: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface Queue {
  id: string;
  q_id: string;
  creator_id: string;
  read_permission: string;
  write_permission: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface QueueRecord {
  id: number;
  queue_id: string;
  sequence_num: number;
  content: any;
  content_type: string;
  metadata?: Record<string, any>;
  created_by?: string;
  created_at: Date;
}

export interface RateLimit {
  id: string;
  user_id: string;
  action: 'read' | 'write';
  count: number;
  window_start: Date;
  window_end: Date;
}

export interface AuthRequest extends Express.Request {
  auth?: {
    userId: string;
    authId: string;
  };
}

export interface CreateQueueInput {
  q_id: string;
  read_permission?: string;
  write_permission?: string;
  metadata?: Record<string, any>;
}

export interface WriteRecordInput {
  content: any;
  content_type?: string;
  metadata?: Record<string, any>;
}

export interface ListRecordsQuery {
  limit?: number;
  after?: number;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
  };
}