# WebPods

HTTP-based append-only logs organized as pods (subdomains) and streams.

## Quick Start

```bash
# Get auth token
curl https://webpods.org/auth/github

# Write to stream (creates pod and stream automatically)
curl -X POST https://alice.webpods.org/blog \
  -H "Authorization: Bearer $TOKEN" \
  -d "First post"

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
# Login
GET https://webpods.org/auth/{provider}  # github or google

# Get user info
GET https://webpods.org/auth/whoami
Authorization: Bearer {token}
```

### Write

```bash
POST {pod}.webpods.org/{stream}
Authorization: Bearer {token}

# Optional parameters
?alias={string}     # Named reference (any string)
?access={mode}      # Set on first write only
```

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

# By alias
GET {pod}.webpods.org/{stream}/{alias}

# List all
GET {pod}.webpods.org/{stream}?limit=100&after=50
```

Single records return raw content with metadata in headers:
- `X-Hash`: Record hash
- `X-Author`: Creator ID
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
  "id": "auth:github:123",
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
curl -X POST alice.webpods.org/page?alias=home \
  -H "X-Content-Type: text/html" \
  -d "<h1>Welcome</h1>"

# Access: alice.webpods.org/page/home
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

## Development

```bash
# Setup
git clone https://github.com/webpods-org/webpods
cd webpods
cp .env.example .env
# Edit .env

# Database
npm run migrate:latest

# Build & run
./build.sh
./start.sh

# Test
npm test
```

## Configuration

Key environment variables:
- `JWT_SECRET`: Required for auth
- `SESSION_SECRET`: For SSO sessions
- `GITHUB_CLIENT_ID/SECRET`: GitHub OAuth
- `GOOGLE_CLIENT_ID/SECRET`: Google OAuth
- `DATABASE_URL`: PostgreSQL connection
- `DOMAIN`: Base domain (default: webpods.org)

See `.env.example` for all options.

## Documentation

- [API Reference](docs/api.md) - Complete API details
- [Architecture](docs/architecture.md) - System design
- [Deployment](docs/deployment.md) - Production setup

## License

MIT