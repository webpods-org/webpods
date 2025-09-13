# API Reference

Complete HTTP API documentation for WebPods.

## Overview

WebPods provides a RESTful API accessible via standard HTTP. The API is split between:

- **Main domain** (`webpods.org`) - Authentication, pod management, OAuth
- **Pod subdomains** (`alice.webpods.org`) - Data operations on streams and records

## Authentication

WebPods supports two authentication methods:

### WebPods JWT Tokens

Used for direct API access and CLI. Obtained through OAuth provider login.

```bash
# Get token via OAuth provider
curl "https://webpods.org/auth/github?no_redirect=1"
# Returns login URL, visit in browser, copy token

# Use token in requests
curl -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  https://webpods.org/api/pods
```

### OAuth 2.0 Tokens (Hydra)

Used by third-party applications after user authorization.

```bash
# OAuth tokens obtained through OAuth flow
curl -H "Authorization: Bearer OAUTH_TOKEN" \
  https://alice.webpods.org/data
```

## Main Domain Endpoints

Base URL: `https://webpods.org`

### Authentication Endpoints

#### `GET /auth/providers`

List available OAuth providers.

**Response:**

```json
{
  "providers": ["github", "google", "microsoft", "gitlab"]
}
```

#### `GET /auth/{provider}`

Start OAuth authentication flow.

**Parameters:**

- `provider` - OAuth provider name (github, google, microsoft, gitlab)
- `no_redirect=1` (optional) - Return login URL instead of redirecting
- `redirect` (optional) - URL to redirect after authentication

**Response (with no_redirect=1):**

```json
{
  "loginUrl": "https://github.com/login/oauth/authorize?..."
}
```

#### `GET /auth/{provider}/callback`

OAuth callback endpoint. Handled automatically during OAuth flow.

#### `GET /auth/whoami`

Get current authenticated user information.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "user_id": "github:12345",
  "username": "alice",
  "email": "alice@example.com",
  "provider": "github"
}
```

**Error Response (401):**

```json
{
  "error": {
    "code": "UNAUTHORIZED",
    "message": "Invalid or expired token"
  }
}
```

#### `POST /auth/logout`

Invalidate current session and token.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "success": true,
  "message": "Logged out successfully"
}
```

### Pod Management Endpoints

#### `POST /api/pods`

Create a new pod.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "name": "my-pod"
}
```

**Response (201):**

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

**Error Response (409):**

```json
{
  "error": {
    "code": "POD_EXISTS",
    "message": "Pod 'my-pod' already exists"
  }
}
```

**Error Response (400):**

```json
{
  "error": {
    "code": "INVALID_POD_NAME",
    "message": "Pod name must be lowercase alphanumeric with hyphens"
  }
}
```

#### `GET /api/pods`

List pods owned by authenticated user.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "pods": [
    {
      "name": "my-pod",
      "created_at": "2024-01-15T10:30:00Z"
    },
    {
      "name": "test-pod",
      "created_at": "2024-01-14T09:20:00Z"
    }
  ]
}
```

#### `GET /api/pods/{name}`

Get pod information.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "name": "my-pod",
  "owner_id": "github:12345",
  "created_at": "2024-01-15T10:30:00Z",
  "stream_count": 42,
  "record_count": 1337
}
```

#### `DELETE /api/pods/{name}`

Delete a pod and all its data.

**Headers:**

- `Authorization: Bearer {token}`

**Query Parameters:**

- `force=true` - Skip confirmation

**Response:**

```json
{
  "success": true,
  "message": "Pod 'my-pod' deleted"
}
```

#### `PUT /api/pods/{name}/transfer`

Transfer pod ownership to another user.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "new_owner_id": "github:67890"
}
```

**Response:**

```json
{
  "success": true,
  "message": "Pod transferred to github:67890"
}
```

### OAuth Endpoints (Third-Party Apps)

#### `POST /oauth/register`

Register a new OAuth client application.

**Headers:**

- `Content-Type: application/json`

**Request Body:**

