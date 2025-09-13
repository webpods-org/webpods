# Third-Party Integration Guide

Build applications that interact with user pods through OAuth 2.0 authentication.

## Overview

WebPods uses Ory Hydra to provide OAuth 2.0 and OpenID Connect authentication, enabling third-party applications to:

- Authenticate users via their WebPods accounts
- Request access to specific user pods
- Read and write data on behalf of users
- Build applications on top of WebPods infrastructure

## Quick Start Example

Here's a complete example of integrating WebPods into your application:

```javascript
// 1. Register your application (one-time setup)
const registerApp = async () => {
  const response = await fetch("https://webpods.org/oauth/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_name: "My Analytics Dashboard",
      redirect_uris: ["https://myapp.com/auth/callback"],
      scope: "openid offline pod:read pod:write",
      contacts: ["admin@myapp.com"],
    }),
  });

  const { client_id, client_secret } = await response.json();
  // Save these credentials securely
  return { client_id, client_secret };
};

// 2. Redirect user to authorize
const authorizeUser = (clientId) => {
  const authUrl = `https://webpods.org/connect?client_id=${clientId}`;
  window.location.href = authUrl;
};

// 3. Handle OAuth callback
const handleCallback = async (code, clientId, clientSecret) => {
  const tokenResponse = await fetch("https://webpods.org/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "https://myapp.com/auth/callback",
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  const tokens = await tokenResponse.json();
  // Store tokens securely
  return tokens;
};

// 4. Access user's pods
const accessPodData = async (pod, path, accessToken) => {
  const response = await fetch(`https://${pod}.webpods.org${path}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  return response.json();
};
```

## OAuth Client Registration

### Registering Your Application

Before users can authorize your application, you must register it with WebPods:

```bash
curl -X POST https://webpods.org/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Application",
    "redirect_uris": ["https://myapp.com/callback"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid offline pod:read pod:write",
    "token_endpoint_auth_method": "client_secret_post",
    "contacts": ["support@myapp.com"],
    "logo_uri": "https://myapp.com/logo.png",
    "client_uri": "https://myapp.com",
    "policy_uri": "https://myapp.com/privacy",
    "tos_uri": "https://myapp.com/terms"
  }'
```

**Response:**

```json
{
  "client_id": "abc123xyz789",
  "client_secret": "secret_key_here",
  "client_name": "My Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "scope": "openid offline pod:read pod:write"
}
```

### Registration Parameters

- **client_name** (required) - Display name for your application
- **redirect_uris** (required) - Array of allowed callback URLs
- **grant_types** - OAuth grant types (default: authorization_code, refresh_token)
- **response_types** - OAuth response types (default: code)
- **scope** - Requested permissions (see Scopes section)
- **token_endpoint_auth_method** - How to authenticate at token endpoint:
  - `none` - Public client (mobile/SPA apps)
  - `client_secret_post` - Include secret in POST body
- **contacts** - Support email addresses
- **logo_uri** - Application logo URL
- **client_uri** - Application homepage
- **policy_uri** - Privacy policy URL
- **tos_uri** - Terms of service URL

### Client Types

#### Public Clients (SPAs, Mobile Apps)

For applications that cannot securely store secrets:

```json
{
  "client_name": "My Mobile App",
  "redirect_uris": ["myapp://callback"],
  "token_endpoint_auth_method": "none",
  "scope": "openid pod:read pod:write"
}
```

#### Confidential Clients (Server Applications)

For applications with secure backend servers:

```json
{
  "client_name": "My Web Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "token_endpoint_auth_method": "client_secret_post",
  "scope": "openid offline pod:read pod:write"
}
```

## Authorization Flow

### Step 1: Direct User to Authorization

#### Simple Method (Recommended)

Use the `/connect` endpoint for simplified flow:

```javascript
const clientId = "your_client_id";
const authUrl = `https://webpods.org/connect?client_id=${clientId}`;
window.location.href = authUrl;
```

#### Direct Hydra Method

For more control, use Hydra OAuth endpoints directly:

```javascript
const params = new URLSearchParams({
  client_id: "your_client_id",
  redirect_uri: "https://myapp.com/callback",
  response_type: "code",
  scope: "openid offline pod:read pod:write",
  state: generateRandomState(), // CSRF protection
});

const authUrl = `https://webpods.org/oauth2/auth?${params}`;
window.location.href = authUrl;
```

### Step 2: User Login and Consent

Users will:

1. Login with their WebPods account (GitHub, Google, etc.)
2. See a consent screen showing:
   - Your application name and logo
   - Which pods your app wants to access
   - Requested permissions (read/write)
3. Approve or deny access

### Step 3: Handle Callback

After authorization, WebPods redirects to your callback URL:

```
https://myapp.com/callback?code=AUTH_CODE&state=STATE
```

Extract and exchange the authorization code:

```javascript
// Express.js example
app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;

  // Verify state for CSRF protection
  if (state !== savedState) {
    return res.status(400).send("Invalid state");
  }

  // Exchange code for tokens
  const tokenResponse = await fetch("https://webpods.org/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "https://myapp.com/callback",
      client_id: process.env.CLIENT_ID,
      client_secret: process.env.CLIENT_SECRET,
    }),
  });

  const tokens = await tokenResponse.json();

  // Store tokens securely
  req.session.accessToken = tokens.access_token;
  req.session.refreshToken = tokens.refresh_token;

  res.redirect("/dashboard");
});
```

### Step 4: Token Response

Successful token exchange returns:

```json
{
  "access_token": "eyJhbGciOiJSUzI1NiIs...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "refresh_token_here",
  "id_token": "eyJhbGciOiJSUzI1NiIs...",
  "scope": "openid offline pod:read pod:write"
}
```

### Step 5: Access Pod Data

Use the access token to interact with user pods:

```javascript
const fetchPodData = async (pod, path, accessToken) => {
  const response = await fetch(`https://${pod}.webpods.org${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json();
};

// Example: Read user's blog posts
const posts = await fetchPodData("alice", "/blog/posts", accessToken);

// Example: Write new data
const writeData = async (pod, path, data, accessToken) => {
  const response = await fetch(`https://${pod}.webpods.org${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });

  return response.json();
};
```

## Token Management

### Token Structure

Access tokens are JWTs containing:

```json
{
  "sub": "github:12345", // User ID
  "client_id": "abc123xyz789", // Your client ID
  "aud": ["https://alice.webpods.org"], // Authorized pods
  "scope": "openid pod:read pod:write",
  "ext": {
    "pods": ["alice", "bob"] // Pods user granted access to
  },
  "exp": 1704067200, // Expiration timestamp
  "iat": 1704063600 // Issued at timestamp
}
```

### Token Validation

Always validate tokens before use:

```javascript
import jwt from "jsonwebtoken";
import jwksRsa from "jwks-rsa";

const client = jwksRsa({
  jwksUri: "https://webpods.org/.well-known/jwks.json",
});

const getKey = (header, callback) => {
  client.getSigningKey(header.kid, (err, key) => {
    const signingKey = key?.getPublicKey();
    callback(err, signingKey);
  });
};

const verifyToken = (token) => {
  return new Promise((resolve, reject) => {
    jwt.verify(
      token,
      getKey,
      {
        algorithms: ["RS256"],
        issuer: "https://webpods.org/",
      },
      (err, decoded) => {
        if (err) reject(err);
        else resolve(decoded);
      },
    );
  });
};
```

### Refreshing Tokens

When access tokens expire, use refresh tokens to get new ones:

```javascript
const refreshAccessToken = async (refreshToken, clientId, clientSecret) => {
  const response = await fetch("https://webpods.org/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
  });

  if (!response.ok) {
    throw new Error("Failed to refresh token");
  }

  return response.json();
};

