# Database Schema

WebPods uses PostgreSQL with the following schema:

## Tables

### user
Stores authenticated users from OAuth providers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| auth_id | VARCHAR(255) | Provider-specific ID (unique) |
| email | VARCHAR(255) | User email |
| name | VARCHAR(255) | Display name |
| provider | VARCHAR(50) | OAuth provider (e.g., 'google') |
| metadata | JSONB | Additional user data |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### pod
Stores pod information (subdomains).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | VARCHAR(63) | Subdomain identifier (unique) |
| metadata | JSONB | Pod metadata |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### stream
Stores stream metadata and permissions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | UUID | Foreign key to pod |
| stream_id | VARCHAR(256) | Stream path within pod (supports nested paths) |
| creator_id | UUID | Foreign key to user |
| access_permission | VARCHAR(500) | Permission expression (single unified field) |
| metadata | JSONB | Stream metadata |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### record
Stores stream records (append-only).

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| stream_id | UUID | Foreign key to stream |
| sequence_num | INTEGER | Sequential number within stream |
| content | TEXT | Record content (text or JSON) |
| content_type | VARCHAR(100) | MIME type |
| alias | VARCHAR(256) | Optional alias (any string) |
| hash | VARCHAR(100) | SHA-256 hash with prefix |
| previous_hash | VARCHAR(100) | Previous record's hash |
| author_id | VARCHAR(255) | Author ID (auth:provider:id format) |
| created_at | TIMESTAMP | Creation time |

### custom_domain
Maps custom domains to pods.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | UUID | Foreign key to pod |
| domain | VARCHAR(255) | Custom domain (unique) |
| verified | BOOLEAN | CNAME verification status |
| ssl_provisioned | BOOLEAN | SSL certificate status |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### rate_limit
Tracks rate limiting per user or IP.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| identifier | VARCHAR(255) | User ID or IP address |
| action | VARCHAR(50) | 'read', 'write', 'pod_create', 'stream_create' |
| count | INTEGER | Request count |
| window_start | TIMESTAMP | Rate limit window start |
| window_end | TIMESTAMP | Rate limit window end |

## Indexes

- `user.auth_id` - Unique index for OAuth lookups
- `pod.pod_id` - Unique index for pod lookups
- `stream.pod_id, stream.stream_id` - Composite unique index
- `stream.creator_id` - Index for user's streams
- `record.stream_id, record.sequence_num` - Composite unique index
- `record.stream_id, record.alias` - Composite unique index
- `custom_domain.domain` - Unique index for domain lookups
- `rate_limit.identifier, rate_limit.action` - Composite index for rate checks

## Migrations

Run migrations:
```bash
npm run migrate:latest
```

Create new migration:
```bash
npm run migrate:make migration_name
```

Rollback:
```bash
npm run migrate:rollback
```

## Query Examples

### Get stream with permissions check
```sql
SELECT * FROM stream 
WHERE pod_id = :podId AND stream_id = :streamId
  AND (read_permission = 'public' 
    OR (read_permission = 'private' AND creator_id = :userId));
```

### Append record with sequence number and hash
```sql
INSERT INTO record (stream_id, sequence_num, content, content_type, alias, hash, previous_hash, author_id)
SELECT :streamId, COALESCE(MAX(sequence_num), -1) + 1, :content, :contentType, :alias, :hash, :previousHash, :authorId
FROM record WHERE stream_id = :streamId
RETURNING *;
```

### Get latest record in stream
```sql
SELECT * FROM record 
WHERE stream_id = :streamId
ORDER BY sequence_num DESC 
LIMIT 1;
```

### Get record by alias
```sql
SELECT * FROM record 
WHERE stream_id = :streamId AND alias = :alias;
```

### Check rate limit
```sql
SELECT COUNT(*) as count
FROM rate_limit
WHERE identifier = :identifier 
  AND action = :action
  AND window_end > NOW();
```