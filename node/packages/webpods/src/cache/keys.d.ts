export declare const cacheKeys: {
  pod: (subdomain: string) => string;
  stream: (podId: string, path: string) => string;
  record: (streamId: string, name: string) => string;
  recordList: (streamId: string, queryParams: Record<string, any>) => string;
  podPattern: (podId: string) => string;
  streamPattern: (streamId: string) => string;
  recordListPattern: (streamId: string) => string;
};
//# sourceMappingURL=keys.d.ts.map
