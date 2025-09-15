export type CacheKey = string;

export type CacheEntry<T = unknown> = {
  value: T | null;
  size: number; // Size in bytes
  expiresAt: number; // Unix timestamp
  hits: number; // Access count for statistics
  createdAt: number; // Unix timestamp
};

export type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number; // Current memory usage in bytes
  entryCount: number;
};

export type CachePoolConfig = {
  enabled: boolean;
  maxEntries: number;
  ttlSeconds: number;
};

export type RecordCachePoolConfig = CachePoolConfig & {
  maxRecordSizeBytes: number;
};

export type RecordListCachePoolConfig = Omit<CachePoolConfig, "maxEntries"> & {
  enabled: boolean;
  ttlSeconds: number;
  maxQueries: number; // Replaces maxEntries for record lists
  maxResultSizeBytes: number;
  maxRecordsPerQuery: number;
};

export type CacheConfig = {
  enabled: boolean;
  adapter: "in-memory" | "redis";

  // Adapter-specific config
  adapterConfig?: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };

  // Cache pools with individual configurations
  pools: {
    // Pod lookups (by subdomain -> pod data)
    pods: CachePoolConfig;

    // Stream lookups (pod+path -> stream data)
    streams: CachePoolConfig;

    // Single record fetches (stream+name -> record)
    singleRecords: RecordCachePoolConfig;

    // Record list queries (query string -> record list)
    recordLists: RecordListCachePoolConfig;
  };
};

// Default cache configuration
export const defaultCacheConfig: CacheConfig = {
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
      maxResultSizeBytes: 52428800, // 50MB - for unique record lists
      maxRecordsPerQuery: 1000,
      ttlSeconds: 30, // 30 seconds
    },
  },
};
