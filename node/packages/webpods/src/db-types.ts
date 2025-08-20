/**
 * Database types that mirror the PostgreSQL schema
 * All database columns use snake_case
 */

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
  metadata?: any; // JSONB
  created_at: Date;
  updated_at?: Date | null;
};

// Pod table
export type PodDbRow = {
  id: string;
  pod_id: string;
  created_at: Date;
};

// Stream table
export type StreamDbRow = {
  id: string;
  pod_id: string;
  stream_id: string;
  creator_id: string;
  access_permission: string;
  created_at: Date;
};

// Record table
export type RecordDbRow = {
  id?: string; // Optional for inserts
  stream_id: string;
  index: number;
  content: string;
  content_type: string;
  hash: string;
  previous_hash?: string | null;
  author_id: string; // Now references user.id
  name?: string | null;
  created_at: Date | string; // Can be string when inserting
};

// Session table
export type SessionDbRow = {
  sid: string;
  sess: any; // JSON
  expire: Date;
};

// OAuth state table
export type OAuthStateDbRow = {
  state: string;
  code_verifier: string;
  pod?: string | null;
  redirect_url?: string | null;
  expires_at: Date;
};

// Rate limit table
export type RateLimitDbRow = {
  id?: string;
  identifier: string;
  action: string;
  count: number;
  window_start: Date;
  window_end: Date;
};
