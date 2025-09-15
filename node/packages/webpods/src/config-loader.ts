/**
 * Configuration loader with environment variable resolution
 *
 * Loads configuration from config.json and resolves environment variable references.
 * Supports:
 * - $VAR_NAME - replaced with environment variable value
 * - $VAR_NAME || default - uses environment variable or default value if not set
 */

import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { createLogger } from "./logger.js";
import type { RawConfig } from "./types.js";
import type { CacheConfig } from "./cache/types.js";
import { defaultCacheConfig } from "./cache/types.js";

const logger = createLogger("webpods:config-loader");

export interface OAuthProviderConfig {
  id: string;
  clientId: string;
  clientSecret: string;

  // OIDC discovery URL or manual endpoints
  issuer?: string;
  authUrl?: string;
  tokenUrl?: string;
  userinfoUrl?: string;
  emailUrl?: string; // Optional separate email endpoint

  scope: string;
  callbackUrl?: string;

  // Field mappings
  userIdField: string;
  emailField: string;
  nameField: string;
}

export interface OAuthConfig {
  providers: OAuthProviderConfig[];
  defaultProvider?: string;
  pkceStateExpiryMinutes?: number;
  rememberShortHours?: number;
  rememberLongHours?: number;
  jwtCacheMaxAgeMS?: number;
  jwtCacheRequestsPerMinute?: number;
}

export interface PublicConfig {
  protocol: string;
  hostname: string;
  port: number;
  host: string;
  origin: string;
  isSecure: boolean;
}

export interface ServerConfig {
  host: string;
  port: number;
  publicUrl: string;
  corsOrigin: string;
  maxPayloadSize: string; // e.g., "10mb", "50mb"
  allowedRecordHeaders?: string[]; // List of allowed custom headers for records
  public?: PublicConfig; // Parsed from publicUrl
}

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export interface AuthConfig {
  jwtSecret: string;
  jwtExpiry: string;
  sessionSecret: string;
  sessionPruneIntervalMS?: number;
}

export interface RateLimitsConfig {
  enabled?: boolean; // Enable/disable rate limiting
  adapter?: "in-memory" | "postgres" | "redis"; // Rate limiter adapter
  writes: number;
  reads: number;
  podCreate: number;
  streamCreate: number;
  maxRecordLimit: number; // Maximum records that can be fetched in a single request
  windowMS?: number;
  defaultQueryLimit?: number;
  cliMaxOperationLimit?: number;
  oauthClientDescriptionMaxLength?: number;
  cleanupIntervalMS?: number; // For in-memory adapter
  maxIdentifiers?: number; // For in-memory adapter
}

export interface HydraConfig {
  adminUrl: string;
  publicUrl: string;
}

export interface MediaConfig {
  externalStorage: {
    enabled: boolean;
    minSize: string; // e.g., "1mb", "0" for always external
    adapter: string; // "filesystem" for now
    filesystem?: {
      basePath: string; // e.g., "/var/webpods/media"
      baseUrl: string; // e.g., "https://static.example.com"
    };
  };
}

export interface AppConfig {
  oauth: OAuthConfig;
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  rateLimits: RateLimitsConfig;
  hydra: HydraConfig;
  media?: MediaConfig; // Optional media configuration
  cache?: CacheConfig; // Optional cache configuration
  rootPod?: string; // Optional pod to serve on main domain
}

// Load media config from environment for testing
function loadMediaConfig(): MediaConfig | undefined {
  if (process.env.MEDIA_EXTERNAL_STORAGE_ENABLED === "true") {
    return {
      externalStorage: {
        enabled: true,
        minSize: process.env.MEDIA_MIN_SIZE || "1kb",
        adapter: process.env.MEDIA_ADAPTER || "filesystem",
        filesystem: {
          basePath:
            process.env.MEDIA_FILESYSTEM_BASE_PATH || "/tmp/webpods-media",
          baseUrl:
            process.env.MEDIA_FILESYSTEM_BASE_URL ||
            "https://static.example.com",
        },
      },
    };
  }
  return undefined;
}

