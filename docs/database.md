# Database Schema

WebPods uses PostgreSQL with the following schema structure.

## Tables

### user

Represents a user account that can own multiple OAuth identities.

| Column     | Type      | Description      |
| ---------- | --------- | ---------------- |
| id         | UUID      | Primary key      |
| created_at | TIMESTAMP | Creation time    |
| updated_at | TIMESTAMP | Last update time |

### identity

Stores OAuth provider identities linked to users.

| Column      | Type         | Description                      |
| ----------- | ------------ | -------------------------------- |
| id          | UUID         | Primary key                      |
| user_id     | UUID         | Parent user (references user.id) |
| provider    | VARCHAR(50)  | OAuth provider ID from config    |
| provider_id | VARCHAR(255) | ID from the provider             |
| email       | VARCHAR(255) | Email address (optional)         |
| name        | VARCHAR(255) | Display name (optional)          |
| metadata    | JSONB        | Additional provider data         |
| created_at  | TIMESTAMP    | Creation time                    |
| updated_at  | TIMESTAMP    | Last update time                 |

### pod

Represents a subdomain (e.g., alice.webpods.org).

| Column     | Type        | Description                  |
| ---------- | ----------- | ---------------------------- |
| name       | VARCHAR(63) | Primary key - subdomain name |
| metadata   | JSONB       | Additional pod metadata      |
| created_at | TIMESTAMP   | Creation time                |
| updated_at | TIMESTAMP   | Last update time             |

### stream

Represents streams within pods (supports nested paths).

| Column            | Type         | Description                         |
| ----------------- | ------------ | ----------------------------------- |
| pod_name          | VARCHAR(63)  | Parent pod (references pod.name)    |
| name              | VARCHAR(256) | Stream path (can include slashes)   |
| user_id           | UUID         | Creator (references user.id)        |
| access_permission | VARCHAR(500) | Access mode (public/private/custom) |
| metadata          | JSONB        | Additional stream metadata          |
| created_at        | TIMESTAMP    | Creation time                       |
| updated_at        | TIMESTAMP    | Last update time                    |

**Note**: `pod_name` and `name` form a composite primary key.

### record

Append-only records with hash chain for integrity.

| Column        | Type         | Description                           |
| ------------- | ------------ | ------------------------------------- |
| id            | BIGSERIAL    | Primary key                           |
| pod_name      | VARCHAR(63)  | Pod containing the record             |
| stream_name   | VARCHAR(256) | Stream path containing the record     |
| index         | INTEGER      | Position in stream (0-based)          |
| content       | TEXT         | Record content (text or JSON)         |
| content_type  | VARCHAR(100) | MIME type (default: text/plain)       |
| name          | VARCHAR(256) | Required name (like a filename)       |
| hash          | VARCHAR(100) | SHA-256 hash with prefix              |
| previous_hash | VARCHAR(100) | Previous record hash (NULL for first) |
| user_id       | UUID         | User who created the record           |
| created_at    | TIMESTAMP    | Creation time                         |

### custom_domain

Maps custom domains to pods.

| Column          | Type         | Description               |
| --------------- | ------------ | ------------------------- |
| id              | BIGSERIAL    | Primary key               |
| pod_name        | VARCHAR(63)  | Pod (references pod.name) |
| domain          | VARCHAR(255) | Custom domain (unique)    |
| verified        | BOOLEAN      | CNAME verification status |
| ssl_provisioned | BOOLEAN      | SSL certificate status    |
| created_at      | TIMESTAMP    | Creation time             |
| updated_at      | TIMESTAMP    | Last update time          |

### rate_limit

Tracks rate limiting per user/IP and action.

| Column       | Type         | Description                                       |
| ------------ | ------------ | ------------------------------------------------- |
| id           | BIGSERIAL    | Primary key                                       |
| identifier   | VARCHAR(255) | User ID or IP address                             |
| action       | VARCHAR(50)  | Action type (write/read/pod_create/stream_create) |
| count        | INTEGER      | Current count in window                           |
| window_start | TIMESTAMP    | Start of time window                              |
| window_end   | TIMESTAMP    | End of time window                                |

### session

Stores server-side session data for SSO.

| Column | Type      | Description              |
| ------ | --------- | ------------------------ |
| sid    | VARCHAR   | Primary key - session ID |
| sess   | JSONB     | Session data             |
| expire | TIMESTAMP | Expiry timestamp         |

