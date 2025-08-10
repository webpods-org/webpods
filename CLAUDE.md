# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the WebPods codebase.

## IMPORTANT: First Steps When Starting a Session

When you begin working on this project, you MUST:

1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and API specification
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `.env.example` - Configuration options

Only after reading these documents should you proceed with any implementation or analysis tasks.

## Documentation Principles

**IMPORTANT**: When writing or updating documentation:
- Write as if the spec was designed from the beginning, not evolved over time
- Avoid phrases like "now allows", "changed from", "previously was", "only X is allowed"
- Present features and constraints as inherent design decisions
- Documentation should be timeless - readable as a complete spec at any point

## Overview

WebPods is an append-only log service organized into pods and streams. Users authenticate via OAuth (GitHub/Google), create pods (subdomains), write to streams within pods, and can serve content directly (HTML, CSS, JSON). The system supports sophisticated permission models using allow/deny lists stored as permission streams.

## Core Architecture Principles

### 1. Pods and Streams
- **Pods**: Subdomains that act as namespaces (e.g., `alice.webpods.org`)
- **Streams**: Append-only logs within pods (e.g., `alice.webpods.org/blog`, `alice.webpods.org/blog/posts/2024`)
- **Records**: Immutable entries in streams (strings or JSON)
- **Aliases**: Named references to records (any string including numbers)
- **Hash Chain**: Each record contains hash of previous record for tamper-proof history
- **System Streams**: Reserved streams under `.meta/` (`.meta/owner`, `.meta/links`, `.meta/domains`, `.meta/streams`)
- **Auto-creation**: Pods and streams created on first write

### 2. URL Structure and Routing
- **Pattern**: `{pod_id}.webpods.org/{stream_path}`
- **Subdomain routing**: Each pod is a subdomain
- **Record access**:
  - Index: `/stream?i=0`, `/stream?i=-1` (returns raw content)
  - Range: `/stream?i=10:20`, `/stream?i=-10:-1` (returns JSON with metadata)
  - Alias: `/stream/my-post`, `/stream/2024` (returns raw content, any string allowed)
- **URL mapping**: `.meta/links` stream maps custom paths to stream/record combinations
- **Stream listing**: `GET {pod_id}.webpods.org/.meta/streams` lists all streams

### 3. Permission System
- **Public** (default): Anyone can read, authenticated users can write
- **Private**: Only the creator can read/write
- **Allow lists** (`/{stream}`): Users listed in that stream can access
- **Deny lists** (`~/{stream}`): Everyone except users in that stream
- **Permission streams**: JSON objects with user permissions (last-write-wins)

### 4. Content Serving
- **Direct serving**: Single records and aliases return raw content
- **URL mappings**: Configure via `.meta/links` for clean URLs (e.g., `/` → `homepage?i=-1`)
- **Custom domains**: Register via `.meta/domains` stream with CNAME pointing to pod
- **Versioning**: Each write creates a new version, aliases always serve latest
- **Content-Type**: Determined by X-Content-Type or Content-Type headers only

### 5. Functional Programming First
- **PREFER FUNCTIONS OVER CLASSES** - Export functions from modules when possible
- **Classes only when beneficial**: Use classes for stateful connections, complex state management
- **Pure Functions**: Use explicit dependency injection
- **Result Types**: Use Result types for error handling
- **Type over Interface**: Prefer `type` over `interface`

### 6. Database Conventions
- **PostgreSQL** with **Knex.js** for migrations and queries
- **Tables**: `pod`, `stream`, `record`, `user`, `rate_limit`
- **Singular table names**: lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: snake_case for all columns
- **Reserved words**: Use backticks for PostgreSQL reserved words

### 7. ESM Modules
- **All imports MUST include `.js` extension**: `import { foo } from './bar.js'`
- **TypeScript configured for `"module": "NodeNext"`**
- **Type: `"module"` in all package.json files**

## Essential Commands