// Load cache config from environment for testing
function loadCacheConfig(): CacheConfig | undefined {
  if (process.env.CACHE_ENABLED === "true") {
    return {
      enabled: true,
      adapter: (process.env.CACHE_ADAPTER || "in-memory") as
        | "in-memory"
        | "redis",
      pools: {
        pods: {
          enabled: process.env.CACHE_PODS_ENABLED !== "false",
          maxEntries: parseInt(process.env.CACHE_PODS_MAX_ENTRIES || "1000"),
          ttlSeconds: parseInt(process.env.CACHE_PODS_TTL_SECONDS || "300"),
        },
        streams: {
          enabled: process.env.CACHE_STREAMS_ENABLED !== "false",
          maxEntries: parseInt(process.env.CACHE_STREAMS_MAX_ENTRIES || "5000"),
          ttlSeconds: parseInt(process.env.CACHE_STREAMS_TTL_SECONDS || "300"),
        },
        singleRecords: {
          enabled: process.env.CACHE_SINGLE_RECORDS_ENABLED !== "false",
          maxEntries: parseInt(
            process.env.CACHE_SINGLE_RECORDS_MAX_ENTRIES || "10000",
          ),
          maxRecordSizeBytes: parseInt(
            process.env.CACHE_SINGLE_RECORDS_MAX_SIZE_BYTES || "10240",
          ),
          ttlSeconds: parseInt(
            process.env.CACHE_SINGLE_RECORDS_TTL_SECONDS || "60",
          ),
        },
        recordLists: {
          enabled: process.env.CACHE_RECORD_LISTS_ENABLED !== "false",
          maxQueries: parseInt(
            process.env.CACHE_RECORD_LISTS_MAX_QUERIES || "500",
          ),
          maxResultSizeBytes: parseInt(
            process.env.CACHE_RECORD_LISTS_MAX_SIZE_BYTES || "102400",
          ),
          maxRecordsPerQuery: parseInt(
            process.env.CACHE_RECORD_LISTS_MAX_RECORDS || "1000",
          ),
          ttlSeconds: parseInt(
            process.env.CACHE_RECORD_LISTS_TTL_SECONDS || "30",
          ),
        },
      },
    };
  }
  return undefined;
}

/**
 * Resolve environment variable references in a value
 * Supports format: $VAR_NAME
 */
function resolveEnvValue(value: unknown, defaultValue?: unknown): unknown {
  if (typeof value !== "string") {
    return value;
  }

  // Check if the value contains an environment variable reference
  if (!value.startsWith("$")) {
    return value;
  }

  // Remove the $ prefix
  const varName = value.substring(1);

  // Get environment variable value
  const envValue = process.env[varName];

  if (envValue === undefined) {
    // Use default if provided
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    // Otherwise error
    throw new Error(`Required environment variable ${varName} is not set`);
  }

  // Try to parse numbers for specific fields
  const num = Number(envValue);
  return !isNaN(num) && (varName.includes("PORT") || varName.includes("LIMIT"))
    ? num
    : envValue;
}

/**
 * Recursively resolve environment variables in an object with context-aware defaults
 */
