# WebPods

A simple, secure platform for storing immutable data with cryptographic verification.

HTTP-based append-only logs using subdomains (pods) and paths (streams). Build append-only logs, content-addressable storage, and versioned data systems using HTTP and subdomains.

## What is WebPods?

WebPods organizes data into:

- **Pods**: Subdomains that act as namespaces (e.g., `alice.webpods.org`)
- **Streams**: Hierarchical append-only logs within pods (e.g., `/blog`, `/blog/posts`, `/blog/posts/2024`)
- **Records**: Immutable entries within streams, with SHA-256 hash chains

> **Important**: Throughout this documentation, `webpods.org` is used as an example domain. When you deploy WebPods, replace it with your actual server domain (e.g., `data.mycompany.com`, `pods.example.net`, or `localhost:3000` for local development). Each WebPods deployment is completely independent.

## Quick Start

```bash
# First, authenticate to get your token
podctl auth login
podctl auth token set "your-jwt-token"

# Create your pod (namespace)
podctl pod create alice

# Write immutable records
podctl record write alice /blog/posts first "My first blog post!"

# Read via CLI or HTTP
podctl record read alice /blog/posts first
curl https://alice.webpods.org/blog/posts/first
```

## Core Concepts

### 🌐 Pods
Subdomains as namespaces. Each pod like `alice.webpods.org` is owned by a user and contains streams of data.

### 📝 Streams
Hierarchical append-only logs. Organize data with paths like `/blog/posts/2024` that maintain immutable records.

### 🔗 Records
Immutable entries with SHA-256 hash chains. Each record links to the previous one, ensuring data integrity.

### 🔐 Permissions
Flexible access control. Streams can be public, private, or use custom permission lists.

### 🔑 OAuth
Multiple authentication providers. Support for GitHub, Google, GitLab, Microsoft, and custom OAuth.

### 🚀 CLI & API
Full-featured CLI tool and REST API. Manage pods, streams, and records programmatically.

## How It Works

### Step 1: Authenticate
Login with your preferred OAuth provider (GitHub, Google, etc.) to get a JWT token for API access.

```bash
# Login opens browser for OAuth
podctl auth login

# After browser auth, set your token
podctl auth token set "your-jwt-token"

# Verify authentication
podctl auth info
```

### Step 2: Create a Pod
Claim your unique subdomain namespace. Pod names must be lowercase with hyphens only.

```bash
# Create your pod
podctl pod create my-pod

# Your pod is now live at:
# https://my-pod.webpods.org
```

### Step 3: Write Records
Add data to streams. Streams and parent paths are created automatically when you write.

```bash
# Write JSON data
podctl record write my-pod /api/users alice \
  '{"name": "Alice", "role": "admin"}'

# Write plain text
podctl record write my-pod /notes today \
  "Remember to update the docs"
```

### Step 4: Read Data
Access your data via HTTP or CLI. Public streams don't require authentication to read.

```bash
# Via HTTP (works in browser too)
curl https://my-pod.webpods.org/api/users/alice

# Via CLI
podctl record read my-pod /api/users alice

# List all records in a stream
podctl record list my-pod /api/users
```

## Key Features

### Hierarchical Streams
Organize data with nested paths like filesystems. Parent streams are created automatically.

```
/blog
├── /blog/posts
│   ├── /blog/posts/2024
│   └── /blog/posts/drafts
└── /blog/comments
```

### Hash Chain Integrity
Every record contains a SHA-256 hash linking to the previous record, creating an immutable chain.

```json
{
  "index": 42,
  "hash": "sha256:abc123...",
  "previous_hash": "sha256:def456...",
  "content": "Your data here"
}
```

### Flexible Queries
Multiple ways to access your data with powerful query parameters:

- List records: `GET /stream`
- Pagination: `?after=10&limit=20`
- Unique records: `?unique=true` 
- Range queries: `?after=5&before=15`
- Negative indexing: `?after=-10` (last 10 records)

## Table of Contents

- [Installation](quickstart.md#installation)
- [Authentication](quickstart.md#authentication)
- [Pod Management](quickstart.md#pod-management)
- [API Reference](api.md)
- [Examples](examples.md)
- [Deployment](deployment.md)

## Installation

### CLI Installation

```bash
# Install the WebPods CLI globally
npm install -g @webpods/podctl

# Verify installation
podctl --version
```

**Full-Featured CLI Available**: Complete command-line interface for all WebPods operations.

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