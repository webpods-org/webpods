/**
 * Database types that mirror the PostgreSQL schema
 * All database columns use snake_case
 */

// Utility type to make a row type suitable for inserts (omits id)
export type InsertRow<T> = Omit<T, "id">;

// User table - container for multiple identities
export type UserDbRow = {
  id: string;
  created_at: Date;
  updated_at?: Date | null;
};

// Identity table - OAuth provider identities
export type IdentityDbRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_id: string;
  email?: string | null;
  name?: string | null;
  metadata?: Record<string, unknown>; // JSONB
  created_at: Date;
  updated_at?: Date | null;
};

// Pod table
export type PodDbRow = {
  name: string; // Primary key
  metadata?: Record<string, unknown>; // JSONB
  created_at: Date;
  updated_at?: Date | null;
};

// Stream table - hierarchical streams (like directories)
export type StreamDbRow = {
  id: number; // bigint serial primary key
  pod_name: string; // References pod.name
  name: string; // Stream name (no slashes - like directory name)
  parent_id?: number | null; // References parent stream.id (bigint)
  user_id: string;
  access_permission: string;
  metadata?: Record<string, unknown>; // JSONB
  created_at: Date;
  updated_at?: Date | null;
};

// Record table - files within streams
export type RecordDbRow = {
  id: number; // bigserial primary key
  stream_id: number;
  index: number;
  content: string;
  content_type: string;
  name: string; // Required name (no slashes - like filename)
  content_hash: string; // SHA-256 hash of content only
  hash: string; // SHA-256 hash of (previous_hash + content_hash)
  previous_hash?: string | null;
  user_id: string; // References user.id
  created_at: Date | string; // Can be string when inserting
};

// Session table
export type SessionDbRow = {
  sid: string;
  sess: Record<string, unknown>; // JSON
  expire: Date;
};

// OAuth state table
export type OAuthStateDbRow = {
  state: string;
  code_verifier: string;
  pod?: string | null;
  redirect_uri?: string | null;
  expires_at: Date;
};

// Rate limit table
export type RateLimitDbRow = {
  id?: string | number; // bigserial
  identifier: string;
  action: string;
  count: number;
  window_start: Date;
  window_end: Date;
};

// Custom domain table
export type CustomDomainDbRow = {
  id?: string | number; // bigserial
  pod_name: string;
  domain: string;
  verified: boolean;
  ssl_provisioned: boolean;
  created_at: Date;
  updated_at?: Date | null;
};

// OAuth client table
export type OAuthClientDbRow = {
  id?: string | number; // bigserial
  user_id: string;
  client_id: string;
  client_name: string;
  client_secret?: string | null;
  redirect_uris: string[];
  requested_pods: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
  metadata?: Record<string, unknown>; // JSONB
  created_at: Date;
  updated_at?: Date | null;
};
