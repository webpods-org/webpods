# Quick Start Guide

Get up and running with WebPods in 5 minutes.

## Table of Contents

1. [Installation](#installation)
2. [Authentication](#authentication)
3. [Create Your First Pod](#create-your-first-pod)
4. [Working with Records](#working-with-records)
5. [Understanding Streams](#understanding-streams)
6. [Next Steps](#next-steps)

## Installation

### CLI Installation

The fastest way to get started is with the WebPods CLI:

```bash
# Install globally
npm install -g @webpods/podctl

# Verify installation
podctl --version
```

### Server Setup (Optional)

For local development, you can run your own WebPods server:

#### Using Docker (Recommended)

```bash
# Quick start with Docker
docker run -d \
  --name webpods \
  -p 3000:3000 \
  -e JWT_SECRET=your-secret-key \
  -e SESSION_SECRET=your-session-secret \
  -v webpods-data:/app/data \
  webpods/webpods
```

#### From Source

```bash
# Clone and build
git clone https://github.com/webpods-org/webpods
cd webpods
cp config.example.json config.json
# Edit config.json with your settings

./scripts/build.sh
npm run migrate:latest
./scripts/start.sh
```

## Authentication

### Step 1: Configure Your Server

By default, the CLI connects to `http://localhost:3000`. To use a different server:

```bash
# Use webpods.org (public instance)
podctl profile add prod --server https://webpods.org
podctl profile use prod

# Or use your own server
podctl profile add local --server http://localhost:3000
podctl profile use local
```

### Step 2: Login

```bash
# Start login process
podctl auth login

# This will show available OAuth providers and a login URL like:
# Available providers: github, google, microsoft, gitlab
# Login URL: http://localhost:3000/auth/github
```

### Step 3: Get Your Token

1. Visit the login URL in your browser
2. Authenticate with your chosen provider (GitHub, Google, etc.)
3. Copy the JWT token from the success page
4. Set it in the CLI:

```bash
podctl auth token set "your-jwt-token-here"
```

### Step 4: Verify Authentication

```bash
# Check if you're logged in
podctl auth info

# Should show:
# User ID: github:12345
# Username: yourusername
# Server: https://webpods.org
```

## Create Your First Pod

Pods are your personal namespaces (subdomains). Each pod is like having your own website:

```bash
# Create a pod (must be lowercase, hyphens only)
podctl pod create my-first-pod

# Your pod is now live at:
# https://my-first-pod.webpods.org (or localhost:3000 for local)

# List your pods
podctl pod list
```

## Working with Records

Records are immutable data entries in streams. Let's create some data:

### Write Your First Record

```bash
# Write a simple text record
podctl record write my-first-pod /notes welcome "Hello, WebPods!"

# Write JSON data
podctl record write my-first-pod /api/users alice '{
  "name": "Alice Smith",
  "email": "alice@example.com",
  "role": "admin"
}'
```

### Read Records

```bash
# Read a specific record
podctl record read my-first-pod /notes welcome

# Or via HTTP (works in browser too!)
curl https://my-first-pod.webpods.org/notes/welcome
```

### List Records in a Stream

```bash
# List all records in /notes
podctl record list my-first-pod /notes

# List with more details
podctl record list my-first-pod /notes --format json
```

## Understanding Streams

Streams are hierarchical paths that organize your data, like folders in a file system:

### Creating Stream Hierarchy

```bash
# Write to nested streams (parent streams are created automatically)
podctl record write my-first-pod /blog/posts/2024 first-post '{
  "title": "My First Post",
  "content": "This is my first blog post using WebPods!",
  "published": true
}'

podctl record write my-first-pod /blog/posts/2024 second-post '{
  "title": "How WebPods Works",
  "content": "WebPods uses immutable records...",
  "published": false
}'

# Write to different stream levels
podctl record write my-first-pod /blog metadata '{
  "title": "My Blog",
  "description": "A blog powered by WebPods"
}'
```

### Exploring Stream Hierarchy

```bash
# List records at different levels
podctl record list my-first-pod /blog              # Blog metadata
podctl record list my-first-pod /blog/posts        # All posts
podctl record list my-first-pod /blog/posts/2024   # Posts from 2024

# Your data structure looks like:
# /blog
#   metadata
# /blog/posts
# /blog/posts/2024
#   first-post
#   second-post
```

### Advanced Queries

```bash
# Get latest 10 records
podctl record list my-first-pod /blog/posts/2024 --limit 10

# Get only latest version of each named record
podctl record list my-first-pod /blog/posts/2024 --unique

# Get last 5 records (negative indexing)
curl "https://my-first-pod.webpods.org/blog/posts/2024?after=-5"
```

## Working with Different Data Types

### Text Files

```bash
# Upload a text file
podctl record write my-first-pod /documents readme.txt "$(cat README.txt)"

# Or pipe content
echo "My note content" | podctl record write my-first-pod /notes today -
```

### Binary Files

```bash
# Upload images, PDFs, etc.
podctl record write my-first-pod /images logo.png --file logo.png
podctl record write my-first-pod /documents manual.pdf --file manual.pdf
```

### JSON APIs

```bash
# Create API-like endpoints
podctl record write my-first-pod /api/config app '{
  "name": "My App",
  "version": "1.0.0",
  "features": ["auth", "storage", "api"]
}'

# Access via HTTP
curl https://my-first-pod.webpods.org/api/config/app
```

## Stream Permissions

By default, streams are private. You can make them public or set custom permissions:

```bash
# Create a public stream
podctl stream create my-first-pod /public --access public

# Write to public stream
podctl record write my-first-pod /public announcement "Welcome to my pod!"

# Anyone can read public streams (no auth required)
curl https://my-first-pod.webpods.org/public/announcement
```

## Data Integrity

WebPods maintains hash chains for data integrity:

```bash
# Verify stream integrity
podctl record verify my-first-pod /blog/posts/2024

# View record with hash information
curl -H "Accept: application/json" https://my-first-pod.webpods.org/blog/posts/2024/first-post
```

## Next Steps

Now that you have the basics, explore more advanced features:

### Learn More

- [Full Documentation](README.md) - Complete feature reference
- [API Reference](api.md) - HTTP API documentation
- [Examples](examples.md) - Real-world use cases

### Build Something

- **Blog**: Use `/posts` streams for blog entries
- **API**: Create JSON endpoints with `/api` streams
- **File Storage**: Upload files to organized streams
- **Activity Log**: Store events in timestamped records

### Advanced Features

- **Custom Domains**: Point your domain to your pod
- **OAuth Apps**: Build applications that use WebPods
- **Stream Sync**: Sync local directories with streams
- **Webhooks**: Get notified of new records

### Common Patterns

```bash
# Configuration management
podctl record write my-pod /.config app-settings '{...}'

# Timestamped logs
podctl record write my-pod /logs "$(date +%s)" "User alice logged in"

# Versioned content
podctl record write my-pod /content page1 "Version 1"
podctl record write my-pod /content page1 "Version 2" # New version, old kept

# Hierarchical organization
podctl record write my-pod /projects/website/tasks "design" '{...}'
podctl record write my-pod /projects/api/tasks "auth" '{...}'
```

You're now ready to build with WebPods! 🚀
