# podctl

Command-line interface for managing WebPods - distributed, user-owned data stores with append-only logs.

## Installation

```bash
# Install globally
npm install -g @webpods/podctl

# Or run with npx
npx @webpods/podctl
```

## Quick Start

```bash
# 1. Authenticate with WebPods
podctl login
# Follow the instructions to get your token

# 2. Create your first pod
podctl pod create my-pod

# 3. Write data to a stream
podctl record write my-pod notes/today "My first note"

# 4. Read it back
podctl record read my-pod notes/today
```

## Authentication

### Login

Start the OAuth authentication flow:

```bash
# Show all available OAuth providers for the current server
podctl login
# Or use the full command
podctl auth login
```

This will print login URL(s) to visit in your browser. After authenticating, copy the token from the success page.

### Check Current User

```bash
podctl auth info
```

### Logout

Clear stored authentication:

```bash
podctl logout
# Or use the full command
podctl auth logout
```

**Note:** `podctl login` and `podctl logout` are convenient aliases for `podctl auth login` and `podctl auth logout`.

## Pod Management

### Create a Pod

```bash
podctl pod create <name>
```

Pod names must be lowercase letters, numbers, and hyphens only.

### List Your Pods

```bash
podctl pod list [--format json|yaml|table|csv]
```

### Get Pod Information

```bash
podctl pod info <pod-name>
```

### Delete a Pod

```bash
podctl pod delete <pod-name> [--force]
```

⚠️ This will delete all data in the pod!

### Transfer Pod Ownership

```bash
podctl pod transfer <pod-name> <new-owner-id> [--force]
```

⚠️ This will permanently transfer ownership of the pod!

## Working with Streams and Records

### Stream Management

#### Create Stream

```bash
podctl stream create <pod> <stream> [--access public|private|/permission-path]
```

#### List Streams

```bash
podctl stream list <pod>
```

#### Delete Stream

```bash
podctl stream delete <pod> <stream> [--force]
```

### Record Management

#### Write Data

Write data to a stream record:

```bash
# Write inline data
podctl record write <pod> <stream> <record-name> '{"data": "value"}'

# Write from file
podctl record write <pod> <stream> <record-name> --file data.json

# Set permissions (public, private, or /permission-stream)
podctl record write <pod> <stream> <record-name> '{"data": "value"}' --permission public

# Add custom headers to the record
podctl record write <pod> <stream> <record-name> '{"data": "value"}' -H "cache-control:no-cache"

# Multiple headers can be specified
podctl record write <pod> <stream> <record-name> '{"data": "value"}' \
  -H "cache-control:private" \
  -H "hello-world:greeting"
```

**Note:** Headers must be configured as allowed in the server configuration. The header format is `key:value` and multiple headers can be specified with multiple `-H` or `--header` flags.

#### Read Data

```bash
# Read specific record by name
podctl record read <pod> <stream> <record-name>

# Read by index (0-based)
podctl record read <pod> <stream> --index 0

# Read by negative index (-1 is latest)
podctl record read <pod> <stream> --index -1

# Save to file
podctl record read <pod> <stream> <record-name> --output data.json
```

#### Delete Record

```bash
# Soft delete (default) - creates deletion marker, preserves data
podctl record delete <pod> <stream> <record-name> [--force]

# Hard delete/purge - permanently erases content, preserves hash chain
podctl record delete <pod> <stream> <record-name> --purge [--force]
```

**Soft Delete (default):**

- Creates a new deletion marker record
- Record becomes invisible to normal queries
- Original data preserved in history

**Hard Delete (with `--purge`):**

- Permanently erases content from ALL records with this name
- Preserves hash values for chain integrity
- Cannot be undone

#### List Records

```bash
# List all records
podctl record list <pod> <stream>

# Limit results
podctl record list <pod> <stream> --limit 10

# Pagination
podctl record list <pod> <stream> --after 50

# Show only unique named records (latest version of each)
podctl record list <pod> <stream> --unique

# Different output formats
podctl record list <pod> <stream> --format json
```

#### Verify Stream Integrity

```bash
# Show stream summary
podctl record verify <pod> <stream>

# Show full hash chain
podctl record verify <pod> <stream> --show-chain

# Check integrity
podctl record verify <pod> <stream> --check-integrity
```

