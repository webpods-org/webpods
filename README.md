# WebPods

An append-only log service with OAuth authentication, organized into pods and streams. Write strings or JSON to streams, read them back, serve HTML directly via custom domains.

## Quick Start

```bash
# Login
curl https://webpods.org/auth/github

# Write to a stream (creates pod + stream automatically)
curl -X POST https://alice.webpods.org/blog \
  -H "Authorization: Bearer $TOKEN" \
  -d "My first post"

# Read from stream
curl https://alice.webpods.org/blog

# Get latest record
curl https://alice.webpods.org/blog?i=-1

# Use aliases (can be numbers too!)
curl -X POST https://alice.webpods.org/blog?alias=2024 \
  -H "Authorization: Bearer $TOKEN" \
  -d "Posts from 2024"
  
curl https://alice.webpods.org/blog/2024  # Returns the aliased content
```

## Core Concepts

- **Pod**: A namespace for streams (e.g., `alice`, `myproject`)
- **Stream**: An append-only log within a pod (e.g., `blog`, `blog/posts/2024`)
- **Record**: An immutable entry in a stream (string or JSON)
- **Hash Chain**: Each record contains a hash of the previous record, creating a cryptographically verifiable chain
- **System Streams**: Special streams under `.system/` (e.g., `.system/owner` for pod ownership)

## URL Structure

```
{pod_id}.webpods.org/{stream_path}
```

Examples:
- `alice.webpods.org/blog`
- `alice.webpods.org/blog/posts/2024` (nested stream paths)
- `myproject.webpods.org/config`
- `acme.webpods.org/.system/owner` (system stream)

## Authentication

WebPods uses OAuth for authentication. Login through supported providers to get a JWT token.

### Login
```
GET https://webpods.org/auth/{provider}?redirect_uri={uri}
```
Providers: `github`, `google`

### Callback
```
GET https://webpods.org/auth/{provider}/callback
```
Returns:
```json
{
  "token": "jwt_token",
  "user": {
    "email": "user@example.com",
    "name": "John Doe",
    "provider": "github"
  }
}
```

### Who Am I
```
GET https://webpods.org/auth/whoami
```

**Headers:**
- `Authorization: Bearer {token}` (required)

Returns:
```json
{
  "user_id": "auth:github:1234567",
  "email": "user@example.com",
  "name": "John Doe",
  "provider": "github"
}
```

## API Reference

### Write to Stream

```
POST {pod_id}.webpods.org/{stream_path}?alias={alias}
```

Creates pod and stream if they don't exist. Supports nested stream paths with slashes.

**Query Parameters:**
- `alias` (optional): Named reference for this record (any string including numbers)
- `read` (optional): Read permission for stream (first write only)
- `write` (optional): Write permission for stream (first write only)

**Headers:**
- `Authorization: Bearer {token}` (required)
- `X-Content-Type` (optional): Explicit content type (highest priority)
- `Content-Type` (optional): Standard content type header

**Body:** String or JSON

**Response:**
```json
{
  "sequence_num": 0,
  "content": "...",
  "content_type": "text/plain",
  "alias": "my-alias",
  "hash": "sha256:...",
  "previous_hash": null,
  "author": "auth:github:1234567",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Read from Stream

```
# Get by index (query parameter)
GET {pod_id}.webpods.org/{stream_path}?i=0      # First record
GET {pod_id}.webpods.org/{stream_path}?i=-1     # Latest record
GET {pod_id}.webpods.org/{stream_path}?i=10:20   # Range [10, 20)

# Get by alias
GET {pod_id}.webpods.org/{stream_path}/{alias}   # Any string including numbers

