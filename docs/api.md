# API Reference

Complete HTTP API documentation for WebPods.

## Base URLs

- **Main domain**: `https://webpods.org` (authentication, pod management)
- **Pod subdomains**: `https://{pod}.webpods.org` (data operations)

## Authentication Endpoints

### `GET /auth/providers`

List available OAuth providers.

**Response:**

```json
{
  "providers": ["github", "google", "microsoft", "gitlab"]
}
```

### `GET /auth/{provider}`

Start OAuth flow for the specified provider.

**Parameters:**

- `provider` - OAuth provider (github, google, microsoft, gitlab)
- `no_redirect=1` - Return login URL instead of redirecting

**Example:**

```bash
curl "https://webpods.org/auth/github?no_redirect=1"
```

### `GET /auth/{provider}/callback`

OAuth callback endpoint (handled automatically by OAuth flow).

### `GET /auth/whoami`

Get current user information.

**Headers:**

- `Authorization: Bearer {jwt_token}`

**Response:**

```json
{
  "user_id": "github:12345",
  "username": "alice",
  "email": "alice@example.com",
  "provider": "github"
}
```

### `POST /auth/logout`

Logout and invalidate token.

**Headers:**

- `Authorization: Bearer {jwt_token}`

## Pod Management

### `POST /api/pods`

Create a new pod.

**Headers:**

- `Authorization: Bearer {jwt_token}`
- `Content-Type: application/json`

**Body:**

```json
{
  "name": "my-pod"
}
```

**Response:**

```json
{
  "success": true,
  "pod": {
    "name": "my-pod",
    "owner_id": "github:12345",
    "created_at": "2024-01-15T10:30:00Z"
  }
}
```

### `GET /api/pods`

List user's pods.

**Headers:**

- `Authorization: Bearer {jwt_token}`

**Response:**

```json
{
  "pods": [
    {
      "name": "my-pod",
      "owner_id": "github:12345",
      "created_at": "2024-01-15T10:30:00Z"
    }
  ]
}
```

### `DELETE https://{pod}.webpods.org/`

Delete a pod.

**Headers:**

- `Authorization: Bearer {jwt_token}`

## Streams

### `POST https://{pod}.webpods.org/{stream}?access={mode}`

Create a stream explicitly.

**Query Parameters:**

- `access` - Access mode: `public`, `private`, or `custom`

**Headers:**

- `Authorization: Bearer {jwt_token}`

### `DELETE https://{pod}.webpods.org/{stream}`

Delete a stream.

**Headers:**

- `Authorization: Bearer {jwt_token}`

### `GET https://{pod}.webpods.org/.config/api/streams`

List all streams in a pod.

**Response:**

```json
{
  "streams": [
    {
      "path": "/blog",
      "access": "public",
      "record_count": 42
    },
    {
      "path": "/blog/posts",
      "access": "public",
      "record_count": 15
    }
  ]
}
```

## Records

### `POST https://{pod}.webpods.org/{stream}/{name}`

Write a record to a stream.

**Headers:**

- `Authorization: Bearer {jwt_token}` (if stream is private)
- `Content-Type: application/json` or `text/plain`

**Body:** Any content (JSON, text, binary)

**Response:**

```json
{
  "success": true,
  "record": {
    "index": 5,
    "name": "my-record",
    "hash": "sha256:abc123...",
    "previous_hash": "sha256:def456...",
    "timestamp": "2024-01-15T10:30:00Z",
    "content_type": "application/json",
    "content_length": 156
  }
}
```

### `GET https://{pod}.webpods.org/{stream}/{name}`

Read a specific record.

**Headers:**

- `Authorization: Bearer {jwt_token}` (if stream is private)

**Response:** Record content with headers:

- `Content-Type`: Original content type
- `X-Record-Index`: Record index number
- `X-Record-Hash`: Record hash
- `X-Record-Timestamp`: Creation timestamp

### `GET https://{pod}.webpods.org/{stream}`

List records in a stream.

**Query Parameters:**

- `after` - Start after this index (supports negative values for "last N")
- `before` - End before this index
- `limit` - Maximum records to return (default 100, max 1000)
- `unique` - Only return the latest record for each unique name
- `format` - Response format: `json` (default) or `html`

**Examples:**

```bash
# Get all records
GET /blog/posts

# Pagination
GET /blog/posts?after=10&limit=20

# Last 10 records
GET /blog/posts?after=-10

# Latest version of each named record
GET /blog/posts?unique=true

# Range query
GET /blog/posts?after=5&before=15
```

**Response:**

```json
{
  "stream": "/blog/posts",
  "records": [
    {
      "index": 1,
      "name": "first-post",
      "hash": "sha256:abc123...",
      "previous_hash": null,
      "timestamp": "2024-01-15T10:30:00Z",
      "content_type": "text/plain",
      "content": "My first blog post!"
    }
  ],
  "pagination": {
    "after": 0,
    "limit": 100,
    "has_more": false
  }
}
```

## OAuth Client Management

### `POST /api/oauth/clients`

Register a new OAuth client.

**Headers:**

- `Authorization: Bearer {jwt_token}`
- `Content-Type: application/json`

**Body:**

```json
{
  "name": "My App",
  "redirect_uris": ["https://myapp.com/callback"]
}
```

### `GET /api/oauth/clients`

List registered clients.

**Headers:**

- `Authorization: Bearer {jwt_token}`

### `GET /api/oauth/clients/{id}`

Get client details.

### `DELETE /api/oauth/clients/{id}`

Delete a client.

## OAuth 2.0 Flow

### `GET /connect`

Simplified authorization endpoint.

**Query Parameters:**

- `client_id` - Registered client ID
- `redirect_uri` - Callback URL
- `scope` - Requested permissions
- `state` - Optional state parameter

### `GET /oauth2/auth`

Full OAuth 2.0 authorization endpoint.

### `POST /oauth2/token`

OAuth 2.0 token exchange endpoint.

### `GET /oauth2/userinfo`

Get user information using OAuth token.

## Error Responses

All errors follow this format:

```json
{
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "Record 'my-record' not found in stream '/blog/posts'"
  }
}
```

Common error codes:

- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - Insufficient permissions
- `POD_NOT_FOUND` - Pod doesn't exist
- `STREAM_NOT_FOUND` - Stream doesn't exist
- `RECORD_NOT_FOUND` - Record doesn't exist
- `VALIDATION_ERROR` - Invalid request data
- `RATE_LIMITED` - Too many requests

## Rate Limits

Default limits (configurable):

- 1000 requests per hour per user
- 100 records per request maximum
- 10MB maximum request size
