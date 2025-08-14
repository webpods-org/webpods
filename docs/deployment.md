# Deployment

## Local Development

```bash
# Prerequisites
- Node.js 20+
- PostgreSQL 14+

# Setup
git clone https://github.com/webpods-org/webpods
cd webpods
cp .env.example .env
# Edit .env with your settings

# Database
createdb webpods_dev
npm run migrate:latest

# Run
./build.sh
./start.sh
```

## Docker

```bash
# Build
docker build -t webpods .

# Run with compose
docker-compose up

# Or standalone
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  webpods
```

## Production

### Requirements

- Domain with wildcard DNS (`*.webpods.org → server`)
- PostgreSQL database
- OAuth app credentials (GitHub/Google)
- SSL certificate (wildcard)

### Environment Variables

```bash
# Required
NODE_ENV=production
JWT_SECRET=<random-256-bit-key>
SESSION_SECRET=<random-256-bit-key>
DATABASE_URL=postgresql://user:pass@host/db

# OAuth (at least one provider)
GITHUB_CLIENT_ID=...
GITHUB_CLIENT_SECRET=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...

# Domain
DOMAIN=webpods.org
WEBPODS_PORT=3000

# Optional
LOG_LEVEL=info
CORS_ORIGIN=*
```

### OAuth Setup

#### GitHub
1. Create OAuth App: https://github.com/settings/developers
2. Authorization callback: `https://webpods.org/auth/github/callback`
3. Copy Client ID and Secret to `.env`

#### Google
1. Create OAuth 2.0 Client: https://console.cloud.google.com/apis/credentials
2. Authorized redirect URI: `https://webpods.org/auth/google/callback`
3. Copy Client ID and Secret to `.env`

### Database Migration

```bash
# Run migrations
npm run migrate:latest

# Rollback if needed
npm run migrate:rollback
```

### SSL/TLS

For wildcard domains, use:
- Let's Encrypt with DNS challenge
- Or commercial wildcard certificate

Example with Nginx:
```nginx
server {
  listen 443 ssl;
  server_name *.webpods.org;
  
  ssl_certificate /path/to/wildcard.crt;
  ssl_certificate_key /path/to/wildcard.key;
  
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
  }
}
```

### Monitoring

Health check endpoint:
```
GET /health
```

Logs use structured JSON format with levels:
- `error`: System errors
- `warn`: Warnings (invalid auth, etc.)
- `info`: Request logs
- `debug`: Detailed debugging

### Scaling

1. **Multiple instances**: Use load balancer
2. **Database**: Connection pooling, read replicas
3. **Sessions**: Shared PostgreSQL store enables horizontal scaling

### Backup

Regular PostgreSQL backups recommended:
```bash
pg_dump webpods > backup_$(date +%Y%m%d).sql
```

Key tables to backup:
- `user`, `pod`, `stream`, `record`
- `session` (for active SSO sessions)

### Troubleshooting

| Issue | Solution |
|-------|----------|
| Wildcard DNS not working | Verify `*.domain` A/CNAME record |
| OAuth redirect mismatch | Check callback URLs match exactly |
| Session not persisting | Verify SESSION_SECRET is set |
| Database connection failed | Check DATABASE_URL format |
| Pod not resolving | Ensure wildcard DNS configured |