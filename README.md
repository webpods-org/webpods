# WebPods

**Build append-only applications with cryptographic verification using just HTTP and subdomains.**

WebPods turns subdomains into personal data stores with immutable, hash-chained records. Suitable for audit logs, event streams, content versioning, and applications requiring tamper-proof data.

## Use Cases

- **Audit Trails** - Immutable logs with cryptographic proof of integrity
- **Blogging Platforms** - Content with built-in version history and authorship
- **IoT Data Collection** - Append-only sensor data streams with timestamps
- **Secure Backups** - Tamper-evident data storage with hash verification
- **Collaborative Apps** - Multi-user data with clear ownership and permissions
- **Event Sourcing** - Natural fit for event-driven architectures
- **Financial Records** - Immutable transaction logs with cryptographic proofs
- **Document Versioning** - Track every change with hash-chained history

## Quick Example

```bash
# Create your namespace (pod)
curl -X POST https://webpods.org/api/pods \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"name": "alice"}'

# Write immutable data
curl -X POST https://alice.webpods.org/blog/posts \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"title": "Hello World", "content": "My first post!"}'

# Read it back - no auth needed for public streams!
curl https://alice.webpods.org/blog/posts/1

# Response includes hash chain for verification
{
  "index": 1,
  "name": "1",
  "hash": "sha256:abc123...",
  "previous_hash": "sha256:000000...",
  "content": {"title": "Hello World", "content": "My first post!"},
  "content_type": "application/json",
  "created_at": "2024-01-15T10:30:00Z"
}
```

You now have a cryptographically-verified, append-only data store at `alice.webpods.org`.

## Core Concepts

### Pods - Your Namespace

Each **pod** is a subdomain that acts as your personal namespace. When you create a pod named `alice`, you get the domain `alice.webpods.org` where all your data lives.

### Streams - Append-Only Logs

**Streams** are hierarchical paths within your pod that act as append-only logs. For example:

- `/blog/posts` - Blog entries
- `/logs/access` - Access logs
- `/iot/temperature` - Temperature readings
- `/config/settings` - Configuration (using unique records)

Streams support nesting: `/blog/posts/2024/january` creates a hierarchy where each level is a stream.

### Records - Immutable Entries

**Records** are individual entries in a stream. Each record:

- Has a unique index (1, 2, 3...)
- Contains your data (JSON, text, binary)
- Includes a SHA-256 hash of its content
- Links to the previous record via `previous_hash`
- Cannot be modified once created (only marked as deleted)

### Hash Chains - Cryptographic Integrity

Every record contains the hash of the previous record, creating an immutable chain. Any tampering with historical data breaks the chain and is immediately detectable.

### Permissions - Access Control

Streams can be:

- **Public** - Anyone can read, only owner can write
- **Private** - Only owner can read/write
- **Custom** - Grant specific users read or write access

## Installation

### Quick Start with Docker

```bash
# Basic setup
docker run -d -p 3000:3000 \
  -e DATABASE_URL=postgresql://postgres:password@localhost/webpods \
  -e JWT_SECRET=your-secret-key \
  -e SESSION_SECRET=your-session-secret \
  -e GITHUB_OAUTH_CLIENT_ID=your-github-client-id \
  -e GITHUB_OAUTH_SECRET=your-github-secret \
  webpods/webpods

# With Docker Compose (recommended)
curl -O https://raw.githubusercontent.com/webpods-org/webpods/main/docker-compose.yml
docker-compose up -d
```

### Install CLI

```bash
# Install globally
npm install -g @webpods/podctl

# Configure server (defaults to http://localhost:3000)
podctl profile add prod --server https://webpods.org
podctl profile use prod

# Login (opens browser for OAuth)
podctl auth login
```

See [deployment guide](docs/deployment.md) for production setup, custom domains, TLS certificates, and database configuration.

## Getting Started

### Step 1: Authenticate

WebPods supports two types of authentication:

**For CLI and Direct API Access** - WebPods JWT tokens:

```bash
# CLI - opens browser
podctl auth login

# API - get login URL
curl "https://webpods.org/auth/github?no_redirect=1"
# Visit URL, authenticate, copy token

# Use token
export WEBPODS_TOKEN="your-jwt-token"
podctl auth info
```

**For Third-Party Apps** - OAuth 2.0 flow (see [third-party integration](docs/third-party-integration.md))

### Step 2: Create Your Pod

```bash
# CLI
podctl pod create my-app

# API
curl -X POST https://webpods.org/api/pods \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "my-app"}'
```

Your pod is now live at `https://my-app.webpods.org`!

### Step 3: Write Data

```bash
# CLI - write text
podctl record write my-app /notes today "Remember to buy milk"

# CLI - write JSON
podctl record write my-app /config settings '{"theme": "dark", "lang": "en"}'

# API - write to stream (auto-increments)
curl -X POST https://my-app.webpods.org/logs/events \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"event": "user_login", "user": "alice", "ip": "192.168.1.1"}'

# API - write with specific name (for config/settings)
curl -X POST https://my-app.webpods.org/config \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"name": "theme", "content": {"color": "dark", "font": "monospace"}}'
```

### Step 4: Read Data

```bash
# CLI
podctl record list my-app /logs/events
podctl record read my-app /logs/events 1

# API - list all records
curl https://my-app.webpods.org/logs/events

# API - get specific record
curl https://my-app.webpods.org/logs/events/1

# API - pagination
curl "https://my-app.webpods.org/logs/events?limit=10&after=5"

# API - get last 20 records
curl "https://my-app.webpods.org/logs/events?after=-20"

# API - get unique/latest records only (for config streams)
curl "https://my-app.webpods.org/config?unique=true"
```

### Step 5: Manage Permissions

```bash
# CLI - make stream public
podctl stream create my-app /blog --access public

# CLI - grant user access
podctl permission grant my-app /private/data github:67890

# API - write to permissions stream
curl -X POST https://my-app.webpods.org/.permissions/private/data \
  -H "Authorization: Bearer $WEBPODS_TOKEN" \
  -d '{"userId": "github:67890", "read": true, "write": false}'
```

## For Third-Party Developers

WebPods provides OAuth 2.0 authentication, allowing your applications to access user pods with their permission.

### Quick Integration Example

```javascript
// 1. Register your application (one-time setup)
const response = await fetch("https://webpods.org/oauth/register", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    client_name: "Pod Analytics Dashboard",
    redirect_uris: ["https://myapp.com/callback"],
    scope: "openid offline pod:read pod:write",
  }),
});
const { client_id, client_secret } = await response.json();

// 2. Direct users to authorize
const authUrl = `https://webpods.org/connect?client_id=${client_id}`;
window.location.href = authUrl;

// 3. Handle callback and exchange code for token
async function handleCallback(code) {
  const tokenResponse = await fetch("https://webpods.org/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code: code,
      redirect_uri: "https://myapp.com/callback",
      client_id: client_id,
      client_secret: client_secret,
    }),
  });
  return tokenResponse.json();
}

// 4. Access user's pods with OAuth token
const userData = await fetch("https://alice.webpods.org/app-data", {
  headers: { Authorization: `Bearer ${oauth_token}` },
});
```

Users will see a consent screen showing which pods your app wants to access, ensuring transparency and control.

See [third-party integration guide](docs/third-party-integration.md) for complete OAuth flows, token refresh, and best practices.

## API Overview

### Authentication & Management (Main Domain)

**Base URL**: `https://webpods.org`