function resolveEnvVars(obj: unknown, path: string[] = []): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map((item, index) =>
      resolveEnvVars(item, [...path, String(index)]),
    );
  }

  if (typeof obj === "object") {
    const resolved: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key];
      const fullPath = currentPath.join(".");

      // Determine default value based on path
      let defaultValue: unknown;
      switch (fullPath) {
        case "server.host":
          defaultValue = "127.0.0.1";
          break;
        case "server.port":
          defaultValue = 3000;
          break;
        case "server.publicUrl":
          defaultValue = "http://localhost:3000";
          break;
        case "server.corsOrigin":
          defaultValue = "*";
          break;
        case "server.maxPayloadSize":
          defaultValue = "10mb";
          break;
        case "database.host":
          defaultValue = "localhost";
          break;
        case "database.port":
          defaultValue = 5432;
          break;
        case "database.database":
          defaultValue = "webpodsdb";
          break;
        case "database.user":
          defaultValue = "postgres";
          break;
        case "auth.jwtExpiry":
          defaultValue = undefined; // No expiry by default
          break;
        case "rateLimits.writes":
          defaultValue = 1000;
          break;
        case "rateLimits.reads":
          defaultValue = 10000;
          break;
        case "rateLimits.podCreate":
          defaultValue = 10;
          break;
        case "rateLimits.streamCreate":
          defaultValue = 100;
          break;
        case "rateLimits.maxRecordLimit":
          defaultValue = 1000; // Default max records per request
          break;
        case "rateLimits.windowMS":
          defaultValue = 3600000; // 1 hour in milliseconds
          break;
        case "rateLimits.defaultQueryLimit":
          defaultValue = 100;
          break;
        case "rateLimits.cliMaxOperationLimit":
          defaultValue = 1000;
          break;
        case "rateLimits.oauthClientDescriptionMaxLength":
          defaultValue = 50;
          break;
        case "oauth.pkceStateExpiryMinutes":
          defaultValue = 10;
          break;
        case "oauth.rememberShortHours":
          defaultValue = 1;
          break;
        case "oauth.rememberLongHours":
          defaultValue = 24;
          break;
        case "oauth.jwtCacheMaxAgeMS":
          defaultValue = 600000; // 10 minutes
          break;
        case "oauth.jwtCacheRequestsPerMinute":
          defaultValue = 10;
          break;
        case "auth.sessionPruneIntervalMS":
          defaultValue = 3600000; // 1 hour
          break;
        case "hydra.adminUrl":
          defaultValue = "http://localhost:4445";
          break;
        case "hydra.publicUrl":
          defaultValue = "http://localhost:4444";
          break;
      }

      if (Array.isArray(value)) {
        // Process arrays recursively
        resolved[key] = resolveEnvVars(value, currentPath);
      } else if (typeof value === "object" && value !== null) {
        // Process objects recursively
        resolved[key] = resolveEnvVars(value, currentPath);
      } else if (typeof value === "string" && value.startsWith("$")) {
        // Only apply defaults to environment variable references
        resolved[key] = resolveEnvValue(value, defaultValue);
      } else {
        // Keep non-env-var values as-is
        resolved[key] = value;
      }
    }
    return resolved;
  }

  return resolveEnvValue(obj);
}

/**
 * Apply default values to missing config fields
 */
function applyDefaults(config: RawConfig): RawConfig {
  // Ensure base structure exists
  config.server = config.server || {};
  config.database = config.database || {};
  config.auth = config.auth || {};
  config.rateLimits = config.rateLimits || {};
  config.oauth = config.oauth || { providers: [] };
  config.hydra = config.hydra || {};

  // Apply defaults for server (using env var references)
  config.server.host = config.server.host ?? "$HOST";
  config.server.port = config.server.port ?? "$PORT";
  config.server.publicUrl = config.server.publicUrl ?? "$PUBLIC_URL";
  config.server.corsOrigin = config.server.corsOrigin ?? "$CORS_ORIGIN";
  config.server.maxPayloadSize =
    config.server.maxPayloadSize ?? "$MAX_PAYLOAD_SIZE";

  // Apply defaults for database
  config.database.host = config.database.host ?? "$WEBPODS_DB_HOST";
  config.database.port = config.database.port ?? "$WEBPODS_DB_PORT";
  config.database.database = config.database.database ?? "$WEBPODS_DB_NAME";
  config.database.user = config.database.user ?? "$WEBPODS_DB_USER";
  config.database.password = config.database.password ?? "$WEBPODS_DB_PASSWORD";

  // Apply defaults for auth
  config.auth.jwtSecret = config.auth.jwtSecret ?? "$JWT_SECRET";
  config.auth.jwtExpiry = config.auth.jwtExpiry ?? "$JWT_EXPIRY";
  config.auth.sessionSecret = config.auth.sessionSecret ?? "$SESSION_SECRET";

  // Apply defaults for rate limits
  config.rateLimits.writes = config.rateLimits.writes ?? "$RATE_LIMIT_WRITES";
  config.rateLimits.reads = config.rateLimits.reads ?? "$RATE_LIMIT_READS";
  config.rateLimits.podCreate =
    config.rateLimits.podCreate ?? "$RATE_LIMIT_POD_CREATE";
  config.rateLimits.streamCreate =
    config.rateLimits.streamCreate ?? "$RATE_LIMIT_STREAM_CREATE";
  config.rateLimits.maxRecordLimit =
    config.rateLimits.maxRecordLimit ?? "$MAX_RECORD_LIMIT";

  // Apply defaults for Hydra
  config.hydra.adminUrl = config.hydra.adminUrl ?? "$HYDRA_ADMIN_URL";
  config.hydra.publicUrl = config.hydra.publicUrl ?? "$HYDRA_PUBLIC_URL";

  return config;
}

