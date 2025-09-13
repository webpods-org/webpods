# Examples

Complete code examples and real-world use cases for WebPods.

## Quick Start Examples

### JavaScript / Node.js

```javascript
// Install the client (example - no official SDK yet)
// npm install node-fetch

const fetch = require("node-fetch");

// Configuration
const POD_URL = "https://my-pod.webpods.org";
const AUTH_TOKEN = "your-jwt-token";

// Write a record
async function writeRecord(stream, name, content) {
  const response = await fetch(`${POD_URL}${stream}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      name: name,
      content: content,
    }),
  });
  return await response.json();
}

// Read records
async function readRecords(stream, options = {}) {
  const params = new URLSearchParams(options);
  const response = await fetch(`${POD_URL}${stream}?${params}`, {
    headers: {
      Authorization: `Bearer ${AUTH_TOKEN}`,
    },
  });
  return await response.json();
}

// Example usage
async function main() {
  // Write configuration
  await writeRecord("/config", "database", {
    host: "localhost",
    port: 5432,
    database: "myapp",
  });

  // Read latest configuration
  const config = await readRecords("/config", { unique: true });
  console.log("Latest config:", config.records);

  // Write event log
  await writeRecord("/events", null, {
    type: "user_login",
    userId: "user123",
    timestamp: new Date().toISOString(),
  });

  // Read last 10 events
  const events = await readRecords("/events", { after: -10 });
  console.log("Recent events:", events.records);
}

main().catch(console.error);
```

### Python

```python
import requests
import json
from datetime import datetime

# Configuration
POD_URL = 'https://my-pod.webpods.org'
AUTH_TOKEN = 'your-jwt-token'

class WebPodsClient:
    def __init__(self, pod_url, auth_token):
        self.pod_url = pod_url
        self.headers = {
            'Authorization': f'Bearer {auth_token}',
            'Content-Type': 'application/json'
        }

    def write_record(self, stream, name=None, content=None):
        """Write a record to a stream"""
        data = {}
        if name:
            data['name'] = name
        if content:
            data['content'] = content

        response = requests.post(
            f'{self.pod_url}{stream}',
            headers=self.headers,
            json=data
        )
        return response.json()

    def read_records(self, stream, **params):
        """Read records from a stream"""
        response = requests.get(
            f'{self.pod_url}{stream}',
            headers=self.headers,
            params=params
        )
        return response.json()

    def delete_record(self, stream, name):
        """Delete a record"""
        response = requests.delete(
            f'{self.pod_url}{stream}/{name}',
            headers=self.headers
        )
        return response.status_code == 200

# Example usage
client = WebPodsClient(POD_URL, AUTH_TOKEN)

# Write sensor data
client.write_record('/sensors/temperature', None, {
    'value': 23.5,
    'unit': 'celsius',
    'location': 'room1',
    'timestamp': datetime.utcnow().isoformat()
})

# Read latest sensor data
data = client.read_records('/sensors/temperature', after=-10)
for record in data['records']:
    content = json.loads(record['content'])
    print(f"Temperature: {content['value']}°C at {content['timestamp']}")

# Store configuration
client.write_record('/config', 'app_settings', {
    'theme': 'dark',
    'language': 'en',
    'notifications': True
})

# Get latest configuration
config = client.read_records('/config', unique=True)
```

### cURL / Bash

```bash
#!/bin/bash

# Configuration
POD_URL="https://my-pod.webpods.org"
AUTH_TOKEN="your-jwt-token"

# Function to write record
write_record() {
  local stream=$1
  local name=$2
  local content=$3

  curl -X POST "${POD_URL}${stream}" \
    -H "Authorization: Bearer ${AUTH_TOKEN}" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${name}\", \"content\": ${content}}"
}

# Function to read records
read_records() {
  local stream=$1
  local params=$2

  curl -X GET "${POD_URL}${stream}?${params}" \
    -H "Authorization: Bearer ${AUTH_TOKEN}"
}

