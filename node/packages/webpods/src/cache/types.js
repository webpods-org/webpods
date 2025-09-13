// Default cache configuration
export const defaultCacheConfig = {
  enabled: false,
  adapter: "in-memory",
  pools: {
    pods: {
      enabled: true,
      maxEntries: 1000,
      ttlSeconds: 300, // 5 minutes
    },
    streams: {
      enabled: true,
      maxEntries: 5000,
      ttlSeconds: 300, // 5 minutes
    },
    singleRecords: {
      enabled: true,
      maxEntries: 10000,
      maxRecordSizeBytes: 10240, // 10KB
      ttlSeconds: 60, // 1 minute
    },
    recordLists: {
      enabled: true,
      maxQueries: 500,
      maxResultSizeBytes: 102400, // 100KB
      maxRecordsPerQuery: 1000,
      ttlSeconds: 30, // 30 seconds
    },
  },
};
//# sourceMappingURL=types.js.map
