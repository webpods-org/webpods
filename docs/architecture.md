# Architecture

## System Design

WebPods is an append-only log service with pod-based multi-tenancy.

### Components

```
[Client] → [Load Balancer] → [WebPods Server] → [PostgreSQL]
                                    ↓
                              [Session Store]
```

### Data Model

```
Pod (subdomain)
 └── Stream (path)
      └── Record (append-only entry)
           ├── content
           ├── hash (SHA-256)
           └── previous_hash → Record
```

### Request Flow

1. **DNS**: `*.webpods.org` → Load balancer
2. **Auth**: JWT validation or session check
3. **Pod Resolution**: Extract from subdomain
4. **Stream Access**: Check permissions
5. **Operation**: Read/Write/Delete
6. **Response**: Content + metadata headers

## Database Schema

### Core Tables

**user**
- `id`: UUID primary key
- `auth_id`: Provider ID (`auth:{provider}:{id}`)
- `email`, `name`, `provider`

**pod**
- `id`: UUID primary key
- `pod_id`: Subdomain identifier
- `owner_id`: User UUID

**stream**
- `id`: UUID primary key
- `pod_id`: Pod UUID
- `stream_id`: Path (`blog/2024`)
- `access_permission`: Access mode
- `creator_id`: User UUID

**record**
- `id`: UUID primary key
- `stream_id`: Stream UUID
- `index`: Sequential position
- `content`: Text/JSON
- `hash`, `previous_hash`: Chain links
- `alias`: Optional named reference

### Session Tables (SSO)

**session**
- `sid`: Session ID
- `sess`: Session data (user, cookie)
- `expire`: Expiration timestamp

**oauth_state**
- `state`: PKCE state
- `code_verifier`: PKCE verifier
- `pod`: Target pod
- `expires_at`: 10-minute TTL

## Security

### Authentication
- OAuth 2.0 with PKCE
- JWT tokens (pod-specific or global)
- PostgreSQL session store for SSO

### Authorization
- Stream-level permissions
- In-memory permission evaluation
- Pod ownership via `.meta/owner`

### Data Integrity
- SHA-256 hash chain
- Immutable records
- Append-only streams

## Performance

### Optimizations
- Connection pooling (PostgreSQL)
- Indexed queries (pod_id, stream_id, alias)
- In-memory permission checks
- Session-based SSO (no repeated OAuth)

### Scaling
- Horizontal: Multiple server instances
- Database: Read replicas for queries
- Sessions: Shared PostgreSQL store

## Technology Stack

- **Runtime**: Node.js with TypeScript
- **Framework**: Express.js
- **Database**: PostgreSQL with Knex.js
- **Auth**: Passport.js, express-session
- **Testing**: Mocha, Chai
- **Build**: ESM modules, tsc