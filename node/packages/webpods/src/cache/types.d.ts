export type CacheKey = string;
export type CacheEntry<T = unknown> = {
  value: T;
  size: number;
  expiresAt: number;
  hits: number;
  createdAt: number;
};
export type CacheStats = {
  hits: number;
  misses: number;
  evictions: number;
  currentSize: number;
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
  maxQueries: number;
  maxResultSizeBytes: number;
  maxRecordsPerQuery: number;
};
export type CacheConfig = {
  enabled: boolean;
  adapter: "in-memory" | "redis";
  adapterConfig?: {
    redis?: {
      host: string;
      port: number;
      password?: string;
      db?: number;
    };
  };
  pools: {
    pods: CachePoolConfig;
    streams: CachePoolConfig;
    singleRecords: RecordCachePoolConfig;
    recordLists: RecordListCachePoolConfig;
  };
};
export declare const defaultCacheConfig: CacheConfig;
//# sourceMappingURL=types.d.ts.map
