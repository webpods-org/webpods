# API Reference

## Authentication

WebPods uses two authentication systems:

1. **User Authentication**: Direct OAuth for users managing their pods
2. **Third-Party OAuth**: Apps accessing WebPods on behalf of users (via Ory Hydra)

### User Authentication Endpoints

#### List OAuth Providers

```
GET /auth/providers
```

Returns configured OAuth providers:

```json
{
  "providers": [
    {
      "id": "github",
      "name": "GitHub",
      "loginUrl": "/auth/github"
    }
  ]
}
```

#### OAuth Login

```
GET /auth/{provider}
```

Initiates OAuth flow. Redirects to provider for authentication.

Query parameters:

- `redirect` - URL to redirect after auth (optional)
- `no_redirect=1` - Return token instead of redirecting (for CLI)

#### OAuth Callback

```
GET /auth/{provider}/callback
```

Handles OAuth provider callback. Creates session and returns JWT token.

#### User Info

```
GET /auth/whoami
Authorization: Bearer {token}
```

Returns authenticated user information:

```json
{
  "user_id": "uuid",
  "email": "user@example.com",
  "name": "User Name"
}
```

#### Logout

```
POST /auth/logout  # Returns JSON
GET /auth/logout   # Browser redirect
```

Clears session and invalidates tokens.

### Third-Party OAuth Client Management

#### Register OAuth Client

```
POST /api/oauth/clients
Authorization: Bearer {webpods-jwt}
Content-Type: application/json
```

Request:

```json
{
  "client_name": "My Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "requested_pods": ["alice", "bob"],
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "token_endpoint_auth_method": "client_secret_basic",
  "scope": "openid offline pod:read pod:write"
}
```

Required fields:

- `client_name` - Display name
- `redirect_uris` - OAuth callback URLs
- `requested_pods` - Pods your app needs access to

Response:

```json
{
  "client_id": "my-application-a1b2c3d4",
  "client_secret": "secret-only-shown-once",
  "client_name": "My Application",
  "redirect_uris": ["https://myapp.com/callback"],
  "requested_pods": ["alice", "bob"]
}
```

#### List OAuth Clients

```
GET /api/oauth/clients
Authorization: Bearer {webpods-jwt}
```

Returns user's registered OAuth clients.

#### Get OAuth Client

```
GET /api/oauth/clients/{client-id}
Authorization: Bearer {webpods-jwt}
```

#### Delete OAuth Client

```
DELETE /api/oauth/clients/{client-id}
Authorization: Bearer {webpods-jwt}
```

#### Simplified OAuth Authorization

```
GET /connect?client_id={your-client-id}
```

Redirects to Hydra with proper OAuth parameters. Users authorize and are redirected to your callback URL.

## Stream Operations

### Write Record

```
POST {pod}.webpods.org/{stream}/{name}
Authorization: Bearer {token}
```

Parameters:

