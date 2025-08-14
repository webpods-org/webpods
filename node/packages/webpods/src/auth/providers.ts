/**
 * OAuth provider abstraction
 */

import { Issuer, Client, generators } from 'openid-client';
import { createLogger } from '../logger.js';

const logger = createLogger('webpods:auth:providers');

export type OAuthProvider = 'github' | 'google';

interface ProviderConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

// Cache OAuth clients
const clientCache = new Map<OAuthProvider, Client>();

/**
 * Get OAuth configuration for a provider
 */
function getProviderConfig(provider: OAuthProvider): ProviderConfig {
  switch (provider) {
    case 'github':
      return {
        clientId: process.env.GITHUB_CLIENT_ID || '',
        clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
        redirectUri: process.env.GITHUB_CALLBACK_URL || `https://${process.env.DOMAIN}/auth/github/callback`
      };
    case 'google':
      return {
        clientId: process.env.GOOGLE_CLIENT_ID || '',
        clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
        redirectUri: process.env.GOOGLE_CALLBACK_URL || `https://${process.env.DOMAIN}/auth/google/callback`
      };
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }
}

/**
 * Initialize GitHub OAuth client
 */
async function initializeGitHubClient(): Promise<Client> {
  const config = getProviderConfig('github');
  
  // GitHub doesn't support OpenID Connect discovery, so we configure manually
  // Allow overriding URLs for testing
  const githubIssuer = new Issuer({
    issuer: process.env.GITHUB_ISSUER || 'https://github.com',
    authorization_endpoint: process.env.GITHUB_AUTH_URL || 'https://github.com/login/oauth/authorize',
    token_endpoint: process.env.GITHUB_TOKEN_URL || 'https://github.com/login/oauth/access_token',
    userinfo_endpoint: process.env.GITHUB_USER_URL || 'https://api.github.com/user',
  });

  const client = new githubIssuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });

  return client;
}

/**
 * Initialize Google OAuth client
 */
async function initializeGoogleClient(): Promise<Client> {
  const config = getProviderConfig('google');
  
  // Google supports OpenID Connect discovery
  // Allow overriding for testing
  const issuerUrl = process.env.GOOGLE_ISSUER || 'https://accounts.google.com';
  
  let googleIssuer: Issuer;
  if (process.env.NODE_ENV === 'test' && process.env.GOOGLE_AUTH_URL) {
    // In test mode with mock OAuth, manually configure endpoints
    googleIssuer = new Issuer({
      issuer: issuerUrl,
      authorization_endpoint: process.env.GOOGLE_AUTH_URL,
      token_endpoint: process.env.GOOGLE_TOKEN_URL || `${issuerUrl}/oauth/token`,
      userinfo_endpoint: process.env.GOOGLE_USERINFO_URL || `${issuerUrl}/oauth/userinfo`,
    });
  } else {
    // Production: use OpenID Connect discovery
    googleIssuer = await Issuer.discover(issuerUrl);
  }
  
  const client = new googleIssuer.Client({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uris: [config.redirectUri],
    response_types: ['code'],
  });

  return client;
}

/**
 * Get or create OAuth client for a provider
 */
export async function getOAuthClient(provider: OAuthProvider): Promise<Client> {
  // Check cache first
  if (clientCache.has(provider)) {
    return clientCache.get(provider)!;
  }

  let client: Client;
  
  switch (provider) {
    case 'github':
      client = await initializeGitHubClient();
      break;
    case 'google':
      client = await initializeGoogleClient();
      break;
    default:
      throw new Error(`Unsupported OAuth provider: ${provider}`);
  }

  // Cache the client
  clientCache.set(provider, client);
  logger.info('OAuth client initialized', { provider });
  
  return client;
}

/**
 * Generate PKCE challenge
 */
export function generatePKCE() {
  const codeVerifier = generators.codeVerifier();
  const codeChallenge = generators.codeChallenge(codeVerifier);
  return { codeVerifier, codeChallenge };
}

/**
 * Generate state for OAuth flow
 */
export function generateState(): string {
  return generators.state();
}

/**
 * Get authorization URL
 */
export async function getAuthorizationUrl(
  provider: OAuthProvider,
  state: string,
  codeChallenge: string
): Promise<string> {
  const client = await getOAuthClient(provider);
  
  const params: any = {
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
  };

  // Provider-specific scopes
  switch (provider) {
    case 'github':
      params.scope = 'read:user user:email';
      break;
    case 'google':
      params.scope = 'openid email profile';
      break;
  }

  return client.authorizationUrl(params);
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  provider: OAuthProvider,
  code: string,
  codeVerifier: string
): Promise<any> {
  const client = await getOAuthClient(provider);
  const config = getProviderConfig(provider);
  
  // In test mode, use grant directly to avoid ID token validation
  if (process.env.NODE_ENV === 'test' && process.env.GOOGLE_ISSUER?.includes('localhost')) {
    const tokenSet = await client.grant({
      grant_type: 'authorization_code',
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier
    });
    return tokenSet;
  }
  
  const tokenSet = await client.callback(
    config.redirectUri,
    { code },
    { code_verifier: codeVerifier }
  );

  return tokenSet;
}

/**
 * Get user info from provider
 */
export async function getUserInfo(
  provider: OAuthProvider,
  accessToken: string
): Promise<any> {
  const client = await getOAuthClient(provider);
  
  if (provider === 'github') {
    // GitHub requires custom API call
    const response = await fetch('https://api.github.com/user', {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (!response.ok) {
      throw new Error('Failed to get GitHub user info');
    }
    
    const user: any = await response.json();
    
    // Also get email if not public
    if (!user.email) {
      const emailResponse = await fetch('https://api.github.com/user/emails', {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (emailResponse.ok) {
        const emails = await emailResponse.json() as any[];
        const primaryEmail = emails.find((e: any) => e.primary);
        if (primaryEmail) {
          user.email = primaryEmail.email;
        }
      }
    }
    
    return {
      id: user.id,
      email: user.email,
      name: user.name || user.login,
      username: user.login,
      avatar_url: user.avatar_url
    };
  } else {
    // Use OpenID Connect userinfo endpoint
    const userinfo = await client.userinfo(accessToken);
    return {
      id: userinfo.sub,
      email: userinfo.email,
      name: userinfo.name,
      picture: userinfo.picture
    };
  }
}