### Build Commands
```bash
# Build entire project (from root)
./build.sh              # Standard build
./build.sh --migrate    # Build + run DB migrations

# Clean build artifacts
./clean.sh

# Start the server
./start.sh

# Lint entire project
./lint-all.sh
```

### Database Commands

**IMPORTANT**: NEVER run database migrations unless explicitly instructed by the user

```bash
# Check migration status (safe to run)
npm run migrate:status

# Create new migration (safe to run)
npm run migrate:make migration_name

# Run migrations (ONLY when explicitly asked)
npm run migrate:latest
npm run migrate:rollback
```

## Data Model

### Core Tables

#### pod
- `id`: UUID primary key
- `pod_id`: Subdomain identifier (e.g., 'alice', 'myproject')
- `created_at`: Creation timestamp
- Note: Ownership tracked in `.meta/owner` stream, not in pod table

#### stream
- `id`: UUID primary key
- `pod_id`: Foreign key to pod
- `stream_id`: Stream identifier within pod (can include slashes)
- `creator_id`: User who created the stream
- `read_permission`: Permission string (e.g., 'public', 'private', '/members')
- `write_permission`: Permission string
- `stream_type`: Type of stream ('normal', 'system', 'permission')

#### record
- `id`: BIGSERIAL primary key
- `stream_id`: Foreign key to stream
- `sequence_num`: Sequential number within stream
- `content`: JSONB or text content
- `content_type`: MIME type
- `hash`: SHA-256 hash of this record
- `previous_hash`: SHA-256 hash of previous record (null for first)
- `created_by`: User who wrote the record
- `created_at`: Timestamp (used in hash calculation)

#### user
- `id`: UUID primary key
- `auth_id`: Provider-specific ID (e.g., 'auth:github:1234567')
- `email`: User email
- `name`: Display name
- `provider`: OAuth provider ('github' or 'google')

## Code Patterns

### Record Writing with Aliases
```typescript
import { createHash } from 'crypto';

export async function writeRecord(
  db: Knex,
  streamId: string,
  content: any,
  contentType: string,
  userId: string,
  alias?: string
): Promise<Result<Record>> {
  return await db.transaction(async (trx) => {
    // Get the previous record's hash
    const previousRecord = await trx('record')
      .where('stream_id', streamId)
      .orderBy('sequence_num', 'desc')
      .first();
    
    const previousHash = previousRecord?.hash || null;
    const timestamp = new Date().toISOString();
    
    // Calculate hash for new record
    const hashData = JSON.stringify({
      previous_hash: previousHash,
      timestamp: timestamp,
      content: content
    });
    
    const hash = createHash('sha256')
      .update(hashData)
      .digest('hex');
    
    // Insert new record with hash and optional alias
    const [record] = await trx('record')
      .insert({
        stream_id: streamId,
        sequence_num: (previousRecord?.sequence_num || -1) + 1,
        content: content,
        content_type: contentType,
        alias: alias || null,
        hash: hash,
        previous_hash: previousHash,
        author: userId,
        created_at: timestamp
      })
      .returning('*');
    
    return success(record);
  });
}

export async function verifyChain(
  db: Knex,
  streamId: string
): Promise<boolean> {
  const records = await db('record')
    .where('stream_id', streamId)
    .orderBy('sequence_num', 'asc');
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    
    // Verify previous_hash matches
    if (i > 0 && record.previous_hash !== records[i - 1].hash) {
      return false;
    }
    
    // Recalculate and verify hash
    const hashData = JSON.stringify({
      previous_hash: record.previous_hash,
      timestamp: record.created_at.toISOString(),
      content: record.content
    });
    
    const calculatedHash = createHash('sha256')
      .update(hashData)
      .digest('hex');
    
    if (calculatedHash !== record.hash) {
      return false;
    }
  }
  
  return true;
}
```