- `{pod}` - Subdomain (created if doesn't exist)
- `{stream}` - Path, can be nested (e.g., `/blog/2024/posts`)
- `{name}` - Record name (required, last path segment)

Query parameters:

- `access` - Permission mode (`public`, `private`, `/{stream}`)

Headers:

- `X-Content-Type` - Explicit content type (highest priority)
- `Content-Type` - Standard content type

Name restrictions:

- Allowed: `a-z`, `A-Z`, `0-9`, `-`, `_`, `.`
- Cannot start or end with periods
- Maximum 256 characters

Response (201 Created):

```json
{
  "index": 0,
  "content": "...",
  "content_type": "text/plain",
  "name": "my-name",
  "hash": "sha256:...",
  "previous_hash": null,
  "author": "user-uuid",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Read Records

#### By Name

```
GET {pod}.webpods.org/{stream}/{name}
```

Returns raw content with metadata in headers:

- `Content-Type` - Content MIME type
- `X-Hash` - Record SHA-256 hash
- `X-Previous-Hash` - Previous record hash
- `X-Author` - Author ID
- `X-Timestamp` - Creation timestamp
- `X-Index` - Record index

#### By Index

```
GET {pod}.webpods.org/{stream}?i={index}
```

Index formats:

- Positive: `0` (first), `5` (sixth)
- Negative: `-1` (latest), `-2` (second to last)
- Range: `0:10` (records 0-9), `-10:-1` (last 10)

#### List Records

```
GET {pod}.webpods.org/{stream}?limit={n}&after={index}&unique={boolean}
```

Query parameters:

- `limit` - Maximum records to return (default: 100, server-configured max: typically 1000)
  - If you request more than the server's max limit, it will be automatically capped
  - No error is returned; the limit is silently adjusted to the maximum allowed
- `after` - Start after this index (for pagination). Supports negative values to get the last N records:
  - `after=-20` returns the last 20 records
  - `after=-3` returns the last 3 records
  - Negative values are converted relative to total record count
- `unique` - When `true`, returns only latest version of each named record, excluding deleted/purged records

Response:

```json
{
  "records": [...],
  "total": 100,
  "has_more": true,
  "next_index": 50
}
```

When `unique=true`:

- Returns only the most recent record for each unique name
- Excludes records marked as deleted (`{"deleted": true}`)
- Excludes records marked as purged (`{"purged": true}`)
- Records without names are excluded
- Useful for treating streams as key-value stores

### Delete Stream

```
DELETE {pod}.webpods.org/{stream}
Authorization: Bearer {token}
```

Only stream creator can delete. System streams (`.meta/*`) cannot be deleted.

## System Streams

### .meta/owner

Pod ownership tracking. Write to transfer ownership:

```json
{ "owner": "new-user-id" }
```

### .meta/links

URL routing configuration:

```json
{
  "/": "homepage?i=-1",
  "/about": "pages/about"
}
```

### .meta/streams

```
GET {pod}.webpods.org/.meta/streams
```

Lists all streams in pod.

## Permissions

### Access Modes

Set via `?access` parameter on first write:

- **public** - Anyone can read, authenticated users can write
- **private** - Only creator can read/write
- **/{stream}** - Users listed in permission stream

### Permission Stream Format

Write to permission stream to grant access:

```json
{
  "id": "user-id",
  "read": true,
  "write": false
}
```

Latest record for a user determines their permissions.

## Rate Limits

Default limits per hour:

- Write: 1000
- Read: 10000
- Pod creation: 10
- Stream creation: 100

Headers in responses:

- `X-RateLimit-Limit` - Requests per hour
- `X-RateLimit-Remaining` - Requests left
- `X-RateLimit-Reset` - Unix timestamp

## Error Responses

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

Common error codes:

- `UNAUTHORIZED` - Missing/invalid authentication
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `INVALID_INPUT` - Invalid request data
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `POD_EXISTS` - Pod ID already taken
- `NAME_EXISTS` - Record name already used

## Content Types

Supported for direct serving:

- `text/html` - HTML pages
- `text/css` - Stylesheets
- `application/javascript` - Scripts
- `application/json` - JSON data
- `text/plain` - Plain text (default)
- `image/*` - Images (stored as base64)

## Binary Content

Images and binary files are stored as base64:

```bash
# Upload image
IMAGE_BASE64=$(base64 -w 0 < image.png)
curl -X POST alice.webpods.org/images/logo \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$IMAGE_BASE64"

# Serve image (automatically decoded)
curl alice.webpods.org/images/logo
```

Supported formats: PNG, JPEG, GIF, WebP, SVG, ICO

## Pagination Examples

### Get the last 20 records

```bash
# Using negative after parameter
curl alice.webpods.org/stream?after=-20

# Returns the 20 most recent records
```

### Get records 10-30

```bash
# Using positive after with limit
curl alice.webpods.org/stream?after=9&limit=21

# Returns records with index 10 through 30
```

### Get all records from the last 50

```bash
# When there are fewer than 50 records, returns all
curl alice.webpods.org/stream?after=-50

# If stream has 30 records, returns all 30
# If stream has 100 records, returns last 50
```

### Paginate through unique records

```bash
# Get last 10 unique (named) records
curl alice.webpods.org/stream?unique=true&after=-10

# Pagination works the same with unique=true
```

## SSO (Single Sign-On)

Sessions persist across pods:

```
GET /auth/authorize?pod={pod-id}
```

If logged in, returns pod-specific token. Otherwise redirects to OAuth.