/**
 * Load configuration from file
 */
export function loadConfig(configPath?: string): AppConfig {
  // Determine config file path
  const paths = [
    configPath,
    process.env.WEBPODS_CONFIG_PATH,
    join(process.cwd(), "config.json"),
  ].filter(Boolean) as string[];

  let configFile: string | undefined;
  for (const path of paths) {
    if (existsSync(path)) {
      configFile = path;
      break;
    }
  }

  if (!configFile) {
    throw new Error(
      "No configuration file found. Create config.json or use -c to specify config path",
    );
  }

  logger.info("Loading configuration", { path: configFile });

  try {
    // Read and parse config file
    const configContent = readFileSync(configFile, "utf-8");
    const rawConfig = JSON.parse(configContent) as RawConfig;

    // Apply defaults for missing fields
    const configWithDefaults = applyDefaults(rawConfig);

    // Resolve environment variables
    const config = resolveEnvVars(configWithDefaults) as AppConfig;

    // Parse publicUrl to extract components
    if (config.server?.publicUrl) {
      try {
        const url = new URL(config.server.publicUrl);
        config.server.public = {
          protocol: url.protocol.replace(":", ""),
          hostname: url.hostname,
          port: parseInt(url.port) || (url.protocol === "https:" ? 443 : 80),
          host: url.host,
          origin: url.origin,
          isSecure: url.protocol === "https:",
        };
      } catch {
        throw new Error(`Invalid publicUrl: ${config.server.publicUrl}`);
      }
    }

    // Load media config from environment if not in config file
    if (!config.media) {
      config.media = loadMediaConfig();
    }

    // Load cache config from environment if not in config file
    if (!config.cache) {
      config.cache = loadCacheConfig();
    }

    // Apply default cache config if cache is defined but incomplete
    if (config.cache && !config.cache.pools) {
      config.cache = { ...defaultCacheConfig, ...config.cache };
    }

    // Validate required fields
    validateConfig(config);

    logger.info("Configuration loaded successfully", {
      providers: config.oauth.providers.map((p) => p.id),
      defaultProvider: config.oauth.defaultProvider,
    });

    return config;
  } catch (error) {
    logger.error("Failed to load configuration", {
      error: (error as Error).message,
    });
    throw error;
  }
}

/**
 * Validate configuration
 */
function validateConfig(config: AppConfig): void {
  // Check OAuth providers
  if (
    !config.oauth ||
    !config.oauth.providers ||
    config.oauth.providers.length === 0
  ) {
    throw new Error("No OAuth providers configured in config.oauth.providers");
  }

  for (const provider of config.oauth.providers) {
    if (!provider.id) {
      throw new Error("OAuth provider missing id");
    }

    if (!provider.clientId || !provider.clientSecret) {
      throw new Error(
        `OAuth provider ${provider.id} missing clientId or clientSecret. Set oauth.providers[].clientSecret or environment variable referenced in the config`,
      );
    }

    // Must have either issuer (for OIDC discovery) or manual endpoints
    if (
      !provider.issuer &&
      (!provider.authUrl || !provider.tokenUrl || !provider.userinfoUrl)
    ) {
      throw new Error(
        `OAuth provider ${provider.id} must have either issuer or authUrl/tokenUrl/userinfoUrl`,
      );
    }

    if (!provider.scope) {
      throw new Error(`OAuth provider ${provider.id} missing scope`);
    }
  }

  // Check auth config
  if (!config.auth?.jwtSecret) {
    throw new Error(
      "auth.jwtSecret is required. Set it in config.json or provide environment variable JWT_SECRET",
    );
  }

  if (!config.auth?.sessionSecret) {
    throw new Error(
      "auth.sessionSecret is required. Set it in config.json or provide environment variable SESSION_SECRET",
    );
  }

  // Check database config
  if (!config.database?.password) {
    throw new Error(
      "database.password is required. Set it in config.json or provide environment variable WEBPODS_DB_PASSWORD",
    );
  }
}

// Singleton config instance
let configInstance: AppConfig | null = null;

/**
 * Get the current configuration (loads on first call)
 */
export function getConfig(): AppConfig {
  if (!configInstance) {
    configInstance = loadConfig();
  }
  return configInstance;
}

/**
 * Reset configuration (mainly for testing)
 */
export function resetConfig(): void {
  configInstance = null;
}
