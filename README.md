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
```

Creates pod and queue if they don't exist.

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
```

**Query Parameters:**
- `limit`: Number of records (default 100)
- `after`: ID for pagination

**Response:**
```json
{
  "records": [
    {
      "index": 0,
      "content": "string1",
      "hash": "sha256:abc123...",
      "previous_hash": null,
      "timestamp": "2025-01-15T10:00:00Z"
    },
    {
      "index": 1,
      "content": {"json": "object"},
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

**Index:**
- Positive: 0-based from start (0, 1, 2...)
- Negative: From end (-1 = last, -2 = second to last)

**Response:**
```json
{
  "index": 5,
  "content": "Blog post content",
  "hash": "sha256:7d865e959b2466918c9863afca942d0fb89d7c9ac0c99bafc3749504ded97730",
  "previous_hash": "sha256:4355a46b19d348dc2f57c046f8ef63d4538ebb936000f3c9ee954a27460dd865",
  "timestamp": "2025-01-15T10:05:00Z"
}
```

For HTML/CSS content serving, use `Accept: text/html` header to get raw content.

### Check for Changes

```
HEAD {pod_id}.webpods.org/{queue_id}
HEAD {pod_id}.webpods.org/{queue_id}/{index}
```

**Response Headers:**
- `X-Hash`: Latest record hash (for queue) or record hash (for single record)
- `X-Previous-Hash`: Previous record hash in chain
- `X-Chain-Hash`: Hash of entire chain (merkle root)
- `X-Last-Modified`: Last write timestamp
- `X-Total-Records`: Record count

### List Queues in Pod

```
GET {pod_id}.webpods.org/
```

**Response:**
```json
{
  "pod": "alice",
  "queues": ["blog", "config", "public-key"]
}
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
```json
{
  "index": 42,
  "content": {"json": "data"},
  "hash": "sha256:...",
  "previous_hash": "sha256:...",
  "timestamp": "2025-01-15T10:00:00Z"
}
```

### Raw Content (with Accept header)
When `Accept: text/html` or matching content-type:
```html
<!DOCTYPE html>
<html>...</html>
```

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
  <body>
    <h1>Welcome!</h1>
  </body>
</html>

# Always serve latest version
GET mysite.webpods.org/homepage/-1
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

Point your domain to your pod using a CNAME record:

```
# DNS Settings (GoDaddy, Namecheap, etc.)
Type: CNAME
Name: @ (or subdomain)
Value: mycompany.webpods.org
```

WebPods automatically provisions SSL certificates via Let's Encrypt.

Your content is then accessible at:
- `https://example.com/blog`
- `https://mycompany.webpods.org/blog` (still works)

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

# Access
https://alice.webpods.org/posts/-1  # Latest post
https://alice.webpods.org/about/-1   # About page
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