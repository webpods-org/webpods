/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";

export function recordToResponse(
  record: StreamRecord,
  streamPath: string,
): StreamRecordResponse {
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

  // Combine stream path with record name for full path
  const fullPath = streamPath.endsWith("/")
    ? `${streamPath}${record.name}`
    : `${streamPath}/${record.name}`;

  return {
    index: record.index,
    content: content,
    contentType: record.contentType,
    name: record.name,
    path: fullPath,
    contentHash: record.contentHash,
    hash: record.hash,
    previousHash: record.previousHash,
    userId: record.userId,
    timestamp: record.createdAt.toISOString(),
  };
}