// Auto-refresh middleware
const autoRefresh = async (req, res, next) => {
  const token = req.session.accessToken;

  try {
    const decoded = jwt.decode(token);
    const expiresIn = decoded.exp - Math.floor(Date.now() / 1000);

    // Refresh if expiring in less than 5 minutes
    if (expiresIn < 300) {
      const newTokens = await refreshAccessToken(
        req.session.refreshToken,
        process.env.CLIENT_ID,
        process.env.CLIENT_SECRET,
      );

      req.session.accessToken = newTokens.access_token;
      if (newTokens.refresh_token) {
        req.session.refreshToken = newTokens.refresh_token;
      }
    }
  } catch (error) {
    // Handle refresh failure
    return res.redirect("/auth/login");
  }

  next();
};
```

## Scopes and Permissions

### Available Scopes

- **openid** - Basic user information
- **offline** - Refresh token for long-lived access
- **pod:read** - Read access to authorized pods
- **pod:write** - Write access to authorized pods

### Legacy Pod-Specific Scopes

For backward compatibility, pod-specific scopes are supported:

- **pod:alice** - Access to the 'alice' pod
- **pod:bob** - Access to the 'bob' pod

### Requesting Pod Access

#### Method 1: State Parameter (Recommended)

Pass requested pods in the state parameter:

```javascript
const state = Buffer.from(
  JSON.stringify({
    nonce: generateNonce(),
    pods: ["alice", "bob", "charlie"],
  }),
).toString("base64");