```json
{
  "client_name": "My Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "scope": "openid offline pod:read pod:write",
  "token_endpoint_auth_method": "client_secret_post",
  "contacts": ["admin@myapp.com"],
  "logo_uri": "https://myapp.com/logo.png",
  "client_uri": "https://myapp.com",
  "policy_uri": "https://myapp.com/privacy",
  "tos_uri": "https://myapp.com/terms"
}
```

**Response (201):**

```json
{
  "client_id": "abc123xyz",
  "client_secret": "secret789",
  "client_name": "My Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "grant_types": ["authorization_code", "refresh_token"],
  "scope": "openid offline pod:read pod:write"
}
```

#### `GET /oauth/client/{clientId}`

Get public information about an OAuth client.

**Response:**

```json
{
  "client_id": "abc123xyz",
  "client_name": "My Application",
  "logo_uri": "https://myapp.com/logo.png",
  "client_uri": "https://myapp.com",
  "policy_uri": "https://myapp.com/privacy",
  "tos_uri": "https://myapp.com/terms",
  "scope": "openid offline pod:read pod:write"
}
```

#### `GET /connect`

Simplified OAuth authorization flow for third-party apps.

**Query Parameters:**

- `client_id` - OAuth client ID

**Response:**
Redirects to Hydra OAuth authorization endpoint with proper parameters.

#### `GET /oauth/login`

Hydra login challenge handler. Part of OAuth flow.

**Query Parameters:**

- `login_challenge` - Hydra login challenge

#### `GET /oauth/consent`

Hydra consent screen. Shows which pods the app wants to access.

**Query Parameters:**

- `consent_challenge` - Hydra consent challenge

#### `POST /oauth/consent`

Handle user's consent decision.

**Request Body:**

```json
{
  "challenge": "consent_challenge_string",
  "action": "accept",
  "scopes": "pod:alice,pod:bob"
}
```

### Rate Limit Information

#### `GET /api/limits`

Get current rate limit status for authenticated user.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "limits": {
    "requests_per_minute": 60,
    "requests_remaining": 45,
    "reset_at": "2024-01-15T10:31:00Z",
    "max_record_size": 10485760,
    "max_record_limit": 1000
  }
}
```

## Pod Subdomain Endpoints

Base URL: `https://{pod}.webpods.org`

### Stream Operations

#### `GET /`

List all streams in the pod.

**Headers (optional):**

- `Authorization: Bearer {token}` - Required for private pods

**Response:**

```json
{
  "streams": [
    {
      "path": "/blog",
      "record_count": 10,
      "created_at": "2024-01-15T10:30:00Z",
      "access": "public",
      "children": ["/blog/posts", "/blog/comments"]
    },
    {
      "path": "/config",
      "record_count": 5,
      "created_at": "2024-01-14T09:20:00Z",
      "access": "private",
      "children": []
    }
  ]
}
```

#### `DELETE /{path}`

Delete an entire stream and all its records.

**Headers:**

- `Authorization: Bearer {token}`

**Query Parameters:**

- `force=true` - Skip confirmation
- `recursive=true` - Delete child streams

**Response:**

```json
{
  "success": true,
  "deleted_count": 42
}
```

### Record Operations

#### `GET /{path}`

List records in a stream or get a specific record.

**Headers (optional):**

- `Authorization: Bearer {token}` - Required for private streams

**Query Parameters:**

- `limit` (number) - Maximum records to return (default: 100, max: 1000)
- `after` (number) - Skip records after index, or negative for last N records
- `before` (number) - Get records before index
- `unique` (boolean) - Return only latest version of named records
- `include_deleted` (boolean) - Include deleted records
- `format` (string) - Response format: "full" (default), "hash", "minimal"
- `fields` (string) - Comma-separated list of fields to include
- `maxContentSize` (number) - Truncate content larger than this
- `order` (string) - Sort order: "asc" (default) or "desc"

**Response (list):**

