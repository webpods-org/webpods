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

## Pod Management

### Create Pod

```
POST /api/pods
Authorization: Bearer {webpods-jwt}
Content-Type: application/json
```

Request:

```json
{
  "name": "my-pod"
}
```

Pod name requirements:

- Lowercase letters, numbers, and hyphens only
- 2-63 characters
- Must be globally unique

Response (201 Created):

```json
{
  "name": "my-pod",
  "id": "my-pod",
  "created_at": "2024-01-01T00:00:00Z",
  "message": "Pod 'my-pod' created successfully"
}
```

### List Pods

```
GET /api/pods
Authorization: Bearer {webpods-jwt}
```

Returns all pods owned by the authenticated user.

Response:

```json
[
  {
    "name": "my-pod",
    "id": "my-pod",
    "created_at": "2024-01-01T00:00:00Z"
  }
]
```

### Delete Pod

```
DELETE {pod}.webpods.org/
Authorization: Bearer {token}
```

Deletes the pod and all its data. Only the owner can delete a pod.

## Stream Operations

### Create Stream

Streams support nested paths and are created automatically on first write. For explicit creation or to set permissions before writing:

```
POST {pod}.webpods.org/{stream-path}
Authorization: Bearer {token}
Content-Length: 0
```

Query parameters:

- `access` - Permission mode:
  - `public` (default) - Anyone can read, authenticated users can write
  - `private` - Only pod owner and stream creator can access
  - `/{permission-stream}` - Users listed in the permission stream can access

Examples:

```bash
# Create public stream (default)
POST {pod}.webpods.org/blog/posts

# Create private stream
POST {pod}.webpods.org/private-notes?access=private

# Create nested stream
POST {pod}.webpods.org/projects/webapp/logs

# Create stream with custom permissions
POST {pod}.webpods.org/team-docs?access=/team-permissions
```

Response (201 Created):

```json
{
  "podName": "my-pod",
  "name": "stream/path",
  "accessPermission": "private",
  "createdAt": "2024-01-01T00:00:00Z"
}
```

**Notes**:

- Stream names support forward slashes for nested paths
- Stream names are automatically normalized with leading slashes (e.g., `blog/posts` becomes `/blog/posts`)
- Names must be alphanumeric with hyphens, underscores, periods, forward slashes
- Cannot start or end with periods
- Nested streams work with recursive queries

### Write Record

**Note**: Streams are created automatically on first write. For explicit creation or to set permissions, see Create Stream above.

```
POST {pod}.webpods.org/{stream}/{name}
Authorization: Bearer {token}
```

Parameters:

- `{pod}` - Subdomain (must exist)
- `{stream}` - Path to existing stream (e.g., `/blog/2024/posts`)
- `{name}` - Record name (required, last path segment)

Query parameters:

- `access` - Permission mode for auto-created streams ("public" or "private", defaults to "public")

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
  "size": 1024,
  "name": "my-name",
  "path": "/stream/path/my-name",
  "content_hash": "sha256:...",
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
- `Content-Length` - Content size in bytes
- `X-Hash` - Record SHA-256 hash
- `X-Content-Hash` - Content-only SHA-256 hash
- `X-Previous-Hash` - Previous record hash
- `X-Author` - Author ID
- `X-Timestamp` - Creation timestamp
- `X-Index` - Record index
- `X-Path` - Full record path

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
GET {pod}.webpods.org/{stream}?limit={n}&after={index}&unique={boolean}&recursive={boolean}
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
- `recursive` - When `true`, includes records from all nested streams under the path

Response:

```json
{
  "records": [...],
  "total": 100,
  "has_more": true,
  "next_index": 50
}
```

##### Recursive Queries

Get records from all nested streams:

```bash
# Get all records from blog/* streams
GET {pod}.webpods.org/blog?recursive=true

# With pagination
GET {pod}.webpods.org/blog?recursive=true&limit=20&after=10

# Get last 50 records across nested streams
GET {pod}.webpods.org/blog?recursive=true&after=-50
```

**Note**: Cannot be combined with `unique=true` or `i` parameters.

##### Unique Records Filter

When `unique=true`:

- Returns only the most recent record for each unique name
- Excludes records marked as deleted (`{"deleted": true}`)
- Excludes records marked as purged (`{"purged": true}`)
- Records without names are excluded
- Useful for treating streams as key-value stores
- Cannot be combined with `recursive=true` or `i` parameters

##### Query Parameter Compatibility

| Parameter   | Compatible With  | Not Compatible With                     |
| ----------- | ---------------- | --------------------------------------- |
| `limit`     | All parameters   | -                                       |
| `after`     | All parameters   | -                                       |
| `unique`    | `limit`, `after` | `recursive`, `i`                        |
| `recursive` | `limit`, `after` | `unique`, `i`                           |
| `i` (index) | -                | `unique`, `recursive`, `limit`, `after` |

### Delete Record

```
DELETE {pod}.webpods.org/{stream}/{name}?purge={boolean}
Authorization: Bearer {token}
```

Parameters:

- `purge` (optional) - When `true`, performs hard delete (overwrites content)

Deletion modes:

1. **Soft delete** (default):
   - Creates tombstone record named `{name}.deleted.{index}`
   - Contains `{"deleted": true}` marker
   - Original record remains in history
   - Excluded from `unique=true` queries

2. **Hard delete/purge** (`purge=true`):
   - Overwrites record content with deletion metadata
   - Content replaced with: `{"purged": true, "by": "user-id", "at": "timestamp"}`
   - Maintains hash chain integrity

Response (200 OK):

```json
{
  "deleted": true,
  "mode": "soft" | "hard",
  "record": {
    "name": "deleted-record-name",
    "index": 123
  }
}
```

### Delete Stream

```
DELETE {pod}.webpods.org/{stream}
Authorization: Bearer {token}
```

Only stream creator can delete. System streams (`.config/*`) cannot be deleted.

### List Streams

```
GET {pod}.webpods.org/.config/api/streams
Authorization: Bearer {token}
```

Returns all streams in the pod:

```json
{
  "streams": [
    {
      "name": "blog/posts",
      "recordCount": 42,
      "accessPermission": "public",
      "createdAt": "2024-01-01T00:00:00Z"
    },
    {
      "name": "private-notes",
      "recordCount": 10,
      "accessPermission": "private",
      "createdAt": "2024-01-02T00:00:00Z"
    }
  ]
}
```

## System Streams

### .config/owner

Pod ownership tracking. Write to transfer ownership:

```json
{ "userId": "new-user-id" }
```

### .config/routing

URL routing configuration:

```json
{
  "/": "homepage?i=-1",
  "/about": "pages/about"
}
```

### .config/api/streams

```
GET {pod}.webpods.org/.config/api/streams
```

Lists all streams in pod.

## Permissions

### Access Modes

Set via `access` query parameter when creating streams or writing first record:

- **public** - Anyone can read, authenticated users can write (default)
- **private** - Only creator can read/write
- **/{stream}** - Users listed in specified permission stream

### Permission Management

To grant access to other users, write permission records to any stream (there are no special permission stream types):

```json
{
  "userId": "user-id",
  "read": true,
  "write": false
}
```

Then reference that stream in the `access` parameter:

```
POST {pod}.webpods.org/my-stream?access=/permissions/my-stream
```

Latest record for each user in the permission stream determines their access rights.

## Rate Limits

Default limits per hour:

- Write: 1000
- Read: 10000
- Pod creation: 10

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
- `POD_NOT_FOUND` - Pod does not exist (must be created first)
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
