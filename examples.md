# Examples

Real-world use cases and code samples for WebPods.

## Blog Platform

Build a static blog using WebPods as your data store.

### Features
- Append-only blog posts
- Categories and tags
- Comments system
- RSS feed generation

### Implementation

```bash
# Create your blog pod
podctl pod create my-blog

# Write blog posts
podctl record write my-blog /posts/2024 "welcome" '{
  "title": "Welcome to My Blog",
  "content": "This is my first post on WebPods!",
  "tags": ["webpods", "blog", "first-post"],
  "published_at": "2024-01-15T10:30:00Z"
}'

podctl record write my-blog /posts/2024 "second-post" '{
  "title": "How WebPods Works", 
  "content": "WebPods organizes data into pods and streams...",
  "tags": ["webpods", "technical"],
  "published_at": "2024-01-16T14:20:00Z"
}'

# Add categories
podctl record write my-blog /categories "webpods" '{
  "name": "WebPods",
  "description": "Posts about WebPods technology"
}'

# Enable comments (public stream)
podctl stream create my-blog /comments/welcome --access public
podctl record write my-blog /comments/welcome "comment-1" '{
  "author": "Alice",
  "content": "Great first post!",
  "timestamp": "2024-01-15T12:00:00Z"
}'
```

### Reading Blog Data

```bash
# Get all posts (latest first)
curl https://my-blog.webpods.org/posts/2024?after=-10

# Get specific post
curl https://my-blog.webpods.org/posts/2024/welcome

# Get comments for a post
curl https://my-blog.webpods.org/comments/welcome

# Generate RSS feed (custom endpoint)
curl https://my-blog.webpods.org/.config/rss
```

### Frontend Integration

```javascript
// Fetch blog posts
async function loadBlogPosts() {
  const response = await fetch('https://my-blog.webpods.org/posts/2024?after=-10');
  const data = await response.json();
  return data.records.map(record => ({
    id: record.name,
    ...JSON.parse(record.content),
    timestamp: record.timestamp
  }));
}

// Fetch single post
async function loadPost(postId) {
  const response = await fetch(`https://my-blog.webpods.org/posts/2024/${postId}`);
  return await response.json();
}
```

## REST API Backend

Use WebPods streams as a backend for your application.

### User Management API

```bash
# Create API pod
podctl pod create my-api

# Store user profiles
podctl record write my-api /users "alice" '{
  "id": "alice",
  "name": "Alice Smith",
  "email": "alice@example.com",
  "role": "admin",
  "created_at": "2024-01-15T10:30:00Z"
}'

podctl record write my-api /users "bob" '{
  "id": "bob", 
  "name": "Bob Johnson",
  "email": "bob@example.com", 
  "role": "user",
  "created_at": "2024-01-15T11:00:00Z"
}'

# Activity log
podctl record write my-api /activity "$(date +%s)" '{
  "user_id": "alice",
  "action": "login", 
  "timestamp": "2024-01-15T10:30:00Z",
  "ip_address": "192.168.1.100"
}'
```

### API Endpoints

```javascript
// Express.js integration
const express = require('express');
const app = express();

// Get user profile
app.get('/api/users/:id', async (req, res) => {
  try {
    const response = await fetch(`https://my-api.webpods.org/users/${req.params.id}`);
    if (!response.ok) {
      return res.status(404).json({ error: 'User not found' });
    }
    const user = await response.json();
    res.json(user);
  } catch (error) {
    res.status(500).json({ error: 'Internal server error' });
  }
});

// List all users
app.get('/api/users', async (req, res) => {
  const response = await fetch('https://my-api.webpods.org/users?unique=true');
  const data = await response.json();
  const users = data.records.map(record => JSON.parse(record.content));
  res.json(users);
});

// Activity log
app.get('/api/activity', async (req, res) => {
  const limit = req.query.limit || 50;
  const response = await fetch(`https://my-api.webpods.org/activity?after=-${limit}`);
  const data = await response.json();
  const activities = data.records.map(record => JSON.parse(record.content));
  res.json(activities);
});
```

## Static Website Hosting

Host your static website with automatic SSL and custom domains.

### File Upload

```bash
# Create website pod
podctl pod create my-site

# Upload HTML files
podctl record write my-site /public "index.html" "$(cat index.html)"
podctl record write my-site /public "about.html" "$(cat about.html)"
podctl record write my-site /public "contact.html" "$(cat contact.html)"

# Upload CSS and assets
podctl record write my-site /public/css "styles.css" "$(cat styles.css)"
podctl record write my-site /public/js "app.js" "$(cat app.js)"
podctl record write my-site /public/images "logo.png" --file logo.png
```

### Custom Routing

```bash
# Set up URL routing
podctl record write my-site /.config "routes" '{
  "/": "/public/index.html",
  "/about": "/public/about.html", 
  "/contact": "/public/contact.html",
  "/blog/*": "/public/blog.html"
}'