# Write log entry
write_record "/logs" "" '{
  "level": "info",
  "message": "Application started",
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

# Read last 20 logs
read_records "/logs" "after=-20"

# Write metric
write_record "/metrics/cpu" "" '{
  "usage": 45.2,
  "timestamp": "'$(date -u +"%Y-%m-%dT%H:%M:%SZ")'"
}'

# Store configuration
write_record "/config" "database" '{
  "host": "localhost",
  "port": 5432
}'

# Get unique configurations
read_records "/config" "unique=true"
```

## Audit Logging System

Complete audit trail with cryptographic integrity verification.

```javascript
// Audit logger implementation
class AuditLogger {
  constructor(podUrl, token) {
    this.podUrl = podUrl;
    this.token = token;
  }

  async logAction(action, details) {
    const auditEntry = {
      action: action,
      timestamp: new Date().toISOString(),
      user: details.user || "system",
      ip: details.ip,
      userAgent: details.userAgent,
      resource: details.resource,
      changes: details.changes,
      result: details.result || "success",
    };

    const response = await fetch(
      `${this.podUrl}/audit/${new Date().getFullYear()}`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ content: auditEntry }),
      },
    );

    return await response.json();
  }

  async verifyIntegrity(year) {
    const response = await fetch(`${this.podUrl}/audit/${year}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    const data = await response.json();
    const records = data.records;

    // Verify hash chain
    for (let i = 1; i < records.length; i++) {
      if (records[i].previous_hash !== records[i - 1].hash) {
        throw new Error(`Hash chain broken at index ${records[i].index}`);
      }
    }

    return { valid: true, recordCount: records.length };
  }

  async queryAuditLog(filters) {
    const response = await fetch(
      `${this.podUrl}/audit/${filters.year || new Date().getFullYear()}`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );

    const data = await response.json();
    let records = data.records.map((r) => JSON.parse(r.content));

    // Apply client-side filters
    if (filters.user) {
      records = records.filter((r) => r.user === filters.user);
    }
    if (filters.action) {
      records = records.filter((r) => r.action === filters.action);
    }
    if (filters.dateFrom) {
      records = records.filter(
        (r) => new Date(r.timestamp) >= new Date(filters.dateFrom),
      );
    }

    return records;
  }
}

// Usage
const audit = new AuditLogger("https://audit.webpods.org", "token");

// Log user action
await audit.logAction("USER_DELETE", {
  user: "admin",
  ip: "192.168.1.100",
  resource: "users/12345",
  changes: { status: "deleted" },
});

// Verify integrity
const integrity = await audit.verifyIntegrity(2024);
console.log("Audit log integrity:", integrity);

// Query audit logs
const logs = await audit.queryAuditLog({
  user: "admin",
  action: "USER_DELETE",
  year: 2024,
});
```

## IoT Data Collection

Collecting and analyzing sensor data from IoT devices.

```python
import asyncio
import aiohttp
import json
from datetime import datetime, timedelta
import statistics

class IoTDataCollector:
    def __init__(self, pod_url, token):
        self.pod_url = pod_url
        self.token = token
        self.session = None

    async def __aenter__(self):
        self.session = aiohttp.ClientSession(
            headers={'Authorization': f'Bearer {self.token}'}
        )
        return self

    async def __aexit__(self, exc_type, exc_val, exc_tb):
        await self.session.close()

    async def record_sensor_data(self, sensor_id, sensor_type, value, unit):
        """Record sensor reading"""
        data = {
            'content': {
                'sensor_id': sensor_id,
                'type': sensor_type,
                'value': value,
                'unit': unit,
                'timestamp': datetime.utcnow().isoformat()
            }
        }

        stream = f'/sensors/{sensor_type}/{sensor_id}/{datetime.utcnow().strftime("%Y/%m/%d")}'

        async with self.session.post(f'{self.pod_url}{stream}', json=data) as response:
            return await response.json()

    async def get_sensor_stats(self, sensor_id, sensor_type, hours=24):
        """Get sensor statistics for the last N hours"""
        # Calculate date range
        end_date = datetime.utcnow()
        start_date = end_date - timedelta(hours=hours)

        # Fetch data from relevant streams
        all_readings = []
        current_date = start_date

        while current_date <= end_date:
            stream = f'/sensors/{sensor_type}/{sensor_id}/{current_date.strftime("%Y/%m/%d")}'

            async with self.session.get(f'{self.pod_url}{stream}') as response:
                if response.status == 200:
                    data = await response.json()
                    for record in data['records']:
                        content = json.loads(record['content'])
                        reading_time = datetime.fromisoformat(content['timestamp'])
                        if start_date <= reading_time <= end_date:
                            all_readings.append(content['value'])

            current_date += timedelta(days=1)

        if not all_readings:
            return None

        return {
            'sensor_id': sensor_id,
            'type': sensor_type,
            'period_hours': hours,
            'reading_count': len(all_readings),
            'min': min(all_readings),
            'max': max(all_readings),
            'avg': statistics.mean(all_readings),
            'median': statistics.median(all_readings),
            'std_dev': statistics.stdev(all_readings) if len(all_readings) > 1 else 0
        }

    async def set_alert_threshold(self, sensor_id, sensor_type, min_val=None, max_val=None):
        """Set alert thresholds for a sensor"""
        data = {
            'name': f'{sensor_id}_threshold',
            'content': {
                'sensor_id': sensor_id,
                'type': sensor_type,
                'min_value': min_val,
                'max_value': max_val,
                'created_at': datetime.utcnow().isoformat()
            }
        }

        async with self.session.post(f'{self.pod_url}/alerts/config', json=data) as response:
            return await response.json()

# Example usage
async def main():
    async with IoTDataCollector('https://iot.webpods.org', 'token') as collector:
        # Record temperature readings
        await collector.record_sensor_data('temp_001', 'temperature', 23.5, 'celsius')
        await collector.record_sensor_data('temp_002', 'temperature', 24.1, 'celsius')

        # Record humidity readings
        await collector.record_sensor_data('hum_001', 'humidity', 65, 'percent')

        # Get statistics
        stats = await collector.get_sensor_stats('temp_001', 'temperature', hours=24)
        print(f"Temperature stats: {stats}")

        # Set alert threshold
        await collector.set_alert_threshold('temp_001', 'temperature', min_val=18, max_val=26)

asyncio.run(main())
```

## Event Sourcing System

Implementation of event sourcing pattern with WebPods.

```javascript
class EventStore {
  constructor(podUrl, token) {
    this.podUrl = podUrl;
    this.token = token;
  }

  // Append event to stream
  async appendEvent(streamName, event) {
    const eventWithMeta = {
      ...event,
      eventId: crypto.randomUUID(),
      timestamp: new Date().toISOString(),
      version: (await this.getStreamVersion(streamName)) + 1,
    };

    const response = await fetch(`${this.podUrl}/events/${streamName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content: eventWithMeta }),
    });

    return await response.json();
  }

  // Get current stream version
  async getStreamVersion(streamName) {
    const response = await fetch(
      `${this.podUrl}/events/${streamName}?after=-1`,
      {
        headers: { Authorization: `Bearer ${this.token}` },
      },
    );

    const data = await response.json();
    if (data.records.length === 0) return 0;

    const lastEvent = JSON.parse(data.records[0].content);
    return lastEvent.version || 0;
  }

  // Read events from stream
  async readEvents(streamName, fromVersion = 0) {
    const response = await fetch(`${this.podUrl}/events/${streamName}`, {
      headers: { Authorization: `Bearer ${this.token}` },
    });

    const data = await response.json();
    return data.records
      .map((r) => JSON.parse(r.content))
      .filter((e) => e.version > fromVersion)
      .sort((a, b) => a.version - b.version);
  }

  // Build aggregate from events
  async getAggregate(streamName, aggregateId) {
    const events = await this.readEvents(streamName);
    const relevantEvents = events.filter((e) => e.aggregateId === aggregateId);

    // Apply events to build current state
    let state = {};
    for (const event of relevantEvents) {
      state = this.applyEvent(state, event);
    }

    return state;
  }

  // Event application logic
  applyEvent(state, event) {
    switch (event.type) {
      case "OrderCreated":
        return {
          ...state,
          id: event.aggregateId,
          items: event.data.items,
          total: event.data.total,
          status: "pending",
        };

      case "OrderShipped":
        return {
          ...state,
          status: "shipped",
          shippedAt: event.timestamp,
          trackingNumber: event.data.trackingNumber,
        };

      case "OrderDelivered":
        return {
          ...state,
          status: "delivered",
          deliveredAt: event.timestamp,
        };

      default:
        return state;
    }
  }

  // Create snapshot for performance
  async createSnapshot(streamName, aggregateId) {
    const state = await this.getAggregate(streamName, aggregateId);
    const version = await this.getStreamVersion(streamName);

    const snapshot = {
      aggregateId,
      version,
      state,
      createdAt: new Date().toISOString(),
    };

    const response = await fetch(`${this.podUrl}/snapshots/${streamName}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        name: `${aggregateId}_v${version}`,
        content: snapshot,
      }),
    });

    return await response.json();
  }
}

// Usage example
const eventStore = new EventStore("https://events.webpods.org", "token");

// Create order
await eventStore.appendEvent("orders", {
  type: "OrderCreated",
  aggregateId: "order_123",
  data: {
    items: [{ product: "Widget", quantity: 2, price: 29.99 }],
    total: 59.98,
  },
});

// Ship order
await eventStore.appendEvent("orders", {
  type: "OrderShipped",
  aggregateId: "order_123",
  data: {
    trackingNumber: "TRACK123456",
  },
});

// Get current order state
const orderState = await eventStore.getAggregate("orders", "order_123");
console.log("Current order state:", orderState);
```

## Blog Platform

Complete blog implementation with comments and RSS.

```javascript
class BlogPlatform {
  constructor(podUrl) {
    this.podUrl = podUrl;
  }

  // Create blog post
  async createPost(post) {
    const slug = post.title.toLowerCase().replace(/\s+/g, "-");
    const year = new Date().getFullYear();

    const response = await fetch(`${this.podUrl}/posts/${year}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: slug,
        content: {
          ...post,
          slug,
          published: new Date().toISOString(),
          updated: new Date().toISOString(),
        },
      }),
    });

    return await response.json();
  }

  // Get posts with pagination
  async getPosts(page = 1, limit = 10) {
    const offset = (page - 1) * limit;
    const response = await fetch(
      `${this.podUrl}/posts?recursive=true&unique=true&after=${offset}&limit=${limit}`,
    );

    const data = await response.json();
    return data.records.map((r) => JSON.parse(r.content));
  }

  // Get single post
  async getPost(year, slug) {
    const response = await fetch(`${this.podUrl}/posts/${year}/${slug}`);
    if (!response.ok) return null;

    const data = await response.json();
    return JSON.parse(data.content);
  }

  // Add comment
  async addComment(postSlug, comment) {
    const response = await fetch(`${this.podUrl}/comments/${postSlug}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: {
          ...comment,
          timestamp: new Date().toISOString(),
        },
      }),
    });

    return await response.json();
  }

  // Generate RSS feed
  async generateRSS() {
    const posts = await this.getPosts(1, 20);

    const rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>My Blog</title>
    <link>${this.podUrl}</link>
    <description>A blog powered by WebPods</description>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    ${posts
      .map(
        (post) => `
    <item>
      <title>${this.escapeXml(post.title)}</title>
      <link>${this.podUrl}/posts/${new Date(post.published).getFullYear()}/${post.slug}</link>
      <description>${this.escapeXml(post.excerpt || post.content.substring(0, 200))}</description>
      <pubDate>${new Date(post.published).toUTCString()}</pubDate>
      <guid>${this.podUrl}/posts/${new Date(post.published).getFullYear()}/${post.slug}</guid>
    </item>`,
      )
      .join("")}
  </channel>
</rss>`;

    return rss;
  }

  escapeXml(text) {
    return text
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
  }
}

