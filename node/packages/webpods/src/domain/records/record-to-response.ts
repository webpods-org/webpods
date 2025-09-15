/**
 * Convert a record to a response format
 */

import { StreamRecord, StreamRecordResponse } from "../../types.js";
import { getStorageAdapter } from "../../storage-adapters/index.js";
import type { WriteRecordResult } from "./write-record.js";
import type { DeleteRecordResult } from "./delete-record.js";

export interface RecordResponseOptions {
  fields?: string[];
  maxContentSize?: number;
}

/**
 * Convert a record to a full response format (used by POST operations)
 * Always returns all fields
 */
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

  // Get content URL if stored externally
  let contentUrl: string | undefined;
  if (record.storage) {
    const adapter = getStorageAdapter();
    if (adapter) {
      contentUrl = adapter.getFileUrl(record.storage);
    }
  }

  // Build full response
  const response: StreamRecordResponse = {
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

  if (contentUrl) {
    response.contentUrl = contentUrl;
  }

  return response;
}

/**
 * Convert a record to a filtered response format (used by GET operations)
 * Supports field selection and content truncation
 */
export function recordToFilteredResponse(
  record: StreamRecord,
  streamPath: string,
  options?: RecordResponseOptions,
): Partial<StreamRecordResponse> {
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

  // Get content URL if stored externally
  let contentUrl: string | undefined;
  if (record.storage) {
    const adapter = getStorageAdapter();
    if (adapter) {
      contentUrl = adapter.getFileUrl(record.storage);
    }
  }

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

  if (contentUrl) {
    fullResponse.contentUrl = contentUrl;
  }

  // If fields are specified, filter the response
  if (options?.fields && options.fields.length > 0) {
    const filteredResponse: Partial<StreamRecordResponse> = {};

    for (const field of options.fields) {
      const key = field as keyof StreamRecordResponse;
      if (key in fullResponse) {
        const value = fullResponse[key];
        if (value !== undefined) {
          (filteredResponse as Record<string, unknown>)[key] = value;
        }
      }
    }

    // Always include size when content is requested (for truncation detection)
    if (
      options.fields.includes("content") &&
      !options.fields.includes("size")
    ) {
      filteredResponse.size = fullResponse.size;
    }

    return filteredResponse;
  }

  // No field filtering, return all fields
  return fullResponse;
}

/**
 * Convert a write result to a minimal response format
 */
export function writeResultToResponse(
  result: WriteRecordResult,
  streamPath: string,
): Partial<StreamRecordResponse> {
  // Combine stream path with record name for full path
  const fullPath = streamPath.endsWith("/")
    ? `${streamPath}${result.name}`
    : `${streamPath}/${result.name}`;

  return {
    index: result.index,
    name: result.name,
    path: fullPath,
    hash: result.hash,
    previousHash: result.previousHash,
    size: result.size,
  };
}

/**
 * Convert a delete result to a minimal response format
 */
export function deleteResultToResponse(
  result: DeleteRecordResult,
  streamPath: string,
): Partial<StreamRecordResponse> {
  // Combine stream path with record name for full path
  const fullPath = streamPath.endsWith("/")
    ? `${streamPath}${result.name}`
    : `${streamPath}/${result.name}`;

  return {
    index: result.index,
    name: result.name,
    path: fullPath,
    hash: result.hash,
    previousHash: result.previousHash,
  };
}
