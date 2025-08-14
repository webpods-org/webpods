# Single Sign-On (SSO) Documentation

WebPods implements Single Sign-On (SSO) to allow users to authenticate once and access multiple pods without re-authentication.

## Overview

The SSO system provides:
- **One-time authentication**: Users log in once via OAuth (Google/GitHub)
- **Session persistence**: Sessions stored in PostgreSQL, shared across all pods
- **Pod-specific tokens**: Each pod receives its own JWT token with pod claim
- **Cookie-based sessions**: Sessions shared across subdomains via cookies
- **PKCE security**: OAuth flows protected with PKCE (Proof Key for Code Exchange)

## Architecture

### Components

1. **Session Store** (`/src/auth/session-store.ts`)
   - PostgreSQL-based session storage using `connect-pg-simple`
   - Automatic cleanup of expired sessions
   - Cookie configuration for subdomain sharing

2. **PKCE Store** (`/src/auth/pkce-store.ts`)
   - Database storage for OAuth state and PKCE verifiers
   - TTL-based expiry (10 minutes by default)
   - Automatic cleanup of expired states

3. **Auth Routes** (`/src/auth/routes.ts`)
   - OAuth provider integration (Google, GitHub)
   - Session creation on successful authentication
   - Pod-specific token generation

4. **Session Management** (`/src/auth/session-routes.ts`)
   - List active sessions
   - Revoke individual or all sessions
   - Logout functionality

## Authentication Flow

### Initial Authentication

1. User visits any pod or main domain
2. Clicks login → redirected to `/auth/google` or `/auth/github`
3. OAuth flow initiated with PKCE:
   - State and code verifier generated
   - Stored in database with TTL
   - User redirected to OAuth provider
4. OAuth callback:
   - Code exchanged for tokens
   - User info retrieved
   - User created/found in database
   - Session created in PostgreSQL
   - Cookie set for subdomain sharing
5. User redirected to success page with JWT token

### Pod Access with SSO

1. User visits pod (e.g., `alice.webpods.org`)
2. Pod redirects to `/auth/authorize?pod=alice`
3. Server checks for active session:
   - **With session**: Generates pod-specific token, redirects back
   - **Without session**: Initiates OAuth flow
4. Pod receives token with pod claim
5. Token used for pod-specific operations

## Configuration

### Environment Variables

```bash
# Session Configuration
SESSION_SECRET=your-session-secret  # Defaults to JWT_SECRET
DOMAIN=webpods.org                  # Base domain for cookie sharing

# OAuth Providers
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# Database (for session storage)
WEBPODS_DB_HOST=localhost
WEBPODS_DB_PORT=5432
WEBPODS_DB_NAME=webpods
WEBPODS_DB_USER=postgres
WEBPODS_DB_PASSWORD=postgres
```

### Cookie Settings

Development:
- Domain: `.localhost`
- Secure: `false` (HTTP allowed)
- SameSite: `lax`

Production:
- Domain: `.webpods.org` (or your domain)
- Secure: `true` (HTTPS only)
- SameSite: `lax`
- HttpOnly: `true` (always)

## Database Schema

### Session Table
```sql
CREATE TABLE session (
  sid VARCHAR PRIMARY KEY,        -- Session ID
  sess JSONB NOT NULL,            -- Session data
  expire TIMESTAMP NOT NULL       -- Expiry timestamp
);
CREATE INDEX ON session(expire);  -- For cleanup
```

### OAuth State Table
```sql
CREATE TABLE oauth_state (
  state VARCHAR PRIMARY KEY,      -- State parameter
  code_verifier VARCHAR(128),     -- PKCE verifier
  pod VARCHAR(63),                -- Optional pod
  redirect_url TEXT,              -- Redirect after auth
  created_at TIMESTAMP,
  expires_at TIMESTAMP NOT NULL
);
CREATE INDEX ON oauth_state(expires_at);
```

## API Endpoints

### Authentication

- `GET /auth/google` - Initiate Google OAuth
- `GET /auth/github` - Initiate GitHub OAuth
- `GET /auth/:provider/callback` - OAuth callback
- `GET /auth/authorize?pod=:pod&redirect=:path` - Pod authorization
- `GET /auth/success` - Success page with token

### Session Management

- `GET /auth/session` - Current session info
- `GET /auth/sessions` - List all user sessions
- `DELETE /auth/sessions/:sessionId` - Revoke specific session
- `DELETE /auth/sessions` - Revoke all sessions
- `POST /auth/logout` - Logout current session
- `GET /auth/logout?redirect=:path` - Logout with redirect

### User Info

- `GET /auth/whoami` - Current user information

## Pod Integration

### Frontend Login Flow

```javascript
// Redirect to pod login
window.location.href = '/login?redirect=/dashboard';

// Pod login endpoint redirects to main domain
// GET /login?redirect=/dashboard
// → Redirects to: http://webpods.org/auth/authorize?pod=alice&redirect=/dashboard
```

### Token Validation

Pod-specific tokens include a `pod` claim:

```javascript
{
  "user_id": "uuid",
  "auth_id": "auth:google:123",
  "email": "user@example.com",
  "pod": "alice",  // Pod-specific claim
  "iat": 1234567890,
  "exp": 1234571490
}
```

Tokens with pod claims only work on the specified pod. Global tokens (without pod claim) work on all pods.

## Security Considerations

1. **PKCE Protection**: All OAuth flows use PKCE to prevent authorization code interception
2. **State Validation**: State parameter verified to prevent CSRF attacks
3. **Session Expiry**: Sessions expire after 7 days of inactivity
4. **Token Expiry**: JWTs expire after configured duration (default: 7 days)
5. **HTTPS Required**: In production, cookies are secure and HTTPS-only
6. **HttpOnly Cookies**: Session cookies cannot be accessed via JavaScript

## Troubleshooting

### Common Issues

1. **Session not shared across pods**
   - Check cookie domain configuration
   - Verify wildcard DNS for subdomains
   - Ensure cookies are being set with correct domain

2. **OAuth callback fails**
   - Verify OAuth provider configuration
   - Check callback URLs match provider settings
   - Ensure PKCE state hasn't expired (10-minute TTL)

3. **Session expires unexpectedly**
   - Check session cleanup job frequency
   - Verify cookie maxAge settings
   - Check for clock drift between server and database

4. **Pod-specific token rejected**
   - Verify token includes correct pod claim
   - Check token hasn't expired
   - Ensure pod exists in database

## Testing

The SSO implementation includes comprehensive tests:

- `sso-complete.test.ts` - Basic SSO functionality
- `sso-full-flow.test.ts` - Complete OAuth flow with mock provider
- `mock-oauth.test.ts` - Mock OAuth provider integration

Run tests:
```bash
npm test -- --grep "SSO"
```

## Migration from Token-Only Auth

If migrating from token-only authentication:

1. Sessions are created automatically on OAuth callback
2. Existing JWT tokens continue to work
3. Users will gain SSO benefits on next login
4. No database migration required (tables created if missing)