```bash
# Authentication
GET  /auth/providers           # List OAuth providers
GET  /auth/{provider}          # Start OAuth login
GET  /auth/whoami              # Get current user
POST /auth/logout              # Logout

# Pod Management
POST   /api/pods               # Create pod
GET    /api/pods               # List your pods
DELETE /api/pods/{name}        # Delete pod
PUT    /api/pods/{name}/transfer # Transfer ownership

# OAuth (for third-party apps)
POST /oauth/register           # Register OAuth client
GET  /connect?client_id=...    # Simplified OAuth flow
```

### Data Operations (Pod Subdomains)

**Base URL**: `https://{pod}.webpods.org`

```bash
# Records
GET    /path                   # List records (or read single named record)
POST   /path                   # Create record (auto-name or specify)
DELETE /path/{name}            # Delete record (mark as deleted)

# Streams
GET    /                       # List all streams
DELETE /path                   # Delete entire stream

# Query Parameters
?limit=20                      # Limit results
?after=10                      # Skip first 10 records
?after=-20                     # Get last 20 records
?before=50                     # Get records before index 50
?unique=true                   # Get only latest version of named records
?include_deleted=true          # Include deleted records
?format=hash                   # Get only hashes (for verification)
?fields=name,content           # Select specific fields
?maxContentSize=1000           # Truncate large content
```

See [API reference](docs/api.md) for complete endpoint documentation, request/response formats, and error codes.

## CLI Overview

### Basic Commands

```bash
# Authentication
podctl auth login              # Login via browser
podctl auth logout             # Logout
podctl auth info               # Show current user
podctl auth token get          # Display token
podctl auth token set TOKEN    # Set token manually

# Pods
podctl pod create NAME         # Create pod
podctl pod list                # List your pods
podctl pod info NAME           # Pod details
podctl pod delete NAME         # Delete pod
podctl pod transfer NAME USER  # Transfer ownership

# Records
podctl record write POD PATH [NAME] DATA    # Write record
podctl record read POD PATH [NAME]          # Read record(s)
podctl record list POD PATH                 # List records
podctl record delete POD PATH NAME          # Delete record

# Streams
podctl stream create POD PATH [--access public|private]
podctl stream list POD
podctl stream delete POD PATH

# Permissions
podctl permission grant POD PATH USER
podctl permission revoke POD PATH USER
podctl permission list POD PATH

# Links (aliases/redirects)
podctl link set POD SOURCE TARGET
podctl link list POD
podctl link remove POD SOURCE

# OAuth clients
podctl oauth register NAME --redirect-uri URL
podctl oauth list
podctl oauth info CLIENT_ID
podctl oauth delete CLIENT_ID

# Rate limits
podctl limit info

# Profiles (multiple servers)
podctl profile add NAME --server URL
podctl profile use NAME
podctl profile list
```

See [CLI reference](docs/cli.md) for all commands, options, and examples.

## Real-World Examples

### Audit Log System

```javascript
class AuditLogger {
  constructor(pod, token) {
    this.pod = pod;
    this.token = token;
    this.baseUrl = `https://${pod}.webpods.org`;
  }

  async log(event) {
    const timestamp = new Date().toISOString();
    const path = `/audit/${timestamp.substring(0, 7)}`; // Group by month

    const response = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        timestamp,
        action: event.action,
        user: event.user,
        resource: event.resource,
        ip: event.ip,
        metadata: event.metadata,
      }),
    });

    return response.json();
  }

  async getRecentLogs(count = 100) {
    const month = new Date().toISOString().substring(0, 7);
    const response = await fetch(
      `${this.baseUrl}/audit/${month}?after=-${count}`,
    );
    return response.json();
  }

  async verifyIntegrity(month) {
    const response = await fetch(`${this.baseUrl}/audit/${month}`);
    const { records } = await response.json();

    // Verify hash chain
    for (let i = 1; i < records.length; i++) {
      const prevHash = records[i].previous_hash;
      const expectedHash = await this.calculateHash(records[i - 1]);
      if (prevHash !== expectedHash) {
        throw new Error(`Integrity violation at record ${i}`);
      }
    }
    return true;
  }
}

