// Test HTTP client utilities using native fetch
import jwt from "jsonwebtoken";
import crypto from "crypto";

// Define RequestInit type for fetch options
type RequestInit = Parameters<typeof fetch>[1];

export interface FetchResponse {
  status: number;
  headers: Record<string, string>;
  data: any;
  text?: string;
}

export interface TokenPayload {
  user_id: string;
  email?: string | null;
  name?: string | null;
  pod?: string;
}

export class TestHttpClient {
  private baseURL: string;
  private authToken: string | null = null;
  private cookieJar: Map<string, string> = new Map();

  /**
   * Generate a JWT token for testing
   * @param payload Token payload
   * @param options JWT sign options
   * @returns Signed JWT token
   */
  public static generateToken(
    payload: TokenPayload,
    options?: jwt.SignOptions,
  ): string {
    const secret = "test-secret-key"; // Must match test-config.json
    return jwt.sign(payload, secret, options || { expiresIn: "1h" });
  }

  /**
   * Generate a pod-specific JWT token for testing
   * @param payload Token payload (pod will be extracted from baseURL if not provided)
   * @param pod Optional pod name to override
   * @param options JWT sign options
   * @returns Signed JWT token with pod claim
   */
  public generatePodToken(
    payload: TokenPayload,
    pod?: string,
    options?: jwt.SignOptions,
  ): string {
    // Extract pod from baseURL if not provided
    if (!pod) {
      const url = new URL(this.baseURL);
      const hostParts = url.hostname.split(".");
      if (hostParts.length > 1 && hostParts[0] !== "localhost") {
        pod = hostParts[0];
      }
    }

    const tokenPayload = { ...payload };
    if (pod) {
      tokenPayload.pod = pod;
    }

    return TestHttpClient.generateToken(tokenPayload, options);
  }

  constructor(baseURL: string) {
    this.baseURL = baseURL;
  }

  public setAuthToken(token: string): void {
    this.authToken = token;
  }

  public clearAuthToken(): void {
    this.authToken = null;
  }

  public setBaseUrl(baseURL: string): void {
    this.baseURL = baseURL;
  }

  public setCookie(name: string, value: string): void {
    this.cookieJar.set(name, value);
  }

  public getCookie(name: string): string | undefined {
    return this.cookieJar.get(name);
  }

  public clearCookies(): void {
    this.cookieJar.clear();
  }

  private getCookieHeader(): string | undefined {
    if (this.cookieJar.size === 0) return undefined;

    const cookies: string[] = [];
    this.cookieJar.forEach((value, name) => {
      cookies.push(`${name}=${value}`);
    });
    return cookies.join("; ");
  }

  private storeCookiesFromResponse(headers: Record<string, string>): void {
    const setCookieHeader = headers["set-cookie"];
    if (!setCookieHeader) return;

    // Parse set-cookie header (simplified - doesn't handle all edge cases)
    const cookies = setCookieHeader.split(",").map((c) => c.trim());
    cookies.forEach((cookie) => {
      const parts = cookie.split(";");
      if (parts.length > 0 && parts[0]) {
        const nameValue = parts[0];
        const equalIndex = nameValue.indexOf("=");
        if (equalIndex > 0) {
          const name = nameValue.substring(0, equalIndex).trim();
          const value = nameValue.substring(equalIndex + 1).trim();
          if (name && value) {
            this.cookieJar.set(name, value);
          }
        }
      }
    });
  }

  private buildUrl(path: string, params?: any): string {
    const url = new URL(path, this.baseURL);
    if (params) {
      Object.keys(params).forEach((key) => {
        if (params[key] !== undefined) {
          url.searchParams.append(key, params[key]);
        }
      });
    }
    return url.toString();
  }

