/**
 * Core types for WebPods CLI
 */

// Configuration
export interface WebPodsProfile {
  name: string;
  server: string;
  token?: string;
  defaultPod?: string;
  outputFormat?: "json" | "yaml" | "table" | "csv";
}

export interface WebPodsConfig {
  profiles: Record<string, WebPodsProfile>;
  currentProfile?: string;
  // Legacy fields for backward compatibility
  server?: string;
  token?: string;
  defaultPod?: string;
  outputFormat: "json" | "yaml" | "table" | "csv";
}

// CLI Context
export interface CliContext {
  workingDir: string;
  config: WebPodsConfig;
}

// Result type for error handling (matches WebPods server pattern)
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

// API Response types (matching WebPods server)
export interface User {
  user_id: string;
  email: string | null;
  name: string | null;
  provider: string;
}

export interface Pod {
  id: string;
  name: string;
  user_id: string;
  created_at: string;
}

export interface Stream {
  id: string;
  pod_id: string;
  stream_id: string;
  user_id: string;
  access_permission: string;
  created_at: string;
}

export interface StreamRecord {
  index: number;
  content: any;
  content_type: string;
  name: string;
  hash: string;
  previous_hash: string | null;
  author: string;
  timestamp: string;
}

export interface StreamListResponse {
  records: StreamRecord[];
  total: number;
  has_more: boolean;
  next_index: number | null;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
  };
}

export interface AuthResponse {
  token: string;
  user: User;
}

export interface OAuthClient {
  id: string;
  user_id: string;
  client_id: string;
  client_name: string;
  redirect_uris: string[];
  requested_pods: string[];
  created_at: string;
}

// Command argument types
export interface GlobalOptions {
  token?: string;
  server?: string;
  profile?: string;
  format?: "json" | "yaml" | "table" | "csv";
  quiet?: boolean;
  verbose?: boolean;
  "no-color"?: boolean;
  config?: string;
}

// Yargs command handler types
export interface LoginArgs extends GlobalOptions {
  provider?: string;
}

export interface TokenSetArgs extends GlobalOptions {
  token: string;
}

export interface CreatePodArgs extends GlobalOptions {
  name: string;
}

export interface DeletePodArgs extends GlobalOptions {
  pod: string;
  force?: boolean;
}

export interface InfoPodArgs extends GlobalOptions {
  pod: string;
}

export interface WriteArgs extends GlobalOptions {
  pod: string;
  stream: string;
  name: string;
  data?: string;
  file?: string;
  permission?: string;
}

export interface ReadArgs extends GlobalOptions {
  pod: string;
  stream: string;
  name?: string;
  index?: string;
  output?: string;
}

export interface ListArgs extends GlobalOptions {
  pod: string;
  stream: string;
  limit?: number;
  after?: number;
  unique?: boolean;
}

export interface StreamsArgs extends GlobalOptions {
  pod: string;
}

export interface DeleteStreamArgs extends GlobalOptions {
  pod: string;
  stream: string;
  force?: boolean;
}

export interface PermissionsArgs extends GlobalOptions {
  pod: string;
  stream: string;
  action?: string;
  mode?: string;
  user?: string;
}

export interface OAuthRegisterArgs extends GlobalOptions {
  name: string;
  redirect: string;
  pods?: string;
}

export interface OAuthDeleteArgs extends GlobalOptions {
  clientId: string;
  force?: boolean;
}

export interface OAuthInfoArgs extends GlobalOptions {
  clientId: string;
}

export interface ConfigArgs extends GlobalOptions {
  key?: string;
  value?: string;
}

export interface ConfigServerArgs extends GlobalOptions {
  url: string;
}

export interface WriteOptions extends GlobalOptions {
  permission?: string;
  file?: string;
}

export interface ReadOptions extends GlobalOptions {
  index?: string;
  output?: string;
}

export interface ListOptions extends GlobalOptions {
  limit?: number;
  after?: number;
  unique?: boolean;
}

export interface PermissionOptions extends GlobalOptions {
  mode?: string;
  user?: string;
}

export interface OAuthRegisterOptions extends GlobalOptions {
  name: string;
  redirect: string;
  pods?: string;
}

// Output formatting
export interface TableRow {
  [key: string]: string | number | boolean;
}
