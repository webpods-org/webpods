# WebPods CLI

Command-line interface for managing WebPods - distributed, user-owned data stores with append-only logs.

## Installation

```bash
# Install globally
npm install -g webpods-cli

# Or run with npx
npx webpods-cli
```

## Quick Start

```bash
# 1. Authenticate with WebPods
pod login
# Follow the instructions to get your token

# 2. Set your token
pod token set <your-token>

# 3. Create your first pod
pod create my-pod

# 4. Write data to a stream
pod write my-pod notes/today "My first note"

# 5. Read it back
pod read my-pod notes/today
```

## Authentication

### Login

Start the OAuth authentication flow:

```bash
pod login [--provider github]
```

This will print a URL to visit in your browser. After authenticating, copy the token from the success page.

### Set Token

Store your authentication token:

```bash
pod token set <token>
```

### Check Current User

```bash
pod whoami
```

### Logout

Clear stored authentication:

```bash
pod logout
```

## Pod Management

### Create a Pod

```bash
pod create <name>
```

Pod names must be lowercase letters, numbers, and hyphens only.

### List Your Pods

```bash
pod list [--format json|yaml|table|csv]
```

### Get Pod Information

```bash
pod info <pod-name>
```

### Delete a Pod

```bash
pod delete <pod-name> [--force]
```

⚠️ This will delete all data in the pod!

## Working with Streams and Records

### Write Data

Write data to a stream record:

```bash
# Write inline data
pod write <pod> <stream> <record-name> '{"data": "value"}'

# Write from file
pod write <pod> <stream> <record-name> --file data.json

# Set permissions (public, private, or /permission-stream)
pod write <pod> <stream> <record-name> '{"data": "value"}' --permission public
```

### Read Data

```bash
# Read specific record by name
pod read <pod> <stream> <record-name>

# Read latest record in stream
pod read <pod> <stream>

# Read by index (0-based)
pod read <pod> <stream> --index 0

# Read by negative index (-1 is latest)
pod read <pod> <stream> --index -1

# Save to file
pod read <pod> <stream> <record-name> --output data.json
```

### List Records

```bash
# List all records
pod list <pod> <stream>

# Limit results
pod list <pod> <stream> --limit 10

# Pagination
pod list <pod> <stream> --after 50

# Show only unique named records (latest version of each)
pod list <pod> <stream> --unique

# Different output formats
pod list <pod> <stream> --format json
```

### List Streams

```bash
pod streams <pod>
```

### Delete Stream

```bash
pod delete-stream <pod> <stream> [--force]
```

## Permissions

WebPods supports three permission modes:

- `private` - Only the pod owner can access
- `public` - Anyone can read (write still requires auth)
- `/stream-path` - Permission controlled by another stream

### View Permissions

```bash
pod permissions <pod> <stream> view
```

### Set Permission Mode

```bash
pod permissions <pod> <stream> set --mode public
pod permissions <pod> <stream> set --mode /permissions/readers
```

### Grant User Access

```bash
pod permissions <pod> <stream> grant --user <user-id>
```

### Revoke User Access

```bash
pod permissions <pod> <stream> revoke --user <user-id>
```

### List Permission Records

```bash
pod permissions <pod> <stream> list
```

## OAuth Client Management

### Register OAuth Client

```bash
pod oauth register --name "My App" --redirect "https://myapp.com/callback" [--pods pod1,pod2]
```

### List Your OAuth Clients

```bash
pod oauth list
```

### Get Client Details

```bash
pod oauth info <client-id>
```

### Delete OAuth Client

```bash
pod oauth delete <client-id> [--force]
```

## Configuration

### View Configuration

```bash
pod config
```

### Set Server URL

```bash
pod config server https://api.webpods.org
```

### Set Configuration Value

```bash
pod config <key> <value>
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
pod create my-blog

# Write blog posts
pod write my-blog posts/welcome '{"title": "Welcome!", "content": "Hello world"}'
pod write my-blog posts/second '{"title": "Second Post", "content": "More content"}'

# Make posts public
pod permissions my-blog posts set --mode public

# List all posts
pod list my-blog posts
```

### Collaborative Notes

```bash
# Create shared pod
pod create team-notes

# Create permission stream
pod write team-notes permissions/editors '{"id": "user123", "read": true, "write": true}'

# Set stream to use permissions
pod permissions team-notes notes set --mode /permissions/editors

# Write notes
pod write team-notes notes/meeting "Meeting notes..."
```

### Data Backup

```bash
# Export all records from a stream
pod list my-pod important-data --format json > backup.json

# Read specific record to file
pod read my-pod config settings --output settings.json
```

## Environment Variables

- `WEBPODS_SERVER` - Default server URL
- `WEBPODS_TOKEN` - Default authentication token
- `HOME/.webpods/config.json` - Configuration file location

## Troubleshooting

### Authentication Issues

- Ensure your token is valid: `pod whoami`
- Try re-authenticating: `pod logout` then `pod login`

### Network Issues

- Check server URL: `pod config`
- Test connection: `pod whoami --server <url>`

### Permission Denied

- Verify you own the pod: `pod info <pod>`
- Check stream permissions: `pod permissions <pod> <stream> view`

## Development

```bash
# Clone the repository
git clone https://github.com/webpods-org/webpods.git
cd webpods/node/packages/webpods-cli

# Install dependencies
npm install

# Build
npm run build

# Run locally
node dist/index.js <command>

# Run tests
cd ../webpods-cli-tests
npm test
```

## License

MIT

## Support

- GitHub Issues: https://github.com/webpods-org/webpods/issues
- Documentation: https://docs.webpods.org
