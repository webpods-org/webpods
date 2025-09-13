# Core Concepts

Deep dive into WebPods architecture, data model, and design principles.

## Pods

### What is a Pod?

A pod is a namespace that exists as a subdomain. When you create a pod named `alice`, you get the domain `alice.webpods.org` where all your data lives. Each pod:

- Is owned by a single user
- Contains multiple streams of data
- Has its own permission settings
- Is accessible via HTTP/HTTPS
- Maintains complete data isolation

### Pod Naming Rules

- Lowercase alphanumeric characters and hyphens only
- Must start with a letter
- Cannot end with a hyphen
- Maximum 63 characters
- Must be unique across the system

### Pod Ownership

Ownership is tracked in the special `/.config/owner` stream. Only the owner can:

- Create streams
- Write records
- Manage permissions
- Transfer ownership
- Delete the pod

## Streams

### Stream Hierarchy

Streams are hierarchical paths that organize data within a pod:

```
/                           # Root
├── /blog                   # Parent stream
│   ├── /blog/posts        # Child stream
│   │   └── /blog/posts/2024  # Grandchild stream
│   └── /blog/comments     # Another child
└── /config                # Sibling stream
    └── /config/settings   # Child of config
```

Key properties:

- Streams are created automatically when you write to them
- Parent streams are created implicitly
- Each level in the hierarchy is a separate stream
- Streams can contain both records and child streams

### Stream Paths

- Must start with `/`
- Path segments separated by `/`
- No trailing slashes
- Case-sensitive
- Maximum path length: 1024 characters

### Special Streams

WebPods uses dot-prefixed streams for metadata:

- `/.config` - Pod configuration
- `/.config/owner` - Ownership records
- `/.permissions` - Access control
- `/.links` - Stream aliases/redirects
- `/.schema` - JSON schema validation

## Records

### Record Structure

Each record is an immutable entry containing:

```json
{
  "index": 42,                          // Sequential position in stream
  "name": "config-v2",                  // Optional unique name
  "hash": "sha256:abc123...",          // SHA-256 of content
  "previous_hash": "sha256:def456...", // Hash of previous record
  "content": {...},                     // Your data
  "content_type": "application/json",  // MIME type
  "headers": {...},                     // Custom headers
  "created_at": "2024-01-15T10:30:00Z",
  "created_by": "github:12345",
  "deleted": false,                     // Soft delete flag
  "purged": false                       // Hard delete flag
}
```

### Immutability

Records cannot be modified after creation. This ensures:

- Complete audit trail
- Data integrity
- Hash chain validity
- Historical accuracy

To "update" data, you create a new record. Use named records with `?unique=true` for configuration-style updates.

### Record Naming

Records can be:

- **Auto-named**: Sequential numbers (1, 2, 3...)
- **Named**: Custom identifiers for specific records

Named records enable:

- Direct access: `/stream/my-record`
- Configuration patterns with `?unique=true`
- Logical grouping of related data

## Hash Chains

### How Hash Chains Work

Each record contains the SHA-256 hash of the previous record, creating an immutable chain:

```
Record 1: hash=abc123, previous_hash=000000 (genesis)
    ↓
Record 2: hash=def456, previous_hash=abc123
    ↓
Record 3: hash=ghi789, previous_hash=def456
```

### Hash Calculation

The hash includes:

- Record content
- Content type
- Custom headers
- Timestamp
- Creator ID

### Verification

To verify integrity:

1. Start from the first record
2. Calculate expected hash for each record
3. Compare with stored `previous_hash` in next record
4. Any mismatch indicates tampering

### Benefits

- **Tamper Detection**: Any modification breaks the chain
- **Cryptographic Proof**: Mathematical guarantee of integrity
- **Audit Trail**: Complete history preserved
- **Trust**: No need to trust the server

## Permissions Model

### Access Levels

Streams have three access levels:

1. **Public**: Anyone can read, owner can write
2. **Private**: Only owner can read/write
3. **Custom**: Specific users granted access

### Permission Inheritance

Permissions cascade down the hierarchy:

- Child streams inherit parent permissions by default
- Can override with more restrictive permissions
- Cannot be less restrictive than parent

### Permission Records

Stored in `/.permissions/{stream-path}`:

```json
{
  "userId": "github:67890",
  "read": true,
  "write": false,
  "granted_by": "github:12345",
  "granted_at": "2024-01-15T10:30:00Z"
}
```

### Permission Evaluation

1. Check stream's access level (public/private)
2. If custom, check permission records
3. Latest record for a user wins
4. Owner always has full access

## Data Integrity

### Append-Only Guarantee

WebPods enforces append-only semantics:

- New records always added to the end
- Indexes are sequential and immutable
- Deletions only mark records, don't remove them

### Deletion Model

Two types of deletion:

1. **Soft Delete** (`deleted=true`):
   - Record marked as deleted
   - Still visible with `?include_deleted=true`
   - Hash chain remains intact
   - Can be "undeleted" by owner