// Usage
const audit = new AuditLogger("company-logs", process.env.TOKEN);
await audit.log({
  action: "DELETE_USER",
  user: "admin@company.com",
  resource: "user:123",
  ip: "192.168.1.1",
});
```

### IoT Data Collection

```python
import requests
import json
from datetime import datetime

class IoTCollector:
    def __init__(self, pod, token):
        self.pod = pod
        self.token = token
        self.base_url = f"https://{pod}.webpods.org"
        self.headers = {"Authorization": f"Bearer {token}"}

    def record_reading(self, sensor_id, value, unit):
        timestamp = datetime.utcnow().isoformat()
        path = f"/sensors/{sensor_id}/{timestamp[:10]}"  # Group by day

        data = {
            "timestamp": timestamp,
            "sensor_id": sensor_id,
            "value": value,
            "unit": unit
        }

        response = requests.post(
            f"{self.base_url}{path}",
            headers=self.headers,
            json=data
        )
        return response.json()

    def get_daily_readings(self, sensor_id, date):
        path = f"/sensors/{sensor_id}/{date}"
        response = requests.get(f"{self.base_url}{path}")
        return response.json()

    def get_latest_reading(self, sensor_id):
        # Get last reading using negative offset
        today = datetime.utcnow().strftime("%Y-%m-%d")
        path = f"/sensors/{sensor_id}/{today}?after=-1"
        response = requests.get(f"{self.base_url}{path}")
        data = response.json()
        return data["records"][0] if data["records"] else None

# Usage
iot = IoTCollector("factory-sensors", token)
iot.record_reading("temp-001", 23.5, "celsius")
iot.record_reading("humidity-001", 65, "percent")
latest = iot.get_latest_reading("temp-001")
```

### Configuration Management

```javascript
// Using unique records for configuration
class ConfigManager {
  constructor(pod, token) {
    this.pod = pod;
    this.token = token;
    this.baseUrl = `https://${pod}.webpods.org`;
  }

  async set(key, value) {
    // Named records overwrite previous values when using unique=true
    const response = await fetch(`${this.baseUrl}/config`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: key,
        content: value,
      }),
    });
    return response.json();
  }

  async get(key) {
    // Get specific config value
    const response = await fetch(`${this.baseUrl}/config/${key}`);
    if (response.ok) {
      const data = await response.json();
      return data.content;
    }
    return null;
  }

  async getAll() {
    // Get all current config (latest values only)
    const response = await fetch(`${this.baseUrl}/config?unique=true`);
    const data = await response.json();

    // Transform to key-value object
    const config = {};
    for (const record of data.records) {
      config[record.name] = record.content;
    }
    return config;
  }
}