```json
{
  "stream": "/blog/posts",
  "total_count": 150,
  "returned_count": 20,
  "records": [
    {
      "index": 1,
      "name": "1",
      "hash": "sha256:abc123...",
      "previous_hash": "sha256:000000...",
      "content": {
        "title": "First Post",
        "body": "Content here..."
      },
      "content_type": "application/json",
      "created_at": "2024-01-15T10:30:00Z",
      "created_by": "github:12345",
      "deleted": false
    },
    {
      "index": 2,
      "name": "2",
      "hash": "sha256:def456...",
      "previous_hash": "sha256:abc123...",
      "content": {
        "title": "Second Post",
        "body": "More content..."
      },
      "content_type": "application/json",
      "created_at": "2024-01-15T11:00:00Z",
      "created_by": "github:12345",
      "deleted": false
    }
  ]
}
```

**Response (single record):**

```json
{
  "index": 1,
  "name": "welcome",
  "hash": "sha256:abc123...",
  "previous_hash": "sha256:000000...",
  "content": {
    "title": "Welcome",
    "body": "Hello World"
  },
  "content_type": "application/json",
  "created_at": "2024-01-15T10:30:00Z",
  "created_by": "github:12345",
  "deleted": false
}
```

**Response (format=hash):**

```json
{
  "stream": "/blog/posts",
  "hashes": [
    {
      "index": 1,
      "hash": "sha256:abc123...",
      "previous_hash": "sha256:000000..."
    },
    {
      "index": 2,
      "hash": "sha256:def456...",
      "previous_hash": "sha256:abc123..."
    }
  ]
}
```

#### `GET /{path}/{name}`

Get a specific named record.

**Headers (optional):**

- `Authorization: Bearer {token}` - Required for private streams

**Response:**

```json
{
  "index": 42,
  "name": "config",
  "hash": "sha256:xyz789...",
  "previous_hash": "sha256:uvw456...",
  "content": {
    "theme": "dark",
    "language": "en"
  },
  "content_type": "application/json",
  "created_at": "2024-01-15T10:30:00Z",
  "created_by": "github:12345",
  "deleted": false
}
```

**Error Response (404):**

```json
{
  "error": {
    "code": "RECORD_NOT_FOUND",
    "message": "Record 'config' not found in stream '/settings'"
  }
}
```

#### `POST /{path}`

Create a new record in a stream.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type` - Type of content (application/json, text/plain, etc.)

**Request Body (auto-named):**

```json
{
  "title": "New Post",
  "content": "Post content here..."
}
```

**Request Body (named):**

```json
{
  "name": "my-config",
  "content": {
    "setting1": "value1",
    "setting2": "value2"
  }
}
```

**Request Body (with headers):**

```json
{
  "content": "Data here...",
  "headers": {
    "X-Custom-Header": "value",
    "X-Source": "api-client"
  }
}
```

**Response (201):**

```json
{
  "success": true,
  "record": {
    "index": 43,
    "name": "43",
    "hash": "sha256:newHash...",
    "previous_hash": "sha256:prevHash...",
    "stream": "/blog/posts",
    "created_at": "2024-01-15T12:00:00Z"
  }
}
```

**Error Response (400):**

```json
{
  "error": {
    "code": "INVALID_CONTENT",
    "message": "Content exceeds maximum size of 10MB"
  }
}
```

**Error Response (409):**

```json
{
  "error": {
    "code": "DUPLICATE_NAME",
    "message": "Record with name 'my-config' already exists"
  }
}
```

#### `DELETE /{path}/{name}`

Mark a record as deleted (soft delete).

**Headers:**

- `Authorization: Bearer {token}`

**Query Parameters:**

- `purge=true` - Permanently delete (requires special permission)

**Response:**

```json
{
  "success": true,
  "message": "Record marked as deleted"
}
```

### Permission Operations

#### `GET /.permissions/{path}`

Get permissions for a stream.

**Headers:**

- `Authorization: Bearer {token}`

**Response:**

```json
{
  "stream": "/private/data",
  "access": "custom",
  "permissions": [
    {
      "user_id": "github:12345",
      "read": true,
      "write": true
    },
    {
      "user_id": "github:67890",
      "read": true,
      "write": false
    }
  ]
}
```

#### `POST /.permissions/{path}`

Grant permissions to a user.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "userId": "github:67890",
  "read": true,
  "write": false
}
```

**Response:**

```json
{
  "success": true,
  "message": "Permissions updated"
}
```