# Set up redirects
podctl record write my-site /.config "redirects" '{
  "/old-page": "/new-page",
  "/blog/old-post": "/blog/new-post"
}'
```

### Access Your Site

```bash
# Your site is live at:
curl https://my-site.webpods.org/

# Custom domain (after DNS setup)
curl https://www.mysite.com/
```

## File Synchronization

Sync local directories with WebPods streams.

### Basic Sync

```bash
# Sync local directory to WebPods
podctl stream sync my-pod /documents ./local-docs/

# Watch for changes and auto-sync
podctl stream sync my-pod /documents ./local-docs/ --watch

# Sync down from WebPods to local
podctl stream sync my-pod /documents ./local-docs/ --download
```

### Selective Sync

```bash
# Sync only specific file types
podctl stream sync my-pod /documents ./docs/ --include "*.md,*.txt"

# Exclude certain files
podctl stream sync my-pod /documents ./docs/ --exclude "*.tmp,*.log"

# Sync with conflict resolution
podctl stream sync my-pod /documents ./docs/ --conflict-resolution newest
```

## Real-time Applications

Build real-time apps using WebPods as an event log.

### Chat Application

```bash
# Create chat room
podctl pod create chat-room

# Send messages
podctl record write chat-room /messages "$(date +%s)" '{
  "user": "alice",
  "message": "Hello everyone!",
  "timestamp": "2024-01-15T10:30:00Z"
}'

# Get recent messages
curl "https://chat-room.webpods.org/messages?after=-50"
```

### Live Updates with Server-Sent Events

```javascript
// Frontend: Listen for new messages
const eventSource = new EventSource('https://chat-room.webpods.org/messages/events');

eventSource.onmessage = function(event) {
  const message = JSON.parse(event.data);
  displayMessage(message);
};

// Backend: Stream new messages
app.get('/messages/events', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'Access-Control-Allow-Origin': '*'
  });
  
  // Poll for new messages and send as SSE
  setInterval(async () => {
    const response = await fetch('https://chat-room.webpods.org/messages?after=-1');
    const data = await response.json();
    if (data.records.length > 0) {
      res.write(`data: ${JSON.stringify(data.records[0])}\n\n`);
    }
  }, 1000);
});
```

## Data Analytics

Use WebPods for storing and analyzing event data.

### Event Tracking

```bash
# Track user events
podctl record write analytics /events "$(date +%s)" '{
  "event": "page_view",
  "page": "/home",
  "user_id": "alice", 
  "timestamp": "2024-01-15T10:30:00Z",
  "properties": {
    "referrer": "https://google.com",
    "user_agent": "Mozilla/5.0..."
  }
}'

# Track conversions
podctl record write analytics /events "$(date +%s)" '{
  "event": "purchase",
  "user_id": "alice",
  "timestamp": "2024-01-15T10:45:00Z", 
  "properties": {
    "product_id": "widget-123",
    "amount": 29.99,
    "currency": "USD"
  }
}'
```

### Analytics Queries

```bash
# Get all events for analysis
curl "https://analytics.webpods.org/events" > events.json

# Filter by event type (client-side filtering)
curl "https://analytics.webpods.org/events" | jq '.records[] | select(.content | fromjson | .event == "purchase")'

# Get recent events
curl "https://analytics.webpods.org/events?after=-1000&limit=100"
```

## Content Management System

Build a flexible CMS using WebPods.

### Content Structure

```bash
# Create CMS pod
podctl pod create my-cms

# Store pages
podctl record write my-cms /pages "home" '{
  "title": "Welcome to Our Site",
  "slug": "home",
  "content": "Welcome to our website...",
  "status": "published",
  "author": "alice",
  "created_at": "2024-01-15T10:30:00Z",
  "updated_at": "2024-01-15T10:30:00Z"
}'

# Store blog posts
podctl record write my-cms /blog "first-post" '{
  "title": "Our First Blog Post",
  "slug": "first-post", 
  "content": "This is our first blog post...",
  "excerpt": "This is our first blog post",
  "status": "published",
  "author": "alice",
  "tags": ["news", "updates"],
  "featured_image": "/images/first-post.jpg",
  "created_at": "2024-01-15T10:30:00Z"
}'

# Store media files
podctl record write my-cms /media "hero-image.jpg" --file hero-image.jpg
```

### Content API

```javascript
// Get published pages
app.get('/api/pages', async (req, res) => {
  const response = await fetch('https://my-cms.webpods.org/pages?unique=true');
  const data = await response.json();
  const pages = data.records
    .map(record => JSON.parse(record.content))
    .filter(page => page.status === 'published');
  res.json(pages);
});

// Get specific page
app.get('/api/pages/:slug', async (req, res) => {
  const response = await fetch(`https://my-cms.webpods.org/pages/${req.params.slug}`);
  if (!response.ok) {
    return res.status(404).json({ error: 'Page not found' });
  }
  const page = await response.json();
  res.json(page);
});
```

These examples show how WebPods can be used for various applications while maintaining data immutability and leveraging the hierarchical stream structure.