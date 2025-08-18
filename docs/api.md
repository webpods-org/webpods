# API Reference

## Authentication

### List OAuth Providers
```
GET https://webpods.org/auth/providers
```

Returns configured OAuth providers with their login URLs.

### OAuth Login
```
GET https://webpods.org/auth/{provider}
```

Examples:
```bash
GET https://webpods.org/auth/github
GET https://webpods.org/auth/google
GET https://webpods.org/auth/gitlab
```

- Providers: Any configured OAuth provider from config.json
- Optional: `?redirect={path}` for post-auth redirect
- Optional: `?no_redirect=1` to prevent auto-redirect (CLI usage)

### SSO Authorization
```
GET https://webpods.org/auth/authorize?pod={pod_id}
```
Generates pod-specific token if session exists, otherwise redirects to OAuth.

### User Info
```
GET https://webpods.org/auth/whoami
Authorization: Bearer {token}
```

Returns:
```json
{
  "user_id": "auth:{provider}:{id}",
  "email": "user@example.com",
  "name": "User Name",
  "provider": "{provider}"
}
```

### Logout
```
POST https://webpods.org/auth/logout  # Returns JSON
GET https://webpods.org/auth/logout   # Browser redirect
```

## Stream Operations

### Write Record
```
POST {pod}.webpods.org/{stream}
Authorization: Bearer {token}
```

Query parameters:
- `name`: String identifier for this record (see restrictions below)
- `access`: Permission mode (`public`, `private`, `/{stream}`)

**Name Restrictions:**
- Allowed characters: `a-z`, `A-Z`, `0-9`, `-` (hyphen), `_` (underscore), `.` (period)
- Cannot start or end with a period
- Cannot contain slashes or other special characters
- Maximum length: 256 characters
- Valid examples: `index.html`, `my-post`, `IMG_1234`, `v2.0.1`
- Invalid examples: `path/to/file`, `.hidden`, `hello world`, `file@name`

Headers:
- `X-Content-Type`: Explicit content type (highest priority)
- `Content-Type`: Standard content type

Response:
```json
{
  "index": 0,
  "content": "...",
  "content_type": "text/plain",
  "name": "my-name",
  "hash": "sha256:...",
  "previous_hash": null,
  "author": "auth:{provider}:{id}",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

### Read Records

#### By Index
```
GET {pod}.webpods.org/{stream}?i={index}
```
- Positive: `0` (first), `5` (sixth)
- Negative: `-1` (latest), `-2` (second to last)
- Range: `0:10` (items 0-9), `-10:-1` (last 10)

#### By Name  
```
GET {pod}.webpods.org/{stream}/{name}
```

#### List Records
```
GET {pod}.webpods.org/{stream}?limit={n}&after={index}
```

Returns:
```json
{
  "records": [...],
  "total": 100,
  "has_more": true,
  "next_index": 50
}
```

### Delete Stream
```
DELETE {pod}.webpods.org/{stream}
Authorization: Bearer {token}
```

## System Streams

### .meta/owner
Pod ownership tracking.
```json
{"owner": "user_id"}
```

### .meta/links
URL routing configuration.
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
- `public`: Anyone reads, authenticated write
- `private`: Creator only
- `/{stream}`: Allow list from permission stream

### Permission Stream Records
```json
{
  "id": "auth:github:123",
  "read": true,
  "write": false
}
```

## Response Headers

### Single Record
- `Content-Type`: Content MIME type
- `X-Hash`: Record SHA-256 hash
- `X-Previous-Hash`: Previous record hash
- `X-Author`: Author ID
- `X-Timestamp`: Creation timestamp
- `X-Index`: Record index

### Rate Limits
- `X-RateLimit-Limit`: Requests per hour
- `X-RateLimit-Remaining`: Requests left
- `X-RateLimit-Reset`: Unix timestamp

## Error Codes

| Code | Description |
|------|-------------|
| `UNAUTHORIZED` | Missing/invalid auth |
| `FORBIDDEN` | Insufficient permissions |
| `NOT_FOUND` | Resource not found |
| `ALIAS_EXISTS` | Name already used |
| `RATE_LIMIT_EXCEEDED` | Too many requests |
| `POD_EXISTS` | Pod ID taken |
| `INVALID_POD_ID` | Invalid pod format |
| `INVALID_STREAM_ID` | Invalid stream format |
| `TOKEN_EXPIRED` | JWT expired |
| `POD_MISMATCH` | Token not valid for pod |

## Rate Limits

- Write: 1000/hour
- Read: 10000/hour  
- Pod creation: 10/hour
- Stream creation: 100/hour

## Content Types

Supported for direct serving:
- `text/html`
- `text/css`
- `application/javascript`
- `application/json`
- `text/plain` (default)

## Examples

### Blog with posts
```bash
# Create post with name
curl -X POST alice.webpods.org/blog/welcome \
  -H "Authorization: Bearer $TOKEN" \
  -d "Welcome post"

# Read by name
curl alice.webpods.org/blog/welcome
```

### Static website
```bash
# Write HTML
curl -X POST alice.webpods.org/page/index \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/html" \
  -d "<h1>Hello</h1>"

# Configure routing
curl -X POST alice.webpods.org/.meta/links \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"/":" page/index"}'
```

### Private stream
```bash
# Create permission stream
curl -X POST alice.webpods.org/members \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"id":"auth:github:456","read":true,"write":true}'

# Create restricted stream
curl -X POST alice.webpods.org/private?access=/members \
  -H "Authorization: Bearer $TOKEN" \
  -d "Members only"
```