### Content Type Detection Pattern
```typescript
export function detectContentType(
  headers: Record<string, string>
): string {
  // 1. Check explicit X-Content-Type header (highest priority)
  if (headers['x-content-type']) {
    return headers['x-content-type'];
  }
  
  // 2. Check standard Content-Type header
  if (headers['content-type']) {
    return headers['content-type'];
  }
  
  // 3. Default to text/plain
  return 'text/plain';
}
```

### Domain Function Pattern
```typescript
// ✅ Good - Pure function with Result type
export async function createPod(
  db: Knex,
  userId: string,
  podId: string
): Promise<Result<Pod>> {
  // Validate pod ID (must be valid subdomain)
  if (!isValidPodId(podId)) {
    return failure({
      code: 'INVALID_POD_ID',
      message: 'Pod ID must be lowercase alphanumeric with hyphens'
    });
  }
  
  try {
    const [pod] = await db('pod')
      .insert({
        id: generateId(),
        pod_id: podId,
        owner_id: userId
      })
      .returning('*');
    return success(pod);
  } catch (error) {
    if (error.code === '23505') { // Unique violation
      return failure({
        code: 'POD_EXISTS',
        message: 'Pod already exists'
      });
    }
    return failure({
      code: 'DATABASE_ERROR',
      message: error.message
    });
  }
}
```

### Permission Checking Pattern
```typescript
export async function checkPermission(
  db: Knex,
  userId: string | null,
  stream: Stream,
  action: 'read' | 'write'
): Promise<boolean> {
  const permission = action === 'read' ? stream.read_permission : stream.write_permission;
  
  // Public access
  if (permission === 'public') {
    return action === 'read' || userId !== null;
  }
  
  // Private access
  if (permission === 'private') {
    return userId === stream.creator_id;
  }
  
  // Parse permission lists
  const permissions = parsePermissions(permission);
  
  for (const perm of permissions) {
    if (perm.type === 'allow') {
      // Check allow list stream
      const allowed = await checkPermissionStream(
        db,
        stream.pod_id,
        perm.stream,
        userId,
        action
      );
      if (!allowed) return false;
    } else if (perm.type === 'deny') {
      // Check deny list stream
      const denied = await checkPermissionStream(
        db,
        stream.pod_id,
        perm.stream,
        userId,
        action
      );
      if (denied) return false;
    }
  }
  
  return true;
}

async function checkPermissionStream(
  db: Knex,
  podId: string,
  streamId: string,
  userId: string | null,
  action: 'read' | 'write'
): Promise<boolean> {
  if (!userId) return false;
  
  // Get the latest permission record for this user
  const record = await db('record')
    .join('stream', 'stream.id', 'record.stream_id')
    .join('pod', 'pod.id', 'stream.pod_id')
    .where('pod.pod_id', podId)
    .where('stream.stream_id', streamId)
    .where('stream.stream_type', 'permission')
    .whereRaw("content->>'id' = ?", [userId])
    .orderBy('record.created_at', 'desc')
    .first();
  
  if (!record) return false;
  
  return record.content[action] === true;
}
```

### URL Routing with .meta/links
```typescript
// Check if path is mapped in .meta/links
export async function resolveLink(
  db: Knex,
  podId: string,
  path: string
): Promise<string | null> {
  // Get latest .meta/links configuration
  const linksRecord = await db('record')
    .join('stream', 'stream.id', 'record.stream_id')
    .join('pod', 'pod.id', 'stream.pod_id')
    .where('pod.pod_id', podId)
    .where('stream.stream_id', '.meta/links')
    .orderBy('record.created_at', 'desc')
    .first();
  
  if (!linksRecord || !linksRecord.content[path]) {
    return null;
  }
  
  return linksRecord.content[path];
}

// Route handler with .meta/links support
router.get('/*', async (req, res) => {
  const podId = extractPodId(req.hostname);
  const path = req.path;
  
  // Check .meta/links mapping first
  const mapping = await resolveLink(db, podId, path);
  if (mapping) {
    // Parse mapping: "stream/alias" or "stream/-1"
    const [streamId, target] = mapping.split('/');
    return serveContent(req, res, podId, streamId, target);
  }
  
  // Fall back to direct stream access
  // ...
    });
    return;
  }
  
  const streamId = req.params.stream_id;
  // ... rest of handler
});
```

