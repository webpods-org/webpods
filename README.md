# WebPods

HTTP-based append-only logs using subdomains (pods) and paths (streams).

## What is WebPods?

WebPods organizes data into:

- **Pods**: Subdomains that act as namespaces (e.g., `alice.webpods.org`)
- **Streams**: Hierarchical append-only logs within pods (e.g., `/blog`, `/blog/posts`, `/blog/posts/2024`)
- **Records**: Immutable entries within streams, with SHA-256 hash chains

> **Important**: Throughout this documentation, `webpods.org` is used as an example domain. When you deploy WebPods, replace it with your actual server domain (e.g., `data.mycompany.com`, `pods.example.net`, or `localhost:3000` for local development). Each WebPods deployment is completely independent.

## Table of Contents

- [Installation](#installation)
- [Authentication](#authentication)
  - [Token Types Explained](#token-types-explained)
- [Pod Management](#pod-management)
- [Understanding Streams and Records](#understanding-streams-and-records)
  - [Hierarchical Structure](#hierarchical-structure)
- [Working with Records](#working-with-records)
- [Stream Operations](#stream-operations)
- [File Synchronization](#file-synchronization)
- [Permissions](#permissions)
- [Links and Custom Routing](#links-and-custom-routing)
- [Custom Domains](#custom-domains)
- [Building Third-Party Apps](#building-third-party-apps)
- [Advanced Features](#advanced-features)
  - [Schema Validation](#schema-validation)
- [Configuration](#configuration)
- [Development](#development)

## Installation

### CLI Installation

```bash
# Install the WebPods CLI globally
npm install -g @webpods/podctl

# Verify installation
podctl --version
```

#### Configure Your Server

The CLI needs to know which WebPods server to connect to. By default, it uses `http://localhost:3000`.

```bash
# For connecting to different servers, use profiles
podctl profile add prod --server https://webpods.org
podctl profile add work --server https://pods.mycompany.com
podctl profile add dev --server http://localhost:3000
podctl profile use prod  # Switch to production server
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

1. **Authentication happens on the main domain** of your WebPods server (e.g., `webpods.org`), not on pod subdomains
2. **Once authenticated**, you receive a JWT token that works across all pods on that server
3. **Each WebPods deployment is independent** - a token from one server won't work on another

### Token Types Explained

WebPods uses two different token systems:

1. **WebPods JWT Tokens** - For direct API access and CLI usage
   - Used by: CLI, direct API calls, personal scripts
   - Get via: `podctl login` or `/auth/{provider}`
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
podctl login
# This shows a URL like: http://localhost:3000/auth/github
# Visit the URL, authenticate, then copy and set the token:
podctl token set "your-jwt-token-here"

# Show all available OAuth providers for the current server
podctl login

# View saved token
podctl token get

# Show current user info
podctl auth info
```

#### HTTP

```bash
# Replace 'webpods.org' with your actual WebPods server domain

# 1. List available OAuth providers
curl https://webpods.org/auth/providers

# 2. For CLI/API usage, get token directly
curl "https://webpods.org/auth/github?no_redirect=1"
# This returns a URL - visit it in browser, authenticate, get your token

# 3. Store token for shell session
export WEBPODS_TOKEN="your-jwt-token-here"

# 4. Verify authentication
curl https://webpods.org/auth/whoami \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Working with Multiple Servers

You can manage pods across multiple WebPods deployments using profiles:

```bash
# Add profiles for different servers
podctl profile add production --server https://webpods.org
podctl profile add staging --server https://staging.example.com
podctl profile add local --server http://localhost:3000

# Login to each server (tokens are stored per-profile)
podctl profile use production
podctl login  # Authenticate with production server
podctl token set "production-token"

podctl profile use staging
podctl login  # Authenticate with staging server
podctl token set "staging-token"

# Switch between servers
podctl profile use production
podctl pod list  # Shows pods on production

podctl profile use staging
podctl pod list  # Shows pods on staging

# List all profiles
podctl profile list

# Use a different profile for a single command
podctl pod list --profile staging
```

### Logout

#### CLI

```bash
podctl logout
```

#### HTTP

```bash
# For API clients (returns JSON)
curl -X POST https://webpods.org/auth/logout \
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
podctl pod create my-awesome-pod
```

#### HTTP

```bash
curl -X POST https://webpods.org/api/pods \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-awesome-pod"}'
```

### List Your Pods

#### CLI

```bash
podctl pod list

# JSON output
podctl pod list --format json
```

#### HTTP

```bash
curl https://webpods.org/api/pods \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Delete a Pod

⚠️ **Warning**: This permanently deletes the pod and all its data!

#### CLI

```bash
# With confirmation prompt
podctl pod delete my-awesome-pod

# Skip confirmation
podctl pod delete my-awesome-pod --force
```

#### HTTP

```bash
curl -X DELETE https://my-awesome-pod.webpods.org/ \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

## Understanding Streams and Records

### Hierarchical Structure

WebPods uses a hierarchical structure similar to a filesystem:

- **Streams** are like directories that can contain records and child streams
- **Records** are like files within streams
- When you write to a path, the last segment becomes the record name, and all preceding segments form the stream hierarchy

For example, writing to `/blog/posts/2024/my-first-post`:

- Creates streams: `/blog`, `/blog/posts`, `/blog/posts/2024`
- Creates record: `my-first-post` in the `/blog/posts/2024` stream

## Working with Records

Records are immutable entries within streams. The last path segment is the record name.

**Note**: Parent streams are created automatically when you write the first record, or can be created explicitly (see [Stream Operations](#stream-operations)).

### Create a Stream

Streams form a hierarchy like directories. They are created automatically when you write the first record, or can be created explicitly.

#### CLI

```bash
# Create a public stream (creates /blog and /blog/posts if needed)
podctl stream create my-pod /blog/posts

# Create a private stream
podctl stream create my-pod /private-notes --access private

# Create a stream with custom permissions
podctl stream create my-pod /team-docs --access /team-permissions
```

#### HTTP

```bash
# Create a public stream explicitly (creates parent streams if needed)
curl -X POST https://my-pod.webpods.org/blog/posts \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a private stream explicitly
curl -X POST https://my-pod.webpods.org/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Streams also auto-create when writing first record
curl -X POST https://my-pod.webpods.org/auto-stream/first-record \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This creates the stream automatically"
```

### Write a Record

#### CLI

```bash
# Write text content (stream auto-creates)
podctl record write my-pod /blog/posts first-post "This is my first blog post!"

# Write from file (stream auto-creates)
podctl record write my-pod /data/users alice @user.json

# Write from stdin (stream auto-creates)
echo "Hello, World!" | podctl record write my-pod /messages greeting -

# Write with specific content type (stream auto-creates)
podctl record write my-pod /styles main.css @style.css --content-type text/css

# Write to private stream (specify access on first write)
podctl record write my-pod /private-notes secret "My secret" --access private
```

#### HTTP

```bash
# Write text content (stream auto-creates as public)
curl -X POST https://my-pod.webpods.org/blog/posts/first-post \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This is my first blog post!"

# Write JSON content (stream auto-creates as public)
curl -X POST https://my-pod.webpods.org/data/users/alice \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "Alice", "age": 30}'

# Write to private stream (specify access on first write)
curl -X POST https://my-pod.webpods.org/private-notes/secret?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d "This is private data"
```

### Read a Record

#### CLI

```bash
# Read by name
podctl record read my-pod /blog/posts first-post

# Read by index
podctl record read my-pod /blog/posts --index 0    # First record
podctl record read my-pod /blog/posts --index -1   # Latest record

# Save to file
podctl record read my-pod /blog/posts first-post -o post.txt

# Show metadata
podctl record read my-pod /blog/posts first-post --metadata

# Read without a name (gets latest)
podctl record read my-pod /blog/posts
```

#### HTTP

```bash
# Read by name (returns raw content)
curl https://my-pod.webpods.org/blog/posts/first-post

# Read with metadata in headers
curl -i https://my-pod.webpods.org/blog/posts/first-post

# Read by index
curl https://my-pod.webpods.org/blog/posts?i=0    # First record
curl https://my-pod.webpods.org/blog/posts?i=-1   # Latest record
curl https://my-pod.webpods.org/blog/posts?i=0:10 # Range (0-9)
```

### Delete a Record

WebPods supports two deletion modes:

- **Soft delete** (default): Creates a tombstone record marking deletion
- **Hard delete/purge**: Overwrites the record content with deletion metadata

#### CLI

```bash
# Soft delete a record (creates tombstone)
podctl record delete my-pod /blog/posts old-post

# Hard delete/purge a record (overwrites content)
podctl record delete my-pod /blog/posts old-post --hard
```

#### HTTP

```bash
# Soft delete (creates tombstone record)
curl -X DELETE https://my-pod.webpods.org/blog/posts/old-post \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Hard delete/purge (overwrites content)
curl -X DELETE https://my-pod.webpods.org/blog/posts/old-post?purge=true \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

**Notes**:

- Soft delete creates a new record named `{original-name}.deleted.{timestamp}` with content:
  ```json
  {
    "deleted": true,
    "originalName": "original-record-name",
    "deletedAt": "2024-01-01T00:00:00.000Z",
    "deletedBy": "user-id"
  }
  ```
- Deleted records are excluded from `unique=true` queries by matching the `originalName` field
- Purged records have their content replaced with `{"purged": true, "by": "user-id", "at": "timestamp"}`
- Both deletion types maintain the hash chain integrity

### List Records in a Stream

#### CLI

```bash
# List all records
podctl record list my-pod blog/posts

# With limit (capped at server maximum, typically 1000)
podctl record list my-pod blog/posts --limit 10

# Pagination with positive offset
podctl record list my-pod blog/posts --limit 10 --after 50

# Negative indexing - get last N records
podctl record list my-pod blog/posts --after -20    # Last 20 records
podctl record list my-pod blog/posts --after -5     # Last 5 records

# Get only unique named records (latest version of each)
podctl record list my-pod blog/posts --unique

# List records from nested streams recursively
podctl record list my-pod blog --recursive          # All records in blog/* streams
podctl record list my-pod / --recursive             # All records in all streams

# JSON output
podctl record list my-pod blog/posts --format json
```

#### HTTP

```bash
# List all records
curl https://my-pod.webpods.org/blog/posts

# With pagination (limit is capped at server maximum)
curl https://my-pod.webpods.org/blog/posts?limit=10&after=20

# Negative indexing - get last N records
curl https://my-pod.webpods.org/blog/posts?after=-20    # Last 20 records
curl https://my-pod.webpods.org/blog/posts?after=-5     # Last 5 records

# Get only unique named records (excludes deleted/purged)
curl https://my-pod.webpods.org/blog/posts?unique=true

# List records from nested streams recursively
curl https://my-pod.webpods.org/blog?recursive=true      # All records in blog/* streams
curl https://my-pod.webpods.org/?recursive=true          # All records in all streams
```

### Advanced Query Features

#### Recursive Stream Queries

Query records from all nested streams under a path:

##### CLI

```bash
# List all records in blog/* streams (blog/posts, blog/drafts, etc.)
podctl record list my-pod blog --recursive

# Combine with pagination
podctl record list my-pod blog --recursive --limit 20 --after 10

# Get last 50 records across all nested streams
podctl record list my-pod blog --recursive --after -50
```

##### HTTP

```bash
# List all records in blog/* streams
curl https://my-pod.webpods.org/blog?recursive=true

# With pagination
curl https://my-pod.webpods.org/blog?recursive=true&limit=20&after=10

# Get last 50 records across all nested streams
curl https://my-pod.webpods.org/blog?recursive=true&after=-50
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
podctl record list my-pod config --unique

# Combine with negative indexing
podctl record list my-pod config --unique --after -10  # Last 10 unique records
```

##### HTTP

```bash
# Get latest version of each named record
curl https://my-pod.webpods.org/config?unique=true

# Combine with pagination
curl https://my-pod.webpods.org/config?unique=true&limit=50&after=100
```

#### Query Parameter Combinations

| Parameter   | Compatible With               | Not Compatible With                     |
| ----------- | ----------------------------- | --------------------------------------- |
| `limit`     | All parameters                | -                                       |
| `after`     | All parameters                | -                                       |
| `unique`    | `recursive`, `limit`, `after` | `i`                                     |
| `recursive` | `unique`, `limit`, `after`    | `i`                                     |
| `i` (index) | -                             | `unique`, `recursive`, `limit`, `after` |

## Stream Operations

### Create a Stream

Streams form a hierarchy like directories and are created automatically when you write the first record, or can be created explicitly. When you create `/blog/posts/2024`, the system automatically creates parent streams `/blog` and `/blog/posts` if they don't exist.

#### CLI

```bash
# Create a public stream (default)
podctl stream create my-pod /blog/posts

# Create nested streams
podctl stream create my-pod /projects/webapp/logs
podctl stream create my-pod /teams/engineering/members

# Create a private stream
podctl stream create my-pod /private-notes --access private

# Create a stream with custom permissions
podctl stream create my-pod /members --access /team-permissions
```

#### HTTP

```bash
# Create a public stream explicitly
curl -X POST https://my-pod.webpods.org/blog/posts \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create nested streams
curl -X POST https://my-pod.webpods.org/projects/webapp/logs \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a private stream explicitly
curl -X POST https://my-pod.webpods.org/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create stream with custom permissions
curl -X POST https://my-pod.webpods.org/members?access=/team-permissions \
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
# List all streams in a pod
podctl stream list my-pod

# List streams at a specific path
podctl stream list my-pod --path /blog
```

#### HTTP

```bash
# List all streams
curl https://my-pod.webpods.org/.config/api/streams \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# List streams at a specific path
curl https://my-pod.webpods.org/.config/api/streams?path=/blog \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# List streams recursively with metadata
curl "https://my-pod.webpods.org/.config/api/streams?path=/blog&recursive=true&includeRecordCounts=true" \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Delete a Stream

⚠️ **Warning**: This deletes all records in the stream!

#### CLI

```bash
podctl stream delete my-pod /old-stream --force
```

#### HTTP

```bash
curl -X DELETE https://my-pod.webpods.org/old-stream \
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
podctl stream create my-pod /public-blog

# Create a private stream
podctl stream create my-pod /private-notes --access private

# Create a stream with custom permissions (users in permission stream)
podctl stream create my-pod /team-docs --access /team-permissions
```

#### HTTP

```bash
# Create a private stream explicitly
curl -X POST https://my-pod.webpods.org/private-notes?access=private \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Create a stream with custom permissions
curl -X POST https://my-pod.webpods.org/team-docs?access=/team-permissions \
  -H "Authorization: Bearer $WEBPODS_TOKEN"
```

### Grant Permissions to Users

#### CLI

```bash
# Grant read access
podctl permission grant my-pod /team-permissions user-123 --read

# Grant read and write access
podctl permission grant my-pod /team-permissions user-456 --read --write

# Revoke access
podctl permission revoke my-pod /team-permissions user-789

# List permissions
podctl permission list my-pod /team-permissions
```

#### HTTP

```bash
# Grant read access to a user
curl -X POST https://my-pod.webpods.org/team-permissions/user-123 \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-123", "read": true, "write": false}'

# Revoke access
curl -X POST https://my-pod.webpods.org/team-permissions/user-789 \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "user-789", "read": false, "write": false}'
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
podctl link set my-pod / "blog/posts?i=-1"

# Set /about to show a specific page
podctl link set my-pod /about "pages/about"

# Set /blog to show unique posts
podctl link set my-pod /blog "blog/posts?unique=true&limit=10"

# List all links
podctl link list my-pod

# Remove a link
podctl link remove my-pod /old-page
```

#### HTTP

```bash
# Set up multiple routes at once
curl -X POST https://my-pod.webpods.org/.config/routing/routes \
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
podctl record write my-pod homepage index "Welcome to my blog!" --content-type text/html

# 2. Create blog posts (stream auto-creates)
podctl record write my-pod blog/posts first "My first post"
podctl record write my-pod blog/posts second "Another post"

# 3. Set up routing
podctl link set my-pod / "homepage/index"           # Homepage
podctl link set my-pod /posts "blog/posts?unique=true"  # All posts
podctl link set my-pod /latest "blog/posts?i=-1"        # Latest post

# Now visitors can access:
# https://my-pod.webpods.org/          -> Shows homepage
# https://my-pod.webpods.org/posts     -> Lists all posts
# https://my-pod.webpods.org/latest    -> Shows most recent post
```

## File Synchronization

WebPods provides powerful commands to synchronize files between your local filesystem and streams, making it easy to manage content at scale.

### Sync Local Directory to Stream

The `sync` command makes a stream equivalent to your local directory by uploading new/changed files and removing files that no longer exist locally.

```bash
# Sync a local website directory to a stream
podctl stream sync my-pod website ./my-website

# Sync with verbose output to see what's happening
podctl stream sync my-pod docs ./documentation --verbose

# Preview changes without making them (dry run)
podctl stream sync my-pod content ./content --dry-run
```

**Features:**

- **Automatic content-type detection** based on file extensions
- **Incremental sync** - only uploads changed files (SHA-256 hash comparison)
- **File cleanup** - removes records for files that no longer exist locally
- **Safe filename mapping** - converts filenames to valid record names
- **Dry run mode** for previewing changes

### Download Stream to Local Directory

The `download` command retrieves all records from a stream and saves them as files locally.

```bash
# Download a stream to a local directory
podctl stream download my-pod website ./downloaded-site

# Download with verbose output
podctl stream download my-pod docs ./local-docs --verbose

# Overwrite existing files
podctl stream download my-pod backup ./restore --overwrite
```

**Features:**

- **Recursive download** - gets all records from the stream
- **Directory creation** - automatically creates the target directory
- **Filename sanitization** - ensures downloaded filenames are filesystem-safe
- **Overwrite protection** - won't replace existing files unless `--overwrite` is used

### Use Cases

**Website Deployment:**

```bash
# Upload your static site
podctl stream sync my-pod website ./dist

# Set up routing to serve it
podctl link set my-pod / "website?unique=true"
```

**Documentation Management:**

```bash
# Sync documentation files
podctl stream sync my-pod docs ./markdown-docs

# Download for local editing
podctl stream download my-pod docs ./local-edit
```

**Content Backup:**

```bash
# Backup content locally
podctl stream download my-pod content ./backup-$(date +%Y%m%d)
```

## Custom Domains

You can map custom domains to your pods.

### Setting a Custom Domain

#### CLI

```bash
# Add a custom domain
podctl domain add my-pod blog.example.com

# List domains for a pod
podctl domain list my-pod

# Remove a custom domain
podctl domain remove my-pod blog.example.com
```

#### HTTP

```bash
# Add custom domain
curl -X POST https://my-pod.webpods.org/.config/domains/custom \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"domain": "blog.example.com"}'
```

### DNS Configuration

After adding a custom domain, configure your DNS:

```
# CNAME record (recommended)
blog.example.com. CNAME my-pod.webpods.org.

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
podctl login
DEVELOPER_TOKEN=$(podctl token get)
```

Register your OAuth client:

#### CLI

```bash
podctl oauth register "My Awesome App" \
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
const response = await fetch("https://alice.webpods.org/data/info", {
  headers: {
    Authorization: "Bearer " + accessToken,
  },
});

// Write to a pod
const writeResponse = await fetch("https://alice.webpods.org/app-data/record", {
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
podctl oauth list

# Get details of a specific client
podctl oauth info my-awesome-app-a1b2c3d4

# Delete a client
podctl oauth delete my-awesome-app-a1b2c3d4
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
podctl oauth register "My SPA" \
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
podctl record write my-pod images logo @logo.png --content-type image/png

# Upload a PDF (stream auto-creates)
podctl record write my-pod docs manual @manual.pdf --content-type application/pdf

# Download binary content
podctl record read my-pod images logo -o downloaded-logo.png
```

#### HTTP

```bash
# Upload an image (must be base64 encoded)
IMAGE_BASE64=$(base64 -w 0 < image.png)
curl -X POST https://my-pod.webpods.org/images/logo \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "X-Content-Type: image/png" \
  -d "$IMAGE_BASE64"

# Images are automatically decoded when served
curl https://my-pod.webpods.org/images/logo > logo.png
```

#### External Storage for Large Media Files

WebPods supports storing large media files externally to optimize database performance and reduce storage costs. When external storage is enabled and configured, files exceeding a size threshold can be stored on the filesystem or cloud storage instead of the database.

##### Enabling External Storage

To store a file externally, include the `X-Record-Type: file` header when uploading:

```bash
# Upload a large image to external storage
IMAGE_BASE64=$(base64 -w 0 < large-photo.jpg)
curl -X POST https://my-pod.webpods.org/photos/vacation \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "X-Content-Type: image/jpeg" \
  -H "X-Record-Type: file" \
  -d "$IMAGE_BASE64"
```

##### How External Storage Works

- Files are stored externally only when both conditions are met:
  1. The `X-Record-Type: file` header is present
  2. The file size exceeds the configured minimum threshold (default: 1KB)
- Externally stored files are served via HTTP 302 redirects to the configured storage URL
- The database stores only metadata and a reference to the external location
- Files are stored in two locations for efficient serving:
  - A hash-based path for deduplication (`.storage/[hash].[ext]`)
  - A name-based path for direct serving (`[recordName].[ext]`)

##### Configuration

External storage is configured in `config.json`:

```json
{
  "media": {
    "externalStorage": {
      "enabled": true,
      "minSize": "10kb",
      "adapter": "filesystem",
      "filesystem": {
        "basePath": "/var/webpods/media",
        "baseUrl": "https://static.example.com"
      }
    }
  }
}
```

##### Deletion Behavior

- **Soft delete** (default): Removes only the name-based file, keeping the hash-based file for deduplication
- **Hard delete** (purge): Removes both name-based and hash-based files completely

### Serving Web Content

WebPods can serve as a static website host:

```bash
# Upload HTML (stream auto-creates)
podctl record write my-pod / index.html @index.html --content-type text/html

# Upload CSS (stream auto-creates)
podctl record write my-pod css styles.css @styles.css --content-type text/css

# Upload JavaScript (stream auto-creates)
podctl record write my-pod js app.js @app.js --content-type application/javascript

# Upload images (stream auto-creates)
podctl record write my-pod img hero.jpg @hero.jpg --content-type image/jpeg

# Set up routing
podctl link set my-pod / "index.html"
podctl link set my-pod /style.css "css/styles.css"

# Your site is live at https://my-pod.webpods.org/
```

### Schema Validation

WebPods supports JSON Schema validation for stream records to ensure data quality and consistency.

#### Enable Schema Validation

##### CLI

```bash
# Create a JSON schema file
echo '{
  "type": "object",
  "required": ["name", "email"],
  "properties": {
    "name": {"type": "string"},
    "email": {"type": "string", "format": "email"}
  }
}' > user-schema.json

# Enable schema validation for a stream
podctl schema enable my-pod /users user-schema.json

# Enable with specific validation mode
podctl schema enable my-pod /products schema.json --mode permissive

# Enable validation for full record (including metadata)
podctl schema enable my-pod /logs schema.json --applies-to full-record

# Disable schema validation
podctl schema disable my-pod /users
```

##### HTTP

```bash
# Enable schema validation via API
curl -X POST https://my-pod.webpods.org/users/.config/schema \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "schemaType": "json-schema",
    "schema": {
      "type": "object",
      "required": ["name", "email"],
      "properties": {
        "name": {"type": "string"},
        "email": {"type": "string", "format": "email"}
      }
    },
    "validationMode": "strict",
    "appliesTo": "content"
  }'

# Disable schema validation
curl -X POST https://my-pod.webpods.org/users/.config/schema \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"schemaType": "none"}'
```

#### Validation Modes

- **strict** (default): Reject records that don't match the schema
- **permissive**: Allow records that don't match, but log validation errors

#### Schema Storage

- Schemas are stored in the stream's `.config/schema` record
- The `has_schema` column provides fast lookup for validation requirements
- Multiple schema versions can be stored with different record names

### Hash Chain Verification

Every record has a SHA-256 hash and links to the previous record:

#### CLI

```bash
# View hash chain
podctl record verify my-pod /stream-name --show-chain

# Verify integrity
podctl record verify my-pod /stream-name --check-integrity
```

#### HTTP

```bash
# Headers include hash information
curl -i https://my-pod.webpods.org/verified/data
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
podctl pod info my-pod --owner

# Transfer ownership (CLI)
# WARNING: You will lose all access to this pod after transfer
# Note: The new user ID must exist in the system
podctl pod transfer my-pod new-user-id --force

# Transfer ownership (HTTP)
curl -X POST https://my-pod.webpods.org/.config/owner \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"userId": "new-user-id"}'
```

#### .config/api/streams

```bash
# List all streams
podctl stream list my-pod

# Via HTTP
curl https://my-pod.webpods.org/.config/api/streams
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
podctl limit info

# Check specific action
podctl limit info --action write
```

#### HTTP

```bash
# Rate limit info is in response headers
curl -i https://my-pod.webpods.org/test \
  -H "Authorization: Bearer $WEBPODS_TOKEN"

# Headers:
# X-RateLimit-Limit: 1000
# X-RateLimit-Remaining: 999
# X-RateLimit-Reset: 1735689600
```

### Backup and Export

#### CLI

```bash
# Verify stream integrity (check hash chain)
podctl record verify my-pod /stream-name
podctl record verify my-pod /stream-name --show-chain
podctl record verify my-pod /stream-name --check-integrity

# Grant/revoke permissions
podctl permission grant my-pod /permission-stream user-id --read
podctl permission grant my-pod /permission-stream user-id --write
podctl permission grant my-pod /permission-stream user-id --read --write
podctl permission revoke my-pod /permission-stream user-id

# Manage links (URL routing)
podctl link set my-pod /about /blog/about-page
podctl link list my-pod
podctl link remove my-pod /about

# Manage custom domains
podctl domain add my-pod example.com
podctl domain list my-pod
podctl domain remove my-pod example.com
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
  },
  "media": {
    "externalStorage": {
      "enabled": false,
      "minSize": "10kb",
      "adapter": "filesystem",
      "filesystem": {
        "basePath": "/var/webpods/media",
        "baseUrl": "https://static.example.com"
      }
    }
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
cd node/packages/podctl-tests && npm test

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
- `DELETE https://{pod}.webpods.org/` - Delete pod

### Streams

- `POST https://{pod}.webpods.org/{stream}?access={mode}` - Create a stream explicitly (or auto-create on first write)
- `DELETE https://{pod}.webpods.org/{stream}` - Delete stream
- `GET https://{pod}.webpods.org/.config/api/streams` - List all streams

### Records

- `POST https://{pod}.webpods.org/{stream}/{name}` - Write record
- `GET https://{pod}.webpods.org/{stream}/{name}` - Read record
- `GET https://{pod}.webpods.org/{stream}` - List records

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

- `podctl login` - Show available OAuth providers (alias for `podctl auth login`)
- `podctl logout` - Clear authentication (alias for `podctl auth logout`)
- `podctl auth login` - Show available OAuth providers
- `podctl auth logout` - Clear stored authentication token
- `podctl auth info` - Show current user info
- `podctl token set <token>` - Set authentication token
- `podctl token show` - Display current token

### Pod Management

- `podctl pod create <name>` - Create a new pod
- `podctl pod list` - List your pods
- `podctl pod info <pod>` - Show pod details
- `podctl pod delete <pod> [--force]` - Delete a pod
- `podctl pod transfer <pod> <user-id> --force` - Transfer pod ownership

### Records

- `podctl record write <pod> <stream> <name> [data]` - Write a record
- `podctl record read <pod> <stream> [name]` - Read a record
- `podctl record list <pod> <stream>` - List records in a stream
- `podctl record delete <pod> <stream> <name> [--hard]` - Delete a record
- `podctl record verify <pod> <stream>` - Verify hash chain integrity

### Streams

- `podctl stream create <pod> <stream> [--access <mode>]` - Create a stream
- `podctl stream list <pod>` - List all streams
- `podctl stream delete <pod> <stream> --force` - Delete a stream
- `podctl stream sync <pod> <stream> <local-path>` - Sync local directory to stream
- `podctl stream download <pod> <stream> <local-path>` - Download stream records to local directory

### Permissions

- `podctl permission grant <pod> <stream> <user> [--read] [--write]` - Grant permissions
- `podctl permission revoke <pod> <stream> <user>` - Revoke permissions
- `podctl permission list <pod> <stream>` - List permissions for a stream

### Links & Domains

- `podctl link set <pod> <path> <stream/record>` - Set a link
- `podctl link list <pod>` - List all links
- `podctl link remove <pod> <path>` - Remove a link
- `podctl domain add <pod> <domain>` - Add custom domain
- `podctl domain list <pod>` - List domains
- `podctl domain remove <pod> <domain>` - Remove domain

### Schema Validation

- `podctl schema enable <pod> <stream> <file>` - Enable schema validation
- `podctl schema disable <pod> <stream>` - Disable schema validation

### Rate Limits

- `podctl limit info` - Check current rate limit status
- `podctl limit info --action <action>` - Check specific action limits

### OAuth Client Management

- `podctl oauth register` - Register a new OAuth client
- `podctl oauth list` - List your OAuth clients
- `podctl oauth info <clientId>` - Show OAuth client details
- `podctl oauth delete <clientId>` - Delete an OAuth client

### Profile Management

- `podctl profile add <name> --server <url>` - Add server profile
- `podctl profile list` - List profiles
- `podctl profile use <name>` - Switch profile
- `podctl profile delete <name> --force` - Delete profile
- `podctl profile current` - Show current profile

### Configuration

- `podctl config [key] [value]` - Show or set configuration values
- `podctl --help` - Show help
- `podctl <command> --help` - Show command help

## Documentation

- [API Reference](docs/api.md) - Complete API documentation
- [CLI Reference](node/packages/podctl/README.md) - Detailed CLI commands
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
