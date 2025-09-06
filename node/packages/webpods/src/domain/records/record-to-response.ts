/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";

export function recordToResponse(record: StreamRecord): StreamRecordResponse {
  let content = record.content;

  // Parse JSON content if needed
  if (
    record.contentType === "application/json" &&
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
    contentType: record.contentType,
    name: record.name,
    contentHash: record.contentHash,
    hash: record.hash,
    previousHash: record.previousHash,
    userId: record.userId,
    timestamp: record.createdAt.toISOString(),
  };
}
