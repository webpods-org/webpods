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
 * Supports formats:
 * - $VAR_NAME
 * - $VAR_NAME || default_value
 */
function resolveEnvValue(value: any): any {
  if (typeof value !== 'string') {
    return value;
  }
  
  // Check if the value contains an environment variable reference
  if (!value.startsWith('$')) {
    return value;
  }
  
  // Remove the $ prefix
  const expr = value.substring(1);
  
  // Check for default value syntax
  if (expr.includes('||')) {
    const parts = expr.split('||').map(s => s.trim());
    if (parts.length !== 2) {
      throw new Error(`Invalid environment variable expression: ${value}`);
    }
    const [varName, defaultValue] = parts;
    
    if (!varName) {
      throw new Error(`Invalid environment variable name in expression: ${value}`);
    }
    
    const envValue = process.env[varName];
    
    if (envValue !== undefined) {
      // Try to parse numbers
      const num = Number(envValue);
      return !isNaN(num) && (varName.includes('PORT') || varName.includes('LIMIT')) ? num : envValue;
    }
    
    // Use default value, try to parse if it's a number
    const num = Number(defaultValue);
    return !isNaN(num) && (varName.includes('PORT') || varName.includes('LIMIT')) ? num : defaultValue;
  }
  
  // Simple environment variable reference
  const envValue = process.env[expr];
  if (envValue === undefined) {
    throw new Error(`Required environment variable ${expr} is not set`);
  }
  
  // Try to parse numbers for specific fields
  const num = Number(envValue);
  return !isNaN(num) && (expr.includes('PORT') || expr.includes('LIMIT')) ? num : envValue;
}

/**
 * Recursively resolve environment variables in an object
 */
function resolveEnvVars(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (Array.isArray(obj)) {
    return obj.map(item => resolveEnvVars(item));
  }
  
  if (typeof obj === 'object') {
    const resolved: any = {};
    for (const [key, value] of Object.entries(obj)) {
      resolved[key] = resolveEnvVars(value);
    }
    return resolved;
  }
  
  return resolveEnvValue(obj);
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
    join(process.cwd(), 'config.example.json'),
  ].filter(Boolean) as string[];
  
  let configFile: string | undefined;
  for (const path of paths) {
    if (existsSync(path)) {
      configFile = path;
      break;
    }
  }
  
  if (!configFile) {
    throw new Error('No configuration file found. Create config.json or set WEBPODS_CONFIG_PATH');
  }
  
  logger.info('Loading configuration', { path: configFile });
  
  try {
    // Read and parse config file
    const configContent = readFileSync(configFile, 'utf-8');
    const rawConfig = JSON.parse(configContent);
    
    // Resolve environment variables
    const config = resolveEnvVars(rawConfig) as AppConfig;
    
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
    throw new Error('No OAuth providers configured');
  }
  
  for (const provider of config.oauth.providers) {
    if (!provider.id) {
      throw new Error('OAuth provider missing id');
    }
    
    if (!provider.clientId || !provider.clientSecret) {
      throw new Error(`OAuth provider ${provider.id} missing clientId or clientSecret`);
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
    throw new Error('JWT_SECRET is required');
  }
  
  if (!config.auth?.sessionSecret) {
    throw new Error('SESSION_SECRET is required');
  }
  
  // Check database config
  if (!config.database?.password) {
    throw new Error('Database password is required');
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