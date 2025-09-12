/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";

export function recordToResponse(
  record: StreamRecord,
  streamPath: string,
): StreamRecordResponse {
  let content = record.content;

  // Decode base64 if content is binary
  if (record.isBinary && typeof content === "string") {
    // For API responses, we return base64 for binary content
    // The GET handler will decode it when serving raw content
    // Keep as base64 for JSON responses (no change needed)
  } else if (
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
    size: record.size,
    name: record.name,
    path: fullPath,
    contentHash: record.contentHash,
    hash: record.hash,
    previousHash: record.previousHash,
    userId: record.userId,
    headers: record.headers,
    timestamp: record.createdAt.toISOString(),
  };
}
