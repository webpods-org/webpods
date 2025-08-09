# WebPods

Append-only log service with OAuth authentication. Users can write strings or JSON to named queues and read them back.

## Quick Start

### Prerequisites
- Node.js 22+
- PostgreSQL 16+
- Google OAuth credentials

### Local Development

1. Clone the repository:
```bash
git clone https://github.com/webpods-org/webpods.git
cd webpods
```

2. Start PostgreSQL:
```bash
cd devenv
./run.sh up
```

3. Copy environment variables:
```bash
cp .env.example .env
# Edit .env with your Google OAuth credentials
```

4. Build and run:
```bash
./build.sh --migrate
./start.sh
```

The server will be running at `http://localhost:3000`

### Docker

```bash
# Build image
./scripts/docker-build.sh

# Run with docker-compose
docker-compose up
```

## API Overview

### Authentication
```
GET /auth/google?redirect_uri={uri}  # OAuth login
```

### Queue Operations
```
POST /q/{q_id}                       # Write to queue
GET /q/{q_id}                        # List records
GET /q/{q_id}/{index}                # Get single record
DELETE /q/{q_id}                     # Delete queue
```

### Permissions
- `public` - Anyone can read/write
- `private` - Only creator can read/write
- `/queue-name` - Users in allow list
- `~/queue-name` - Users NOT in deny list

## Project Structure

```
webpods/
├── node/packages/
│   ├── webpods/                    # Main server package
│   ├── webpods-test-utils/         # Test utilities
│   └── webpods-integration-tests/  # Integration tests
├── database/                       # Migrations
├── scripts/                        # Build and deployment scripts
└── devenv/                         # Local development environment
```

## Development

```bash
# Install dependencies
./build.sh --install

# Run tests
npm test

# Lint code
npm run lint

# Run migrations
npm run migrate:webpods:latest
```

## Testing

```bash
# Run integration tests
npm run test:integration

# Test Docker image
./scripts/docker-test.sh
```

## License

MIT
