# WebPods

HTTP-based append-only logs using subdomains (pods) and paths (streams).

## What is WebPods?

WebPods organizes data into:

- **Pods**: Subdomains that act as namespaces (e.g., `alice.yourdomain.com`)
- **Streams**: Append-only logs within pods (e.g., `/blog`, `/data/2024`)
- **Records**: Immutable entries with SHA-256 hash chains

> **Note**: Throughout this documentation, we use `webpods.example.com` as an example domain. Replace it with your actual WebPods server domain (e.g., `webpods.org`, `data.mycompany.com`, or `localhost:3000` for local development).

## Table of Contents

- [Installation](#installation)
- [Authentication](#authentication)
  - [Token Types Explained](#token-types-explained)
- [Pod Management](#pod-management)
- [Working with Records](#working-with-records)
- [Stream Operations](#stream-operations)
- [Permissions](#permissions)
- [Links and Custom Routing](#links-and-custom-routing)
- [Custom Domains](#custom-domains)
- [Building Third-Party Apps](#building-third-party-apps)
- [Advanced Features](#advanced-features)
- [Configuration](#configuration)
- [Development](#development)

## Installation

### CLI Installation

```bash
# Install the WebPods CLI globally
npm install -g webpods-cli

# Verify installation
pod --version
```

#### Configure Your Server

The CLI needs to know which WebPods server to connect to. By default, it uses `http://localhost:3000`.

```bash
# For a production server
pod config server https://webpods.example.com

# Or use the --server flag with any command
pod login --server https://webpods.example.com

# For multiple servers, use profiles (recommended)
pod profile add prod --server https://webpods.example.com
pod profile add dev --server http://localhost:3000
pod profile use prod  # Switch to production server
```

### Server Installation

#### Using Docker

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

#### From Source

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

## Authentication

### How Authentication Works

1. **Authentication happens on the main domain** of your WebPods server (e.g., `webpods.example.com`), not on pod subdomains
2. **Once authenticated**, you receive a JWT token that works across all pods on that server
3. **Each WebPods deployment is independent** - a token from one server won't work on another

### Token Types Explained

WebPods uses two different token systems:

1. **WebPods JWT Tokens** - For direct API access and CLI usage
   - Used by: CLI, direct API calls, personal scripts
   - Get via: `pod login` or `/auth/{provider}`
   - Contains: `type: "webpods"` field
   - Purpose: Direct access to your own pods

2. **Hydra OAuth Tokens** - For third-party applications
   - Used by: External apps accessing WebPods on your behalf
   - Get via: OAuth 2.0 flow through `/connect`
   - Issued by: Ory Hydra
   - Purpose: Delegated access for third-party apps

**For CLI and direct API usage, you only need WebPods JWT tokens.**

### Login and Get Token

**Important**: Authentication happens on the main domain of your WebPods server, not on pod subdomains.

#### CLI

```bash
# Login to your configured server (defaults to http://localhost:3000)
pod login
# This shows a URL like: http://localhost:3000/auth/github
# Visit the URL, authenticate, then copy and set the token:
pod token set "your-jwt-token-here"

# Or login to a specific server
pod login --server https://webpods.example.com

# Login with a different OAuth provider (default is github)
pod login --provider google

# View saved token
pod token get

# Show current user info
pod whoami
```

#### HTTP

```bash
# Replace 'webpods.example.com' with your actual WebPods server domain

# 1. List available OAuth providers
curl https://webpods.example.com/auth/providers

# 2. For CLI/API usage, get token directly
curl "https://webpods.example.com/auth/github?no_redirect=1"
# This returns a URL - visit it in browser, authenticate, get your token

# 3. Store token for shell session
export WEBPODS_TOKEN="your-jwt-token-here"

# 4. Verify authentication
curl https://webpods.example.com/auth/whoami \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Working with Multiple Servers

You can manage pods across multiple WebPods deployments using profiles:

```bash
# Add profiles for different servers
pod profile add production --server https://webpods.example.com
pod profile add staging --server https://staging.example.com
pod profile add local --server http://localhost:3000

# Login to each server (tokens are stored per-profile)
pod profile use production
pod login  # Authenticate with production server
pod token set "production-token"

pod profile use staging
pod login  # Authenticate with staging server
pod token set "staging-token"

# Switch between servers
pod profile use production
pod list  # Shows pods on production

pod profile use staging
pod list  # Shows pods on staging

# List all profiles
pod profile list

# Use a different profile for a single command
pod list --profile staging
```

### Logout

#### CLI

```bash
pod logout
```

#### HTTP

```bash
# For API clients (returns JSON)
curl -X POST https://webpods.example.com/auth/logout \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

## Pod Management

Pods are your personal namespaces. Pod names must be:

- Lowercase letters, numbers, and hyphens only
- 2-63 characters long
- Globally unique

### Create a Pod

#### CLI

```bash
pod create my-awesome-pod
```

#### HTTP

```bash
curl -X POST https://webpods.example.com/api/pods \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-awesome-pod"}'
```

### List Your Pods

#### CLI

```bash
pod list

# JSON output
pod list --format json
```

#### HTTP

```bash
curl https://webpods.example.com/api/pods \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Delete a Pod

⚠️ **Warning**: This permanently deletes the pod and all its data!

#### CLI

```bash
# With confirmation prompt
pod delete my-awesome-pod

# Skip confirmation
pod delete my-awesome-pod --force
```

#### HTTP

```bash
curl -X DELETE https://my-awesome-pod.webpods.example.com/ \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

## Working with Records

Records are immutable entries in streams. The last path segment is the record name.

**Note**: Streams are created automatically when you write the first record, or can be created explicitly (see [Stream Operations](#stream-operations)).

### Create a Stream

Streams are created automatically when you write the first record, or can be created explicitly.

#### CLI

```bash
# Create a public stream (default)
pod stream create my-pod /blog/posts

# Create a private stream
pod stream create my-pod /private-notes --access private

# Create a stream with custom permissions
pod stream create my-pod /team-docs --access /team-permissions
```

#### HTTP

```bash
# Create a public stream explicitly
curl -X POST https://my-pod.webpods.example.com/blog/posts \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a private stream explicitly
curl -X POST https://my-pod.webpods.example.com/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Streams also auto-create when writing first record
curl -X POST https://my-pod.webpods.example.com/auto-stream/first-record \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This creates the stream automatically"
```

### Write a Record

#### CLI

```bash
# Write text content (stream auto-creates)
pod write my-pod /blog/posts/first-post "This is my first blog post!"

# Write from file (stream auto-creates)
pod write my-pod /data/users/alice @user.json

# Write from stdin (stream auto-creates)
echo "Hello, World!" | pod write my-pod /messages/greeting -

# Write with specific content type (stream auto-creates)
pod write my-pod /styles/main.css @style.css --content-type text/css

# Write to private stream (specify access on first write)
pod write my-pod /private-notes/secret "My secret" --access private
```

#### HTTP

```bash
# Write text content (stream auto-creates as public)
curl -X POST https://my-pod.webpods.example.com/blog/posts/first-post \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This is my first blog post!"

# Write JSON content (stream auto-creates as public)
curl -X POST https://my-pod.webpods.example.com/data/users/alice \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "age": 30}'

# Write to private stream (specify access on first write)
curl -X POST https://my-pod.webpods.example.com/private-notes/secret?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This is private data"
```

### Read a Record

#### CLI

```bash
# Read by name
pod read my-pod /blog/posts/first-post

# Read by index
pod read my-pod /blog/posts --index 0    # First record
pod read my-pod /blog/posts --index -1   # Latest record

# Save to file
pod read my-pod /blog/posts/first-post -o post.txt

# Show metadata
pod read my-pod /blog/posts/first-post --metadata

# Read without a name (gets latest)
pod read my-pod /blog/posts
```

#### HTTP

```bash
# Read by name (returns raw content)
curl https://my-pod.webpods.example.com/blog/posts/first-post

# Read with metadata in headers
curl -i https://my-pod.webpods.example.com/blog/posts/first-post

# Read by index
curl https://my-pod.webpods.example.com/blog/posts?i=0    # First record
curl https://my-pod.webpods.example.com/blog/posts?i=-1   # Latest record
curl https://my-pod.webpods.example.com/blog/posts?i=0:10 # Range (0-9)
```

### Delete a Record

WebPods supports two deletion modes:

- **Soft delete** (default): Creates a tombstone record marking deletion
- **Hard delete/purge**: Overwrites the record content with deletion metadata

#### CLI

```bash
# Soft delete a record (creates tombstone)
pod delete my-pod /blog/posts/old-post

# Hard delete/purge a record (overwrites content)
pod delete my-pod /blog/posts/old-post --purge
```

#### HTTP

```bash
# Soft delete (creates tombstone record)
curl -X DELETE https://my-pod.webpods.example.com/blog/posts/old-post \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Hard delete/purge (overwrites content)
curl -X DELETE https://my-pod.webpods.example.com/blog/posts/old-post?purge=true \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

**Notes**:

- Soft delete creates a new record named `{original-name}.deleted.{index}` with `{"deleted": true}`
- Deleted records are excluded from `unique=true` queries
- Purged records have their content replaced with `{"purged": true, "by": "user-id", "at": "timestamp"}`
- Both deletion types maintain the hash chain integrity

### List Records in a Stream

#### CLI

```bash
# List all records
pod record list my-pod blog/posts

# With limit (capped at server maximum, typically 1000)
pod record list my-pod blog/posts --limit 10

# Pagination with positive offset
pod record list my-pod blog/posts --limit 10 --after 50

# Negative indexing - get last N records
pod record list my-pod blog/posts --after -20    # Last 20 records
pod record list my-pod blog/posts --after -5     # Last 5 records

# Get only unique named records (latest version of each)
pod record list my-pod blog/posts --unique

# List records from nested streams recursively
pod record list my-pod blog --recursive          # All records in blog/* streams
pod record list my-pod / --recursive             # All records in all streams

# JSON output
pod record list my-pod blog/posts --format json
```

#### HTTP

```bash
# List all records
curl https://my-pod.webpods.example.com/blog/posts

# With pagination (limit is capped at server maximum)
curl https://my-pod.webpods.example.com/blog/posts?limit=10&after=20

# Negative indexing - get last N records
curl https://my-pod.webpods.example.com/blog/posts?after=-20    # Last 20 records
curl https://my-pod.webpods.example.com/blog/posts?after=-5     # Last 5 records

# Get only unique named records (excludes deleted/purged)
curl https://my-pod.webpods.example.com/blog/posts?unique=true

# List records from nested streams recursively
curl https://my-pod.webpods.example.com/blog?recursive=true      # All records in blog/* streams
curl https://my-pod.webpods.example.com/?recursive=true          # All records in all streams
```

### Advanced Query Features

#### Recursive Stream Queries

Query records from all nested streams under a path:

##### CLI

```bash
# List all records in blog/* streams (blog/posts, blog/drafts, etc.)
pod record list my-pod blog --recursive

# Combine with pagination
pod record list my-pod blog --recursive --limit 20 --after 10

# Get last 50 records across all nested streams
pod record list my-pod blog --recursive --after -50
```

##### HTTP

```bash
# List all records in blog/* streams
curl https://my-pod.webpods.example.com/blog?recursive=true

# With pagination
curl https://my-pod.webpods.example.com/blog?recursive=true&limit=20&after=10

# Get last 50 records across all nested streams
curl https://my-pod.webpods.example.com/blog?recursive=true&after=-50
```

**Note**: Recursive queries cannot be combined with `unique=true`.

#### Unique Records Filter

Returns only the latest version of each named record, filtering out:

- Records without names
- Deleted records (marked with `{"deleted": true}`)
- Purged records (marked with `{"purged": true}`)

This effectively treats the stream as a key-value store.

##### CLI

```bash
# Get latest version of each named record
pod record list my-pod config --unique

# Combine with negative indexing
pod record list my-pod config --unique --after -10  # Last 10 unique records
```

##### HTTP

```bash
# Get latest version of each named record
curl https://my-pod.webpods.example.com/config?unique=true

# Combine with pagination
curl https://my-pod.webpods.example.com/config?unique=true&limit=50&after=100
```

#### Query Parameter Combinations

| Parameter   | Compatible With  | Not Compatible With                     |
| ----------- | ---------------- | --------------------------------------- |
| `limit`     | All parameters   | -                                       |
| `after`     | All parameters   | -                                       |
| `unique`    | `limit`, `after` | `recursive`, `i`                        |
| `recursive` | `limit`, `after` | `unique`, `i`                           |
| `i` (index) | -                | `unique`, `recursive`, `limit`, `after` |

## Stream Operations

### Create a Stream

Streams are created automatically when you write the first record, or can be created explicitly. Streams support nested paths using forward slashes.

#### CLI

```bash
# Create a public stream (default)
pod stream create my-pod /blog/posts

# Create nested streams
pod stream create my-pod /projects/webapp/logs
pod stream create my-pod /teams/engineering/members

# Create a private stream
pod stream create my-pod /private-notes --access private

# Create a stream with custom permissions
pod stream create my-pod /members --access /team-permissions
```

#### HTTP

```bash
# Create a public stream explicitly
curl -X POST https://my-pod.webpods.example.com/blog/posts \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create nested streams
curl -X POST https://my-pod.webpods.example.com/projects/webapp/logs \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a private stream explicitly
curl -X POST https://my-pod.webpods.example.com/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create stream with custom permissions
curl -X POST https://my-pod.webpods.example.com/members?access=/team-permissions \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

**Notes**:

- All streams are regular data streams. Permission streams are just regular streams that contain permission records.
- Nested paths are supported (e.g., `/blog/posts/drafts`) and work with recursive queries
- Stream names are automatically normalized with leading slashes (e.g., `blog/posts` becomes `/blog/posts`)
- Stream names must be valid (alphanumeric, hyphens, underscores, periods, forward slashes, no leading/trailing periods)

### List All Streams

#### CLI

```bash
pod stream list my-pod
```

#### HTTP

```bash
curl https://my-pod.webpods.example.com/.config/api/streams \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Delete a Stream

⚠️ **Warning**: This deletes all records in the stream!

#### CLI

```bash
pod stream delete my-pod /old-stream --force
```

#### HTTP

```bash
curl -X DELETE https://my-pod.webpods.example.com/old-stream \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

## Permissions

Permissions are set when creating streams using the `access_permission` parameter.

### Permission Hierarchy

1. **Pod Owner**: Has full access to all streams in their pod, regardless of stream permissions
   - Can create new streams
   - Can delete any stream
   - Can read/write to any stream (even private ones)
   - Can transfer pod ownership
2. **Stream Creator**: Has access to streams they created (unless pod ownership was transferred)
3. **Explicit Permissions**: Users granted access via permission streams

### Permission Modes

- **public** (default) - Anyone can read, authenticated users can write
- **private** - Only the pod owner and stream creator can read and write
- **/{permission-stream}** - Users listed in the permission stream can access

**Important**: When pod ownership is transferred, the previous owner loses access to ALL streams, even ones they created.

### Set Stream Permissions

Permissions are set when creating streams, not when writing records.

#### CLI

```bash
# Create a public stream (default)
pod stream create my-pod /public-blog

# Create a private stream
pod stream create my-pod /private-notes --access private

# Create a stream with custom permissions (users in permission stream)
pod stream create my-pod /team-docs --access /team-permissions
```

#### HTTP

```bash
# Create a private stream explicitly
curl -X POST https://my-pod.webpods.example.com/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a stream with custom permissions
curl -X POST https://my-pod.webpods.example.com/team-docs?access=/team-permissions \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Grant Permissions to Users

#### CLI

```bash
# Grant read access
pod grant my-pod /team-permissions user-123 --read

# Grant read and write access
pod grant my-pod /team-permissions user-456 --read --write

# Revoke access
pod revoke my-pod /team-permissions user-789

# List permissions
pod permissions my-pod /team-permissions
```

#### HTTP

```bash
# Grant read access to a user
curl -X POST https://my-pod.webpods.example.com/team-permissions/user-123 \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "user-123", "read": true, "write": false}'

# Revoke access
curl -X POST https://my-pod.webpods.example.com/team-permissions/user-789 \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"id": "user-789", "read": false, "write": false}'
```

## Links and Custom Routing

WebPods supports custom URL routing within your pod using the `.config/routing` system stream.

### How Links Work

When someone visits a path on your pod, WebPods:

1. First checks if a stream/record exists at that exact path
2. If not, checks `.config/routing` for routing rules
3. Routes can redirect to streams with query parameters

### Setting Up Links

#### CLI

```bash
# Set homepage to show latest post
pod links set my-pod / "blog/posts?i=-1"

# Set /about to show a specific page
pod links set my-pod /about "pages/about"

# Set /blog to show unique posts
pod links set my-pod /blog "blog/posts?unique=true&limit=10"

# List all links
pod links list my-pod

# Remove a link
pod links remove my-pod /old-page
```

#### HTTP

```bash
# Set up multiple routes at once
curl -X POST https://my-pod.webpods.example.com/.config/routing/routes \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "/": "homepage?i=-1",
    "/about": "pages/about",
    "/blog": "blog/posts?unique=true",
    "/contact": "pages/contact"
  }'
```

### Example: Building a Blog

```bash
# 1. Create your homepage (stream auto-creates)
pod write my-pod homepage/index "Welcome to my blog!" --content-type text/html

# 2. Create blog posts (stream auto-creates)
pod write my-pod blog/posts/first "My first post"
pod write my-pod blog/posts/second "Another post"

# 3. Set up routing
pod links set my-pod / "homepage/index"           # Homepage
pod links set my-pod /posts "blog/posts?unique=true"  # All posts
pod links set my-pod /latest "blog/posts?i=-1"        # Latest post

# Now visitors can access:
# https://my-pod.webpods.example.com/          -> Shows homepage
# https://my-pod.webpods.example.com/posts     -> Lists all posts
# https://my-pod.webpods.example.com/latest    -> Shows most recent post
```

## Custom Domains

You can map custom domains to your pods.

### Setting a Custom Domain

#### CLI

```bash
# Add a custom domain
pod domain add my-pod blog.example.com

# List domains for a pod
pod domain list my-pod

# Remove a custom domain
pod domain remove my-pod blog.example.com
```

#### HTTP

```bash
# Add custom domain
curl -X POST https://my-pod.webpods.example.com/.config/domains/custom \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain": "blog.example.com"}'
```

### DNS Configuration

After adding a custom domain, configure your DNS:

```
# CNAME record (recommended)
blog.example.com. CNAME my-pod.webpods.example.com.

# Or A record (if CNAME not possible)
blog.example.com. A <webpods-server-ip>
```

## Building Third-Party Apps

This section is for developers building applications that need to access WebPods on behalf of users.

### Understanding OAuth Flow

Third-party apps use OAuth 2.0 via Ory Hydra to get access tokens. These are different from WebPods JWT tokens:

1. **Your app registers** as an OAuth client
2. **Users authorize** your app to access specific pods
3. **Your app receives** OAuth tokens from Hydra
4. **Use tokens** to access WebPods on user's behalf

### Step 1: Register Your Application

First, you need a WebPods account and token:

```bash
# Get your own WebPods token
pod login
DEVELOPER_TOKEN=$(pod token get)
```

Register your OAuth client:

#### CLI

```bash
pod oauth register "My Awesome App" \
  --redirect-uri https://myapp.com/callback \
  --redirect-uri http://localhost:3000/callback \
  --pods alice,bob \
  --scope "openid offline pod:read pod:write"

# Save the client_id and client_secret!
```

#### HTTP

```bash
curl -X POST https://webpods.org/api/oauth/clients \
  -H "Authorization: Bearer $DEVELOPER_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "My Awesome App",
    "redirect_uris": [
      "https://myapp.com/callback",
      "http://localhost:3000/callback"
    ],
    "requested_pods": ["alice", "bob"],
    "grant_types": ["authorization_code", "refresh_token"],
    "response_types": ["code"],
    "scope": "openid offline pod:read pod:write"
  }'
```

Response:

```json
{
  "client_id": "my-awesome-app-a1b2c3d4",
  "client_secret": "secret-xyz789-only-shown-once",
  "client_name": "My Awesome App"
}
```

### Step 2: Implement OAuth Flow

#### Authorization Request

Send users to authorize your app:

```javascript
const authUrl = new URL("https://webpods.org/connect");
authUrl.searchParams.append("client_id", "my-awesome-app-a1b2c3d4");
authUrl.searchParams.append("redirect_uri", "https://myapp.com/callback");
authUrl.searchParams.append("scope", "openid pod:read pod:write");
authUrl.searchParams.append("state", generateRandomState());

// Redirect user to authUrl
window.location.href = authUrl.toString();
```

#### Handle Callback

Users are redirected back with an authorization code:

```javascript
// GET https://myapp.com/callback?code=abc123&state=xyz

async function handleCallback(code, state) {
  // Verify state matches what you sent

  // Exchange code for tokens
  const response = await fetch("https://webpods.org/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + btoa(CLIENT_ID + ":" + CLIENT_SECRET),
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "https://myapp.com/callback",
    }),
  });

  const tokens = await response.json();
  // tokens.access_token - Use this to access WebPods
  // tokens.refresh_token - Use this to get new access tokens
}
```

### Step 3: Access WebPods APIs

Use the OAuth access token to make requests:

```javascript
// Read from a pod
const response = await fetch("https://alice.webpods.example.com/data/info", {
  headers: {
    Authorization: "Bearer " + accessToken,
  },
});

// Write to a pod
const writeResponse = await fetch("https://alice.webpods.example.com/app-data/record", {
  method: "POST",
  headers: {
    Authorization: "Bearer " + accessToken,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ data: "from my app" }),
});
```

### Managing OAuth Clients

#### CLI

```bash
# List your OAuth clients
pod oauth list

# Get details of a specific client
# pod oauth get my-awesome-app-a1b2c3d4  # NOT YET IMPLEMENTED

# Delete a client
# pod oauth delete my-awesome-app-a1b2c3d4  # NOT YET IMPLEMENTED
```

#### HTTP

```bash
# List clients
curl https://webpods.org/api/oauth/clients \
  -H "Authorization: Bearer $DEVELOPER_TOKEN"

# Delete a client
curl -X DELETE https://webpods.org/api/oauth/clients/my-awesome-app-a1b2c3d4 \
  -H "Authorization: Bearer $DEVELOPER_TOKEN"
```

### Public Client for SPAs

For single-page applications that can't securely store secrets:

```bash
pod oauth register "My SPA" \
  --redirect-uri https://spa.example.com/callback \
  --public \
  --scope "openid pod:read pod:write"
```

This creates a public client that uses PKCE for security.

## Advanced Features

### Binary Content and Images

#### CLI

```bash
# Upload an image (stream auto-creates)
pod write my-pod images/logo @logo.png --content-type image/png

# Upload a PDF (stream auto-creates)
pod write my-pod docs/manual @manual.pdf --content-type application/pdf

# Download binary content
pod read my-pod images/logo -o downloaded-logo.png
```

#### HTTP

```bash
# Upload an image (must be base64 encoded)
IMAGE_BASE64=$(base64 -w 0 < image.png)
curl -X POST https://my-pod.webpods.example.com/images/logo \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$IMAGE_BASE64"

# Images are automatically decoded when served
curl https://my-pod.webpods.example.com/images/logo > logo.png
```

### Serving Web Content

WebPods can serve as a static website host:

```bash
# Upload HTML (stream auto-creates)
pod write my-pod index.html @index.html --content-type text/html

# Upload CSS (stream auto-creates)
pod write my-pod css/styles.css @styles.css --content-type text/css

# Upload JavaScript (stream auto-creates)
pod write my-pod js/app.js @app.js --content-type application/javascript

# Upload images (stream auto-creates)
pod write my-pod img/hero.jpg @hero.jpg --content-type image/jpeg

# Set up routing
pod links set my-pod / "index.html"
pod links set my-pod /style.css "css/styles.css"

# Your site is live at https://my-pod.webpods.example.com/
```

### Hash Chain Verification

Every record has a SHA-256 hash and links to the previous record:

#### CLI

```bash
# View hash chain
pod verify my-pod /stream-name --show-chain

# Verify integrity
pod verify my-pod /stream-name --check-integrity
```

#### HTTP

```bash
# Headers include hash information
curl -i https://my-pod.webpods.example.com/verified/data
# X-Hash: sha256:abc123...
# X-Previous-Hash: sha256:def456...
```

### System Streams

Special streams that control pod behavior:

#### .config/owner

Pod ownership controls complete access to a pod. When ownership is transferred:

- The new owner gains full control of the pod
- The previous owner loses ALL access (read and write) to the pod and its streams
- Only the pod owner can create new streams
- The pod owner has full access to all streams regardless of individual stream permissions
- The transfer validates that the new owner user ID exists
- Ownership transfer is immediate and cannot be reversed without the new owner's consent

```bash
# View ownership
pod info my-pod --owner

# Transfer ownership (CLI)
# WARNING: You will lose all access to this pod after transfer
# Note: The new user ID must exist in the system
pod transfer my-pod new-user-id --force

# Transfer ownership (HTTP)
curl -X POST https://my-pod.webpods.example.com/.config/owner \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"owner": "new-user-id"}'
```

#### .config/api/streams

```bash
# List all streams
pod stream list my-pod

# Via HTTP
curl https://my-pod.webpods.example.com/.config/api/streams
```

#### .config/routing

```bash
# Set pod configuration
# pod config my-pod set description "My personal blog"  # NOT YET IMPLEMENTED
# pod config my-pod set theme "dark"  # NOT YET IMPLEMENTED

# Get configuration
# pod config my-pod get  # NOT YET IMPLEMENTED
```

### Rate Limits

Default limits per hour:

- Read: 10,000
- Write: 1,000
- Pod creation: 10
- Stream creation: 100

#### CLI

```bash
# Check your current limits
pod limits

# Check specific action
pod limits --action write
```

#### HTTP

```bash
# Rate limit info is in response headers
curl -i https://my-pod.webpods.example.com/test \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Headers:
# X-RateLimit-Limit: 1000
# X-RateLimit-Remaining: 999
# X-RateLimit-Reset: 1735689600
```

### Backup and Export

#### CLI

```bash
# Export entire pod
pod export my-pod -o my-pod-backup.json
pod export my-pod --exclude-config  # Exclude .config/ streams

# Verify stream integrity (check hash chain)
pod verify my-pod /stream-name
pod verify my-pod /stream-name --show-chain
pod verify my-pod /stream-name --check-integrity

# Grant/revoke permissions
pod grant my-pod /permission-stream user-id --read
pod grant my-pod /permission-stream user-id --write
pod grant my-pod /permission-stream user-id --read --write
pod revoke my-pod /permission-stream user-id

# Manage links (URL routing)
pod links set my-pod /about /blog/about-page
pod links list my-pod
pod links remove my-pod /about

# Manage custom domains
pod domain add my-pod example.com
pod domain list my-pod
pod domain remove my-pod example.com
```

### Localhost Testing

For local development, use the X-Pod-Name header:

```bash
# When running locally without wildcard DNS
curl -X POST http://localhost:3000/test/data \
  -H "Authorization: Bearer $TOKEN" \
  -H "X-Pod-Name: my-pod" \
  -d "test data"
```

## Configuration

### CLI Configuration

```bash
# Set default server
# pod config set server https://webpods.org  # NOT YET IMPLEMENTED

# Set default output format
# pod config set format json  # NOT YET IMPLEMENTED

# Set default pod (avoid typing it every time)
# pod config set default-pod my-main-pod  # NOT YET IMPLEMENTED

# Enable verbose output
# pod config set verbose true  # NOT YET IMPLEMENTED

# View all settings
# pod config list  # NOT YET IMPLEMENTED

# Configuration is stored in ~/.webpods/config.json
```

### Server Configuration

Create `config.json`:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "public": {
      "url": "https://webpods.org",
      "hostname": "webpods.org"
    }
  },
  "oauth": {
    "providers": [
      {
        "id": "github",
        "clientId": "github-client-id",
        "clientSecret": "$GITHUB_SECRET",
        "authUrl": "https://github.com/login/oauth/authorize",
        "tokenUrl": "https://github.com/login/oauth/access_token",
        "userinfoUrl": "https://api.github.com/user",
        "scope": "read:user user:email"
      },
      {
        "id": "google",
        "clientId": "google-client-id",
        "clientSecret": "$GOOGLE_SECRET",
        "authUrl": "https://accounts.google.com/o/oauth2/v2/auth",
        "tokenUrl": "https://oauth2.googleapis.com/token",
        "userinfoUrl": "https://www.googleapis.com/oauth2/v1/userinfo",
        "scope": "openid email profile"
      }
    ]
  },
  "hydra": {
    "adminUrl": "http://localhost:4445",
    "publicUrl": "http://localhost:4444"
  },
  "rateLimits": {
    "read": 10000,
    "write": 1000,
    "podCreate": 10,
    "streamCreate": 100,
    "maxRecordLimit": 1000
  },
  "features": {
    "customDomains": true,
    "binaryContent": true,
    "publicRegistration": true
  }
}
```

### Environment Variables

```bash
# Required
JWT_SECRET=your-secret-key-min-32-chars
SESSION_SECRET=your-session-secret
WEBPODS_DB_PASSWORD=database-password

# Database (with defaults)
WEBPODS_DB_HOST=localhost
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpodsdb
WEBPODS_DB_USER=postgres

# OAuth provider secrets
GITHUB_SECRET=your-github-oauth-secret
GOOGLE_SECRET=your-google-oauth-secret

# Optional
PUBLIC_URL=https://webpods.org
MAX_RECORD_SIZE=10485760  # 10MB
MAX_RECORD_LIMIT=1000
LOG_LEVEL=info
```

## Development

### Running Tests

```bash
# Run all tests
npm test

# Run specific test suites
npm run test:grep -- "authentication"

# Run CLI tests only
cd node/packages/webpods-cli-tests && npm test

# Run integration tests only
cd node/packages/webpods-integration-tests && npm test

# Run with coverage
npm run test:coverage
```

### Database Operations

```bash
# Run migrations
npm run migrate:latest

# Rollback migration
npm run migrate:rollback

# Create new migration
npm run migrate:make add_new_feature

# Check migration status
npm run migrate:status
```

### Building and Development

```bash
# Development mode with hot reload
npm run dev

# Build for production
./build.sh

# Build without formatting (faster)
./build.sh --no-format

# Build and run migrations
./build.sh --migrate

# Clean all build artifacts
./clean.sh

# Format code
./format-all.sh

# Lint code
./lint-all.sh
./lint-all.sh --fix
```

### Docker Development

```bash
# Build Docker image
docker build -t webpods:local .

# Run with docker-compose
docker-compose up

# Run tests in Docker
docker-compose -f docker-compose.test.yml up
```

## API Reference

### Authentication Endpoints

- `GET /auth/providers` - List OAuth providers
- `GET /auth/{provider}` - Start OAuth flow
- `GET /auth/{provider}/callback` - OAuth callback
- `GET /auth/whoami` - Get current user info
- `POST /auth/logout` - Logout

### Pod Management

- `POST /api/pods` - Create pod
- `GET /api/pods` - List user's pods
- `DELETE https://{pod}.webpods.example.com/` - Delete pod

### Streams

- `POST https://{pod}.webpods.example.com/{stream}?access={mode}` - Create a stream explicitly (or auto-create on first write)
- `DELETE https://{pod}.webpods.example.com/{stream}` - Delete stream
- `GET https://{pod}.webpods.example.com/.config/api/streams` - List all streams

### Records

- `POST https://{pod}.webpods.example.com/{stream}/{name}` - Write record
- `GET https://{pod}.webpods.example.com/{stream}/{name}` - Read record
- `GET https://{pod}.webpods.example.com/{stream}` - List records

### OAuth Client Management

- `POST /api/oauth/clients` - Register client
- `GET /api/oauth/clients` - List clients
- `GET /api/oauth/clients/{id}` - Get client
- `DELETE /api/oauth/clients/{id}` - Delete client

### OAuth 2.0 Flow

- `GET /connect` - Simplified authorization
- `GET /oauth2/auth` - Authorization endpoint
- `POST /oauth2/token` - Token endpoint
- `GET /oauth2/userinfo` - User info endpoint

## Error Codes

- `UNAUTHORIZED` - Missing or invalid authentication
- `FORBIDDEN` - Insufficient permissions
- `NOT_FOUND` - Resource not found
- `POD_NOT_FOUND` - Pod doesn't exist (must create first)
- `POD_EXISTS` - Pod name already taken
- `NAME_EXISTS` - Record name already used in stream
- `INVALID_INPUT` - Request validation failed
- `RATE_LIMIT_EXCEEDED` - Too many requests
- `INTERNAL_ERROR` - Server error

## CLI Commands Reference

### Authentication

- `pod login [provider]` - Login via OAuth provider
- `pod logout` - Clear authentication
- `pod whoami` - Show current user info
- `pod token set <token>` - Set authentication token
- `pod token show` - Display current token

### Pod Management

- `pod create <name>` - Create a new pod
- `pod list` - List your pods
- `pod info <pod>` - Show pod details
- `pod delete <pod> [--force]` - Delete a pod
- `pod transfer <pod> <user-id> --force` - Transfer pod ownership

### Records

- `pod write <pod> <path> <data>` - Write a record
- `pod read <pod> <path>` - Read a record
- `pod record list <pod> <stream>` - List records in a stream
- `pod delete <pod> <path> [--purge]` - Delete a record

### Streams

- `pod stream create <pod> <stream> [--access <mode>]` - Create a stream
- `pod stream list <pod>` - List all streams
- `pod stream delete <pod> <stream> --force` - Delete a stream
- `pod verify <pod> <stream>` - Verify stream integrity

### Permissions

- `pod grant <pod> <stream> <user> [--read] [--write]` - Grant permissions
- `pod revoke <pod> <stream> <user>` - Revoke permissions

### Links & Domains

- `pod links set <pod> <path> <stream/record>` - Set a link
- `pod links list <pod>` - List all links
- `pod links remove <pod> <path>` - Remove a link
- `pod domain add <pod> <domain>` - Add custom domain
- `pod domain list <pod>` - List domains
- `pod domain remove <pod> <domain>` - Remove domain

### Backup & Export

- `pod export <pod> [-o file]` - Export pod data
- `pod export <pod> --exclude-config` - Export without .config/ streams

### Profile Management

- `pod profile add <name> --server <url>` - Add server profile
- `pod profile list` - List profiles
- `pod profile use <name>` - Switch profile
- `pod profile delete <name> --force` - Delete profile
- `pod profile current` - Show current profile

### Configuration

- `pod config set <key> <value>` - Set config value
- `pod config get [key]` - Get config value
- `pod --help` - Show help
- `pod <command> --help` - Show command help

## Documentation

- [API Reference](docs/api.md) - Complete API documentation
- [CLI Reference](node/packages/webpods-cli/README.md) - Detailed CLI commands
- [Configuration Guide](docs/configuration.md) - OAuth and server setup
- [Architecture](docs/architecture.md) - System design and data model
- [Deployment Guide](docs/deployment.md) - Production deployment
- [Security](docs/security.md) - Security considerations

## Support

- GitHub Issues: https://github.com/webpods-org/webpods/issues
- Documentation: https://docs.webpods.org
- Community: https://discord.gg/webpods

## License

MIT