// Usage
const config = new ConfigManager("my-app", token);
await config.set("theme", { mode: "dark", accent: "blue" });
await config.set("features", { beta: true, analytics: false });
const allConfig = await config.getAll();
```

See [examples documentation](docs/examples.md) for more use cases including content versioning, collaborative editing, and blockchain-style applications.

## Key Features

### Cryptographic Integrity

Every record contains a SHA-256 hash of the previous record, creating an immutable chain. Tampering with any historical record breaks the chain and is immediately detectable.

### HTTP-Native API

No special protocols, libraries, or clients required. Everything works over standard HTTP/HTTPS. Each pod gets its own subdomain for data isolation.

### Append-Only Guarantees

Records can never be modified after creation. Deletions only mark records as deleted without removing them. Designed for audit trails, compliance, and event sourcing.

### Flexible Permissions

Fine-grained access control per stream. Public streams allow anonymous reads. Private streams require authentication. Custom permissions grant specific users access.

### Simple Scaling

Pods are independent namespaces. Scale horizontally by adding servers. Use DNS to route pods to different servers. No complex sharding required.

### OAuth 2.0 for Apps

Full OAuth 2.0 and OpenID Connect support through Ory Hydra. Third-party developers can build applications that interact with user pods after obtaining consent.

### Multiple Data Formats

Store JSON, plain text, or binary data. Content-Type headers are preserved. Large content can be streamed.

### Efficient Queries

Pagination with positive/negative offsets. Unique record filtering for configuration use cases. Field selection to reduce bandwidth. Range queries for time-series data.

## Advanced Features

### Negative Indexing

Use negative values in the `after` parameter to get the most recent records:

```bash
?after=-10           # Get last 10 records
?after=-100&limit=50 # Get records 100-51 from the end
```

### Unique Records

For configuration and state management, use unique records to get only the latest version:

```bash
?unique=true         # Returns only the latest version of each named record
```

### Field Selection

Reduce bandwidth by selecting specific fields:

```bash
?fields=name,created_at      # Only return name and timestamp
?maxContentSize=1000          # Truncate large content fields
```

### Hash Verification

Verify data integrity by fetching only hashes:

```bash
?format=hash         # Returns only record hashes for verification
```

### Hierarchical Streams

Streams support arbitrary nesting:

```
/logs                # Parent stream
/logs/2024           # Child stream
/logs/2024/01        # Grandchild stream
/logs/2024/01/15     # Great-grandchild stream
```

### Stream Metadata

Special streams for pod configuration:

```
/.config/owner       # Pod ownership
/.permissions/*      # Access control
/.links/*           # Stream aliases/redirects
```

## Architecture

WebPods consists of:

- **API Server** - Handles HTTP requests, authentication, and business logic
- **PostgreSQL Database** - Stores pods, streams, records with hash chains
- **Ory Hydra** - OAuth 2.0 server for third-party authentication
- **CLI Tool** - Command-line interface for pod management

Each pod is isolated at the subdomain level. Records are immutable and hash-chained. Permissions are evaluated per request.

See [concepts documentation](docs/concepts.md) for detailed architecture information.

## Documentation

- [**API Reference**](docs/api.md) - Complete HTTP API documentation with all endpoints
- [**CLI Reference**](docs/cli.md) - All CLI commands, options, and examples
- [**Third-Party Integration**](docs/third-party-integration.md) - OAuth flows, building apps on WebPods
- [**Deployment Guide**](docs/deployment.md) - Installation, configuration, production setup
- [**Core Concepts**](docs/concepts.md) - Deep dive into pods, streams, permissions, hash chains
- [**Examples**](docs/examples.md) - Code examples in JavaScript, Python, cURL

## System Requirements

- **Node.js** 18+ (for server and CLI)
- **PostgreSQL** 13+ (for data storage)
- **Docker** (optional, for containerized deployment)
- **Ory Hydra** (optional, for OAuth support)

## Configuration

WebPods can be configured via environment variables or `config.json`:

```bash
# Essential configuration
DATABASE_URL=postgresql://user:pass@localhost/webpods
JWT_SECRET=your-secret-key-minimum-32-chars
SESSION_SECRET=your-session-secret

# OAuth providers (at least one required)
GITHUB_OAUTH_CLIENT_ID=your-client-id
GITHUB_OAUTH_SECRET=your-client-secret

# Optional
PORT=3000
HOST=0.0.0.0
PUBLIC_URL=https://webpods.org
MAX_RECORD_SIZE=10485760  # 10MB
MAX_RECORD_LIMIT=1000
```

See [deployment guide](docs/deployment.md) for complete configuration options.

## Contributing

WebPods is open source and welcomes contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

- [GitHub Issues](https://github.com/webpods-org/webpods/issues) - Bug reports and feature requests
- [Discussions](https://github.com/webpods-org/webpods/discussions) - Questions and community support
- [Security](SECURITY.md) - Report security vulnerabilities

## Quick Links

- [GitHub Repository](https://github.com/webpods-org/webpods)
- [npm Package](https://www.npmjs.com/package/@webpods/podctl)
- [Docker Hub](https://hub.docker.com/r/webpods/webpods)