# List all records
GET {pod_id}.webpods.org/{stream_path}?limit=100&after=50
```

**Single Record Response:** Returns raw content with headers:
- `Content-Type`: The content type
- `X-Hash`: Record hash
- `X-Previous-Hash`: Previous record hash
- `X-Author`: Author ID
- `X-Timestamp`: Creation timestamp

**Range/List Response:**
```json
{
  "records": [...],
  "total": 150,
  "has_more": true,
  "next_id": 100
}
```

### Delete Stream

```
DELETE {pod_id}.webpods.org/{stream_path}
```

Only the stream creator can delete it. System streams cannot be deleted.

**Headers:**
- `Authorization: Bearer {token}` (required)

### List Streams

```
GET {pod_id}.webpods.org/.system/streams
```

Returns all streams in the pod.

**Response:**
```json
{
  "pod": "alice",
  "streams": [
    "blog",
    "blog/posts/2024",
    "config",
    ".system/owner",
    ".system/links"
  ]
}
```

## Permissions

Streams support sophisticated permission models:

### Basic Permissions
- `public` (default): Anyone can read, authenticated users can write
- `private`: Only the creator can read/write
- `auth`: Any authenticated user can read/write

### Permission Streams
- `/members`: Allow list - users in this stream can access
- `~/blocked`: Deny list - users in this stream are blocked

Example:
```bash
# Create a members-only blog
curl -X POST "alice.webpods.org/private-blog?read=/members&write=/members" \
  -H "Authorization: Bearer $TOKEN" \
  -d "Members only content"

# Add member
curl -X POST alice.webpods.org/members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "auth:github:789", "read": true, "write": true}'
```

## System Streams

System streams provide pod configuration and metadata:

### .system/owner
Tracks pod ownership. Last record determines current owner.

```bash
# Transfer ownership
curl -X POST alice.webpods.org/.system/owner \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"owner": "auth:github:987654"}'
```

### .system/links
Maps URL paths to stream/record combinations for clean URLs.

```bash
# Configure homepage
curl -X POST alice.webpods.org/.system/links \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "/": "homepage?i=-1",
    "/about": "pages/about",
    "/blog": "blog/posts?i=-10:-1"
  }'
```

### .system/domains
Configure custom domains (requires DNS CNAME).

```bash
curl -X POST alice.webpods.org/.system/domains \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domains": ["alice.com", "blog.alice.com"]}'
```

## Content Serving

WebPods can serve content directly with proper Content-Type headers:

```bash
# Write HTML
curl -X POST alice.webpods.org/homepage \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/html" \
  -d '<h1>Welcome to my site!</h1>'

# Access directly
curl alice.webpods.org/homepage?i=-1
# Returns HTML with Content-Type: text/html

# Write CSS
curl -X POST alice.webpods.org/assets/styles?alias=main.css \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/css" \
  -d 'body { font-family: sans-serif; }'

# Access via alias
curl alice.webpods.org/assets/styles/main.css
# Returns CSS with Content-Type: text/css
```

## Hash Chain Verification

Every record includes:
- `hash`: SHA-256 hash of the record (includes previous_hash, timestamp, content)
- `previous_hash`: Hash of the previous record (null for first record)

This creates an immutable, verifiable chain of records.

## Development

```bash
# Clone repository
git clone https://github.com/webpods-org/webpods.git
cd webpods

# Install dependencies
npm install

# Setup database
cp .env.example .env
# Edit .env with your database credentials
npm run migrate:webpods:latest

# Build
./build.sh

# Start server
./start.sh

# Run tests
npm test

# Lint
./lint-all.sh
```

## Environment Variables

Key configuration options:

- `DATABASE_URL`: PostgreSQL connection string
- `JWT_SECRET`: Secret for JWT signing (required)
- `GITHUB_CLIENT_ID`: GitHub OAuth app client ID
- `GITHUB_CLIENT_SECRET`: GitHub OAuth app client secret
- `GOOGLE_CLIENT_ID`: Google OAuth client ID
- `GOOGLE_CLIENT_SECRET`: Google OAuth client secret
- `DOMAIN`: Base domain (default: webpods.org)
- `PORT`: Server port (default: 3000)

See `.env.example` for complete list.

## License

MIT