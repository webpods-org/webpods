# WebPods Configuration Guide

## Table of Contents
- [Environment Variables](#environment-variables)
- [Configuration Examples](#configuration-examples)
- [OAuth Setup](#oauth-setup)
- [Database Configuration](#database-configuration)
- [Security Settings](#security-settings)
- [Docker Configuration](#docker-configuration)
- [Production Recommendations](#production-recommendations)

## Environment Variables

WebPods uses environment variables for configuration. Create a `.env` file in the root directory or set these variables in your deployment environment.

### Core Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `NODE_ENV` | Environment mode (development, production) | `development` | No |
| `PORT` | Server port | `3000` | No |
| `WEBPODS_PORT` | Alternative port variable | `3000` | No |
| `LOG_LEVEL` | Logging level (debug, info, warn, error) | `info` | No |

### Database Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `WEBPODS_DB_HOST` | PostgreSQL host | `localhost` | No |
| `WEBPODS_DB_PORT` | PostgreSQL port | `5432` | No |
| `WEBPODS_DB_NAME` | Database name | `webpods` | No |
| `WEBPODS_DB_USER` | Database user | `postgres` | No |
| `WEBPODS_DB_PASSWORD` | Database password | `postgres` | Yes* |
| `DATABASE_URL` | Full database URL (alternative to individual settings) | - | No |

*Required in production

### Authentication Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `JWT_SECRET` | Secret key for JWT signing | `dev-secret-key` | Yes* |
| `JWT_EXPIRY` | Token expiration time | `1h` | No |
| `GOOGLE_CLIENT_ID` | Google OAuth client ID | - | Yes |
| `GOOGLE_CLIENT_SECRET` | Google OAuth client secret | - | Yes |
| `GOOGLE_CALLBACK_URL` | OAuth callback URL | `/auth/google/callback` | No |
| `AUTH_SUCCESS_REDIRECT` | URL to redirect after successful auth | `/` | No |
| `AUTH_FAILURE_REDIRECT` | URL to redirect after failed auth | `/auth/error` | No |

*Required in production

### CORS Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `CORS_ORIGIN` | Allowed CORS origins (comma-separated) | `*` | No |
| `CORS_CREDENTIALS` | Allow credentials in CORS | `true` | No |
| `CORS_MAX_AGE` | CORS preflight cache duration (seconds) | `86400` | No |

### Rate Limiting Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `RATE_LIMIT_WRITES_PER_HOUR` | Write operations per hour per user | `2000` | No |
| `RATE_LIMIT_READS_PER_HOUR` | Read operations per hour per user | `10000` | No |
| `RATE_LIMIT_UNAUTH_READS_PER_HOUR` | Unauthenticated reads per hour per IP | `1000` | No |
| `RATE_LIMIT_ENABLED` | Enable rate limiting | `true` | No |

### Server Configuration

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `BODY_SIZE_LIMIT` | Maximum request body size | `10mb` | No |
| `REQUEST_TIMEOUT` | Request timeout (ms) | `30000` | No |
| `KEEP_ALIVE_TIMEOUT` | Keep-alive timeout (ms) | `65000` | No |
| `TRUST_PROXY` | Trust proxy headers | `false` | No |
| `BEHIND_PROXY` | Running behind a reverse proxy | `false` | No |

## Configuration Examples

### Development Configuration (.env.development)

```bash
# Environment
NODE_ENV=development
PORT=3000
LOG_LEVEL=debug

# Database
WEBPODS_DB_HOST=localhost
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpods_dev
WEBPODS_DB_USER=postgres
WEBPODS_DB_PASSWORD=postgres

# Authentication
JWT_SECRET=dev-secret-key-change-in-production
JWT_EXPIRY=24h
GOOGLE_CLIENT_ID=your-dev-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-dev-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# CORS
CORS_ORIGIN=http://localhost:3000,http://localhost:5173
CORS_CREDENTIALS=true

# Rate Limiting (relaxed for development)
RATE_LIMIT_WRITES_PER_HOUR=10000
RATE_LIMIT_READS_PER_HOUR=50000
RATE_LIMIT_ENABLED=false
```

### Production Configuration (.env.production)

```bash
# Environment
NODE_ENV=production
PORT=3000
LOG_LEVEL=warn

# Database
WEBPODS_DB_HOST=db.internal.example.com
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpods
WEBPODS_DB_USER=webpods_app
WEBPODS_DB_PASSWORD=${DB_PASSWORD}  # Use secrets management

# Authentication
JWT_SECRET=${JWT_SECRET}  # Use secrets management
JWT_EXPIRY=1h
GOOGLE_CLIENT_ID=your-prod-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET}  # Use secrets management
GOOGLE_CALLBACK_URL=https://api.webpods.io/auth/google/callback
AUTH_SUCCESS_REDIRECT=https://app.webpods.io/dashboard
AUTH_FAILURE_REDIRECT=https://app.webpods.io/auth/error

# CORS
CORS_ORIGIN=https://app.webpods.io,https://webpods.io
CORS_CREDENTIALS=true
CORS_MAX_AGE=86400

# Rate Limiting
RATE_LIMIT_WRITES_PER_HOUR=2000
RATE_LIMIT_READS_PER_HOUR=10000
RATE_LIMIT_UNAUTH_READS_PER_HOUR=1000
RATE_LIMIT_ENABLED=true

# Server
BODY_SIZE_LIMIT=10mb
REQUEST_TIMEOUT=30000
TRUST_PROXY=true
BEHIND_PROXY=true
```

### Docker Configuration (.env.docker)

```bash
# Environment
NODE_ENV=production
PORT=3000

# Database (using Docker service names)
WEBPODS_DB_HOST=postgres
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpods
WEBPODS_DB_USER=postgres
WEBPODS_DB_PASSWORD=postgres

# Authentication
JWT_SECRET=docker-secret-key-change-me
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback

# CORS
CORS_ORIGIN=*
CORS_CREDENTIALS=true

# Rate Limiting
RATE_LIMIT_ENABLED=true
```

## OAuth Setup

### Google OAuth Configuration

1. **Create a Google Cloud Project**
   - Go to [Google Cloud Console](https://console.cloud.google.com)
   - Create a new project or select existing

2. **Enable Google+ API**
   ```bash
   gcloud services enable plus.googleapis.com
   ```

3. **Create OAuth Credentials**
   - Navigate to APIs & Services > Credentials
   - Click "Create Credentials" > "OAuth client ID"
   - Choose "Web application"
   - Add authorized redirect URIs:
     - Development: `http://localhost:3000/auth/google/callback`
     - Production: `https://api.webpods.io/auth/google/callback`

4. **Configure Environment Variables**
   ```bash
   GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=your-client-secret
   GOOGLE_CALLBACK_URL=https://api.webpods.io/auth/google/callback
   ```

## Database Configuration

### Connection String Format

```bash
# PostgreSQL connection string
DATABASE_URL=postgresql://user:password@host:port/database?sslmode=require

# Example
DATABASE_URL=postgresql://webpods:secret@db.example.com:5432/webpods?sslmode=require
```

### Connection Pool Settings

```javascript
// Configured in code, can be overridden via environment
{
  min: process.env.DB_POOL_MIN || 2,
  max: process.env.DB_POOL_MAX || 10,
  acquireTimeoutMillis: process.env.DB_ACQUIRE_TIMEOUT || 30000
}
```

### SSL Configuration

For production databases with SSL:

```bash
# Require SSL
WEBPODS_DB_SSL=true
WEBPODS_DB_SSL_REJECT_UNAUTHORIZED=true

# With self-signed certificates
WEBPODS_DB_SSL_CA=/path/to/ca-cert.pem
WEBPODS_DB_SSL_CERT=/path/to/client-cert.pem
WEBPODS_DB_SSL_KEY=/path/to/client-key.pem
```

## Security Settings

### JWT Configuration

```bash
# Generate a secure secret
openssl rand -base64 64

# Configure in environment
JWT_SECRET=<generated-secret>
JWT_EXPIRY=1h  # Format: 1h, 30m, 7d
JWT_ALGORITHM=HS256
```

### HTTPS Configuration

For production, always use HTTPS:

```bash
# Enable HTTPS redirect
FORCE_HTTPS=true

# HSTS Settings
HSTS_MAX_AGE=31536000
HSTS_INCLUDE_SUBDOMAINS=true
HSTS_PRELOAD=true
```

### Security Headers

```bash
# Content Security Policy
CSP_DIRECTIVES="default-src 'self'; script-src 'self'"

# Other security headers
X_FRAME_OPTIONS=DENY
X_CONTENT_TYPE_OPTIONS=nosniff
X_XSS_PROTECTION=1; mode=block
```

## Docker Configuration

### Docker Compose Variables

```bash
# docker-compose.yml uses these
COMPOSE_PROJECT_NAME=webpods
POSTGRES_VERSION=16
NODE_VERSION=22

# Volumes
POSTGRES_DATA_VOLUME=./data/postgres
WEBPODS_LOGS_VOLUME=./data/logs
```

### Docker Build Args

```bash
# Build-time variables
docker build \
  --build-arg NODE_ENV=production \
  --build-arg NPM_TOKEN=${NPM_TOKEN} \
  -t webpods:latest .
```

### Container Environment

```yaml
# docker-compose.yml
services:
  webpods:
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:postgres@postgres:5432/webpods
    env_file:
      - .env.production
```

## Production Recommendations

### Essential Settings

```bash
# Required for production
NODE_ENV=production
JWT_SECRET=<strong-random-secret>
WEBPODS_DB_PASSWORD=<strong-password>
GOOGLE_CLIENT_ID=<oauth-client-id>
GOOGLE_CLIENT_SECRET=<oauth-client-secret>
```

### Performance Tuning

```bash
# Database connections
DB_POOL_MIN=5
DB_POOL_MAX=20

# Node.js
NODE_OPTIONS="--max-old-space-size=2048"
UV_THREADPOOL_SIZE=8

# Clustering
CLUSTER_WORKERS=auto  # or specific number
```

### Monitoring

```bash
# Metrics
METRICS_ENABLED=true
METRICS_PORT=9090
METRICS_PATH=/metrics

# Health checks
HEALTH_CHECK_ENABLED=true
HEALTH_CHECK_INTERVAL=30000

# Logging
LOG_FORMAT=json
LOG_OUTPUT=stdout
LOG_LEVEL=warn
```

### Backup Configuration

```bash
# Database backups
BACKUP_ENABLED=true
BACKUP_SCHEDULE="0 2 * * *"  # 2 AM daily
BACKUP_RETENTION_DAYS=30
BACKUP_S3_BUCKET=webpods-backups
```

### High Availability

```bash
# Load balancing
LB_STRATEGY=round-robin
LB_HEALTH_CHECK_PATH=/health
LB_HEALTH_CHECK_INTERVAL=10

# Database
DB_READ_REPLICAS=db-read-1.example.com,db-read-2.example.com
DB_FAILOVER_ENABLED=true
```

## Environment Variable Validation

WebPods validates critical environment variables on startup:

```javascript
// Required in production
if (process.env.NODE_ENV === 'production') {
  assert(process.env.JWT_SECRET !== 'dev-secret-key');
  assert(process.env.GOOGLE_CLIENT_ID);
  assert(process.env.GOOGLE_CLIENT_SECRET);
  assert(process.env.WEBPODS_DB_PASSWORD);
}
```

## Secret Management

### Best Practices

1. **Never commit secrets to version control**
2. **Use environment-specific secret management**
3. **Rotate secrets regularly**
4. **Use different secrets per environment**

### Secret Management Solutions

```bash
# AWS Secrets Manager
AWS_SECRETS_ENABLED=true
AWS_SECRETS_REGION=us-east-1
AWS_SECRETS_PREFIX=webpods/

# HashiCorp Vault
VAULT_ENABLED=true
VAULT_ADDR=https://vault.example.com
VAULT_TOKEN=${VAULT_TOKEN}
VAULT_PATH=secret/webpods

# Kubernetes Secrets
kubectl create secret generic webpods-secrets \
  --from-literal=jwt-secret=${JWT_SECRET} \
  --from-literal=db-password=${DB_PASSWORD}
```

## Troubleshooting Configuration

### Debug Mode

```bash
# Enable debug logging
DEBUG=webpods:*
LOG_LEVEL=debug

# Database query logging
KNEX_DEBUG=true

# Request/Response logging
MORGAN_FORMAT=dev
```

### Common Issues

1. **Database Connection Failed**
   ```bash
   # Check connection
   WEBPODS_DB_HOST=localhost
   WEBPODS_DB_PORT=5432
   # Ensure PostgreSQL is running
   ```

2. **OAuth Redirect Mismatch**
   ```bash
   # Ensure callback URL matches Google Console
   GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
   ```

3. **CORS Errors**
   ```bash
   # Allow your frontend origin
   CORS_ORIGIN=http://localhost:5173
   CORS_CREDENTIALS=true
   ```