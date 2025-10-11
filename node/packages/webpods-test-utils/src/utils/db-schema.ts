/**
 * Database schema for test utilities
 * Re-export types from local db-types
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

export type {
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
};

/**
 * Database schema interface for Tinqer
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
