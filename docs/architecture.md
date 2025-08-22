# Architecture

## System Overview

WebPods is an HTTP-based append-only log service using subdomains for multi-tenancy.

### Components

```
[Client] → [WebPods Server] → [PostgreSQL]
              ↓        ↓
        [Session]  [OAuth Providers]
         Store     - Direct (GitHub, Google)
                   - Hydra (Third-party apps)
```

### Data Model

```
User
 └── Pod (subdomain namespace)
      └── Stream (append-only log)
           └── Record (immutable entry)
                ├── content
                ├── hash (SHA-256)
                └── previous_hash → Record
```

## Request Flow

1. **DNS Resolution**: Wildcard DNS (`*.webpods.org`) routes to server
2. **Pod Extraction**: Subdomain determines target pod
3. **Authentication**: JWT token or session validation
4. **Permission Check**: Stream access rights verification
5. **Operation**: Read/Write/Delete execution
6. **Response**: Content with metadata headers

## Authentication Architecture

### Dual OAuth System

WebPods implements two distinct OAuth flows:

#### 1. User Authentication (Direct OAuth)

- **Purpose**: Users logging into WebPods
- **Flow**: User → WebPods → OAuth Provider → WebPods
- **Result**: WebPods JWT token + session cookie
- **Providers**: Any OAuth 2.0 provider (GitHub, Google, etc.)

#### 2. Third-Party OAuth (via Hydra)

- **Purpose**: External apps accessing WebPods
- **Flow**: App → Hydra → WebPods → User Login → Consent → App
- **Result**: Hydra-issued OAuth tokens with pod scopes
- **Infrastructure**: Ory Hydra OAuth 2.0 server

### Token Types

1. **WebPods JWT**
   - Issued after direct OAuth login
   - Full access to user's pods
   - 7-day expiry

2. **Session Cookie**
   - Created alongside JWT
   - Enables SSO across pods
   - HttpOnly, Secure, SameSite=Lax

3. **Hydra OAuth Token**
   - Issued to third-party apps
   - Scoped to specific pods
   - Standard OAuth 2.0 access token

## Database Schema

### Core Tables

#### user

- `id` (UUID): Primary key
- `created_at`: Registration time
- `updated_at`: Last modification

#### identity

- `id` (UUID): Primary key
- `user_id` → user: Owner
- `provider`: OAuth provider ID
- `provider_id`: External user ID
- `email`, `name`: User info
- `metadata` (JSONB): Provider data

#### pod

- `id` (UUID): Primary key
- `pod_id`: Subdomain identifier
- `user_id` → user: Owner

#### stream

- `id` (UUID): Primary key
- `pod_id` → pod: Parent pod
- `stream_id`: Path (e.g., `/blog/2024`)
- `user_id` → user: Creator
- `access_permission`: Access mode

#### record

- `id` (UUID): Primary key
- `stream_id` → stream: Parent stream
- `index`: Position (0-based)
- `content`: Record data
- `content_type`: MIME type
- `hash`: SHA-256 hash
- `previous_hash`: Chain link
- `user_id` → user: Writer
- `name`: Optional identifier

#### oauth_client

- `id` (UUID): Primary key
- `user_id` → user: Owner
- `client_id`: OAuth client ID
- `client_secret`: OAuth secret
- `requested_pods`: Required pods array
- `redirect_uris`: Callback URLs

## Permission Model

### Access Modes

1. **public**: Open read, authenticated write
2. **private**: Creator only
3. **/{stream}**: Custom access list

### Permission Resolution

Permissions are evaluated in-memory:

1. Fetch all records from permission stream
2. Process chronologically
3. Latest record per user wins
4. Check user's final permission state

## Hash Chain

Each record maintains blockchain-style integrity:

```
Record N:
  hash = SHA256(content + metadata)
  previous_hash = Record[N-1].hash
```

## Rate Limiting

Per-user hourly limits:

- Writes: 1000
- Reads: 10000
- Pod creation: 10
- Stream creation: 100

Anonymous reads limited by IP address.

## Content Serving

### Direct Serving

HTML, CSS, JavaScript served with appropriate MIME types.

### Binary Content

Images stored as base64, decoded on retrieval.

### URL Routing

`.meta/links` stream maps URLs to content:

```json
{
  "/": "homepage?i=-1",
  "/about": "pages/about"
}
```

## Root Pod

Optional main domain serving:

- Configure `rootPod` in config.json
- Main domain serves from specified pod
- System endpoints take precedence

## Security

### HTTPS

TLS termination at load balancer or reverse proxy.

### Authentication

- PKCE for OAuth flows
- JWT with RS256 signing
- Secure session cookies

### Input Validation

- Zod schemas for all inputs
- SQL injection prevention via parameterized queries
- Path traversal protection

### Rate Limiting

- Per-user and per-IP limits
- Hourly windows
- Automatic cleanup of expired windows