// Usage
const blog = new BlogPlatform("https://my-blog.webpods.org");

// Create post
await blog.createPost({
  title: "Getting Started with WebPods",
  content: "WebPods is a powerful data platform...",
  excerpt: "Learn how to get started with WebPods",
  tags: ["webpods", "tutorial"],
  author: "John Doe",
});

// Get recent posts
const posts = await blog.getPosts(1, 10);

// Add comment
await blog.addComment("getting-started-with-webpods", {
  author: "Jane Smith",
  email: "jane@example.com",
  content: "Great article!",
});

// Generate RSS
const rssFeed = await blog.generateRSS();
```

## Configuration Management

Managing application configuration with version history.

```python
class ConfigManager:
    def __init__(self, pod_url, token):
        self.pod_url = pod_url
        self.token = token
        self.headers = {
            'Authorization': f'Bearer {token}',
            'Content-Type': 'application/json'
        }

    def set_config(self, key, value, metadata=None):
        """Set configuration value"""
        config_data = {
            'name': key,
            'content': {
                'value': value,
                'updated_at': datetime.utcnow().isoformat(),
                'updated_by': metadata.get('user', 'system') if metadata else 'system',
                'version': self.get_version(key) + 1,
                'metadata': metadata
            }
        }

        response = requests.post(
            f'{self.pod_url}/config',
            headers=self.headers,
            json=config_data
        )
        return response.json()

    def get_config(self, key):
        """Get latest configuration value"""
        response = requests.get(
            f'{self.pod_url}/config?unique=true',
            headers=self.headers
        )

        data = response.json()
        for record in data['records']:
            if record['name'] == key:
                content = json.loads(record['content'])
                return content['value']
        return None

    def get_version(self, key):
        """Get current version number"""
        response = requests.get(
            f'{self.pod_url}/config',
            headers=self.headers
        )

        data = response.json()
        version = 0
        for record in data['records']:
            if record['name'] == key:
                content = json.loads(record['content'])
                version = max(version, content.get('version', 0))
        return version

    def get_history(self, key):
        """Get configuration history"""
        response = requests.get(
            f'{self.pod_url}/config',
            headers=self.headers
        )

        data = response.json()
        history = []
        for record in data['records']:
            if record['name'] == key:
                content = json.loads(record['content'])
                history.append({
                    'version': content.get('version', 0),
                    'value': content['value'],
                    'updated_at': content['updated_at'],
                    'updated_by': content.get('updated_by', 'unknown')
                })

        return sorted(history, key=lambda x: x['version'])

    def rollback(self, key, version):
        """Rollback to specific version"""
        history = self.get_history(key)
        for entry in history:
            if entry['version'] == version:
                return self.set_config(key, entry['value'], {
                    'rollback_from': self.get_version(key),
                    'rollback_to': version
                })
        raise ValueError(f"Version {version} not found for key {key}")

# Usage
config = ConfigManager('https://app.webpods.org', 'token')

# Set configuration
config.set_config('database_url', 'postgres://localhost/myapp', {
    'user': 'admin',
    'reason': 'Initial setup'
})

# Update configuration
config.set_config('database_url', 'postgres://prod-server/myapp', {
    'user': 'admin',
    'reason': 'Move to production'
})

# Get current value
db_url = config.get_config('database_url')
print(f"Current database URL: {db_url}")

# View history
history = config.get_history('database_url')
for entry in history:
    print(f"v{entry['version']}: {entry['value']} (by {entry['updated_by']})")

# Rollback to version 1
config.rollback('database_url', 1)
```

These examples demonstrate the versatility of WebPods for building various types of applications while maintaining data integrity, immutability, and complete audit trails.