## Permissions

WebPods supports three permission modes:

- `private` - Only the podctl owner can access
- `public` - Anyone can read (write still requires auth)
- `/stream-path` - Permission controlled by another stream

### Grant User Access

```bash
podctl permission grant <pod> <stream> <user-id>
```

### Revoke User Access

```bash
podctl permission revoke <pod> <stream> <user-id>
```

### List Permission Records

```bash
podctl permission list <pod> <stream>
```

## OAuth Client Management

### Register OAuth Client

```bash
podctl oauth register --name "My App" --redirect "https://myapp.com/callback" [--pods pod1,pod2]
```

### List Your OAuth Clients

```bash
podctl oauth list
```

### Get Client Details

```bash
podctl oauth info <client-id>
```

### Delete OAuth Client

```bash
podctl oauth delete <client-id> [--force]
```

## Links

### Set a Link

```bash
podctl link set <key> <target-pod> <target-stream>
```

### List Links

```bash
podctl link list
```

### Remove a Link

```bash
podctl link remove <key>
```

## Rate Limits

### View Rate Limit Information

```bash
podctl limit info
```

## Configuration

### View Current Configuration

```bash
podctl config
```

This shows the current profile settings including server URL, authentication status, and preferences.

### Managing Server URLs

Server URLs are managed through profiles:

```bash
# Add a new profile with a different server
podctl profile add myserver --server https://my-webpods.com

# Switch to that profile
podctl profile use myserver

# List all profiles
podctl profile list
```

### Set Configuration Values

```bash
# Set output format or default pod
podctl config <key> <value>

# Valid keys: outputFormat, defaultPod
podctl config outputFormat json
podctl config defaultPod my-main-pod
```

## Global Options

All commands support these options:

- `--server <url>` - Override default server URL
- `--token <token>` - Use specific token for this command
- `--format <format>` - Output format (json, yaml, table, csv)
- `--quiet` - Suppress non-essential output
- `--verbose` - Show detailed output
- `--no-color` - Disable colored output
- `--help` - Show command help

## Examples

### Blog System

```bash
# Create a blog pod
podctl pod create my-blog

# Create public posts stream
podctl stream create my-blog posts --access public

# Write blog posts
podctl record write my-blog posts welcome '{"title": "Welcome!", "content": "Hello world"}'
podctl record write my-blog posts second '{"title": "Second Post", "content": "More content"}'

# List all posts
podctl record list my-blog posts
```

### Collaborative Notes

```bash
# Create shared pod
podctl pod create team-notes

# Create permission stream and add editors
podctl stream create team-notes permissions/editors --access private
podctl record write team-notes permissions/editors user123 '{"userId": "user123", "read": true, "write": true}'

# Create notes stream controlled by permissions
podctl stream create team-notes notes --access /permissions/editors

# Write notes
podctl record write team-notes notes meeting "Meeting notes..."
```

### Data Backup

```bash
# Export all records from a stream
podctl record list my-pod important-data --format json > backup.json

# Read specific record to file
podctl record read my-pod config settings --output settings.json

# Verify stream integrity before backup
podctl record verify my-pod important-data --check-integrity
```

## Environment Variables

- `WEBPODS_SERVER` - Default server URL
- `WEBPODS_TOKEN` - Default authentication token
- `HOME/.webpods/config.json` - Configuration file location

## Troubleshooting

### Authentication Issues

- Ensure your token is valid: `podctl auth info`
- Try re-authenticating: `podctl logout` then `podctl login`

### Network Issues

- Check server URL: `podctl config`
- Test connection: `podctl auth info --server <url>`

### Permission Denied

- Verify you own the pod: `podctl pod info <pod>`
- Check stream permissions: `podctl permission list <pod> <stream>`

## Development

```bash
# Clone the repository
git clone https://github.com/webpods-org/webpods.git
cd webpods/node/packages/podctl

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js <command>

# Run tests
cd ../podctl-tests
npm test
```

## License

MIT

## Support

- GitHub Issues: https://github.com/webpods-org/webpods/issues
- Documentation: https://docs.webpods.org
