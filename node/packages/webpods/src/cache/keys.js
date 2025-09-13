import * as crypto from "crypto";
export const cacheKeys = {
  // Pod lookup: "pod:subdomain"
  pod: (subdomain) => `pod:${subdomain}`,
  // Stream lookup: "stream:podId:path"
  stream: (podId, path) => `stream:${podId}:${path}`,
  // Single record: "record:streamId:name"
  record: (streamId, name) => `record:${streamId}:${name}`,
  // Record list: "list:streamId:queryHash"
  // Query hash includes all params (limit, after, unique, fields, etc.)
  recordList: (streamId, queryParams) => {
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
  podPattern: (podId) => `*:${podId}:*`,
  streamPattern: (streamId) => `*:${streamId}:*`,
  recordListPattern: (streamId) => `list:${streamId}:*`,
};
//# sourceMappingURL=keys.js.map
