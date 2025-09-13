import * as crypto from "crypto";

export const cacheKeys = {
  // Pod-level keys
  podOwner: (podName: string): string => `pod:${podName}:owner`,

  podMeta: (podName: string): string => `pod:${podName}:meta`,

  // Stream-level keys (nested under pod)
  streamOwner: (podName: string, streamPath: string): string =>
    `pod:${podName}:stream:${streamPath}:owner`,

  streamMeta: (podName: string, streamPath: string): string =>
    `pod:${podName}:stream:${streamPath}:meta`,

  streamById: (streamId: string | number): string => `stream:id:${streamId}`,

  streamChildren: (podName: string, parentId: string | number | null): string =>
    `pod:${podName}:stream:${parentId || "root"}:children`,

  streamChildrenCount: (
    podName: string,
    parentId: string | number | null,
  ): string => `pod:${podName}:stream:${parentId || "root"}:children:count`,

  // Permission cache (user-specific, nested under stream)
  streamPermission: (
    podName: string,
    streamPath: string,
    userId: string,
  ): string => `pod:${podName}:stream:${streamPath}:perm:${userId}`,

  // Record-level keys (nested under stream)
  recordData: (
    podName: string,
    streamPath: string,
    recordName: string,
  ): string => `pod:${podName}:stream:${streamPath}:record:${recordName}:data`,

  recordMeta: (
    podName: string,
    streamPath: string,
    recordName: string,
  ): string => `pod:${podName}:stream:${streamPath}:record:${recordName}:meta`,

  // List cache (query-specific, nested under stream)
  recordList: (
    podName: string,
    streamPath: string,
    queryParams: Record<string, unknown>,
  ): string => {
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
    return `pod:${podName}:stream:${streamPath}:list:${hash}`;
  },

  // Unique records list cache
  uniqueRecordList: (
    podName: string,
    streamPath: string,
    queryParams: Record<string, unknown>,
  ): string => {
    const sortedParams = Object.keys(queryParams)
      .sort()
      .map((k) => `${k}=${queryParams[k]}`)
      .join("&");
    const hash = crypto
      .createHash("sha256")
      .update(sortedParams)
      .digest("hex")
      .substring(0, 16);
    return `pod:${podName}:stream:${streamPath}:unique:${hash}`;
  },

  // Pod streams list cache
  podStreams: (podName: string, optionsHash: string): string =>
    `pod:${podName}:streams:${optionsHash}`,

  // User-related caches
  userPods: (userId: string): string => `user:${userId}:pods`,

  userInfo: (userId: string): string => `user:${userId}:info`,

  // Link resolution cache
  link: (podName: string, path: string): string =>
    `pod:${podName}:link:${path}`,

  // Domain resolution cache
  domainPod: (domain: string): string => `domain:${domain}:pod`,

  // Pattern matching for invalidation
  podPattern: (podName: string): string => `pod:${podName}:*`,

  podStreamsPattern: (podName: string): string => `pod:${podName}:streams:*`,

  streamPattern: (podName: string, streamPath: string): string =>
    `pod:${podName}:stream:${streamPath}:*`,

  recordPattern: (
    podName: string,
    streamPath: string,
    recordName: string,
  ): string => `pod:${podName}:stream:${streamPath}:record:${recordName}:*`,

  recordListPattern: (podName: string, streamPath: string): string =>
    `pod:${podName}:stream:${streamPath}:list:*`,

  userPattern: (userId: string): string => `user:${userId}:*`,
};
