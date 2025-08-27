/**
 * Provider-agnostic OAuth implementation
 */

import { generators } from "openid-client";
import {
  getOAuthClient,
  getProviderConfig,
  isProviderConfigured,
} from "./oauth-config.js";

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
  codeChallenge: string,
): Promise<string> {
  if (!isProviderConfigured(providerId)) {
    throw new Error(`OAuth provider ${providerId} not configured`);
  }

  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;

  const params: Record<string, string> = {
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
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
  codeVerifier: string,
): Promise<Record<string, unknown>> {
  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;

  // Handle localhost OAuth providers (for testing)
  if (config.issuer?.includes("localhost")) {
    const tokenSet = await client.grant({
      grant_type: "authorization_code",
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    });
    return tokenSet;
  }

  const tokenSet = await client.callback(
    config.redirectUri,
    { code },
    { code_verifier: codeVerifier },
  );

  return tokenSet;
}

/**
 * Get user info from any provider
 */
export async function getUserInfo(
  providerId: string,
  accessToken: string,
): Promise<Record<string, unknown>> {
  const client = await getOAuthClient(providerId);
  const config = getProviderConfig(providerId)!;

  // If provider has a custom userinfo URL, use it directly
  if (!config.issuer && config.userinfoUrl) {
    return await getCustomUserInfo(accessToken, config as unknown as Record<string, unknown>);
  }

  // Standard OIDC userinfo endpoint
  try {
    const userinfo = await client.userinfo(accessToken);
    return normalizeUserInfo(userinfo, config as unknown as Record<string, unknown>);
  } catch (error) {
    // Fallback to manual API call if userinfo fails
    if (config.userinfoUrl) {
      const response = await fetch(config.userinfoUrl, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get user info from ${providerId}`);
      }

      const data = await response.json() as Record<string, unknown>;
      return normalizeUserInfo(data, config as unknown as Record<string, unknown>);
    }

    throw error;
  }
}

/**
 * Get user info from custom userinfo endpoint
 */
async function getCustomUserInfo(
  accessToken: string,
  config: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const userinfoUrl = config.userinfoUrl as string | undefined;
  const id = config.id as string;
  
  if (!userinfoUrl) {
    throw new Error(`Provider ${id} missing userinfo URL`);
  }

  const response = await fetch(userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info from ${id}`);
  }

  const data = await response.json() as Record<string, unknown>;

  // Some providers may have a separate email endpoint
  // This can be configured in config.json if needed
  const emailUrl = config.emailUrl as string | undefined;
  const emailField = config.emailField as string;
  
  if (emailUrl && !data[emailField]) {
    const emailResponse = await fetch(emailUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (emailResponse.ok) {
      const emailData = await emailResponse.json() as Array<{primary?: boolean; verified?: boolean; email?: string; value?: string}> | Record<string, unknown>;
      // Handle array of emails (some providers return multiple)
      if (Array.isArray(emailData)) {
        const primaryEmail = emailData.find(
          (e) => e.primary || e.verified,
        );
        if (primaryEmail) {
          data[emailField] = primaryEmail.email || primaryEmail.value;
        }
      } else {
        const emailDataObj = emailData as Record<string, unknown>;
        data[emailField] =
          emailDataObj[emailField] || emailDataObj.email;
      }
    }
  }

  return normalizeUserInfo(data, config);
}

/**
 * Normalize user info based on provider config field mappings
 */
function normalizeUserInfo(data: Record<string, unknown>, config: Record<string, unknown>): Record<string, unknown> {
  // Extract fields based on config mappings
  const userIdField = (config.userIdField as string) || "id";
  const emailField = (config.emailField as string) || "email";
  const nameField = (config.nameField as string) || "name";
  
  const userId = data[userIdField] || data.id || data.sub;
  const email = data[emailField] || data.email;
  const name =
    data[nameField] || data.name || data.username || data.login;

  // Standard normalized format
  return {
    id: userId,
    email: email,
    name: name,
    username: data.username || data.login,
    picture: data.picture || data.avatar_url || data.avatar,
    raw: data, // Include raw data for debugging
  };
}

/**
 * Validate that a provider is supported
 */
export function validateProvider(providerId: string): boolean {
  return isProviderConfigured(providerId);
}
