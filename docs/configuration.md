# Configuration

WebPods uses a JSON configuration file with environment variable support for secrets.

## Setup

```bash
cp config.example.json config.json
# Edit config.json with your OAuth providers
```

## OAuth Providers

WebPods supports any OAuth 2.0 provider. Configure them in `config.json`:

### Common Providers

#### GitHub

```json
{
  "id": "github",
  "clientId": "your-github-client-id",
  "clientSecret": "$GITHUB_OAUTH_SECRET",
  "authUrl": "https://github.com/login/oauth/authorize",
  "tokenUrl": "https://github.com/login/oauth/access_token",
  "userinfoUrl": "https://api.github.com/user",
  "emailUrl": "https://api.github.com/user/emails",
  "scope": "read:user user:email",
  "userIdField": "id",
  "emailField": "email",
  "nameField": "name"
}
```

#### Google (OIDC)

```json
{
  "id": "google",
  "clientId": "your-google-client-id",
  "clientSecret": "$GOOGLE_OAUTH_SECRET",
  "issuer": "https://accounts.google.com",
  "scope": "openid email profile",
  "userIdField": "sub",
  "emailField": "email",
  "nameField": "name"
}
```

#### Custom Provider

```json
{
  "id": "mycompany",
  "clientId": "your-client-id",
  "clientSecret": "$MYCOMPANY_OAUTH_SECRET",
  "authUrl": "https://auth.mycompany.com/oauth/authorize",
  "tokenUrl": "https://auth.mycompany.com/oauth/token",
  "userinfoUrl": "https://auth.mycompany.com/api/user",
  "scope": "openid email profile",
  "userIdField": "id",
  "emailField": "email",
  "nameField": "name"
}
```

### Provider Configuration Fields

| Field          | Required | Description                                                    |
| -------------- | -------- | -------------------------------------------------------------- |
| `id`           | Yes      | Unique identifier for the provider                             |
| `clientId`     | Yes      | OAuth application client ID                                    |
| `clientSecret` | Yes      | OAuth application client secret (use `$VAR` for env reference) |
| `issuer`       | No\*     | OIDC discovery URL (for providers supporting OIDC)             |
| `authUrl`      | No\*     | Authorization endpoint URL                                     |
| `tokenUrl`     | No\*     | Token exchange endpoint URL                                    |
| `userinfoUrl`  | No\*     | User information endpoint URL                                  |
| `emailUrl`     | No       | Separate email endpoint (e.g., GitHub)                         |
| `scope`        | Yes      | OAuth scopes to request                                        |
| `userIdField`  | Yes      | Field name for user ID in provider response                    |
| `emailField`   | Yes      | Field name for email in provider response                      |
| `nameField`    | Yes      | Field name for display name in provider response               |

\*Either `issuer` OR all three URLs (`authUrl`, `tokenUrl`, `userinfoUrl`) are required.

## Environment Variables

Reference environment variables in config.json using `$VAR_NAME`:

```bash
# .env
GITHUB_OAUTH_SECRET=your-github-secret
GOOGLE_OAUTH_SECRET=your-google-secret
JWT_SECRET=your-jwt-secret
SESSION_SECRET=your-session-secret
```

Use `$VAR || default` for optional values:

```json
{
  "host": "$HOST || 0.0.0.0",
  "port": "$PORT || 3000",
  "publicUrl": "$PUBLIC_URL || http://localhost:3000"
}
```

## Complete Example

See `config.example.json` for a complete configuration template with multiple providers.
