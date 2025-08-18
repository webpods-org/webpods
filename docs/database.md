# Database Schema

WebPods uses PostgreSQL with Knex.js for migrations and queries.

## Core Tables

### user
Stores authenticated users from OAuth providers.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| auth_id | VARCHAR(255) | Unique auth identifier (`auth:{provider}:{id}`) |
| email | VARCHAR(255) | User email from OAuth provider |
| name | VARCHAR(255) | Display name |
| provider | VARCHAR(50) | OAuth provider ID (e.g., `github`, `google`) |
| metadata | JSONB | Additional user data from OAuth |
| created_at | TIMESTAMP | User creation time |
| updated_at | TIMESTAMP | Last update time |

### pod
Represents subdomains (namespaces).

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | VARCHAR(100) | Unique subdomain identifier |
| user_id | UUID | Owner (references user.id) |
| created_at | TIMESTAMP | Pod creation time |

### stream
Append-only logs within pods.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | UUID | Parent pod (references pod.id) |
| stream_id | VARCHAR(500) | Stream path (e.g., `blog/2024`) |
| user_id | UUID | Creator (references user.id) |
| access_permission | VARCHAR(50) | Access mode (`public`, `private`, stream path) |
| created_at | TIMESTAMP | Stream creation time |

### record
Immutable entries in streams.

| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| stream_id | UUID | Parent stream (references stream.id) |
| index | INTEGER | Position in stream (0-based) |
| content | TEXT | Record content |
| content_type | VARCHAR(100) | MIME type |
| hash | VARCHAR(100) | SHA-256 hash of content |
| previous_hash | VARCHAR(100) | Hash of previous record (chain) |
| author_id | VARCHAR(255) | Author's auth_id |
| name | VARCHAR(255) | Optional named reference |
| created_at | TIMESTAMP | Record creation time |

### session
Active user sessions for SSO.

| Column | Type | Description |
|--------|------|-------------|
| sid | VARCHAR | Session ID (primary key) |
| sess | JSON | Session data |
| expire | TIMESTAMP | Expiration time |

## Indexes

- `user.auth_id` - Unique index for OAuth lookups
- `user.email` - Index for email searches
- `pod.pod_id` - Unique index for subdomain routing
- `stream.pod_id, stream.stream_id` - Composite unique index
- `record.stream_id, record.index` - Composite unique index
- `record.name` - Index for name lookups

## Migrations

Run migrations:
```bash
npm run migrate:latest
```

Create new migration:
```bash
npm run migrate:make migration_name
```

Check migration status:
```bash
npm run migrate:status
```

Rollback last migration:
```bash
npm run migrate:rollback
```

## Conventions

- **Table names**: Singular, lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: Snake_case (e.g., `stream_id`, `created_at`)
- **Primary keys**: UUID with auto-generation
- **Timestamps**: Always include `created_at`, add `updated_at` where needed
- **Foreign keys**: Named as `{table}_id` (e.g., `user_id`, `pod_id`)

## Permission Model

Permissions are stored as records in permission streams (`/{stream}`) with this format:

```json
{
  "id": "auth:{provider}:{id}",
  "read": true,
  "write": false,
  "admin": false
}
```

The latest record for a user determines their current permissions.