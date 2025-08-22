# Database Schema

WebPods uses PostgreSQL with pg-promise for queries and Knex.js for migrations.

## Tables

### user
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update |

### identity
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | References user.id |
| provider | VARCHAR(50) | OAuth provider ID |
| provider_id | VARCHAR(255) | External user ID |
| email | VARCHAR(255) | User email |
| name | VARCHAR(255) | Display name |
| metadata | JSONB | Provider data |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update |

### pod
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | VARCHAR(100) | Subdomain identifier |
| user_id | UUID | Owner (references user.id) |
| created_at | TIMESTAMP | Creation time |

### stream
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| pod_id | UUID | Parent pod (references pod.id) |
| stream_id | VARCHAR(500) | Stream path |
| user_id | UUID | Creator (references user.id) |
| access_permission | VARCHAR(50) | Access mode |
| created_at | TIMESTAMP | Creation time |

### record
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| stream_id | UUID | Parent stream (references stream.id) |
| index | INTEGER | Position (0-based) |
| content | TEXT | Record data |
| content_type | VARCHAR(100) | MIME type |
| hash | VARCHAR(100) | SHA-256 hash |
| previous_hash | VARCHAR(100) | Previous record hash |
| author_id | UUID | Author (references user.id) |
| name | VARCHAR(255) | Optional identifier |
| created_at | TIMESTAMP | Creation time |

### oauth_client
| Column | Type | Description |
|--------|------|-------------|
| id | UUID | Primary key |
| user_id | UUID | Owner (references user.id) |
| client_id | VARCHAR(255) | OAuth client ID |
| client_name | VARCHAR(255) | Display name |
| client_secret | VARCHAR(255) | OAuth secret |
| redirect_uris | TEXT[] | Callback URLs |
| requested_pods | TEXT[] | Required pods |
| grant_types | TEXT[] | OAuth grant types |
| response_types | TEXT[] | OAuth response types |
| token_endpoint_auth_method | VARCHAR(50) | Auth method |
| scope | VARCHAR(500) | OAuth scopes |
| metadata | JSONB | Additional data |
| created_at | TIMESTAMP | Creation time |
| updated_at | TIMESTAMP | Last update |

### session
| Column | Type | Description |
|--------|------|-------------|
| sid | VARCHAR | Session ID (primary key) |
| sess | JSON | Session data |
| expire | TIMESTAMP | Expiration time |

### oauth_state
| Column | Type | Description |
|--------|------|-------------|
| state | VARCHAR(255) | OAuth state (primary key) |
| code_verifier | VARCHAR(255) | PKCE verifier |
| pod | VARCHAR(100) | Target pod |
| redirect_uri | TEXT | Redirect URL |
| expires_at | TIMESTAMP | Expiration (10 minutes) |

## Indexes

- `identity(provider, provider_id)` - Unique composite
- `pod(pod_id)` - Unique
- `stream(pod_id, stream_id)` - Unique composite
- `record(stream_id, index)` - Unique composite
- `record(name)` - For name lookups
- `oauth_client(client_id)` - Unique

## Migrations

```bash
# Run migrations
npm run migrate:latest

# Rollback
npm run migrate:rollback

# Create new migration
npm run migrate:make migration_name

# Check status
npm run migrate:status
```

**Important**: All schema changes go in `/database/webpods/migrations/20250810000000_initial_schema.js`. Never create new migration files.

## Query Patterns

### Using pg-promise

```typescript
// Always use named parameters
const stream = await db.oneOrNone<StreamDbRow>(
  `SELECT * FROM stream 
   WHERE stream_id = $(streamId) 
   AND pod_id = $(podId)`,
  { streamId, podId }
);

// Insert with RETURNING
const record = await db.one<RecordDbRow>(
  `INSERT INTO record (stream_id, content, author_id)
   VALUES ($(streamId), $(content), $(authorId))
   RETURNING *`,
  { streamId, content, authorId }
);

// Handle reserved words
const user = await db.oneOrNone<UserDbRow>(
  `SELECT * FROM "user" WHERE id = $(userId)`,
  { userId }
);
```

### Type Safety

All database types use `*DbRow` suffix:

```typescript
type UserDbRow = {
  id: string;
  created_at: Date;
  updated_at: Date | null;
};

type StreamDbRow = {
  id: string;
  pod_id: string;
  stream_id: string;
  user_id: string;
  access_permission: string;
  created_at: Date;
};
```

## Conventions

- Table names: Singular, lowercase (`user`, `stream`, `record`)
- Column names: snake_case (`stream_id`, `created_at`)
- Foreign keys: `{table}_id` (`user_id`, `pod_id`)
- Timestamps: Always include `created_at`, optional `updated_at`
- UUIDs: Auto-generated primary keys