### oauth_state

Temporary storage for OAuth PKCE flows.

| Column        | Type         | Description                        |
| ------------- | ------------ | ---------------------------------- |
| state         | VARCHAR      | Primary key - state parameter      |
| code_verifier | VARCHAR(128) | PKCE code verifier                 |
| pod           | VARCHAR(63)  | Optional pod for pod-specific auth |
| redirect_uri  | TEXT         | Where to redirect after auth       |
| created_at    | TIMESTAMP    | Creation time                      |
| expires_at    | TIMESTAMP    | TTL for state                      |

### oauth_client

Registered OAuth client applications.

| Column                     | Type         | Description                      |
| -------------------------- | ------------ | -------------------------------- |
| id                         | BIGSERIAL    | Primary key                      |
| user_id                    | UUID         | Owner (references user.id)       |
| client_id                  | VARCHAR(255) | Unique client identifier         |
| client_name                | VARCHAR(255) | Display name                     |
| client_secret              | VARCHAR(255) | Secret (NULL for public clients) |
| redirect_uris              | TEXT[]       | Array of allowed redirect URIs   |
| requested_pods             | TEXT[]       | Array of pods the client needs   |
| grant_types                | TEXT[]       | Allowed grant types              |
| response_types             | TEXT[]       | Allowed response types           |
| token_endpoint_auth_method | VARCHAR(50)  | Auth method                      |
| scope                      | VARCHAR(500) | Allowed scopes                   |
| metadata                   | JSONB        | Additional client metadata       |
| created_at                 | TIMESTAMP    | Creation time                    |
| updated_at                 | TIMESTAMP    | Last update time                 |

## Indexes

### Primary Keys

- `user(id)`
- `identity(id)`
- `pod(name)`
- `stream(pod_name, name)` - Composite
- `record(id)`
- `custom_domain(id)`
- `rate_limit(id)`
- `session(sid)`
- `oauth_state(state)`
- `oauth_client(id)`

### Foreign Keys

- `identity(user_id)` → `user(id)`
- `stream(pod_name)` → `pod(name)`
- `stream(user_id)` → `user(id)`
- `record(pod_name, stream_name)` → `stream(pod_name, name)`
- `record(user_id)` → `user(id)`
- `custom_domain(pod_name)` → `pod(name)`
- `oauth_client(user_id)` → `user(id)`

### Other Indexes

- `identity(provider, provider_id)` - Unique composite
- `identity(user_id)`
- `identity(email)`
- `stream(user_id)`
- `record(pod_name, stream_name, index)` - Unique composite
- `record(pod_name, stream_name, name)`
- `record(user_id)`
- `record(hash)`
- `custom_domain(domain)` - Unique
- `custom_domain(pod_name)`
- `rate_limit(identifier, action, window_start)` - Unique composite
- `rate_limit(identifier, action, window_end)`
- `session(expire)`
- `oauth_state(expires_at)`
- `oauth_client(user_id)`
- `oauth_client(client_id)` - Unique

## Triggers

### update_updated_at_column

Updates the `updated_at` timestamp on row modifications. Applied to:

- `user`
- `identity`
- `pod`
- `stream`
- `custom_domain`
- `oauth_client`

## Notes

1. **Hash Chain**: Records maintain integrity through a hash chain where each record includes the hash of the previous record.

2. **Composite Keys**: The `stream` table uses a composite primary key of `(pod_name, name)` to uniquely identify streams within pods.

3. **Nested Paths**: Stream names can include slashes for nested organization (e.g., `blog/posts`, `api/v1/users`).

4. **System Streams**: Streams starting with `.config/` are system streams with special handling:
   - `.config/owner` - Pod ownership
   - `.config/routing` - URL routing rules
   - `.config/domains` - Custom domain configuration
   - `.config/api/streams` - Stream listing endpoint

5. **Permissions**: The `access_permission` field in streams supports:
   - `public` - Anyone can read
   - `private` - Only creator can access
   - Custom permission strings for future expansion

6. **Rate Limiting**: Actions tracked:
   - `read` - Reading records
   - `write` - Writing records
   - `pod_create` - Creating pods
   - `stream_create` - Creating streams

7. **PostgreSQL Arrays**: The `oauth_client` table uses PostgreSQL array types for `redirect_uris`, `requested_pods`, `grant_types`, and `response_types`.
