/**
 * Configuration loader with environment variable resolution
 * 
 * Loads configuration from config.json and resolves environment variable references.
 * Supports:
 * - $VAR_NAME - replaced with environment variable value
 * - $VAR_NAME || default - uses environment variable or default value if not set
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { createLogger } from './logger.js';

const logger = createLogger('webpods:config-loader');

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
}

export interface ServerConfig {
  port: number;
  domain: string;
  corsOrigin: string;
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
}

export interface RateLimitsConfig {
  writes: number;
  reads: number;
  podCreate: number;
  streamCreate: number;
}

export interface AppConfig {
  oauth: OAuthConfig;
  server: ServerConfig;
  database: DatabaseConfig;
  auth: AuthConfig;
  rateLimits: RateLimitsConfig;
}

/**
 * Resolve environment variable references in a value
 * Supports format: $VAR_NAME
 */
function resolveEnvValue(value: any, defaultValue?: any): any {
  if (typeof value !== 'string') {
    return value;
  }
  
  // Check if the value contains an environment variable reference
  if (!value.startsWith('$')) {
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
  return !isNaN(num) && (varName.includes('PORT') || varName.includes('LIMIT')) ? num : envValue;
}

/**
 * Recursively resolve environment variables in an object with context-aware defaults
 */
function resolveEnvVars(obj: any, path: string[] = []): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map((item, index) => resolveEnvVars(item, [...path, String(index)]));
  }
  
  if (typeof obj === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      const currentPath = [...path, key];
      const fullPath = currentPath.join('.');
      
      // Determine default value based on path
      let defaultValue: any;
      switch (fullPath) {
        case 'server.port':
          defaultValue = 3000;
          break;
        case 'server.domain':
          defaultValue = 'localhost';
          break;
        case 'server.corsOrigin':
          defaultValue = '*';
          break;
        case 'database.host':
          defaultValue = 'localhost';
          break;
        case 'database.port':
          defaultValue = 5432;
          break;
        case 'database.database':
          defaultValue = 'webpodsdb';
          break;
        case 'database.user':
          defaultValue = 'postgres';
          break;
        case 'auth.jwtExpiry':
          defaultValue = '7d';
          break;
        case 'rateLimits.writes':
          defaultValue = 1000;
          break;
        case 'rateLimits.reads':
          defaultValue = 10000;
          break;
        case 'rateLimits.podCreate':
          defaultValue = 10;
          break;
        case 'rateLimits.streamCreate':
          defaultValue = 100;
          break;
      }
      
      if (typeof value === 'object' && !Array.isArray(value)) {
        resolved[key] = resolveEnvVars(value, currentPath);
      } else if (typeof value === 'string' && value.startsWith('$')) {
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
function applyDefaults(config: any): any {
  // Ensure base structure exists
  config.server = config.server || {};
  config.database = config.database || {};
  config.auth = config.auth || {};
  config.rateLimits = config.rateLimits || {};
  
  // Apply defaults for server (using env var references)
  config.server.port = config.server.port ?? '$PORT';
  config.server.domain = config.server.domain ?? '$DOMAIN';
  config.server.corsOrigin = config.server.corsOrigin ?? '$CORS_ORIGIN';
  
  // Apply defaults for database
  config.database.host = config.database.host ?? '$WEBPODS_DB_HOST';
  config.database.port = config.database.port ?? '$WEBPODS_DB_PORT';
  config.database.database = config.database.database ?? '$WEBPODS_DB_NAME';
  config.database.user = config.database.user ?? '$WEBPODS_DB_USER';
  config.database.password = config.database.password ?? '$WEBPODS_DB_PASSWORD';
  
  // Apply defaults for auth
  config.auth.jwtSecret = config.auth.jwtSecret ?? '$JWT_SECRET';
  config.auth.jwtExpiry = config.auth.jwtExpiry ?? '$JWT_EXPIRY';
  config.auth.sessionSecret = config.auth.sessionSecret ?? '$SESSION_SECRET';
  
  // Apply defaults for rate limits
  config.rateLimits.writes = config.rateLimits.writes ?? '$RATE_LIMIT_WRITES';
  config.rateLimits.reads = config.rateLimits.reads ?? '$RATE_LIMIT_READS';
  config.rateLimits.podCreate = config.rateLimits.podCreate ?? '$RATE_LIMIT_POD_CREATE';
  config.rateLimits.streamCreate = config.rateLimits.streamCreate ?? '$RATE_LIMIT_STREAM_CREATE';
  
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
    join(process.cwd(), 'config.json'),
  ].filter(Boolean) as string[];
  
  let configFile: string | undefined;
  for (const path of paths) {
    if (existsSync(path)) {
      configFile = path;
      break;
    }
  }
  
  if (!configFile) {
    throw new Error('No configuration file found. Create config.json or use -c to specify config path');
  }
  
  logger.info('Loading configuration', { path: configFile });
  
  try {
    // Read and parse config file
    const configContent = readFileSync(configFile, 'utf-8');
    const rawConfig = JSON.parse(configContent);
    
    // Apply defaults for missing fields
    const configWithDefaults = applyDefaults(rawConfig);
    
    // Resolve environment variables
    const config = resolveEnvVars(configWithDefaults) as AppConfig;
    
    // Validate required fields
    validateConfig(config);
    
    logger.info('Configuration loaded successfully', {
      providers: config.oauth.providers.map(p => p.id),
      defaultProvider: config.oauth.defaultProvider
    });
    
    return config;
  } catch (error: any) {
    logger.error('Failed to load configuration', { error: error.message });
    throw error;
  }
}

/**
 * Validate configuration
 */
function validateConfig(config: AppConfig): void {
  // Check OAuth providers
  if (!config.oauth || !config.oauth.providers || config.oauth.providers.length === 0) {
    throw new Error('No OAuth providers configured in config.oauth.providers');
  }
  
  for (const provider of config.oauth.providers) {
    if (!provider.id) {
      throw new Error('OAuth provider missing id');
    }
    
    if (!provider.clientId || !provider.clientSecret) {
      throw new Error(`OAuth provider ${provider.id} missing clientId or clientSecret. Set oauth.providers[].clientSecret or environment variable referenced in the config`);
    }
    
    // Must have either issuer (for OIDC discovery) or manual endpoints
    if (!provider.issuer && (!provider.authUrl || !provider.tokenUrl || !provider.userinfoUrl)) {
      throw new Error(`OAuth provider ${provider.id} must have either issuer or authUrl/tokenUrl/userinfoUrl`);
    }
    
    if (!provider.scope) {
      throw new Error(`OAuth provider ${provider.id} missing scope`);
    }
  }
  
  // Check auth config
  if (!config.auth?.jwtSecret) {
    throw new Error('auth.jwtSecret is required. Set it in config.json or provide environment variable JWT_SECRET');
  }
  
  if (!config.auth?.sessionSecret) {
    throw new Error('auth.sessionSecret is required. Set it in config.json or provide environment variable SESSION_SECRET');
  }
  
  // Check database config
  if (!config.database?.password) {
    throw new Error('database.password is required. Set it in config.json or provide environment variable WEBPODS_DB_PASSWORD');
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