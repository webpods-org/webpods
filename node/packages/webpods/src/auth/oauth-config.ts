/**
 * OAuth provider configuration using config.json
 */

import { Issuer, Client } from 'openid-client';
import { createLogger } from '../logger.js';
import { getConfig, OAuthProviderConfig as ConfigProvider } from '../config-loader.js';

const logger = createLogger('webpods:auth:oauth-config');

export interface OAuthProviderConfig extends ConfigProvider {
  redirectUri: string;
}

// Cache for OAuth clients
const clientCache = new Map<string, Client>();

// Cache for provider configs
let providerConfigs: Map<string, OAuthProviderConfig> | null = null;

/**
 * Load OAuth provider configurations from config.json
 */
export function loadProviderConfigs(): Map<string, OAuthProviderConfig> {
  if (providerConfigs) {
    return providerConfigs;
  }
  
  providerConfigs = new Map();
  const config = getConfig();
  
  if (!config.oauth || !config.oauth.providers) {
    logger.warn('No OAuth providers configured');
    return providerConfigs;
  }
  
  const protocol = process.env.NODE_ENV === 'development' ? 'http' : 'https';
  const baseUrl = `${protocol}://${config.server.domain}`;
  
  for (const provider of config.oauth.providers) {
    // Build full config with redirect URI
    const fullConfig: OAuthProviderConfig = {
      ...provider,
      redirectUri: provider.callbackUrl || `${baseUrl}/auth/${provider.id}/callback`
    };
    
    providerConfigs.set(provider.id, fullConfig);
    logger.info('OAuth provider configured', { provider: provider.id });
  }
  
  return providerConfigs;
}

/**
 * Get or create OAuth client for a provider
 */
export async function getOAuthClient(providerId: string): Promise<Client> {
  // Check cache first
  if (clientCache.has(providerId)) {
    return clientCache.get(providerId)!;
  }
  
  const configs = loadProviderConfigs();
  const config = configs.get(providerId);
  
  if (!config) {
    throw new Error(`OAuth provider ${providerId} not configured`);
  }
  
  let issuer: Issuer;
  
  if (config.issuer) {
    // Try OIDC discovery
    try {
      issuer = await Issuer.discover(config.issuer);
      logger.info('OIDC discovery successful', { provider: providerId });
    } catch (error) {
      logger.warn('OIDC discovery failed, using manual config', { 
        provider: providerId, 
        error 
      });
      
      // Fall back to manual configuration
      if (!config.authUrl || !config.tokenUrl) {
        throw new Error(`OAuth provider ${providerId} discovery failed and no manual endpoints configured`);
      }
      
      issuer = new Issuer({
        issuer: config.issuer,
        authorization_endpoint: config.authUrl,
        token_endpoint: config.tokenUrl,
        userinfo_endpoint: config.userinfoUrl,
      });
    }
  } else {
    // Manual configuration
    if (!config.authUrl || !config.tokenUrl || !config.userinfoUrl) {
      throw new Error(`OAuth provider ${providerId} missing required endpoints`);
    }
    
    issuer = new Issuer({
      issuer: providerId,
      authorization_endpoint: config.authUrl,
      token_endpoint: config.tokenUrl,
      userinfo_endpoint: config.userinfoUrl,
    });
  }
  
  const client = new issuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });
  
  // Cache the client
  clientCache.set(providerId, client);
  logger.info('OAuth client initialized', { provider: providerId });
  
  return client;
}

/**
 * Get list of configured OAuth providers
 */
export function getConfiguredProviders(): string[] {
  const configs = loadProviderConfigs();
  return Array.from(configs.keys());
}

/**
 * Check if a provider is configured
 */
export function isProviderConfigured(providerId: string): boolean {
  const configs = loadProviderConfigs();
  return configs.has(providerId);
}

/**
 * Get provider configuration
 */
export function getProviderConfig(providerId: string): OAuthProviderConfig | undefined {
  const configs = loadProviderConfigs();
  return configs.get(providerId);
}

/**
 * Get default OAuth provider
 */
export function getDefaultProvider(): string | undefined {
  const config = getConfig();
  return config.oauth.defaultProvider || getConfiguredProviders()[0];
}