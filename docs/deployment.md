# Deployment Guide

## Local Development

### Prerequisites
- Node.js 22+
- PostgreSQL 16+
- Google OAuth credentials

### Setup

1. Start PostgreSQL:
```bash
cd devenv
./run.sh up
```

2. Configure environment:
```bash
cp .env.example .env
# Edit .env with your Google OAuth credentials
```

3. Build and migrate:
```bash
./build.sh --migrate
```

4. Start server:
```bash
./start.sh
```

## Docker Deployment

### Build and Run
```bash
# Build image
docker build -t webpods .

# Run with docker-compose
docker compose up -d
```

### Environment Variables
Create `.env.production`:
```bash
NODE_ENV=production
JWT_SECRET=your-secret-key
GOOGLE_CLIENT_ID=your-client-id
GOOGLE_CLIENT_SECRET=your-client-secret
WEBPODS_DB_PASSWORD=secure-password
```

## Production Deployment

### Using Docker
```bash
# Build production image
docker build -t webpods:latest .

# Push to registry
docker push your-registry/webpods:latest

# Deploy
docker run -d \
  --name webpods \
  --env-file .env.production \
  -p 3000:3000 \
  webpods:latest
```

### Database Migrations
```bash
# Run migrations
npm run migrate:latest

# Rollback if needed
npm run migrate:rollback
```

### Health Check
```bash
curl http://localhost:3000/health
```

## Configuration

### Required Environment Variables
- `JWT_SECRET` - Secret for JWT signing
- `GOOGLE_CLIENT_ID` - Google OAuth client ID
- `GOOGLE_CLIENT_SECRET` - Google OAuth client secret
- `WEBPODS_DB_PASSWORD` - Database password (production)

### Optional Configuration
- `PORT` - Server port (default: 3000)
- `WEBPODS_DB_HOST` - Database host (default: localhost)
- `WEBPODS_DB_PORT` - Database port (default: 5432)
- `WEBPODS_DB_NAME` - Database name (default: webpods)
- `RATE_LIMIT_WRITES_PER_HOUR` - Write rate limit (default: 2000)

## Google OAuth Setup

1. Go to [Google Cloud Console](https://console.cloud.google.com)
2. Create a new project or select existing
3. Enable Google+ API
4. Create OAuth 2.0 credentials (Web application)
5. Add redirect URIs:
   - Development: `http://localhost:3000/auth/google/callback`
   - Production: `https://your-domain.com/auth/google/callback`

## Monitoring

### Logs
```bash
# Docker logs
docker logs webpods

# PM2 logs (if using PM2)
pm2 logs webpods
```

### Database
```bash
# Check database connections
psql -U postgres -d webpods -c "SELECT count(*) FROM pg_stat_activity;"
```

## Troubleshooting

### Database Connection Issues
Check connection settings:
```bash
WEBPODS_DB_HOST=localhost
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpods
WEBPODS_DB_USER=postgres
```

### OAuth Errors
Ensure callback URL matches Google Console configuration:
```bash
GOOGLE_CALLBACK_URL=http://localhost:3000/auth/google/callback
```

### Port Already in Use
Change port in `.env`:
```bash
PORT=3001
```