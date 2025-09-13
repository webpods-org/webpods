import * as crypto from "crypto";

export const cacheKeys = {
  // Pod lookup: "pod:subdomain"
  pod: (subdomain: string): string => `pod:${subdomain}`,

  // Stream lookup: "stream:podId:path"
  stream: (podId: string, path: string): string => `stream:${podId}:${path}`,

  // Single record: "record:streamId:name"
  record: (streamId: string, name: string): string =>
    `record:${streamId}:${name}`,

  // Record list: "list:streamId:queryHash"
  // Query hash includes all params (limit, after, unique, fields, etc.)
  recordList: (streamId: string, queryParams: Record<string, unknown>): string => {
    // Sort params for consistent hashing
    const sortedParams = Object.keys(queryParams)
      .sort()
      .map((k) => `${k}=${queryParams[k]}`)
      .join("&");
    const hash = crypto
      .createHash("sha256")
      .update(sortedParams)
      .digest("hex")
      .substring(0, 16);
    return `list:${streamId}:${hash}`;
  },

  // Pattern matching for invalidation
  podPattern: (podId: string): string => `*:${podId}:*`,
  streamPattern: (streamId: string): string => `*:${streamId}:*`,
  recordListPattern: (streamId: string): string => `list:${streamId}:*`,
};
