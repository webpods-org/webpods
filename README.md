# WebPods

HTTP-based append-only logs using subdomains (pods) and paths (streams).

## What is WebPods?

WebPods organizes data into:

- **Pods**: Subdomains that act as namespaces (e.g., `alice.webpods.org`)
- **Streams**: Append-only logs within pods (e.g., `/blog`, `/data/2024`)
- **Records**: Immutable entries with SHA-256 hash chains

## Quick Start

```bash
# 1. Get an auth token
curl https://webpods.org/auth/github  # Returns JWT token

# 2. Write data (creates pod and stream automatically)
curl -X POST https://alice.webpods.org/blog/first-post \
  -H "Authorization: Bearer $TOKEN" \
  -d "My first blog post"

# 3. Read data
curl https://alice.webpods.org/blog/first-post
```

## API Overview

### Authentication

```bash
# List available OAuth providers
GET https://webpods.org/auth/providers

# Login via OAuth
GET https://webpods.org/auth/{provider}

# Get current user info
GET https://webpods.org/auth/whoami
Authorization: Bearer {token}
```

### Writing Data

```bash
POST {pod}.webpods.org/{stream}/{name}
Authorization: Bearer {token}

# The last path segment is the record name (required)
# Names can contain: a-z, A-Z, 0-9, -, _, .
# Cannot start/end with periods
```

### Reading Data

```bash
# By name
GET {pod}.webpods.org/{stream}/{name}

# By index
GET {pod}.webpods.org/{stream}?i=0      # First record
GET {pod}.webpods.org/{stream}?i=-1     # Latest record
GET {pod}.webpods.org/{stream}?i=0:10   # Range (0-9)

# List with pagination
GET {pod}.webpods.org/{stream}?limit=100&after=50   # After index 50
GET {pod}.webpods.org/{stream}?after=-20            # Last 20 records
GET {pod}.webpods.org/{stream}?unique=true&after=-10 # Last 10 unique
```

### Permissions

Set on first write with `?access={mode}`:

- `public` - Anyone can read, authenticated users can write (default)
- `private` - Only creator can read/write
- `/{stream}` - Users listed in that stream can access

## For Third-Party Developers

If you're building an app that needs to access WebPods on behalf of users:

### 1. Register Your OAuth Client

```bash
POST https://webpods.org/api/oauth/clients
Authorization: Bearer {your-webpods-token}
Content-Type: application/json

{
  "client_name": "My App",
  "redirect_uris": ["https://myapp.com/callback"],
  "requested_pods": ["alice", "bob"]  # Pods you need access to
}

# Returns: client_id and client_secret
```

### 2. Direct Users to Authorize

```
https://webpods.org/connect?client_id={your-client-id}
```

### 3. Handle the OAuth Callback

Users will be redirected to your callback URL with an authorization code. Exchange it for an access token using standard OAuth 2.0 flow.

## Installation

### Using Docker

```bash
docker run -p 3000:3000 \
  -e WEBPODS_DB_HOST=postgres \
  -e WEBPODS_DB_PORT=5432 \
  -e WEBPODS_DB_NAME=webpodsdb \
  -e WEBPODS_DB_USER=postgres \
  -e WEBPODS_DB_PASSWORD=yourpassword \
  -e JWT_SECRET=your-secret-key \
  -e SESSION_SECRET=your-session-secret \
  -e GITHUB_OAUTH_SECRET=your-github-secret \
  -v ./config.json:/app/config.json \
  webpods/webpods
```

### From Source

```bash
# Clone and setup
git clone https://github.com/webpods-org/webpods
cd webpods
cp config.example.json config.json
# Edit config.json with your OAuth providers

# Build and run
./build.sh
npm run migrate:latest
./start.sh
```

## Configuration

WebPods requires OAuth providers for user authentication. Edit `config.json`:

```json
{
  "oauth": {
    "providers": [
      {
        "id": "github",
        "clientId": "your-client-id",
        "clientSecret": "$GITHUB_SECRET", // Reference env variable
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "userinfoUrl": "https://api.github.com/user",
        "scope": "read:user user:email"
      }
    ]
  }
}
```

Environment variables:

- `JWT_SECRET` - Required for token signing
- `SESSION_SECRET` - Required for session management  
- `WEBPODS_DB_HOST` - PostgreSQL host (default: localhost)
- `WEBPODS_DB_PORT` - PostgreSQL port (default: 5432)
- `WEBPODS_DB_NAME` - Database name (default: webpodsdb)
- `WEBPODS_DB_USER` - Database user (default: postgres)
- `WEBPODS_DB_PASSWORD` - Database password (required)
- OAuth secrets referenced in config.json (e.g., `GITHUB_OAUTH_SECRET`)

## Documentation

- [API Reference](docs/api.md) - Complete API documentation
- [Configuration Guide](docs/configuration.md) - OAuth and server setup
- [Architecture](docs/architecture.md) - System design and data model
- [Deployment](docs/deployment.md) - Production deployment guide

## Development

```bash
# Run tests
npm test

# Run specific tests
npm run test:grep -- "pattern"

# Database migrations
npm run migrate:latest   # Run migrations
npm run migrate:rollback # Rollback last migration
```

## License

MIT
