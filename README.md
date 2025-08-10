# WebPods

An append-only log service with OAuth authentication, organized into pods and queues. Write strings or JSON to queues, read them back, serve HTML directly via custom domains.

## Quick Start

```bash
# Login
curl https://webpods.org/auth/github

# Write to a queue (creates pod + queue automatically)
curl -X POST https://alice.webpods.org/blog \
  -H "Authorization: Bearer $TOKEN" \
  -d "My first post"

# Read from queue
curl https://alice.webpods.org/blog

# Get latest record
curl https://alice.webpods.org/blog/-1
```

## Core Concepts

- **Pod**: A namespace for queues (e.g., `alice`, `myproject`)
- **Queue**: An append-only log within a pod (e.g., `blog`, `config`)
- **Record**: An immutable entry in a queue (string or JSON)
- **Hash Chain**: Each record contains a hash of the previous record, creating a cryptographically verifiable chain
- **System Queues**: Special queues starting with `_` (e.g., `_owner` for pod ownership)

## URL Structure

```
{pod_id}.webpods.org/{queue_id}
```

Examples:
- `alice.webpods.org/blog`
- `myproject.webpods.org/config`
- `acme.webpods.org/team-members`

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

### Write to Queue

```
POST {pod_id}.webpods.org/{queue_id}
POST {pod_id}.webpods.org/{queue_id}/{alias}
```

Creates pod and queue if they don't exist.

**Alias Requirements:**
- Must contain at least one non-numeric character (to distinguish from indices)
- Valid: `my-post`, `logo.png`, `v2`, `post-123`
- Invalid: `123`, `456`, `-1` (these would conflict with index access)

**Headers:**
- `Authorization: Bearer {token}` (required)
- `Content-Type: application/json` or `text/plain`
- `X-Content-Type`: Override content type (optional)

**Query Parameters** (optional):
- `read`: `public` (default), `private`, `/{allow-list}`, `~/{deny-list}`
- `write`: `public` (default), `private`, `/{allow-list}`, `~/{deny-list}`

**Body:** String or JSON

**Example:**
```bash
curl -X POST https://alice.webpods.org/blog \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Content-Type: text/html" \
  -d "<h1>Hello World</h1>"
```

### Read from Queue

```
GET {pod_id}.webpods.org/{queue_id}
GET {pod_id}.webpods.org/{queue_id}/{start}-{end}
```

**Range Examples:**
- `/blog` - All records (up to default limit)
- `/blog/0-99` - Records 0 through 99
- `/blog/10-20` - Records 10 through 20
- `/blog/-10--1` - Last 10 records
- `/blog/0--1` - All records

**Query Parameters:**
- `limit`: Number of records (default 100, only for non-range requests)
- `after`: ID for pagination (only for non-range requests)

**Response:**
```json
{
  "records": [
    {
      "index": 0,
      "content": "string1",
      "author": "auth:github:1234567",
      "hash": "sha256:abc123...",
      "previous_hash": null,
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "index": 1,
      "content": {"json": "object"},
      "author": "auth:google:110169484474386276334",
      "hash": "sha256:def456...",
      "previous_hash": "sha256:abc123...",
      "timestamp": "2025-01-15T10:01:00Z"
    }
  ],
  "total": 1234,
  "has_more": true,
  "next_id": 1235
}
```

### Get Single Record

```
GET {pod_id}.webpods.org/{queue_id}/{index}
```

**Path Types:**
- **Numeric index**: `0`, `1`, `-1` (returns raw content)
- **Range**: `10-20`, `-10--1` (returns JSON with metadata)
- **Alias**: `my-post`, `logo.png` (returns raw content of latest with this alias)

**Response:** 
- **Single index or alias**: Returns raw content directly (HTML, CSS, JSON, text)
- **Range**: Returns JSON with records array and metadata

This enables direct content serving for websites and APIs.

### List Queues in Pod

```
GET {pod_id}.webpods.org/_queues
```

**Response:**
```json
{
  "pod": "alice",
  "queues": ["blog", "config", "public-key"]
}
```

### Root Domain Access

```
GET {pod_id}.webpods.org/
```

**Response:**
- If `_root` queue is configured: Serves content from configured queue/index
- If no `_root` configuration: Returns 404

**Configure root:**
```bash
POST alice.webpods.org/_root
{"queue": "homepage", "index": -1}
```

### Delete Queue

```
DELETE {pod_id}.webpods.org/{queue_id}
```

Requires authentication as pod owner.

### Delete Pod

```
DELETE {pod_id}.webpods.org/
```

Deletes entire pod and all queues. Requires authentication as pod owner.

### Transfer Pod Ownership

```
POST {pod_id}.webpods.org/_owner
```

**Headers:**
- `Authorization: Bearer {token}` (required - must be current pod owner)

**Body:**
```json
{
  "owner": "auth:github:7891011"
}
```

Transfers pod ownership by appending to the `_owner` queue. The last entry determines current owner. Only the current owner (last entry in `_owner` queue) can write new ownership records.

## Reserved System Queues

All queue names starting with `_` are reserved for system use:

