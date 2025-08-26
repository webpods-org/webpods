/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";

export function recordToResponse(record: StreamRecord): StreamRecordResponse {
  let content = record.content;

  // Parse JSON content if needed
  if (
    record.content_type === "application/json" &&
    typeof content === "string"
  ) {
    try {
      content = JSON.parse(content);
    } catch {
      // Keep as string if parse fails
    }
  }

  return {
    index: record.index,
    content: content,
    content_type: record.content_type,
    name: record.name,
    hash: record.hash,
    previous_hash: record.previous_hash,
    author: record.user_id,
    timestamp: record.created_at.toISOString(),
  };
}
