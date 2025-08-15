/**
 * Provider-agnostic OAuth implementation
 */

import { generators } from 'openid-client';
import { 
  getOAuthClient, 
  getProviderConfig,
  isProviderConfigured 
} from './oauth-config.js';

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
 * Get authorization URL for any provider
 */
export async function getAuthorizationUrl(
  providerId: string,
  state: string,
  codeChallenge: string
): Promise<string> {
  if (!isProviderConfigured(providerId)) {
    throw new Error(`OAuth provider ${providerId} not configured`);
  }
  
  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;
  
  const params: any = {
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    scope: config.scope,
  };
  
  return client.authorizationUrl(params);
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  providerId: string,
  code: string,
  codeVerifier: string
): Promise<any> {
  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;
  
  // Handle test environment
  if (process.env.NODE_ENV === 'test' && config.issuer?.includes('localhost')) {
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
 * Get user info from any provider
 */
export async function getUserInfo(
  providerId: string,
  accessToken: string
): Promise<any> {
  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;
  
  // If provider has a custom userinfo URL, use it directly
  if (!config.issuer && config.userinfoUrl) {
    return await getCustomUserInfo(accessToken, config);
  }
  
  // Standard OIDC userinfo endpoint
  try {
    const userinfo = await client.userinfo(accessToken);
    return normalizeUserInfo(userinfo, config);
  } catch (error) {
    // Fallback to manual API call if userinfo fails
    if (config.userinfoUrl) {
      const response = await fetch(config.userinfoUrl, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json'
        }
      });
      
      if (!response.ok) {
        throw new Error(`Failed to get user info from ${providerId}`);
      }
      
      const data = await response.json();
      return normalizeUserInfo(data, config);
    }
    
    throw error;
  }
}

/**
 * Get user info from custom userinfo endpoint
 */
async function getCustomUserInfo(accessToken: string, config: any): Promise<any> {
  if (!config.userinfoUrl) {
    throw new Error(`Provider ${config.id} missing userinfo URL`);
  }
  
  const response = await fetch(config.userinfoUrl, {
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Accept': 'application/json'
    }
  });
  
  if (!response.ok) {
    throw new Error(`Failed to get user info from ${config.id}`);
  }
  
  const data: any = await response.json();
  
  // Some providers may have a separate email endpoint
  // This can be configured in config.json if needed
  if (config.emailUrl && !data[config.emailField]) {
    const emailResponse = await fetch(config.emailUrl, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Accept': 'application/json'
      }
    });
    
    if (emailResponse.ok) {
      const emailData: any = await emailResponse.json();
      // Handle array of emails (some providers return multiple)
      if (Array.isArray(emailData)) {
        const primaryEmail = emailData.find((e: any) => e.primary || e.verified);
        if (primaryEmail) {
          data[config.emailField] = primaryEmail.email || primaryEmail.value;
        }
      } else {
        data[config.emailField] = emailData[config.emailField] || emailData.email;
      }
    }
  }
  
  return normalizeUserInfo(data, config);
}

/**
 * Normalize user info based on provider config field mappings
 */
function normalizeUserInfo(data: any, config: any): any {
  // Extract fields based on config mappings
  const userId = data[config.userIdField] || data.id || data.sub;
  const email = data[config.emailField] || data.email;
  const name = data[config.nameField] || data.name || data.username || data.login;
  
  // Standard normalized format
  return {
    id: userId,
    email: email,
    name: name,
    username: data.username || data.login,
    picture: data.picture || data.avatar_url || data.avatar,
    raw: data // Include raw data for debugging
  };
}

/**
 * Validate that a provider is supported
 */
export function validateProvider(providerId: string): boolean {
  return isProviderConfigured(providerId);
}