- `_owner` - Pod ownership records (last record determines current owner)
- `_root` - Root domain serving configuration
- `_domains` - Custom domain mappings
- `_queues` - Lists all queues (GET only, not a real queue)

These queues cannot be created by users directly and have special system behaviors.

## Permissions

### Permission Models

```bash
# Public (default)
POST alice.webpods.org/blog
# Anyone can read, authenticated users can write

# Private
POST alice.webpods.org/journal?read=private&write=private
# Only creator can read and write

# Allow list
POST company.webpods.org/internal?read=/employees&write=/employees

# Deny list
POST forum.webpods.org/posts?write=~/banned-users

# Combined
POST project.webpods.org/docs?read=/members,~/suspended&write=/admins
```

### Managing Access Lists

Permission queues use JSON objects:

```bash
# Add to allow list
POST company.webpods.org/employees
{
  "id": "auth:github:1234567",
  "read": true,
  "write": true
}

# Update permissions (last write wins)
POST company.webpods.org/employees
{
  "id": "auth:github:1234567",
  "read": true,
  "write": false
}

# Remove access
POST company.webpods.org/employees
{
  "id": "auth:github:1234567",
  "read": false,
  "write": false
}
```

## Hash Chain Verification

### Calculate Hash Locally
```javascript
// Hash calculation (for verification)
function calculateHash(previousHash, timestamp, content) {
  const data = JSON.stringify({
    previous_hash: previousHash,
    timestamp: timestamp,
    content: content
  });
  return crypto.createHash('sha256').update(data).digest('hex');
}
```

## Record Format

All API responses include hash information for verification:

### List Response
```json
{
  "records": [
    {
      "index": 0,
      "content": "any content here",
      "author": "auth:github:1234567",
      "hash": "sha256:...",
      "previous_hash": null,
      "timestamp": "2025-01-15T10:00:00Z"
    }
  ],
  "total": 100,
  "has_more": false,
  "next_id": null
}
```

### Single Record Response
Returns the raw content directly:
- HTML → `<!DOCTYPE html><html>...</html>`
- JSON → `{"json": "data"}`
- Text → `Plain text content`
- CSS → `body { font-family: serif; }`

To get the full record with metadata (author, hash, etc), use the queue listing endpoint with appropriate filters.

## Common Patterns

### Audit Trail
```bash
# Create tamper-proof audit log
POST audit.webpods.org/logs?write=private
{
  "action": "user_login",
  "user": "alice@example.com",
  "ip": "192.168.1.1",
  "timestamp": "2025-01-15T10:00:00Z"
}

# Read audit log
GET audit.webpods.org/logs
```

### Static Website

```bash
# Write HTML
POST mysite.webpods.org/homepage
X-Content-Type: text/html

<!DOCTYPE html>
<html>
  <head>
    <link rel="stylesheet" href="/style/-1">
  </head>
  <body>
    <h1>Welcome!</h1>
  </body>
</html>

# Write CSS
POST mysite.webpods.org/style
X-Content-Type: text/css

body { font-family: serif; }

# Configure root
POST mysite.webpods.org/_root
{"queue": "homepage", "index": -1}

# Access patterns
GET mysite.webpods.org/          # Serves homepage/-1
GET mysite.webpods.org/style/-1  # Serves CSS
```

### Versioned Content

```bash
# Version 1
POST docs.webpods.org/api
# API v1 documentation...

# Version 2 (append new version)
POST docs.webpods.org/api
# API v2 documentation...

# Get latest
GET docs.webpods.org/api/-1

# Get specific version
GET docs.webpods.org/api/0  # v1
GET docs.webpods.org/api/1  # v2
```

### Configuration

```bash
# Store config
POST myapp.webpods.org/config
Content-Type: application/json
{
  "theme": "dark",
  "version": "2.0"
}

# Check if changed
HEAD myapp.webpods.org/config/-1
X-Hash: sha256:abc123...

# Get if changed
GET myapp.webpods.org/config/-1
```

### Public Inbox

```bash
# Create write-only inbox
POST contact.webpods.org/messages?read=private

# Anyone can submit
POST contact.webpods.org/messages
"Please contact me about..."

# Only owner can read
GET contact.webpods.org/messages
```

### Team Workspace

```bash
# Create team pod with member list
POST acme.webpods.org/members
{"id": "auth:github:7777", "read": true, "write": true}

# Create team-only queue
POST acme.webpods.org/internal?read=/members&write=/members
"Internal documentation..."
```

## Custom Domains

### Setup Custom Domain

1. **Configure DNS** (at your domain registrar):
```
Type: CNAME
Name: @ (or subdomain)
Value: alice.webpods.org
```

2. **Register domain with WebPods**:
```bash
POST alice.webpods.org/_domains
{"domains": ["alice-blog.com", "www.alice-blog.com"]}
```

3. **Configure root content** (optional):
```bash
POST alice.webpods.org/_root
{"queue": "homepage", "index": -1}
```

WebPods automatically provisions SSL certificates via Let's Encrypt.

### Access Patterns

