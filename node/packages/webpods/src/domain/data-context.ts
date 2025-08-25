/**
 * Data context for domain functions
 * Similar to Foreman's DataContext but without orgId
 */

import type { Database } from "../db/index.js";

export interface DataContext {
  db: Database;
}