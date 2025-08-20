# WebPods

HTTP-based append-only logs organized as pods (subdomains) and streams.

## Quick Start

```bash
# Get auth token (e.g., using GitHub or Google)
curl https://webpods.org/auth/github
# or
curl https://webpods.org/auth/google

# Write to stream (creates pod and stream automatically)
# Name is required - last segment of path
curl -X POST https://alice.webpods.org/blog/first-post \
  -H "Authorization: Bearer $TOKEN" \
  -d "My first blog post"

# Read latest
curl https://alice.webpods.org/blog?i=-1
```

## Core Concepts

**Pod**: Subdomain namespace (`alice.webpods.org`)  
**Stream**: Append-only log (`/blog`, `/blog/2024/posts`)  
**Record**: Immutable entry with SHA-256 hash chain

## API

### Authentication

```bash
# List available providers
GET https://webpods.org/auth/providers

# Login with OAuth (GitHub, Google, or any configured provider)
GET https://webpods.org/auth/github
GET https://webpods.org/auth/google
GET https://webpods.org/auth/{provider}  # Any provider from config.json

# Get user info
GET https://webpods.org/auth/whoami
Authorization: Bearer {token}
```

### Write

```bash
POST {pod}.webpods.org/{stream}/{name}
Authorization: Bearer {token}

# Name is REQUIRED - last path segment
# Examples:
#   POST alice.webpods.org/blog/my-post
#   POST alice.webpods.org/images/logo.png
#   POST alice.webpods.org/data/2024/report.json

# Optional parameters
?access={mode}      # Set on first write only
```

**Name restrictions:**

- Can only contain: `a-z`, `A-Z`, `0-9`, `-`, `_`, `.`
- Cannot start or end with `.`
- Maximum 256 characters
- Examples: `index.html`, `logo.png`, `post-2024-01-15`

Content type priority:

1. `X-Content-Type` header
2. `Content-Type` header
3. Auto-detect

### Read

```bash
# By index
GET {pod}.webpods.org/{stream}?i=0      # First
GET {pod}.webpods.org/{stream}?i=-1     # Latest
GET {pod}.webpods.org/{stream}?i=0:10   # Range

# By name
GET {pod}.webpods.org/{stream}/{name}

# List all
GET {pod}.webpods.org/{stream}?limit=100&after=50
```

Single records return raw content with metadata in headers:

- `X-Hash`: Record hash
- `X-Author`: Creator user ID
- `X-Timestamp`: Creation time

### Delete

```bash
DELETE {pod}.webpods.org/{stream}
Authorization: Bearer {token}
```

Only stream creator can delete. System streams cannot be deleted.

## Permissions

**Access modes:**

- `public`: Anyone reads, authenticated write (default)
- `private`: Creator only
- `/{stream}`: Users listed in that stream

**Permission stream format:**

```json
{
  "id": "user-uuid-here",
  "read": true,
  "write": false
}
```

## System Streams

### .meta/owner

Pod ownership. Last record wins.

### .meta/links

URL routing:

```json
{
  "/": "homepage?i=-1",
  "/about": "pages/about?i=-1"
}
```

### .meta/streams

Lists all pod streams.

## Content Serving

Write HTML/CSS/JS with proper content type:

```bash
curl -X POST alice.webpods.org/page/home.html \
  -H "X-Content-Type: text/html" \
  -d "<h1>Welcome</h1>"

# Access: alice.webpods.org/page/home.html
```

## Hash Chain

Each record contains:

- `hash`: SHA-256 of content + metadata
- `previous_hash`: Link to previous (null for first)

## SSO (Single Sign-On)

Sessions persist across pods. One login for all your pods.

```bash
# Authorize pod access (if already logged in, skips OAuth)
GET https://webpods.org/auth/authorize?pod=alice

# Returns pod-specific token
```

## Configuration

WebPods supports any OAuth 2.0 provider. Here are examples for popular providers:

### GitHub

```json
{
  "oauth": {
    "providers": [
      {
        "id": "github",
        "clientId": "your-github-client-id",
        "clientSecret": "$GITHUB_SECRET",
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "userinfoUrl": "https://api.github.com/user",
        "scope": "read:user user:email",
        "userIdField": "id",
        "emailField": "email",
        "nameField": "name"
      }
    ]
  }
}
```

### Google

```json
{
  "oauth": {
    "providers": [
      {
        "id": "google",
        "clientId": "your-google-client-id",
        "clientSecret": "$GOOGLE_SECRET",
        "issuer": "https://accounts.google.com",
        "scope": "openid email profile",
        "userIdField": "sub",
        "emailField": "email",
        "nameField": "name"
      }
    ]
  }
}
```

## Development

```bash
# Setup
git clone https://github.com/webpods-org/webpods
cd webpods
cp config.example.json config.json
cp .env.example .env
# Edit config.json with your OAuth providers

# Database
npm run migrate:latest

# Build & run
./build.sh
./start.sh

# Test
npm test
```

## Configuration

WebPods uses `config.json` for configuration with environment variables for secrets:

1. Copy `config.example.json` to `config.json`
2. Configure OAuth providers in the JSON file
3. Set secrets in `.env` file

Key settings:

- OAuth providers and endpoints
- Server configuration (port, domain)
- Database connection
- Authentication secrets (JWT, session)
- Rate limits

See [Configuration Guide](docs/configuration.md) for details.

## Documentation

- [API Reference](docs/api.md) - Complete API details
- [Architecture](docs/architecture.md) - System design
- [Configuration](docs/configuration.md) - OAuth and server setup
- [Database](docs/database.md) - Schema and migrations
- [Deployment](docs/deployment.md) - Production setup

## License

MIT