const authUrl = `https://webpods.org/oauth2/auth?client_id=${clientId}&state=${state}`;
```

#### Method 2: Legacy Scopes

Include pod names in scope:

```javascript
const scope = "openid offline pod:read pod:write pod:alice pod:bob";
```

### Permission Checks

The token's `ext.pods` claim lists authorized pods:

```javascript
const canAccessPod = (token, podName) => {
  const decoded = jwt.decode(token);
  return decoded.ext?.pods?.includes(podName) || false;
};
```

## API Endpoints for OAuth

### Registration Endpoints

#### `POST /oauth/register`

Register new OAuth client.

```bash
curl -X POST https://webpods.org/oauth/register \
  -H "Content-Type: application/json" \
  -d '{"client_name": "My App", ...}'
```

#### `GET /oauth/client/{clientId}`

Get public client information.

```bash
curl https://webpods.org/oauth/client/abc123xyz789
```

### Authorization Endpoints

#### `GET /connect`

Simplified authorization flow.

```
https://webpods.org/connect?client_id=abc123xyz789
```

#### `GET /oauth2/auth`

Standard OAuth authorization endpoint.

```
https://webpods.org/oauth2/auth?
  client_id=abc123xyz789&
  redirect_uri=https://myapp.com/callback&
  response_type=code&
  scope=openid+offline+pod:read+pod:write&
  state=random_state
