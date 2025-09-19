/**
 * Database types that mirror the PostgreSQL schema
 * All database columns use snake_case
 */

// Utility type to make a row type suitable for inserts (omits id)
export type InsertRow<T> = Omit<T, "id">;

// User table - container for multiple identities
export type UserDbRow = {
  id: string;
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};

// Identity table - OAuth provider identities
export type IdentityDbRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_id: string;
  email?: string | null;
  name?: string | null;
  metadata: string; // TEXT storing JSON
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};

// Pod table
export type PodDbRow = {
  name: string; // Primary key
  owner_id?: string | null; // Pod owner - denormalized for performance
  metadata: string; // TEXT storing JSON
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};

// Stream table - hierarchical streams (like directories)
export type StreamDbRow = {
  id: number; // bigint serial primary key
  pod_name: string; // References pod.name
  name: string; // Stream name (no slashes - like directory name)
  path: string; // Full path for O(1) lookups
  parent_id?: number | null; // References parent stream.id (bigint)
  user_id: string;
  access_permission: string;
  has_schema: boolean; // Whether this stream has validation schema
  metadata: string; // TEXT storing JSON
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};

// Record table - files within streams
export type RecordDbRow = {
  id: number; // bigserial primary key
  stream_id: number;
  index: number;
  content: string;
  content_type: string;
  is_binary: boolean; // Whether content is base64-encoded binary
  size: number; // Content size in bytes
  name: string; // Required name (no slashes - like filename)
  path: string; // Full path including record name for O(1) lookups
  content_hash: string; // SHA-256 hash of content only
  hash: string; // SHA-256 hash of (previous_hash + content_hash)
  previous_hash?: string | null;
  user_id: string; // References user.id
  storage?: string | null; // External storage location (adapter-specific format)
  headers: string; // TEXT storing JSON
  deleted: boolean; // Soft delete flag
  purged: boolean; // Hard delete flag
  created_at: number; // BIGINT timestamp
};

// Session table (managed by connect-pg-simple)
export type SessionDbRow = {
  sid: string;
  sess: Record<string, unknown>; // JSONB
  expire: Date; // TIMESTAMP
};

// OAuth state table
export type OAuthStateDbRow = {
  state: string;
  code_verifier: string;
  pod?: string | null;
  redirect_uri?: string | null;
  created_at: number; // BIGINT timestamp
  expires_at: number; // BIGINT timestamp
};

// Rate limit table
export type RateLimitDbRow = {
  id?: string | number; // bigserial
  identifier: string;
  action: string;
  count: number;
  window_start: number; // BIGINT timestamp
  window_end: number; // BIGINT timestamp
};

// Custom domain table
export type CustomDomainDbRow = {
  id?: string | number; // bigserial
  pod_name: string;
  domain: string;
  verified: boolean;
  ssl_provisioned: boolean;
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};

// OAuth client table
export type OAuthClientDbRow = {
  id?: string | number; // bigserial
  user_id: string;
  client_id: string;
  client_name: string;
  client_secret?: string | null;
  redirect_uris: string; // TEXT storing JSON array
  requested_pods: string; // TEXT storing JSON array
  grant_types: string; // TEXT storing JSON array
  response_types: string; // TEXT storing JSON array
  token_endpoint_auth_method: string;
  scope: string;
  metadata: string; // TEXT storing JSON
  created_at: number; // BIGINT timestamp
  updated_at: number; // BIGINT timestamp
};
