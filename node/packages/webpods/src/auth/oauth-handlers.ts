/**
 * Provider-agnostic OAuth implementation
 */

import { generators } from "openid-client";
import {
  getOAuthClient,
  getProviderConfig,
  isProviderConfigured,
  type OAuthProviderConfig,
} from "./oauth-config.js";
import type { OAuthUserInfo } from "../types.js";

// Type for OAuth authorization parameters
interface OAuthAuthorizationParams {
  state: string;
  code_challenge: string;
  code_challenge_method: "S256";
  scope: string;
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

  const params: OAuthAuthorizationParams = {
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
    scope: config.scope,
  };

  // authorizationUrl expects AuthorizationParameters which has an index signature
  // We use our typed params and cast to the expected type
  return client.authorizationUrl(
    params as Parameters<typeof client.authorizationUrl>[0],
  );
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  providerId: string,
  code: string,
  codeVerifier: string,
): Promise<unknown> {
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
): Promise<OAuthUserInfo> {
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
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to get user info from ${providerId}`);
      }

      const data = (await response.json()) as Record<string, unknown>;
      return normalizeUserInfo(data, config);
    }

    throw error;
  }
}

/**
 * Get user info from custom userinfo endpoint
 */
async function getCustomUserInfo(
  accessToken: string,
  config: OAuthProviderConfig,
): Promise<OAuthUserInfo> {
  if (!config.userinfoUrl) {
    throw new Error(`Provider ${config.id} missing userinfo URL`);
  }

  const response = await fetch(config.userinfoUrl, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to get user info from ${config.id}`);
  }

  const data: Record<string, unknown> = (await response.json()) as Record<
    string,
    unknown
  >;

  // Some providers may have a separate email endpoint
  // This can be configured in config.json if needed
  if (config.emailUrl && !data[config.emailField]) {
    const emailResponse = await fetch(config.emailUrl, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
    });

    if (emailResponse.ok) {
      const emailData: unknown = await emailResponse.json();
      // Handle array of emails (some providers return multiple)
      if (Array.isArray(emailData)) {
        const primaryEmail = emailData.find(
          (e: Record<string, unknown>) => e.primary || e.verified,
        );
        if (primaryEmail) {
          data[config.emailField] = primaryEmail.email || primaryEmail.value;
        }
      } else {
        const emailObj = emailData as Record<string, unknown>;
        data[config.emailField] = emailObj[config.emailField] || emailObj.email;
      }
    }
  }

  return normalizeUserInfo(data, config);
}

/**
 * Normalize user info based on provider config field mappings
 */
function normalizeUserInfo(
  data: Record<string, unknown>,
  config: OAuthProviderConfig,
): OAuthUserInfo {
  // Extract fields based on config mappings
  const userId = data[config.userIdField] || data.id || data.sub;
  const email = data[config.emailField] || data.email;
  const name =
    data[config.nameField] || data.name || data.username || data.login;

  // Standard normalized format
  return {
    id: String(userId),
    email: email ? String(email) : null,
    name: name ? String(name) : null,
    username: data.username
      ? String(data.username)
      : data.login
        ? String(data.login)
        : undefined,
    picture: data.picture
      ? String(data.picture)
      : data.avatar_url
        ? String(data.avatar_url)
        : data.avatar
          ? String(data.avatar)
          : undefined,
    raw: data, // Include raw data for debugging
  };
}

/**
 * Validate that a provider is supported
 */
export function validateProvider(providerId: string): boolean {
  return isProviderConfigured(providerId);
}
