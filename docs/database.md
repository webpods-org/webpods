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

### queue
Stores queue metadata and permissions.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| q_id | VARCHAR(256) | User-defined queue identifier (unique) |
| creator_id | UUID | Foreign key to user |
| read_permission | VARCHAR(20) | 'public', 'auth', or 'owner' |
| write_permission | VARCHAR(20) | 'auth' or 'owner' |
| metadata | JSONB | Queue metadata |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update time |

### record
Stores queue records (append-only).

| Column | Type | Description |
|--------|------|-------------|
| id | BIGSERIAL | Primary key |
| queue_id | UUID | Foreign key to queue |
| sequence_num | INTEGER | Sequential number within queue |
| content | JSONB | Record content |
| content_type | VARCHAR(100) | MIME type |
| metadata | JSONB | Record metadata |
| created_by | UUID | Foreign key to user (nullable) |
| created_at | TIMESTAMP | Creation time |

### rate_limit
Tracks rate limiting per user.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Foreign key to user |
| action | VARCHAR(20) | 'read' or 'write' |
| count | INTEGER | Request count |
| window_start | TIMESTAMP | Rate limit window start |
| window_end | TIMESTAMP | Rate limit window end |

## Indexes

- `user.auth_id` - Unique index for OAuth lookups
- `queue.q_id` - Unique index for queue lookups
- `queue.creator_id` - Index for user's queues
- `record.queue_id, record.sequence_num` - Composite index for ordered reads
- `rate_limit.user_id, rate_limit.action` - Composite index for rate checks

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

### Get queue with permissions check
```sql
SELECT * FROM queue 
WHERE q_id = 'my-queue' 
  AND (read_permission = 'public' 
    OR (read_permission = 'auth' AND $1 IS NOT NULL)
    OR (read_permission = 'owner' AND creator_id = $1));
```

### Append record with sequence number
```sql
INSERT INTO record (queue_id, sequence_num, content, content_type, created_by)
SELECT $1, COALESCE(MAX(sequence_num), 0) + 1, $2, $3, $4
FROM record WHERE queue_id = $1
RETURNING *;
```

### Check rate limit
```sql
SELECT COUNT(*) as count
FROM rate_limit
WHERE user_id = $1 
  AND action = $2
  AND window_start > NOW() - INTERVAL '1 hour';
```