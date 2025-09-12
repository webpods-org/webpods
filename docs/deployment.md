# Deployment Guide

Complete guide for deploying WebPods in production.

## Overview

WebPods can be deployed in several ways:

- **Docker** (recommended for most deployments)
- **Docker Compose** (for full stack with database)
- **From source** (for development and customization)
- **Kubernetes** (for large-scale deployments)

## Prerequisites

- PostgreSQL 12 or higher
- Node.js 18+ (if building from source)
- Domain with wildcard DNS support (\*.yourdomain.com)
- SSL certificate for your domain

## Docker Deployment

### Simple Docker Run

```bash
# Pull the latest image
docker pull ghcr.io/webpods-org/webpods:latest

# Run WebPods
docker run -d \
  --name webpods \
  -p 3000:3000 \
  -e DATABASE_URL="postgresql://user:password@host:5432/webpodsdb" \
  -e JWT_SECRET="your-super-secret-jwt-key" \
  -e SESSION_SECRET="your-session-secret-key" \
  -e PUBLIC_URL="https://webpods.yourdomain.com" \
  -e GITHUB_OAUTH_CLIENT_ID="your-github-client-id" \
  -e GITHUB_OAUTH_SECRET="your-github-client-secret" \
  -v ./config.json:/app/config.json \
  -v webpods-uploads:/app/uploads \
  --restart unless-stopped \
  ghcr.io/webpods-org/webpods:latest
```

### Docker Compose (Recommended)

Create `docker-compose.yml`:

```yaml
version: "3.8"

services:
  webpods:
    image: ghcr.io/webpods-org/webpods:latest
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://webpods:${DB_PASSWORD}@postgres:5432/webpodsdb
      - JWT_SECRET=${JWT_SECRET}
      - SESSION_SECRET=${SESSION_SECRET}
      - PUBLIC_URL=${PUBLIC_URL}
      - GITHUB_OAUTH_CLIENT_ID=${GITHUB_OAUTH_CLIENT_ID}
      - GITHUB_OAUTH_SECRET=${GITHUB_OAUTH_SECRET}
      - GOOGLE_OAUTH_CLIENT_ID=${GOOGLE_OAUTH_CLIENT_ID}
      - GOOGLE_OAUTH_SECRET=${GOOGLE_OAUTH_SECRET}
      - NODE_ENV=production
    volumes:
      - ./config.json:/app/config.json
      - webpods-uploads:/app/uploads
    depends_on:
      postgres:
        condition: service_healthy
    restart: unless-stopped

  postgres:
    image: postgres:15-alpine
    environment:
      - POSTGRES_DB=webpodsdb
      - POSTGRES_USER=webpods
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U webpods -d webpodsdb"]
      interval: 30s
      timeout: 10s
      retries: 3
    restart: unless-stopped

volumes:
  postgres-data:
  webpods-uploads:
```

Create `.env` file:

```env
DB_PASSWORD=your-secure-database-password
JWT_SECRET=your-super-secret-jwt-key-at-least-32-characters
SESSION_SECRET=your-session-secret-key-at-least-32-characters
PUBLIC_URL=https://webpods.yourdomain.com
GITHUB_OAUTH_CLIENT_ID=your-github-oauth-client-id
GITHUB_OAUTH_SECRET=your-github-oauth-client-secret
GOOGLE_OAUTH_CLIENT_ID=your-google-oauth-client-id
GOOGLE_OAUTH_SECRET=your-google-oauth-client-secret
```

Deploy:

```bash
# Start services
docker-compose up -d

# Check logs
docker-compose logs -f webpods

# Stop services
docker-compose down
```

## Configuration

### OAuth Provider Setup

#### GitHub OAuth

1. Go to GitHub Settings → Developer settings → OAuth Apps
2. Create a new OAuth App:
   - Application name: "Your WebPods Instance"
   - Homepage URL: `https://webpods.yourdomain.com`
   - Authorization callback URL: `https://webpods.yourdomain.com/auth/github/callback`
3. Note the Client ID and Client Secret

#### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable the Google+ API
4. Create OAuth 2.0 credentials:
   - Authorized origins: `https://webpods.yourdomain.com`
   - Authorized redirect URIs: `https://webpods.yourdomain.com/auth/google/callback`

#### Microsoft OAuth