2. **Hard Delete** (`purged=true`):
   - Record content removed
   - Only metadata remains
   - Hash chain preserved with placeholder
   - Irreversible

### Consistency Guarantees

- **Write Consistency**: All writes are atomic
- **Read Consistency**: Always see latest committed state
- **Hash Consistency**: Chain verified on write
- **Permission Consistency**: Evaluated per request

## Query Model

### Pagination

WebPods uses index-based pagination:

```bash
?limit=20           # First 20 records
?after=20&limit=20  # Records 21-40
?after=-20          # Last 20 records
```

### Unique Records

For configuration/state management:

```bash
?unique=true        # Only latest version of named records
```

Example flow:

1. Write: `name=theme, content={color: "dark"}`
2. Write: `name=theme, content={color: "light"}`
3. Query with `?unique=true` returns only the second record

### Field Selection

Optimize bandwidth:

```bash
?fields=name,hash,created_at    # Only specific fields
?maxContentSize=1000             # Truncate large content
```

### Recursive Queries

Access entire hierarchies:

```bash
?recursive=true                  # Include all child streams
?recursive=true&unique=true      # Latest records from all streams
```

## Caching Strategy

### Hierarchical Cache

WebPods uses a hierarchical caching system:

```
/blog           → Cache key: pod:alice:stream:/blog
/blog/posts     → Cache key: pod:alice:stream:/blog/posts
/blog?unique    → Cache key: pod:alice:stream:/blog:unique
```

### Cache Invalidation

Intelligent invalidation based on operation:

- Write to `/blog/posts` invalidates:
  - `/blog/posts` (direct)
  - `/blog` (parent)
  - `/` (ancestors)
- Preserves sibling caches (`/blog/comments`)

### Cache Patterns

Different patterns for different queries:

- **List queries**: Cached until stream modified
- **Unique queries**: Cached separately
- **Recursive queries**: Invalidated by any descendant change
- **Single records**: Immutable, cached forever

## Security Model

### Authentication Types

1. **WebPods JWT Tokens**:
   - Direct API access
   - Full user permissions
   - Generated via OAuth login

2. **Hydra OAuth Tokens**:
   - Third-party applications
   - Scoped to specific pods
   - Consent-based access

### Token Validation

Tokens validated on every request:

1. Signature verification
2. Expiry check
3. Scope validation
4. Pod access verification

### Rate Limiting

Protection against abuse:

- Per-user limits
- Per-IP limits
- Configurable thresholds
- Graceful degradation

## Architecture Principles

### Simplicity

- HTTP-only API
- No custom protocols
- Standard REST patterns
- JSON as primary format

### Scalability

- Pods are independent
- Horizontal scaling via DNS
- No cross-pod queries
- Stateless request handling

### Reliability

- Atomic operations
- No partial writes
- Automatic retries
- Graceful error handling

### Extensibility

- Custom headers preserved
- Flexible content types
- Schema validation optional
- Plugin architecture ready

## Use Case Patterns

### Event Sourcing

Natural fit for event-driven systems:

```javascript
// Write events
POST /events/2024/01
{ "type": "UserCreated", "data": {...} }

// Replay events
GET /events/2024/01
```

### Configuration Management

Using unique records:

```javascript
// Write config
POST /config
{ "name": "database", "content": { "host": "localhost" } }

// Read latest
GET /config?unique=true
```

### Audit Logging

Immutable audit trail:

```javascript
// Log action
POST /audit/2024
{ "action": "DELETE_USER", "user": "admin", "target": "user123" }

// Verify integrity
GET /audit/2024?format=hash
```

### Time-Series Data

Organized by time:

```javascript
// Write sensor data
POST /sensors/temperature/2024/01/15
{ "value": 23.5, "unit": "celsius", "timestamp": "..." }

// Query range
GET /sensors/temperature/2024/01?after=100&before=200
```

### Content Versioning

Every change preserved:

```javascript
// Write document
POST /docs/manual
{ "name": "v1", "content": "Initial version" }

POST /docs/manual
{ "name": "v2", "content": "Updated version" }

// Get history
GET /docs/manual
```

## Performance Considerations

### Write Performance

- Sequential writes optimal
- Batch writes via multiple requests
- No locking between streams
- Parallel writes to different streams

### Read Performance

- Indexed queries fast
- Negative indexing efficient
- Unique queries optimized
- Field selection reduces bandwidth

### Storage Efficiency

- Content deduplication possible
- Compression supported
- External storage for large objects
- Automatic cleanup of purged records

## Limitations and Trade-offs

### Design Limitations

- No cross-pod queries
- No record updates
- No complex queries (JOIN, GROUP BY)
- No full-text search built-in

### Trade-offs

- **Immutability vs Flexibility**: Can't update, but complete history
- **Simplicity vs Features**: Basic queries only, but easy to understand
- **Security vs Convenience**: Explicit permissions, but more setup
- **Integrity vs Performance**: Hash verification overhead