### Negative Indexing Pattern
```typescript
export async function getRecordByIndex(
  db: Knex,
  streamId: string,
  index: number | string
): Promise<Result<Record>> {
  let recordIndex = typeof index === 'string' ? parseInt(index) : index;
  
  // Handle negative indexing
  if (recordIndex < 0) {
    const [{ count }] = await db('record')
      .where('stream_id', streamId)
      .count('* as count');
    
    recordIndex = parseInt(count as string) + recordIndex;
    
    if (recordIndex < 0) {
      return failure({
        code: 'INVALID_INDEX',
        message: 'Index out of range'
      });
    }
  }
  
  const record = await db('record')
    .where('stream_id', streamId)
    .where('sequence_num', recordIndex)
    .first();
  
  if (!record) {
    return failure({
      code: 'NOT_FOUND',
      message: 'Record not found'
    });
  }
  
  return success(record);
}
```

## Common Tasks

### Adding OAuth Provider
1. Install passport strategy (e.g., `passport-github2`)
2. Configure strategy in `routes/auth.ts`
3. Add environment variables for client ID/secret
4. Update user table auth_id format

### Implementing Custom Domains
1. Add `custom_domain` table for CNAME mappings
2. Implement middleware to resolve custom domain to pod
3. Add Let's Encrypt integration for SSL
4. Update routing to handle both subdomains and custom domains

### Handling Content Types
1. `X-Content-Type` header overrides content type
2. Content-Type detection: X-Content-Type → Content-Type → text/plain
3. X-Content-Type is the only custom header

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
cd node/packages/webpods-integration-tests
npm test -- --grep "permission"
```

## Important Notes

### Security Model
- OAuth-only authentication (GitHub + Google)
- JWT tokens for stateless authentication
- Permission streams for fine-grained access control
- Rate limiting per user and per IP
- Pod ownership cannot be transferred

### Performance Considerations
- Subdomain routing requires wildcard DNS
- Permission checks may require multiple queries
- Latest record access (`/-1`) optimized with indexes
- Content serving bypasses JSON serialization for raw content

### Error Handling
- Use Result types everywhere
- Never throw exceptions for expected errors
- Consistent error response format
- Include error codes for client handling

## Git Workflow

**IMPORTANT**: NEVER commit and push changes without explicit user permission. When the user asks you to commit and push, follow the git commit guidelines in the main Claude system prompt.

## Environment Variables

Key configuration options:
- `DOMAIN` - Base domain for pods (e.g., webpods.org)
- `JWT_SECRET` - Required in production
- `GITHUB_CLIENT_ID` - GitHub OAuth client ID
- `GITHUB_CLIENT_SECRET` - GitHub OAuth client secret
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `DATABASE_URL` - PostgreSQL connection string
- `REDIS_URL` - Redis for caching (optional)
- `WILDCARD_SSL` - Enable wildcard SSL certificates
- `LETSENCRYPT_EMAIL` - Email for Let's Encrypt

See `.env.example` for complete list.

## Debugging Tips

1. **Pod resolution issues**: Check wildcard DNS configuration
2. **Permission denied**: Trace through permission stream lookups
3. **Negative indexing**: Verify record count calculations
4. **Content serving**: Check Content-Type headers
5. **OAuth issues**: Verify callback URLs match provider configuration

## Common Issues

### Wildcard DNS not working
- Ensure `*.domain.org` DNS record points to server
- Check nginx/reverse proxy configuration for subdomain routing

### Permission streams not updating
- Remember last-write-wins pattern
- Check if stream is marked as permission type
- Verify JSON structure in permission records

### Content not serving correctly
- Check X-Content-Type header on write
- Verify content_type field in database
- Ensure raw content response for single record endpoints