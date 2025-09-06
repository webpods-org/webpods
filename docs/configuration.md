# Configuration Guide

## Configuration File

WebPods uses `config.json` for configuration with environment variable support for secrets.

### Basic Structure

```json
{
  "oauth": {
    "providers": [...],
    "defaultProvider": "github"
  },
  "hydra": {
    "adminUrl": "$HYDRA_ADMIN_URL || http://localhost:4445",
    "publicUrl": "$HYDRA_PUBLIC_URL || http://localhost:4444"
  },
  "server": {
    "host": "$HOST || 0.0.0.0",
    "port": "$PORT || 3000",
    "publicUrl": "$PUBLIC_URL || http://localhost:3000"
  },
  "rateLimits": {
    "read": "$RATE_LIMIT_READS || 10000",       // Read requests per hour
    "write": "$RATE_LIMIT_WRITES || 1000",      // Write requests per hour
    "podCreate": "$RATE_LIMIT_POD_CREATE || 10",           // Pod creations per day
    "streamCreate": "$RATE_LIMIT_STREAM_CREATE || 100",    // Stream creations per day
    "maxRecordLimit": "$MAX_RECORD_LIMIT || 1000"          // Max records per request
  },
  "rootPod": "root"  // Optional: serve main domain from this pod
}
```

## OAuth Provider Configuration

### GitHub

```json
{
  "id": "github",
  "clientId": "your-github-client-id",
  "clientSecret": "$GITHUB_OAUTH_SECRET",
  "authUrl": "https://github.com/login/oauth/authorize",
  "tokenUrl": "https://github.com/login/oauth/access_token",
  "userinfoUrl": "https://api.github.com/user",
  "emailUrl": "https://api.github.com/user/emails",
  "scope": "read:user user:email",
  "userIdField": "id",
  "emailField": "email",
  "nameField": "name"
}
```

### Google (OIDC)

```json
{
  "id": "google",
  "clientId": "your-google-client-id",
  "clientSecret": "$GOOGLE_OAUTH_SECRET",
  "issuer": "https://accounts.google.com",
  "scope": "openid email profile",
  "userIdField": "sub",
  "emailField": "email",
  "nameField": "name"
}
```

### Generic OAuth 2.0

```json
{
  "id": "custom",
  "clientId": "your-client-id",
  "clientSecret": "$CUSTOM_OAUTH_SECRET",
  "authUrl": "https://auth.example.com/oauth/authorize",
  "tokenUrl": "https://auth.example.com/oauth/token",
  "userinfoUrl": "https://auth.example.com/api/user",
  "scope": "openid email profile",
  "userIdField": "id",
  "emailField": "email",
  "nameField": "name"
}
```

### Provider Fields

| Field          | Required | Description               |
| -------------- | -------- | ------------------------- |
| `id`           | Yes      | Unique identifier         |
| `clientId`     | Yes      | OAuth application ID      |
| `clientSecret` | Yes      | OAuth application secret  |
| `issuer`       | No\*     | OIDC discovery URL        |
| `authUrl`      | No\*     | Authorization endpoint    |
| `tokenUrl`     | No\*     | Token endpoint            |
| `userinfoUrl`  | No\*     | User info endpoint        |
| `emailUrl`     | No       | Separate email endpoint   |
| `scope`        | Yes      | OAuth scopes              |
| `userIdField`  | Yes      | User ID field in response |
| `emailField`   | Yes      | Email field in response   |
| `nameField`    | Yes      | Name field in response    |

\*Either `issuer` OR all three URLs required

## Rate Limits

WebPods supports configurable rate limits to prevent abuse:

### Configuration

Rate limits can be set in `config.json` or via environment variables:

| Field            | Environment Variable       | Default | Description                          |
| ---------------- | -------------------------- | ------- | ------------------------------------ |
| `read`           | `RATE_LIMIT_READS`         | 10000   | Read requests per hour per IP        |
| `write`          | `RATE_LIMIT_WRITES`        | 1000    | Write requests per hour per user     |
| `podCreate`      | `RATE_LIMIT_POD_CREATE`    | 10      | Pod creations per day per user       |
| `streamCreate`   | `RATE_LIMIT_STREAM_CREATE` | 100     | Stream creations per day per user    |
| `maxRecordLimit` | `MAX_RECORD_LIMIT`         | 1000    | Maximum records returned per request |

### Rate Limit Headers

When rate limits are exceeded, the API returns:

- Status: `429 Too Many Requests`
- Headers:
  - `X-RateLimit-Limit`: Request limit
  - `X-RateLimit-Remaining`: Remaining requests
  - `X-RateLimit-Reset`: Unix timestamp when limit resets
  - `Retry-After`: Seconds until limit resets

## Environment Variables

### Required

```bash
JWT_SECRET=random-256-bit-key
SESSION_SECRET=random-256-bit-key
DATABASE_URL=postgresql://user:pass@host/db
```

### Optional

```bash
# Server
HOST=0.0.0.0
PORT=3000
PUBLIC_URL=https://webpods.org
DOMAIN=webpods.org

# Database
WEBPODS_DB_HOST=localhost
WEBPODS_DB_PORT=5432
WEBPODS_DB_USER=postgres
WEBPODS_DB_PASSWORD=postgres
WEBPODS_DB_NAME=webpodsdb

# OAuth Secrets (referenced in config.json)
GITHUB_OAUTH_SECRET=...
GOOGLE_OAUTH_SECRET=...

# Hydra (for third-party OAuth)
HYDRA_ADMIN_URL=http://localhost:4445
HYDRA_PUBLIC_URL=http://localhost:4444

# Limits
MAX_PAYLOAD_SIZE=10mb
MAX_RECORD_LIMIT=1000  # Max records per request (default: 1000)

# Rate Limits (per hour)
RATE_LIMIT_WRITES=1000        # Write operations per hour
RATE_LIMIT_READS=10000        # Read operations per hour
RATE_LIMIT_POD_CREATE=10      # Pod creations per hour
RATE_LIMIT_STREAM_CREATE=100  # Stream creations per hour
```

## Setting Up OAuth Providers

### GitHub

1. Go to https://github.com/settings/developers
2. Click "New OAuth App"
3. Set:
   - Application name: Your app name
   - Homepage URL: https://webpods.org
   - Authorization callback URL: https://webpods.org/auth/github/callback
4. Copy Client ID and Client Secret

### Google

1. Go to https://console.cloud.google.com/apis/credentials
2. Create "OAuth 2.0 Client ID"
3. Set:
   - Application type: Web application
   - Authorized redirect URIs: https://webpods.org/auth/google/callback
4. Copy Client ID and Client Secret

## Hydra Configuration

For third-party OAuth support:

```yaml
# docker-compose.yml
hydra:
  image: oryd/hydra:v2.3.0
  environment:
    DSN: postgresql://...
    URLS_SELF_ISSUER: https://auth.webpods.org
    URLS_CONSENT: https://webpods.org/oauth/consent
    URLS_LOGIN: https://webpods.org/oauth/login
  ports:
    - "4444:4444" # Public API
    - "4445:4445" # Admin API
```

## Complete Example

See `config.example.json` for a complete configuration template.