  private getHeaders(
    additionalHeaders?: Record<string, string>,
  ): Record<string, string> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...additionalHeaders,
    };

    if (this.authToken) {
      headers["Authorization"] = this.authToken.startsWith("Bearer ")
        ? this.authToken
        : `Bearer ${this.authToken}`;
    }

    // Add cookies to headers
    const cookieHeader = this.getCookieHeader();
    if (cookieHeader) {
      headers["Cookie"] = cookieHeader;
    }

    return headers;
  }

  private async processResponse(response: Response): Promise<FetchResponse> {
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
      headers[key] = value;
    });

    // Store cookies from response
    this.storeCookiesFromResponse(headers);

    const text = await response.text();
    let data: any = text;

    // Try to parse as JSON if content-type suggests it
    const contentType = headers["content-type"] || "";
    if (contentType.includes("application/json") && text) {
      try {
        data = JSON.parse(text);
      } catch {
        // Keep as text if JSON parsing fails
      }
    }

    return {
      status: response.status,
      headers,
      data,
      text,
    };
  }

  public async get(url: string, config?: any): Promise<FetchResponse> {
    const options: RequestInit = {
      method: "GET",
      headers: this.getHeaders(config?.headers),
    };

    // Handle followRedirect option
    if (config?.followRedirect === false) {
      options.redirect = "manual";
    }

    // Build URL with params
    const fullUrl = this.buildUrl(url, config?.params);

    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async post(
    url: string,
    data?: any,
    config?: any,
  ): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);

    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === "string") {
        body = data;
        // Override content-type for plain text
        if (
          !config?.headers?.["Content-Type"] &&
          !config?.headers?.["content-type"]
        ) {
          headers["Content-Type"] = "text/plain";
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: "POST",
      headers,
      body,
    };

    // Handle followRedirect option
    if (config?.followRedirect === false) {
      options.redirect = "manual";
    }

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async put(
    url: string,
    data?: any,
    config?: any,
  ): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);

    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === "string") {
        body = data;
        // Override content-type for plain text
        if (
          !config?.headers?.["Content-Type"] &&
          !config?.headers?.["content-type"]
        ) {
          headers["Content-Type"] = "text/plain";
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: "PUT",
      headers,
      body,
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async patch(
    url: string,
    data?: any,
    config?: any,
  ): Promise<FetchResponse> {
    const headers = this.getHeaders(config?.headers);

    let body: string | undefined;
    if (data !== undefined) {
      if (typeof data === "string") {
        body = data;
        // Override content-type for plain text
        if (
          !config?.headers?.["Content-Type"] &&
          !config?.headers?.["content-type"]
        ) {
          headers["Content-Type"] = "text/plain";
        }
      } else {
        body = JSON.stringify(data);
      }
    }

    const options: RequestInit = {
      method: "PATCH",
      headers,
      body,
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async delete(url: string): Promise<FetchResponse> {
    const options: RequestInit = {
      method: "DELETE",
      headers: this.getHeaders(),
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  public async head(url: string): Promise<FetchResponse> {
    const options: RequestInit = {
      method: "HEAD",
      headers: this.getHeaders(),
    };

    const fullUrl = this.buildUrl(url);
    const response = await fetch(fullUrl, options);
    return this.processResponse(response);
  }

  /**
   * Authenticate via OAuth flow for tests using real Hydra
   * This uses test mode headers to auto-accept login and consent
   * @param userId Test user ID
   * @param pods List of pods to request access to (e.g., ["alice", "bob"])
   * @returns Access token
   */
  public async authenticateViaOAuth(
    userId: string,
    pods: string[] = [],
  ): Promise<string> {
    const clientId = "webpods-test-authz-client";
    const redirectUri = "http://localhost:3000/callback";
    const scopes = "openid offline"; // Generic scopes only

    // Generate PKCE challenge using S256
    const codeVerifier =
      "test-verifier-43-chars-minimum-required-length-" +
      Math.random().toString(36).substring(7);
    const codeChallenge = crypto
      .createHash("sha256")
      .update(codeVerifier)
      .digest("base64url");

    // Cookie jar to maintain session
    const cookies = new Map<string, string>();

    // Helper to get cookie header
    const getCookieHeader = () => {
      return Array.from(cookies.entries())
        .map(([name, value]) => `${name}=${value}`)
        .join("; ");
    };

    // Helper to parse set-cookie headers
    const parseCookies = (setCookieHeader: string | null) => {
      if (!setCookieHeader) return;
      // Handle multiple set-cookie headers that may be combined
      const cookieArray = setCookieHeader.split(", ory_");
      cookieArray.forEach((cookie, index) => {
        if (index > 0) cookie = "ory_" + cookie;
        // Simple cookie parsing - just get name=value
        const firstPart = cookie.split(";")[0];
        if (!firstPart) return;
        const parts = firstPart.split("=");
        if (parts.length === 2 && parts[0] && parts[1]) {
          cookies.set(parts[0].trim(), parts[1].trim());
        }
      });
    };

    // Start OAuth flow with Hydra
    const authUrl = new URL("http://localhost:4444/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("scope", scopes);

    // Encode pods in state parameter since Hydra doesn't pass custom params through
    const stateData = {
      nonce: "test-state",
      pods: pods,
    };
    const state = Buffer.from(JSON.stringify(stateData)).toString("base64");
    authUrl.searchParams.set("state", state);

    authUrl.searchParams.set("code_challenge", codeChallenge);
    authUrl.searchParams.set("code_challenge_method", "S256");

    // Start the OAuth flow
    const authResponse = await fetch(authUrl.toString(), {
      redirect: "manual",
    });

    // Collect Hydra cookies
    parseCookies(authResponse.headers.get("set-cookie"));

    let location = authResponse.headers.get("location");
    if (!location) {
      throw new Error("No redirect from Hydra auth endpoint");
    }

    // Check for immediate error
    if (location.includes("error=")) {
      const errorUrl = new URL(location, "http://localhost:3000");
      const error = errorUrl.searchParams.get("error");
      const errorDesc = errorUrl.searchParams.get("error_description");
      throw new Error(`OAuth error from Hydra: ${error} - ${errorDesc}`);
    }

    // Follow redirect to login endpoint with test headers and cookies
    const loginResponse = await fetch(location, {
      redirect: "manual",
      headers: {
        "x-test-user": userId,
        "x-test-consent": "true",
        Cookie: getCookieHeader(),
      },
    });

    parseCookies(loginResponse.headers.get("set-cookie"));
    location = loginResponse.headers.get("location");
    let maxRedirects = 10;

    // Follow redirects until we get the authorization code
    while (location && !location.includes("code=") && maxRedirects-- > 0) {
      const nextResponse = await fetch(location, {
        redirect: "manual",
        headers: {
          "x-test-user": userId,
          "x-test-consent": "true",
          Cookie: getCookieHeader(),
        },
      });

      // Update cookies
      parseCookies(nextResponse.headers.get("set-cookie"));

      location = nextResponse.headers.get("location");

      // Check for errors in the redirect
      if (location && location.includes("error=")) {
        const errorUrl = new URL(location, "http://localhost:3000");
        const error = errorUrl.searchParams.get("error");
        const errorDesc = errorUrl.searchParams.get("error_description");
        throw new Error(`OAuth error: ${error} - ${errorDesc}`);
      }
    }

    if (!location || !location.includes("code=")) {
      throw new Error("Failed to get authorization code from Hydra");
    }

    // Extract the authorization code
    const callbackUrl = new URL(location, "http://localhost:3000");
    const code = callbackUrl.searchParams.get("code");

    if (!code) {
      throw new Error("No authorization code in callback URL");
    }

    // Exchange code for token
    const tokenResponse = await fetch("http://localhost:4444/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        client_id: clientId,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const error = await tokenResponse.text();
      throw new Error(`Failed to exchange code for token: ${error}`);
    }

    const tokenData = (await tokenResponse.json()) as any;

    if (!tokenData.access_token) {
      throw new Error("No access token in response");
    }

    // Set the token for future requests
    this.setAuthToken(tokenData.access_token);

    return tokenData.access_token;
  }

  /**
   * Create a stream explicitly using POST with empty body
   * @param streamName The name/path of the stream
   * @param accessPermission Optional access permission (defaults to 'public')
   * @param _streamType Optional stream type (unused, kept for compatibility)
   * @returns Response from stream creation
   */
  public async createStream(
    streamName: string,
    accessPermission?: string,
    _streamType?: string,
  ): Promise<FetchResponse> {
    // Create stream using POST with empty body
    const url = accessPermission
      ? `/${streamName}?access=${encodeURIComponent(accessPermission)}`
      : `/${streamName}`;

    return this.post(url, "", {
      headers: {
        "Content-Type": "application/json",
      },
    });
  }
}