```

#### `POST /oauth2/token`

Exchange authorization code for tokens.

```bash
curl -X POST https://webpods.org/oauth2/token \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "grant_type=authorization_code&code=AUTH_CODE&..."
```

#### `POST /oauth2/revoke`

Revoke access or refresh token.

```bash
curl -X POST https://webpods.org/oauth2/revoke \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "token=REFRESH_TOKEN&client_id=CLIENT_ID&client_secret=CLIENT_SECRET"
```

#### `GET /.well-known/openid-configuration`

OpenID Connect discovery endpoint.

```bash
curl https://webpods.org/.well-known/openid-configuration
```

## Building Your Application

### Design Considerations

#### Stateless vs Stateful

**Stateless Architecture:**

- Store tokens in encrypted cookies
- No server-side session storage
- Scales horizontally easily

```javascript
// Encrypted cookie storage
app.use(
  cookieSession({
    name: "session",
    keys: [process.env.SESSION_KEY],
    maxAge: 24 * 60 * 60 * 1000, // 24 hours
    httpOnly: true,
    secure: true,
  }),
);
```

**Stateful Architecture:**

- Store tokens in server-side session
- Better for sensitive applications
- Requires session store (Redis, database)

```javascript
// Redis session storage
app.use(
  session({
    store: new RedisStore({ client: redisClient }),
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);
```

#### Token Storage Security

**DO:**

- Store tokens in httpOnly cookies
- Use secure flag in production
- Encrypt sensitive data
- Implement CSRF protection

**DON'T:**

- Store tokens in localStorage (XSS vulnerable)
- Log tokens
- Send tokens in URL parameters
- Store tokens in plain text

### Best Practices

#### Error Handling

```javascript
class WebPodsClient {
  async request(url, options = {}) {
    const response = await fetch(url, {
      ...options,
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        ...options.headers,
      },
    });

    if (response.status === 401) {
      // Token expired, try refresh
      await this.refreshToken();
      return this.request(url, options);
    }

    if (response.status === 403) {
      throw new Error("Access denied to pod");
    }

    if (response.status === 429) {
      // Rate limited, wait and retry
      const retryAfter = response.headers.get("X-RateLimit-Reset");
      await this.waitUntil(retryAfter);
      return this.request(url, options);
    }

    if (!response.ok) {
      const error = await response.json();
      throw new Error(error.message || `HTTP ${response.status}`);
    }

    return response.json();
  }
}
```

#### Rate Limiting

Respect WebPods rate limits:

```javascript
class RateLimiter {
  constructor() {
    this.requests = [];
    this.limit = 60; // requests per minute
  }

  async throttle() {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove old requests
    this.requests = this.requests.filter((t) => t > oneMinuteAgo);

    if (this.requests.length >= this.limit) {
      const oldestRequest = this.requests[0];
      const waitTime = 60000 - (now - oldestRequest);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }

    this.requests.push(now);
  }
}
```

#### Batch Operations

Optimize API calls:

```javascript
// Instead of multiple individual requests
for (const record of records) {
  await writeRecord(pod, path, record);
}

// Batch write in a single stream
const batchWrite = async (pod, path, records) => {
  const results = [];
  for (const record of records) {
    results.push(await writeRecord(pod, path, record));
  }
  return results;
};
```

### Testing Locally

#### Development Setup

1. Run WebPods locally:

```bash
docker-compose up -d
```

2. Configure OAuth client for local development:

```json
{
  "client_name": "My App (Dev)",
  "redirect_uris": ["http://localhost:3001/callback"]
}
```

3. Use test mode headers for automated testing:

```javascript
// Only works when WebPods is in test mode
const headers = process.env.TEST_MODE
  ? {
      "X-Test-User": "test-user-123",
      "X-Test-Consent": "true",
    }
  : {};
```

#### Mock OAuth Flow

For unit tests, mock the OAuth flow:

```javascript
class MockWebPodsAuth {
  async authorize() {
    return {
      access_token: "mock_token",
      refresh_token: "mock_refresh",
      expires_in: 3600,
    };
  }

  async validateToken(token) {
    return {
      sub: "test:user",
      client_id: "test_client",
      ext: { pods: ["test-pod"] },
    };
  }
}
```

## Complete Example: Analytics Dashboard

Here's a full example of a third-party analytics dashboard:

```javascript
// server.js
import express from "express";
import session from "express-session";
import crypto from "crypto";

const app = express();

// Session configuration
app.use(
  session({
    secret: process.env.SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
  }),
);

// OAuth configuration
const oauth = {
  clientId: process.env.WEBPODS_CLIENT_ID,
  clientSecret: process.env.WEBPODS_CLIENT_SECRET,
  redirectUri: process.env.WEBPODS_REDIRECT_URI,
  baseUrl: process.env.WEBPODS_URL || "https://webpods.org",
};

// Start OAuth flow
app.get("/auth/login", (req, res) => {
  const state = crypto.randomBytes(16).toString("hex");
  req.session.oauthState = state;

  const authUrl = `${oauth.baseUrl}/connect?client_id=${oauth.clientId}`;
  res.redirect(authUrl);
});

// Handle OAuth callback
app.get("/auth/callback", async (req, res) => {
  const { code, state } = req.query;

  // Verify state
  if (state !== req.session.oauthState) {
    return res.status(400).send("Invalid state parameter");
  }

  try {
    // Exchange code for tokens
    const tokenResponse = await fetch(`${oauth.baseUrl}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: code,
        redirect_uri: oauth.redirectUri,
        client_id: oauth.clientId,
        client_secret: oauth.clientSecret,
      }),
    });

    const tokens = await tokenResponse.json();

    // Store tokens in session
    req.session.accessToken = tokens.access_token;
    req.session.refreshToken = tokens.refresh_token;
    req.session.tokenExpiry = Date.now() + tokens.expires_in * 1000;

    res.redirect("/dashboard");
  } catch (error) {
    console.error("OAuth error:", error);
    res.status(500).send("Authentication failed");
  }
});

// Middleware to check authentication
const requireAuth = async (req, res, next) => {
  if (!req.session.accessToken) {
    return res.redirect("/auth/login");
  }

  // Check token expiry
  if (Date.now() >= req.session.tokenExpiry - 60000) {
    // Refresh 1 min early
    try {
      const refreshResponse = await fetch(`${oauth.baseUrl}/oauth2/token`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "refresh_token",
          refresh_token: req.session.refreshToken,
          client_id: oauth.clientId,
          client_secret: oauth.clientSecret,
        }),
      });

      const tokens = await refreshResponse.json();
      req.session.accessToken = tokens.access_token;
      req.session.tokenExpiry = Date.now() + tokens.expires_in * 1000;
    } catch (error) {
      return res.redirect("/auth/login");
    }
  }

  next();
};

// Dashboard - show authorized pods
app.get("/dashboard", requireAuth, async (req, res) => {
  // Decode token to get pod list
  const token = req.session.accessToken;
  const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64"));
  const pods = payload.ext?.pods || [];

  res.json({
    user: payload.sub,
    pods: pods,
  });
});

// Fetch analytics data from pod
app.get("/api/analytics/:pod", requireAuth, async (req, res) => {
  const { pod } = req.params;
  const { path = "/analytics" } = req.query;

  try {
    const response = await fetch(`https://${pod}.webpods.org${path}`, {
      headers: {
        Authorization: `Bearer ${req.session.accessToken}`,
      },
    });

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to fetch from pod: ${response.statusText}`,
      });
    }

    const data = await response.json();
    res.json(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Write analytics event to pod
app.post("/api/analytics/:pod/events", requireAuth, async (req, res) => {
  const { pod } = req.params;
  const event = req.body;

  try {
    const response = await fetch(
      `https://${pod}.webpods.org/analytics/events`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${req.session.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(event),
      },
    );

    if (!response.ok) {
      return res.status(response.status).json({
        error: `Failed to write to pod: ${response.statusText}`,
      });
    }

    const result = await response.json();
    res.json(result);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Logout
app.post("/auth/logout", (req, res) => {
  req.session.destroy();
  res.redirect("/");
});

app.listen(3001, () => {
  console.log("Analytics dashboard running on http://localhost:3001");
});
```

## SDK Support

While WebPods doesn't provide official SDKs yet, here are examples for common languages:

### JavaScript/TypeScript SDK Example

```typescript
class WebPodsClient {
  private accessToken: string;
  private refreshToken: string;
  private baseUrl: string;

  constructor(config: {
    accessToken: string;
    refreshToken?: string;
    baseUrl?: string;
  }) {
    this.accessToken = config.accessToken;
    this.refreshToken = config.refreshToken || "";
    this.baseUrl = config.baseUrl || "https://webpods.org";
  }

  async readRecord(pod: string, path: string, name?: string): Promise<any> {
    const url = name
      ? `https://${pod}.webpods.org${path}/${name}`
      : `https://${pod}.webpods.org${path}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async writeRecord(pod: string, path: string, data: any): Promise<any> {
    const response = await fetch(`https://${pod}.webpods.org${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }

  async listRecords(
    pod: string,
    path: string,
    options?: {
      limit?: number;
      after?: number;
      unique?: boolean;
    },
  ): Promise<any> {
    const params = new URLSearchParams();
    if (options?.limit) params.append("limit", options.limit.toString());
    if (options?.after) params.append("after", options.after.toString());
    if (options?.unique) params.append("unique", "true");

    const url = `https://${pod}.webpods.org${path}?${params}`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${this.accessToken}` },
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    return response.json();
  }
}

// Usage
const client = new WebPodsClient({
  accessToken: "your_access_token",
});

const records = await client.listRecords("alice", "/blog/posts", {
  limit: 10,
  after: -10, // Last 10 records
});
```

### Python SDK Example

```python
import requests
from typing import Optional, Dict, Any

class WebPodsClient:
    def __init__(self, access_token: str, base_url: str = "https://webpods.org"):
        self.access_token = access_token
        self.base_url = base_url
        self.session = requests.Session()
        self.session.headers.update({
            "Authorization": f"Bearer {access_token}"
        })

    def read_record(self, pod: str, path: str, name: Optional[str] = None) -> Dict[str, Any]:
        url = f"https://{pod}.webpods.org{path}"
        if name:
            url += f"/{name}"

        response = self.session.get(url)
        response.raise_for_status()
        return response.json()

    def write_record(self, pod: str, path: str, data: Any) -> Dict[str, Any]:
        url = f"https://{pod}.webpods.org{path}"

        response = self.session.post(url, json=data)
        response.raise_for_status()
        return response.json()

    def list_records(self, pod: str, path: str,
                    limit: Optional[int] = None,
                    after: Optional[int] = None,
                    unique: bool = False) -> Dict[str, Any]:
        url = f"https://{pod}.webpods.org{path}"

        params = {}
        if limit:
            params['limit'] = limit
        if after is not None:
            params['after'] = after
        if unique:
            params['unique'] = 'true'

        response = self.session.get(url, params=params)
        response.raise_for_status()
        return response.json()

# Usage
client = WebPodsClient(access_token="your_access_token")

# Read records
records = client.list_records("alice", "/blog/posts", limit=10, after=-10)

# Write record
result = client.write_record("alice", "/analytics", {
    "event": "page_view",
    "timestamp": "2024-01-15T10:30:00Z"
})
```

## Security Considerations

### HTTPS Only

Always use HTTPS in production:

- Redirect all HTTP traffic to HTTPS
- Use secure cookies
- Enable HSTS headers

### CSRF Protection

Implement CSRF protection for all state-changing operations:

```javascript
import csrf from "csurf";

const csrfProtection = csrf({ cookie: true });
app.use(csrfProtection);

app.get("/form", (req, res) => {
  res.render("form", { csrfToken: req.csrfToken() });
});
```

### Content Security Policy

Set appropriate CSP headers:

```javascript
app.use((req, res, next) => {
  res.setHeader(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self' 'unsafe-inline';",
  );
  next();
});
```

### Token Rotation

Regularly rotate tokens and implement proper revocation:

```javascript
// Revoke token on logout
const revokeToken = async (token) => {
  await fetch("https://webpods.org/oauth2/revoke", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      token: token,
      client_id: oauth.clientId,
      client_secret: oauth.clientSecret,
    }),
  });
};
```

## Troubleshooting

### Common Issues

#### "Invalid client_id"

- Verify client is registered
- Check for typos in client_id
- Ensure using correct WebPods server

#### "Invalid redirect_uri"

- Redirect URI must exactly match registered URI
- Check for trailing slashes
- Verify protocol (http vs https)

#### "Token expired"

- Implement automatic token refresh
- Check token expiry before requests
- Handle 401 responses gracefully

#### "Access denied to pod"

- User hasn't granted access to this pod
- Token doesn't include required pod in ext.pods
- Request new authorization for additional pods

#### Rate Limiting

- Implement exponential backoff
- Check X-RateLimit headers
- Cache responses when appropriate

### Debug Mode

Enable detailed logging for development:

```javascript
if (process.env.NODE_ENV === "development") {
  // Log all WebPods requests
  const originalFetch = fetch;
  global.fetch = async (...args) => {
    console.log("WebPods Request:", args);
    const response = await originalFetch(...args);
    console.log("WebPods Response:", response.status);
    return response;
  };
}
```

## Migration from Direct Auth

If migrating from direct WebPods authentication to OAuth:

1. Register your application as OAuth client
2. Update authentication flow to use OAuth
3. Map existing user IDs (they remain the same)
4. Update API calls to use OAuth tokens
5. Implement token refresh logic

The user IDs remain consistent across both authentication methods, simplifying migration.
