# Deployment

## Quick Start with Docker

```bash
docker run -p 3000:3000 \
  -e DATABASE_URL=postgresql://... \
  -e JWT_SECRET=... \
  -e SESSION_SECRET=... \
  -v ./config.json:/app/config.json \
  webpods
```

## Production Setup

### Requirements

- Domain with wildcard DNS (`*.webpods.org`)
- PostgreSQL database  
- SSL certificate (wildcard recommended)
- OAuth application credentials

### OAuth Setup

Register your application with OAuth providers:

#### GitHub
1. Go to https://github.com/settings/developers
2. Create new OAuth App
3. Set Authorization callback URL: `https://yourdomain.com/auth/github/callback`
4. Copy Client ID and Secret

#### Google
1. Go to https://console.cloud.google.com/apis/credentials
2. Create OAuth 2.0 Client ID
3. Add authorized redirect URI: `https://yourdomain.com/auth/google/callback`
4. Copy Client ID and Secret

### Configuration

1. Create `config.json` from `config.example.json`
2. Add your OAuth providers with client IDs
3. Set environment variables:

```bash
# Required
JWT_SECRET=<random-256-bit-key>
SESSION_SECRET=<random-256-bit-key>
DATABASE_URL=postgresql://user:pass@host/db
PUBLIC_URL=https://webpods.org
HOST=0.0.0.0
PORT=3000

# OAuth secrets (as referenced in config.json)
GITHUB_OAUTH_SECRET=...
GOOGLE_OAUTH_SECRET=...
# Add other providers as needed
```

### Database

Run migrations:

```bash
npm run migrate:latest
```

### SSL/TLS

For production, use a reverse proxy (nginx, Caddy) with SSL termination:

```nginx
server {
  server_name *.webpods.org;
  
  location / {
    proxy_pass http://localhost:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

### Docker Compose

See `docker-compose.yml` for a complete production setup with PostgreSQL.