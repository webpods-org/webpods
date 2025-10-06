/**
 * Tinqer database schema definition
 * Maps table names to their TypeScript row types for type-safe queries
 */

import type {
  UserDbRow,
  IdentityDbRow,
  PodDbRow,
  StreamDbRow,
  RecordDbRow,
  SessionDbRow,
  OAuthStateDbRow,
  RateLimitDbRow,
  CustomDomainDbRow,
  OAuthClientDbRow,
} from "../db-types.js";

/**
 * Database schema interface for Tinqer
 * Each key is a table name, each value is the row type
 */
export interface DatabaseSchema {
  user: UserDbRow;
  identity: IdentityDbRow;
  pod: PodDbRow;
  stream: StreamDbRow;
  record: RecordDbRow;
  session: SessionDbRow;
  oauth_state: OAuthStateDbRow;
  rate_limit: RateLimitDbRow;
  custom_domain: CustomDomainDbRow;
  oauth_client: OAuthClientDbRow;
}