### Link Operations

#### `GET /.links/{path}`

Get link/redirect for a stream.

**Response:**

```json
{
  "source": "/old/path",
  "target": "/new/path",
  "created_at": "2024-01-15T10:30:00Z"
}
```

#### `POST /.links/{path}`

Create a link/redirect from one stream to another.

**Headers:**

- `Authorization: Bearer {token}`
- `Content-Type: application/json`

**Request Body:**

```json
{
  "target": "/new/path"
}
```

**Response:**

```json
{
  "success": true,
  "link": {
    "source": "/old/path",
    "target": "/new/path"
  }
}
```

## Error Responses

All error responses follow this format:

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human-readable error message",
    "details": {} // Optional additional information
  }
}
```

### Common Error Codes

#### Authentication Errors (4xx)

- `UNAUTHORIZED` - Missing or invalid authentication
- `TOKEN_EXPIRED` - JWT token has expired
- `INVALID_TOKEN` - Malformed or invalid token
- `FORBIDDEN` - Authenticated but not authorized
- `POD_FORBIDDEN` - Token not authorized for this pod

#### Validation Errors (4xx)

- `INVALID_POD_NAME` - Pod name format invalid
- `INVALID_STREAM_PATH` - Stream path format invalid
- `INVALID_RECORD_NAME` - Record name format invalid
- `INVALID_CONTENT` - Content validation failed
- `CONTENT_TOO_LARGE` - Content exceeds size limit
- `INVALID_QUERY_PARAM` - Query parameter invalid

#### Resource Errors (4xx)

- `POD_NOT_FOUND` - Pod does not exist
- `STREAM_NOT_FOUND` - Stream does not exist
- `RECORD_NOT_FOUND` - Record does not exist
- `POD_EXISTS` - Pod name already taken
- `DUPLICATE_NAME` - Named record already exists

#### Rate Limiting (429)

- `RATE_LIMIT_EXCEEDED` - Too many requests

#### Server Errors (5xx)

- `INTERNAL_ERROR` - Unexpected server error
- `DATABASE_ERROR` - Database operation failed
- `HASH_VERIFICATION_ERROR` - Hash chain broken

## Query Parameters

### Pagination

Use `limit` and `after` for pagination:

```bash
# First page
GET /stream?limit=20

# Next page
GET /stream?limit=20&after=20

# Page 3
GET /stream?limit=20&after=40
```

### Negative Indexing

Use negative `after` values to get recent records:

```bash
# Last 10 records
GET /stream?after=-10

# Last 50 records, but only return 20
GET /stream?after=-50&limit=20
```

### Unique Records

For configuration/state management:

```bash
# Get only latest version of each named record
GET /config?unique=true
```

### Field Selection

Reduce response size:

```bash
# Only get specific fields
GET /stream?fields=name,created_at,hash

# Truncate large content
GET /stream?maxContentSize=1000
```

## Content Types

WebPods preserves Content-Type headers:

- `application/json` - JSON data (default)
- `text/plain` - Plain text
- `text/html` - HTML content
- `text/markdown` - Markdown content
- `application/octet-stream` - Binary data
- Custom types supported

## Rate Limits

Default rate limits (configurable):

- **Requests**: 60 per minute per IP/user
- **Record Size**: 10MB maximum
- **Records per Request**: 1000 maximum
- **Pod Creation**: 10 per hour per user

Rate limit headers included in responses:

- `X-RateLimit-Limit` - Request limit
- `X-RateLimit-Remaining` - Requests remaining
- `X-RateLimit-Reset` - Reset timestamp

## HTTP Status Codes

- `200 OK` - Successful GET request
- `201 Created` - Resource created successfully
- `204 No Content` - Successful DELETE request
- `400 Bad Request` - Invalid request parameters
- `401 Unauthorized` - Authentication required
- `403 Forbidden` - Not authorized for resource
- `404 Not Found` - Resource does not exist
- `409 Conflict` - Resource already exists
- `429 Too Many Requests` - Rate limit exceeded
- `500 Internal Server Error` - Server error
- `503 Service Unavailable` - Temporary unavailability