With custom domain configured:
- `https://alice-blog.com/` → Serves from homepage/-1 (if _root configured)
- `https://alice-blog.com/blog` → Access blog queue
- `https://alice-blog.com/_queues` → List all queues
- `https://alice.webpods.org/` → Original subdomain still works

## User Identification

Users are identified in permission lists as:
```
auth:{provider}:{id}
```

Examples:
- `auth:github:1234567`
- `auth:google:110169484474386276334`

## Rate Limits

- Writes: 1000/hour per user
- Reads: 10000/hour per IP
- Pod creation: 10/day per user
- Queue creation: 100/day per user

## Content Limits

- Maximum content size: 1MB per record
- Maximum queue ID length: 256 characters
- Maximum pod ID length: 63 characters (subdomain limit)
- Custom header: `X-Content-Type` for content type override

## Implementation Notes

- All records are immutable (no updates, no deletes)
- Each record contains SHA-256 hash of previous record, forming an immutable chain
- Hash includes: previous_hash + timestamp + content
- First record in queue has `previous_hash: null`
- Tampering with any record invalidates all subsequent hashes
- Queues can only be deleted entirely
- Pod and queue IDs are case-sensitive
- Pod IDs must be valid subdomains (lowercase, alphanumeric, hyphens)
- Content-Type determined by: X-Content-Type header, then Content-Type header, defaults to text/plain
- Negative indexing supported (-1 for last record)
- Permission lists use last-write-wins pattern (last record in permission queue)
- Pod ownership determined by last record in `_owner` queue
- System queues (starting with `_`) have special behaviors
- Empty POST creates queue without content

## Error Codes

```json
{
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - No permission for this operation
- `NOT_FOUND` - Queue or record doesn't exist
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `CONTENT_TOO_LARGE` - Content exceeds size limit
- `INVALID_QUEUE_ID` - Invalid characters in queue ID
- `INVALID_POD_ID` - Invalid characters in pod ID
- `INVALID_INDEX` - Record index out of range

## Self-Hosting

WebPods is open source. To run your own instance:

```bash
# Clone repository
git clone https://github.com/webpods-org/webpods
cd webpods

# Configure OAuth providers
export GITHUB_CLIENT_ID=xxx
export GITHUB_CLIENT_SECRET=xxx
export GOOGLE_CLIENT_ID=xxx
export GOOGLE_CLIENT_SECRET=xxx

# Configure domain
export DOMAIN=webpods.org
export WILDCARD_SSL=true

# Run with Docker
docker compose up -d

# Or run directly
npm install
npm start
```

### Required DNS

- `*.yourdomain.org` → Your server IP (wildcard for pods)
- `yourdomain.org` → Your server IP (for auth endpoints)

### Environment Variables

```bash
# OAuth
GITHUB_CLIENT_ID=xxx
GITHUB_CLIENT_SECRET=xxx
GOOGLE_CLIENT_ID=xxx
GOOGLE_CLIENT_SECRET=xxx

# Server
JWT_SECRET=your-secret-key
PORT=3000
DOMAIN=webpods.org

# Database
DATABASE_URL=postgresql://user:pass@localhost/webpods

# Redis (for caching)
REDIS_URL=redis://localhost:6379

# Limits
MAX_CONTENT_SIZE=1048576
RATE_LIMIT_WRITES=1000
RATE_LIMIT_READS=10000

# SSL
LETSENCRYPT_EMAIL=admin@webpods.org
WILDCARD_SSL=true
```

## Examples

### Personal Blog

```bash
# Setup
POST alice.webpods.org/posts?write=private
POST alice.webpods.org/about?write=private
POST alice.webpods.org/style?write=private

# Publish content
POST alice.webpods.org/posts
X-Content-Type: text/html
<article>...</article>

POST alice.webpods.org/style
X-Content-Type: text/css
body { font-family: serif; }

# Configure homepage
POST alice.webpods.org/_root
{"queue": "posts", "index": -1}

# Add custom domains
POST alice.webpods.org/_domains
{"domains": ["alice-blog.com", "www.alice-blog.com"]}

# Access
https://alice.webpods.org/          # Latest post (via _root)
https://alice-blog.com/             # Same content via custom domain
https://alice.webpods.org/posts/0-9 # First 10 posts with metadata
```

### API Monitoring

```bash
# Write status every minute
POST status.webpods.org/api
{"status": "up", "latency": 23, "timestamp": "2025-01-15T10:00:00Z"}

# Check current status
GET status.webpods.org/api/-1

# Get history
GET status.webpods.org/api?limit=60
```

### Collaborative Notes

```bash
# Create shared notes
POST team.webpods.org/notes?read=/team&write=/team

# Team members add notes
POST team.webpods.org/notes
"Meeting scheduled for 3pm"

POST team.webpods.org/notes
"Deploy postponed to tomorrow"

# Everyone on team can read
GET team.webpods.org/notes
```

## License

MIT

## Contributing

Pull requests welcome! Please read CONTRIBUTING.md first.

## Support

- GitHub Issues: https://github.com/webpods-org/webpods/issues
- Documentation: https://docs.webpods.org
- Community: https://discord.gg/webpods