1. Go to [Azure Portal](https://portal.azure.com)
2. Register a new application
3. Set redirect URI: `https://webpods.yourdomain.com/auth/microsoft/callback`

### Configuration File

Create `config.json`:

```json
{
  "server": {
    "host": "0.0.0.0",
    "port": 3000,
    "publicUrl": "https://webpods.yourdomain.com",
    "allowedRecordHeaders": ["cache-control", "content-encoding", "x-custom"]
  },
  "database": {
    "url": "postgresql://user:password@localhost:5432/webpodsdb"
  },
  "security": {
    "jwtSecret": "your-jwt-secret",
    "sessionSecret": "your-session-secret",
    "bcryptRounds": 12
  },
  "oauth": {
    "github": {
      "clientId": "your-github-client-id",
      "clientSecret": "your-github-client-secret",
      "scope": ["user:email"]
    },
    "google": {
      "clientId": "your-google-client-id",
      "clientSecret": "your-google-client-secret",
      "scope": ["profile", "email"]
    },
    "microsoft": {
      "clientId": "your-microsoft-client-id",
      "clientSecret": "your-microsoft-client-secret",
      "scope": ["https://graph.microsoft.com/user.read"]
    }
  },
  "rateLimits": {
    "windowMinutes": 60,
    "maxRequests": 1000,
    "maxRecordLimit": 1000
  },
  "upload": {
    "maxFileSize": "10MB",
    "allowedTypes": ["image/*", "text/*", "application/json", "application/pdf"]
  }
}
```

### Custom Record Headers

The `allowedRecordHeaders` configuration allows you to specify which custom headers can be stored with records. When users write records, they can include headers with the `x-record-header-` prefix, and these will be:

- Stored with the record in the database
- Returned as HTTP headers when fetching individual records
- Included in the JSON response when listing records

Common use cases:

- `cache-control`: Control browser and CDN caching behavior
- `content-encoding`: Specify compression or encoding
- Custom application headers for metadata

## Reverse Proxy Setup

### Nginx Configuration

WebPods requires wildcard subdomain support. Configure Nginx:

```nginx
# Main domain
server {
    listen 443 ssl http2;
    server_name webpods.yourdomain.com;

    ssl_certificate /etc/ssl/certs/webpods.crt;
    ssl_certificate_key /etc/ssl/private/webpods.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}

# Wildcard subdomains (pods)
server {
    listen 443 ssl http2;
    server_name *.webpods.yourdomain.com;

    ssl_certificate /etc/ssl/certs/webpods.crt;
    ssl_certificate_key /etc/ssl/private/webpods.key;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Forwarded-Host $host;
        proxy_set_header X-Forwarded-Port $server_port;
    }
}

# HTTP redirect to HTTPS
server {
    listen 80;
    server_name webpods.yourdomain.com *.webpods.yourdomain.com;
    return 301 https://$host$request_uri;
}
```

### Traefik Configuration

```yaml
# docker-compose.yml
version: "3.8"

services:
  traefik:
    image: traefik:v2.10
    command:
      - --api.dashboard=true
      - --providers.docker=true
      - --entrypoints.web.address=:80
      - --entrypoints.websecure.address=:443
      - --certificatesresolvers.letsencrypt.acme.email=admin@yourdomain.com
      - --certificatesresolvers.letsencrypt.acme.storage=/acme.json
      - --certificatesresolvers.letsencrypt.acme.httpchallenge.entrypoint=web
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ./acme.json:/acme.json
    restart: unless-stopped

  webpods:
    image: ghcr.io/webpods-org/webpods:latest
    environment:
      - DATABASE_URL=postgresql://webpods:${DB_PASSWORD}@postgres:5432/webpodsdb
      - JWT_SECRET=${JWT_SECRET}
      - SESSION_SECRET=${SESSION_SECRET}
      - PUBLIC_URL=https://webpods.yourdomain.com
    labels:
      - "traefik.enable=true"
      - "traefik.http.routers.webpods.rule=Host(`webpods.yourdomain.com`) || HostRegexp(`{subdomain:[a-z0-9-]+}.webpods.yourdomain.com`)"
      - "traefik.http.routers.webpods.entrypoints=websecure"
      - "traefik.http.routers.webpods.tls.certresolver=letsencrypt"
      - "traefik.http.services.webpods.loadbalancer.server.port=3000"
    volumes:
      - ./config.json:/app/config.json
    depends_on:
      - postgres
    restart: unless-stopped
```

## DNS Configuration

Set up wildcard DNS for your domain:

```
A    webpods.yourdomain.com    → your-server-ip
A    *.webpods.yourdomain.com  → your-server-ip
```

Or with CloudFlare/other DNS provider that supports wildcard:

```
A    webpods     → your-server-ip
A    *           → your-server-ip
```

## SSL Certificates

### Let's Encrypt (Recommended)

```bash
# Install certbot
sudo apt install certbot

# Get wildcard certificate
sudo certbot certonly --manual --preferred-challenges=dns \
  -d webpods.yourdomain.com -d "*.webpods.yourdomain.com"

# Follow the DNS TXT record instructions
# Certificates will be saved to /etc/letsencrypt/live/webpods.yourdomain.com/
```

### Auto-renewal

```bash
# Add to crontab
sudo crontab -e

# Add this line:
0 12 * * * /usr/bin/certbot renew --quiet && systemctl reload nginx
```

## Database Setup

### PostgreSQL Installation

```bash
# Ubuntu/Debian
sudo apt update
sudo apt install postgresql postgresql-contrib

# Start and enable
sudo systemctl start postgresql
sudo systemctl enable postgresql

# Create database and user
sudo -u postgres psql << EOF
CREATE DATABASE webpodsdb;
CREATE USER webpods WITH PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE webpodsdb TO webpods;
\q
EOF
```

### Database Migrations

```bash
# Run migrations (inside WebPods container or source installation)
npm run migrate:latest

# Check migration status
npm run migrate:status
```

## Monitoring and Logging

### Health Checks

WebPods provides health check endpoints:

```bash
# Basic health check
curl https://webpods.yourdomain.com/health

# Detailed system status
curl https://webpods.yourdomain.com/status
```

### Logging

Configure log levels in your environment:

```bash
# Environment variables
LOG_LEVEL=info  # debug, info, warn, error
LOG_FORMAT=json # json, simple

# Or in config.json
{
  "logging": {
    "level": "info",
    "format": "json"
  }
}
```

### Monitoring with Docker

```bash
# View logs
docker logs -f webpods

# Monitor resource usage
docker stats webpods

# Health check
docker exec webpods curl -f http://localhost:3000/health
```

## Backup and Recovery

### Database Backup

```bash
# Create backup
pg_dump -h localhost -U webpods webpodsdb > backup-$(date +%Y%m%d).sql

# Restore backup
psql -h localhost -U webpods webpodsdb < backup-20240115.sql
```

### File Uploads Backup

```bash
# Backup uploads directory
tar -czf uploads-backup-$(date +%Y%m%d).tar.gz uploads/

# Restore uploads
tar -xzf uploads-backup-20240115.tar.gz
```

### Automated Backups

Create backup script:

```bash
#!/bin/bash
BACKUP_DIR="/backups"
DATE=$(date +%Y%m%d-%H%M%S)

# Database backup
pg_dump -h localhost -U webpods webpodsdb > "$BACKUP_DIR/db-$DATE.sql"

# Uploads backup
tar -czf "$BACKUP_DIR/uploads-$DATE.tar.gz" uploads/

# Keep only last 30 days
find $BACKUP_DIR -name "*.sql" -mtime +30 -delete
find $BACKUP_DIR -name "*.tar.gz" -mtime +30 -delete
```

Add to crontab:

```bash
0 2 * * * /path/to/backup-script.sh
```

## Security Considerations

### Environment Variables

- Use strong, random secrets for JWT_SECRET and SESSION_SECRET
- Keep OAuth client secrets secure
- Use environment variables instead of config file for production secrets

### Network Security

- Run behind reverse proxy (Nginx/Traefik)
- Use HTTPS only
- Configure proper CORS headers
- Implement rate limiting

### Database Security

- Use dedicated database user with minimal privileges
- Enable SSL connections to database
- Regular security updates

### Updates

```bash
# Update Docker image
docker pull ghcr.io/webpods-org/webpods:latest
docker-compose up -d webpods

# Update from source
git pull
./scripts/build.sh
npm run migrate:latest
./scripts/start.sh
```

## Troubleshooting

### Common Issues

1. **Wildcard DNS not working**
   - Check DNS propagation: `dig *.webpods.yourdomain.com`
   - Verify DNS records are correct

2. **OAuth callback errors**
   - Check callback URLs in OAuth provider settings
   - Ensure PUBLIC_URL is set correctly

3. **Database connection errors**
   - Verify DATABASE_URL format
   - Check PostgreSQL is running and accessible

4. **SSL certificate issues**
   - Verify certificate covers wildcard domain
   - Check certificate expiration

### Debug Mode

```bash
# Enable debug logging
LOG_LEVEL=debug docker-compose up -d

# View detailed logs
docker-compose logs -f webpods
```

### Support

For deployment issues:

- Check the [GitHub Issues](https://github.com/webpods-org/webpods/issues)
- Join the [Discussions](https://github.com/webpods-org/webpods/discussions)
- Review logs for error messages
