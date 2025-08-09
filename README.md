# WebPods

Append-only log service with OAuth authentication. Users can write strings or JSON to named queues and read them back.

## Quick Start

### Prerequisites
- Node.js 22+
- PostgreSQL 16+
- Google OAuth credentials

### Local Development

```bash
# Clone and setup
git clone https://github.com/webpods-org/webpods.git
cd webpods

# Start PostgreSQL
cd devenv
./run.sh up
cd ..

# Configure environment
cp .env.example .env
# Edit .env with your Google OAuth credentials

# Build and migrate
./build.sh --migrate

# Start server
./start.sh
```

Server runs at `http://localhost:3000`

## API Overview

### Authentication
```http
GET /auth/google                     # Initiate OAuth
GET /auth/google/callback            # OAuth callback (returns JWT)
GET /auth/me                         # Get current user
```

### Queue Operations
```http
POST /q/{queue_id}                   # Write to queue
  ?read=public|auth|owner            # Set read permission
  ?write=auth|owner                  # Set write permission

GET /q/{queue_id}                    # Read from queue
  ?limit=100&after=50                # Pagination

GET /q/{queue_id}/{index}            # Get single record

DELETE /q/{queue_id}                 # Delete queue (owner only)

HEAD /q/{queue_id}                   # Get queue metadata
```

### Health Check
```http
GET /health                          # Service health
```

## Permissions

- `public` - Anyone can read
- `auth` - Any authenticated user can access
- `owner` - Only the queue creator can access

## Rate Limits

- Write: 2000 requests/hour per user
- Read: 10000 requests/hour per user

## Configuration

Required environment variables:
- `JWT_SECRET` - Secret for JWT signing (production)
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `WEBPODS_DB_PASSWORD` - Database password (production)

See `.env.example` for all options.

## Docker Deployment

```bash
# Build and run
docker build -t webpods .
docker compose up -d

# With environment file
docker run -d \
  --name webpods \
  --env-file .env.production \
  -p 3000:3000 \
  webpods
```

## Example Usage

### JavaScript/TypeScript
```javascript
// Authenticate
const response = await fetch('http://localhost:3000/auth/google');
// Follow OAuth flow to get JWT token

// Write to queue
await fetch('http://localhost:3000/q/my-queue', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({ message: 'Hello, World!' })
});

// Read from queue
const data = await fetch('http://localhost:3000/q/my-queue', {
  headers: { 'Authorization': `Bearer ${token}` }
}).then(r => r.json());
```

### cURL
```bash
# Write to queue
curl -X POST http://localhost:3000/q/my-queue \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"message": "Hello, World!"}'

# Read from queue
curl http://localhost:3000/q/my-queue \
  -H "Authorization: Bearer $TOKEN"
```

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URIs:
   - Development: `http://localhost:3000/auth/google/callback`
   - Production: `https://your-domain.com/auth/google/callback`

## License

MIT