/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";

export interface RecordResponseOptions {
  fields?: string[];
  maxContentSize?: number;
}

export function recordToResponse(
  record: StreamRecord,
  streamPath: string,
  options?: RecordResponseOptions,
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

  // Apply content size limit if specified
  if (
    options?.maxContentSize &&
    options.maxContentSize > 0 &&
    typeof content === "string"
  ) {
    if (content.length > options.maxContentSize) {
      // Truncate content to maxContentSize
      content = content.substring(0, options.maxContentSize);
    }
  }

  // Combine stream path with record name for full path
  const fullPath = streamPath.endsWith("/")
    ? `${streamPath}${record.name}`
    : `${streamPath}/${record.name}`;

  // Build full response
  const fullResponse: StreamRecordResponse = {
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

  // If fields are specified, filter the response
  if (options?.fields && options.fields.length > 0) {
    const filteredResponse: Record<string, unknown> = {};

    for (const field of options.fields) {
      const key = field as keyof StreamRecordResponse;
      if (key in fullResponse) {
        filteredResponse[field] = fullResponse[key];
      }
    }

    // Always include size when content is requested (for truncation detection)
    if (
      options.fields.includes("content") &&
      !options.fields.includes("size")
    ) {
      filteredResponse.size = fullResponse.size;
    }

    return filteredResponse as unknown as StreamRecordResponse;
  }

  return fullResponse;
}
