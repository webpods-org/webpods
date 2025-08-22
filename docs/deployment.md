# Deployment Guide

## Requirements

- PostgreSQL 12+
- Node.js 20+
- Domain with wildcard DNS (`*.webpods.org`)
- SSL certificate (wildcard recommended)
- OAuth application credentials

## Quick Start with Docker

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://user:pass@host/db \
  -e JWT_SECRET=your-secret \
  -e SESSION_SECRET=your-secret \
  -v ./config.json:/app/config.json \
  webpods/webpods
```

## Production Setup

### 1. Database Setup

```bash
# Create database
createdb webpodsdb

# Run migrations
npm run migrate:latest
```

### 2. Configuration

Create `config.json`:
```json
{
  "oauth": {
    "providers": [
      {
        "id": "github",
        "clientId": "your-client-id",
        "clientSecret": "$GITHUB_OAUTH_SECRET",
        // ... other fields
      }
    ]
  },
  "server": {
    "publicUrl": "https://webpods.org"
  }
}
```

Set environment variables:
```bash
export JWT_SECRET=$(openssl rand -hex 32)
export SESSION_SECRET=$(openssl rand -hex 32)
export DATABASE_URL=postgresql://user:pass@localhost/webpodsdb
export GITHUB_OAUTH_SECRET=your-github-secret
```

### 3. SSL/TLS with Nginx

```nginx
server {
  server_name webpods.org *.webpods.org;
  
  listen 443 ssl http2;
  ssl_certificate /path/to/cert.pem;
  ssl_certificate_key /path/to/key.pem;

  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
  }
}

server {
  server_name webpods.org *.webpods.org;
  listen 80;
  return 301 https://$host$request_uri;
}
```

### 4. Process Management with systemd

```ini
# /etc/systemd/system/webpods.service
[Unit]
Description=WebPods Server
After=network.target postgresql.service

[Service]
Type=simple
User=webpods
WorkingDirectory=/opt/webpods
ExecStart=/usr/bin/node /opt/webpods/node/packages/webpods/dist/index.js
Restart=always
RestartSec=10

Environment="NODE_ENV=production"
EnvironmentFile=/opt/webpods/.env

[Install]
WantedBy=multi-user.target
```

Enable and start:
```bash
systemctl enable webpods
systemctl start webpods
```

## Docker Compose

Complete setup with PostgreSQL and Hydra:

```yaml
version: '3.8'

services:
  postgres:
    image: postgres:15
    environment:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: webpodsdb
    volumes:
      - postgres_data:/var/lib/postgresql/data

  hydra:
    image: oryd/hydra:v2.3.0
    environment:
      DSN: postgresql://postgres:postgres@postgres/hydra
      URLS_SELF_ISSUER: https://auth.webpods.org
      URLS_CONSENT: https://webpods.org/oauth/consent
      URLS_LOGIN: https://webpods.org/oauth/login
    ports:
      - "4444:4444"
      - "4445:4445"
    depends_on:
      - postgres

  webpods:
    image: webpods/webpods
    environment:
      DATABASE_URL: postgresql://postgres:postgres@postgres/webpodsdb
      JWT_SECRET: ${JWT_SECRET}
      SESSION_SECRET: ${SESSION_SECRET}
      HYDRA_ADMIN_URL: http://hydra:4445
      HYDRA_PUBLIC_URL: https://auth.webpods.org
      PUBLIC_URL: https://webpods.org
    ports:
      - "3000:3000"
    volumes:
      - ./config.json:/app/config.json
    depends_on:
      - postgres
      - hydra

volumes:
  postgres_data:
```

## DNS Configuration

Configure wildcard DNS for your domain:

```
A     webpods.org       -> your-server-ip
A     *.webpods.org     -> your-server-ip
```

Or using CNAME:
```
CNAME webpods.org       -> your-server.example.com
CNAME *.webpods.org     -> your-server.example.com
```

## Health Checks

Monitor endpoint:
```bash
curl https://webpods.org/health
```

Expected response:
```json
{
  "status": "healthy",
  "version": "0.0.25",
  "timestamp": "2024-01-01T00:00:00Z"
}
```

## Backup

### Database Backup

```bash
# Backup
pg_dump webpodsdb > backup.sql

# Restore
psql webpodsdb < backup.sql
```

### Automated Backups

```bash
# /etc/cron.d/webpods-backup
0 3 * * * postgres pg_dump webpodsdb | gzip > /backups/webpods-$(date +\%Y\%m\%d).sql.gz
```

## Scaling Considerations

- WebPods server is stateless - run multiple instances behind load balancer
- PostgreSQL is the bottleneck - consider read replicas for high read loads
- Session store can be moved to Redis for better performance
- Use CDN for serving static content from pods

## Security Checklist

- [ ] HTTPS enabled with valid certificate
- [ ] Environment variables secured (not in version control)
- [ ] Database password is strong
- [ ] JWT_SECRET and SESSION_SECRET are random
- [ ] Firewall configured (only expose necessary ports)
- [ ] Regular security updates applied
- [ ] Database backups configured
- [ ] Rate limiting enabled
- [ ] Monitoring and alerting configured