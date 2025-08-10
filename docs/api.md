# WebPods API Reference

WebPods is an append-only log service organized into pods (subdomains) and streams, with OAuth authentication and cryptographic hash chains.

## Core Concepts

- **Pod**: A subdomain namespace (e.g., `alice.webpods.org`)
- **Stream**: An append-only log within a pod (e.g., `/blog`, `/blog/posts/2024`)
- **Record**: An immutable entry in a stream
- **Hash Chain**: Each record links to the previous via SHA-256 hash

## Authentication

### OAuth Login
```http
GET https://webpods.org/auth/{provider}?redirect_uri={uri}
```
Providers: `github`, `google`

### OAuth Callback
```http
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
```http
GET https://webpods.org/auth/whoami
Authorization: Bearer {token}
```

## Stream Operations

### Write to Stream
```http
POST {pod_id}.webpods.org/{stream_path}
Authorization: Bearer {token}
Content-Type: application/json
X-Content-Type: text/html  # Optional, overrides Content-Type

{"message": "Hello, World!"}
```

Query parameters:
- `?alias={string}` - Set an alias (any string, including numbers)
- `?read=public|private|/{permission_stream}|~/{deny_stream}` - Read permission
- `?write=public|private|/{permission_stream}|~/{deny_stream}` - Write permission

Response:
```json
{
  "index": 0,
  "content": {"message": "Hello, World!"},
  "content_type": "application/json",
  "alias": "my-post",
  "hash": "sha256:abc123...",
  "previous_hash": null,
  "author": "auth:github:123456",
  "created_at": "2024-01-01T00:00:00Z"
}
```

### Read from Stream

#### Get specific record by index
```http
GET {pod_id}.webpods.org/{stream_path}?i={index}
```
- Positive index: `?i=0` (first), `?i=5` (sixth)
- Negative index: `?i=-1` (latest), `?i=-2` (second to last)
- Returns raw content with metadata in headers

#### Get range of records
```http
GET {pod_id}.webpods.org/{stream_path}?i={start}:{end}
```
- Examples: `?i=0:10`, `?i=-10:-1`
- Returns JSON array with metadata

#### Get record by alias
```http
GET {pod_id}.webpods.org/{stream_path}/{alias}
```
- Examples: `/blog/my-post`, `/assets/2024`, `/config/v1.0.0`
- Returns raw content

#### List all records
```http
GET {pod_id}.webpods.org/{stream_path}?limit={limit}&after={index}
```

Response:
```json
{
  "stream": {
    "stream_id": "blog/posts",
    "creator_id": "user123",
    "read_permission": "public",
    "write_permission": "private"
  },
  "records": [
    {
      "index": 0,
      "content": "First post",
      "content_type": "text/plain",
      "hash": "sha256:...",
      "author": "auth:github:123",
      "created_at": "2024-01-01T00:00:00Z"
    }
  ],
  "has_more": true,
  "next_index": 10
}
```

### Delete Stream
```http
DELETE {pod_id}.webpods.org/{stream_path}
Authorization: Bearer {token}
```
- Only stream creator can delete
- Cannot delete system streams (`.meta/*`)

## System Streams

### Pod Ownership
```http
GET/POST {pod_id}.webpods.org/.meta/owner
```
Format:
```json
{
  "owner": "user_id",
  "transferred_at": "2024-01-01T00:00:00Z"
}
```

### URL Mappings
```http
GET/POST {pod_id}.webpods.org/.meta/links
```
Format:
```json
{
  "/": "homepage?i=-1",
  "/about": "pages/about",
  "/blog": "blog?i=-10:-1"
}
```

### Custom Domains
```http
GET/POST {pod_id}.webpods.org/.meta/domains
```
Format:
```json
{
  "domain": "example.com",
  "verified": false,
  "cname_target": "alice.webpods.org"
}
```

### List All Streams
```http
GET {pod_id}.webpods.org/.meta/streams
```
Response:
```json
{
  "pod": "alice",
  "streams": [
    {
      "stream_id": "blog",
      "record_count": 42,
      "created_at": "2024-01-01T00:00:00Z"
    },
    {
      "stream_id": "blog/posts/2024",
      "record_count": 10,
      "created_at": "2024-01-01T00:00:00Z"
    }
  ]
}
```

## Permissions

### Permission Types
- `public` - Anyone can read, authenticated users can write
- `private` - Only creator can access
- `/{stream_name}` - Allow list (users in this permission stream)
- `~/{stream_name}` - Deny list (everyone except users in this stream)

### Permission Streams
Permission streams are special streams containing user access records:

```http
POST {pod_id}.webpods.org/allowed-users
Content-Type: application/json

{
  "id": "auth:github:456789",
  "read": true,
  "write": false
}
```

Then use in stream creation:
```http
POST {pod_id}.webpods.org/restricted?read=/allowed-users
```

## Content Serving

### Direct HTML Serving
```http
POST alice.webpods.org/page?alias=index
X-Content-Type: text/html

<html><body><h1>Welcome</h1></body></html>
```

Access via:
- `alice.webpods.org/page/index` - Returns HTML directly
- `alice.webpods.org/page?i=-1` - Returns latest HTML

### Supported Content Types
- `text/html` - Served as HTML
- `text/css` - Served as CSS
- `application/javascript` - Served as JS
- `application/json` - Served as JSON
- `text/plain` - Default

## Rate Limits

### Limits by Action
- **Write**: 2000/hour per user
- **Read**: 10000/hour per user  
- **Pod Creation**: 10/hour per user
- **Stream Creation**: 100/hour per user

### Rate Limit Headers
```
X-RateLimit-Limit: 2000
X-RateLimit-Remaining: 1999
X-RateLimit-Reset: 1704070800
```

## Error Responses

```json
{
  "error": {
    "code": "FORBIDDEN",
    "message": "You do not have permission to access this stream"
  }
}
```

### Error Codes
- `INVALID_INPUT` - Invalid request parameters
- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Pod/stream/record not found
- `ALIAS_EXISTS` - Alias already exists in stream
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `POD_EXISTS` - Pod ID already taken
- `INVALID_POD_ID` - Invalid pod ID format
- `INVALID_STREAM_ID` - Invalid stream ID format

## Hash Chain Verification

Each record contains:
- `hash`: SHA-256 hash of `{previous_hash, timestamp, content}`
- `previous_hash`: Hash of the previous record (null for first record)

This creates an immutable, tamper-evident chain where any modification would break the hash chain.

## Examples

### Create a Blog Pod with Posts
```bash
# Authenticate
TOKEN=$(curl -s https://webpods.org/auth/github/callback | jq -r .token)

# Write first post
curl -X POST https://alice.webpods.org/blog \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: text/plain" \
  -d "My first blog post"

# Write with alias
curl -X POST https://alice.webpods.org/blog?alias=welcome \
  -H "Authorization: Bearer $TOKEN" \
  -d "Welcome to my blog!"

# Read by alias
curl https://alice.webpods.org/blog/welcome

# Get latest post
curl https://alice.webpods.org/blog?i=-1

# Create nested stream for 2024 posts
curl -X POST https://alice.webpods.org/blog/posts/2024 \
  -H "Authorization: Bearer $TOKEN" \
  -d "First post of 2024"
```

### Set Up a Website
```bash
# Create homepage
curl -X POST https://alice.webpods.org/pages?alias=home \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/html" \
  -d '<html><body><h1>Welcome to Alice's Site</h1></body></html>'

# Set up URL routing
curl -X POST https://alice.webpods.org/.meta/links \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"/": "pages/home", "/blog": "blog?i=-10:-1"}'

# Now visit alice.webpods.org to see the homepage
```

### Create a Private Stream with Allow List
```bash
# Create permission stream
curl -X POST https://alice.webpods.org/team-members \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "auth:github:bob", "read": true, "write": true}'

# Create restricted stream
curl -X POST https://alice.webpods.org/internal?read=/team-members \
  -H "Authorization: Bearer $TOKEN" \
  -d "Internal team documentation"
```