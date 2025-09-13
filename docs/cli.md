# CLI Reference

Complete documentation for the WebPods command-line interface (`podctl`).

## Installation

### npm (Node.js required)

```bash
# Install globally
npm install -g @webpods/podctl

# Verify installation
podctl --version
```

### Direct Download

Binaries available for macOS, Linux, and Windows from [GitHub Releases](https://github.com/webpods-org/webpods/releases).

## Configuration

### Initial Setup

```bash
# Configure default server (defaults to http://localhost:3000)
podctl config set server https://webpods.org

# Or use profiles for multiple servers
podctl profile add production --server https://webpods.org
podctl profile add local --server http://localhost:3000
podctl profile use production
```

### Configuration File

Configuration stored in `~/.webpods/config.json`:

```json
{
  "currentProfile": "production",
  "profiles": {
    "production": {
      "server": "https://webpods.org",
      "token": "jwt_token_here"
    },
    "local": {
      "server": "http://localhost:3000",
      "token": "jwt_token_here"
    }
  }
}
```

## Authentication Commands

### `podctl auth login`

Authenticate with WebPods server using OAuth provider.

```bash
podctl auth login

# Output:
# Available providers:
# 1. github
# 2. google
# 3. microsoft
#
# Select provider or enter number: github
#
# Opening browser to: https://webpods.org/auth/github
# After authenticating, copy your token and run:
# podctl auth token set YOUR_TOKEN
```

**Options:**

- `--provider PROVIDER` - Skip provider selection

### `podctl auth token set`

Set authentication token obtained from login.

```bash
podctl auth token set "eyJhbGciOiJIUzI1NiIs..."

# With profile
podctl auth token set "token" --profile staging
```

### `podctl auth token get`

Display current authentication token.

```bash
podctl auth token get

# Output: eyJhbGciOiJIUzI1NiIs...
```

**Options:**

- `--decode` - Show decoded token payload

### `podctl auth info`

Show current authenticated user information.

```bash
podctl auth info

# Output:
# User ID: github:12345
# Username: alice
# Email: alice@example.com
# Provider: github
# Server: https://webpods.org
```

### `podctl auth logout`

Logout and clear stored token.

```bash
podctl auth logout

# Output: Logged out successfully
```

## Pod Commands

### `podctl pod create`

Create a new pod.

```bash
podctl pod create my-pod

# Output:
# Pod 'my-pod' created successfully
# URL: https://my-pod.webpods.org
```

**Arguments:**

- `NAME` - Pod name (lowercase, alphanumeric, hyphens)

**Options:**

- `--public` - Make pod publicly readable by default

### `podctl pod list`

List all pods owned by authenticated user.

```bash
podctl pod list

# Output:
# NAME          CREATED
# my-pod        2024-01-15T10:30:00Z
# test-pod      2024-01-14T09:20:00Z
# data-store    2024-01-13T08:15:00Z
```

**Options:**

- `--json` - Output as JSON
- `--verbose` - Show additional details

### `podctl pod info`

Get detailed information about a pod.

```bash
podctl pod info my-pod

# Output:
# Name: my-pod
# Owner: github:12345
# Created: 2024-01-15T10:30:00Z
# Streams: 15
# Records: 342
# URL: https://my-pod.webpods.org
```

**Arguments:**

- `NAME` - Pod name

### `podctl pod delete`

Delete a pod and all its data.

```bash
podctl pod delete my-pod

# Confirmation prompt:
# Delete pod 'my-pod' and all its data? This cannot be undone. (y/N): y
# Pod 'my-pod' deleted successfully

# Skip confirmation
podctl pod delete my-pod --force
```

**Arguments:**

- `NAME` - Pod name

**Options:**

- `--force` - Skip confirmation prompt

### `podctl pod transfer`

Transfer pod ownership to another user.

```bash
podctl pod transfer my-pod github:67890

# Confirmation prompt:
# Transfer pod 'my-pod' to user 'github:67890'? (y/N): y
# Pod transferred successfully

# Skip confirmation
podctl pod transfer my-pod github:67890 --force
```

**Arguments:**

- `POD` - Pod name
- `USER` - New owner's user ID

**Options:**

- `--force` - Skip confirmation prompt

## Stream Commands

### `podctl stream create`

Create a new stream or update stream settings.

```bash
# Create public stream
podctl stream create my-pod /blog/posts --access public

# Create private stream
podctl stream create my-pod /private/data --access private

# Output: Stream '/blog/posts' created successfully
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path

**Options:**

- `--access TYPE` - Access level: public, private (default: private)
- `--parent PATH` - Parent stream path

### `podctl stream list`

List all streams in a pod.

```bash
podctl stream list my-pod

# Output:
# PATH                 RECORDS  ACCESS   CREATED
# /blog                10       public   2024-01-15T10:30:00Z
# /blog/posts          25       public   2024-01-15T10:31:00Z
# /config              5        private  2024-01-14T09:20:00Z
# /logs                150      private  2024-01-13T08:15:00Z
```

**Arguments:**

- `POD` - Pod name

**Options:**

- `--json` - Output as JSON
- `--tree` - Display as tree structure

### `podctl stream delete`

Delete a stream and all its records.

```bash
podctl stream delete my-pod /old/data

# Confirmation prompt:
# Delete stream '/old/data' and all its records? (y/N): y
# Stream deleted successfully

# Delete with child streams
podctl stream delete my-pod /parent --recursive --force
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path

**Options:**

- `--force` - Skip confirmation
- `--recursive` - Delete child streams

## Record Commands

### `podctl record write`

Write a record to a stream.

```bash
# Write text data (auto-named)
podctl record write my-pod /notes "Remember to buy milk"

# Write JSON data (auto-named)
podctl record write my-pod /logs '{"event": "login", "user": "alice"}'

# Write with specific name
podctl record write my-pod /config theme '{"mode": "dark"}'

# Write from file
podctl record write my-pod /data report < report.json

# Write with custom headers
podctl record write my-pod /audit event "User deleted" \
  --header "X-Source=cli" \
  --header "X-User=admin"

# Output:
# Record written successfully
# Index: 42
# Name: 42 (or specified name)
# Hash: sha256:abc123...
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path
- `NAME` (optional) - Record name
- `DATA` - Record content (or pipe from stdin)

**Options:**

- `--type TYPE` - Content type (default: auto-detect)
- `--header KEY=VALUE` - Add custom header

### `podctl record read`

Read records from a stream.

```bash
# Read all records in stream
podctl record read my-pod /blog/posts

# Read specific record by name
podctl record read my-pod /config theme

# Read specific record by index
podctl record read my-pod /logs 42

# Read with pagination
podctl record read my-pod /logs --limit 10 --after 20

# Read last 20 records
podctl record read my-pod /logs --after -20

# Read unique records only
podctl record read my-pod /config --unique

# Output format options
podctl record read my-pod /data --format json
podctl record read my-pod /data --format yaml
podctl record read my-pod /data --format table
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path
- `NAME` (optional) - Record name or index

**Options:**

- `--limit N` - Maximum records to return
- `--after N` - Skip records (negative for last N)
- `--before N` - Get records before index
- `--unique` - Show only latest named records
- `--include-deleted` - Include deleted records
- `--format FORMAT` - Output format: json, yaml, table, raw
- `--fields FIELDS` - Comma-separated fields to include

### `podctl record list`

List records in a stream (simplified output).

```bash
podctl record list my-pod /blog/posts

# Output:
# INDEX  NAME       CREATED                DELETED
# 1      1          2024-01-15T10:30:00Z   false
# 2      welcome    2024-01-15T10:31:00Z   false
# 3      3          2024-01-15T10:32:00Z   false
# 4      update     2024-01-15T10:33:00Z   true

# With pagination
podctl record list my-pod /logs --limit 20 --after 100
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path

**Options:**

- `--limit N` - Maximum records to return
- `--after N` - Skip records
- `--unique` - Show only latest named records
- `--include-deleted` - Include deleted records

### `podctl record delete`

Mark a record as deleted.

```bash
podctl record delete my-pod /old/data record-name

# Confirmation prompt:
# Delete record 'record-name'? (y/N): y
# Record marked as deleted

# Skip confirmation
podctl record delete my-pod /old/data 42 --force

# Permanently delete (if authorized)
podctl record delete my-pod /sensitive secret-data --purge --force
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path
- `NAME` - Record name or index

**Options:**

- `--force` - Skip confirmation
- `--purge` - Permanently delete (requires permission)

### `podctl record verify`

Verify hash chain integrity of records.

```bash
podctl record verify my-pod /audit

# Output:
# Verifying stream: /audit
# Records verified: 150
# Hash chain: VALID
# Integrity: VERIFIED

# Verify specific range
podctl record verify my-pod /logs --after 100 --before 200

# If tampering detected:
# Hash chain BROKEN at record 42
# Expected: sha256:abc123...
# Found: sha256:def456...
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path

**Options:**

- `--after N` - Start verification from index
- `--before N` - Stop verification at index
- `--verbose` - Show detailed verification

## Permission Commands

### `podctl permission grant`

Grant user access to a stream.

```bash
# Grant read access
podctl permission grant my-pod /private/data github:67890 --read

# Grant write access
podctl permission grant my-pod /shared/docs github:67890 --write

# Grant both read and write
podctl permission grant my-pod /team/work github:67890 --read --write

# Output: Permissions granted to github:67890
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path
- `USER` - User ID to grant access

**Options:**

- `--read` - Grant read permission
- `--write` - Grant write permission

### `podctl permission revoke`

Revoke user access to a stream.

```bash
podctl permission revoke my-pod /private/data github:67890

# Output: Permissions revoked for github:67890
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path
- `USER` - User ID to revoke

### `podctl permission list`

List permissions for a stream.

```bash
podctl permission list my-pod /shared/docs

# Output:
# USER           READ  WRITE
# github:12345   Yes   Yes    (owner)
# github:67890   Yes   No
# github:11111   Yes   Yes
```

**Arguments:**

- `POD` - Pod name
- `PATH` - Stream path

## Profile Commands

### `podctl profile add`

Add a new server profile.

```bash
podctl profile add staging --server https://staging.webpods.com

# Output: Profile 'staging' added
```

**Arguments:**

- `NAME` - Profile name

**Options:**

- `--server URL` - Server URL
- `--set-current` - Make this the current profile

### `podctl profile use`

Switch to a different profile.

```bash
podctl profile use staging

# Output: Switched to profile 'staging'
```

**Arguments:**

- `NAME` - Profile name

### `podctl profile list`

List all configured profiles.

```bash
podctl profile list

# Output:
# PROFILE      SERVER                      CURRENT
# production   https://webpods.org         *
# staging      https://staging.webpods.com
# local        http://localhost:3000
```

### `podctl profile remove`

Remove a profile.

```bash
podctl profile remove old-server

# Output: Profile 'old-server' removed
```

**Arguments:**

- `NAME` - Profile name

### `podctl profile current`

Show current profile details.

```bash
podctl profile current

# Output:
# Profile: production
# Server: https://webpods.org
# Token: Set
```

## Configuration Commands

### `podctl config get`

Get configuration value.

```bash
podctl config get server
# Output: https://webpods.org

podctl config get profile
# Output: production
```

**Arguments:**

- `KEY` - Configuration key

### `podctl config set`

Set configuration value.

```bash
podctl config set server https://webpods.org
podctl config set timeout 30000
```

**Arguments:**

- `KEY` - Configuration key
- `VALUE` - Configuration value

### `podctl config list`

List all configuration values.

```bash
podctl config list

# Output:
# server: https://webpods.org
# profile: production
# timeout: 10000
# format: json
```

## Global Options

These options work with all commands:

- `--profile PROFILE` - Use specific profile for this command
- `--server URL` - Override server URL for this command
- `--token TOKEN` - Use specific token for this command
- `--json` - Output in JSON format
- `--quiet` - Suppress non-essential output
- `--verbose` - Show detailed output
- `--no-color` - Disable colored output
- `--help` - Show help for command
- `--version` - Show CLI version

## Environment Variables

The CLI respects these environment variables:

- `WEBPODS_SERVER` - Default server URL
- `WEBPODS_TOKEN` - Authentication token
- `WEBPODS_PROFILE` - Default profile to use
- `WEBPODS_CONFIG_DIR` - Configuration directory (default: ~/.webpods)
- `NO_COLOR` - Disable colored output

## Examples

### Complete Workflow

```bash
# 1. Setup and authenticate
podctl profile add prod --server https://webpods.org
podctl profile use prod
podctl auth login
podctl auth token set "your-token-here"

# 2. Create pod and streams
podctl pod create my-app
podctl stream create my-app /config --access private
podctl stream create my-app /blog --access public

# 3. Write data
podctl record write my-app /config settings '{"theme": "dark"}'
podctl record write my-app /blog/posts "First post content"

# 4. Read data
podctl record read my-app /config settings
podctl record list my-app /blog/posts

# 5. Manage permissions
podctl permission grant my-app /private github:67890 --read
podctl permission list my-app /private
```

### Working with Multiple Servers

```bash
# Add profiles for different environments
podctl profile add prod --server https://webpods.org
podctl profile add dev --server http://localhost:3000

# Login to each
podctl profile use prod
podctl auth login
podctl auth token set "prod-token"

podctl profile use dev
podctl auth login
podctl auth token set "dev-token"

# Use different profiles
podctl pod list --profile prod
podctl pod list --profile dev

# Or switch profiles
podctl profile use prod
podctl pod list
```

### Scripting with podctl

```bash
#!/bin/bash

# Write sensor data every minute
while true; do
  TEMP=$(sensors | grep "Core 0" | awk '{print $3}')
  podctl record write iot-pod /sensors/cpu "$(date -Iseconds) $TEMP"
  sleep 60
done
```

### Backup and Restore

```bash
# Backup: Export all records
podctl record read backup-pod /data --format json > backup.json

# Restore: Import records
cat backup.json | jq -r '.records[].content' | while read line; do
  podctl record write new-pod /data "$line"
done
```

## Error Handling

The CLI uses standard exit codes:

- `0` - Success
- `1` - General error
- `2` - Authentication error
- `3` - Network error
- `4` - Not found error
- `5` - Permission denied
- `6` - Invalid input

Check exit codes in scripts:

```bash
if podctl pod create test-pod; then
  echo "Pod created"
else
  echo "Failed to create pod"
  exit 1
fi
```

## Troubleshooting

### Connection Issues

```bash
# Test connection to server
podctl auth info

# Use verbose mode for debugging
podctl pod list --verbose

# Check configured server
podctl config get server
```

### Authentication Problems

```bash
# Re-authenticate
podctl auth logout
podctl auth login
podctl auth token set "new-token"

# Verify token
podctl auth token get --decode
```

### Profile Issues

```bash
# Check current profile
podctl profile current

# List all profiles
podctl profile list

# Reset to default
podctl profile use default
```
