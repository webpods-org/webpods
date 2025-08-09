# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the WebPods codebase.

## IMPORTANT: First Steps When Starting a Session

When you begin working on this project, you MUST:

1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and quick start
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `.env.example` - Configuration options

Only after reading these documents should you proceed with any implementation or analysis tasks.

## Overview

WebPods is an append-only log service with OAuth authentication. Users can write strings or JSON to named queues and read them back. The project follows functional programming principles with TypeScript and uses PostgreSQL as the single source of truth.

## Core Architecture Principles

### 1. Append-Only Design
- **Immutability**: Records cannot be modified or individually deleted once written
- **Sequential Ordering**: Each record has a monotonically increasing sequence number
- **Queue-Based**: User-defined named queues for logical data separation
- **Auto-Creation**: Queues are created automatically on first write

### 2. Functional Programming Only
- **NO CLASSES** - Export functions from modules only
- **Pure Functions**: Use explicit dependency injection
- **Result Types**: Use Result types for error handling instead of exceptions
- **Type over Interface**: Prefer `type` over `interface` (use `interface` only for extensible contracts)

### 3. Database Conventions
- **PostgreSQL** with **Knex.js** for migrations and queries
- **No ORMs**: Direct SQL queries with Knex query builder
- **Table Names**: Singular and lowercase (e.g., `user`, `queue`, `record`, `rate_limit`)
- **Column Names**: snake_case for all columns
- **Reserved Words**: Use backticks for PostgreSQL reserved words like `user`

### 4. REST API Design
- **RESTful Endpoints**: Standard HTTP verbs (POST, GET, DELETE, HEAD)
- **JSON by Default**: Support for both JSON and plain text content
- **JWT Authentication**: Bearer tokens in Authorization header
- **Consistent Error Format**: Standard error response structure

### 5. ESM Modules
- **All imports MUST include `.js` extension**: `import { foo } from './bar.js'`
- **TypeScript configured for `"module": "NodeNext"`**
- **Type: `"module"` in all package.json files**

## Essential Commands

### Build Commands
```bash
# Build entire project (from root)
./build.sh              # Standard build
./build.sh --migrate    # Build + run DB migrations

# Clean build artifacts
./clean.sh

# Start the server
./start.sh

# Lint entire project
./lint-all.sh
```

### Database Commands

**IMPORTANT**: NEVER run database migrations unless explicitly instructed by the user

```bash
# Check migration status (safe to run)
npm run migrate:status

# Create new migration (safe to run)
npm run migrate:make migration_name

# Run migrations (ONLY when explicitly asked)
npm run migrate:latest
npm run migrate:rollback
```

## Package Structure

```
webpods/
├── node/packages/
│   ├── webpods/                    # Main server (self-contained)
│   │   ├── src/
│   │   │   ├── index.ts           # Entry point
│   │   │   ├── db.ts              # Database connection
│   │   │   ├── types.ts           # Core types
│   │   │   ├── logger.ts          # Logging
│   │   │   ├── routes/            # API endpoints
│   │   │   ├── domain/            # Business logic
│   │   │   └── middleware/        # Express middleware
│   │   └── package.json
│   ├── webpods-test-utils/        # Testing utilities
│   └── webpods-integration-tests/ # Integration tests
├── database/webpods/migrations/   # Database migrations
├── devenv/                        # Docker dev environment
└── scripts/                       # Utility scripts
```

## Development Workflow

1. **Define Types**: Add/update types in `webpods/src/types.ts`
2. **Create Migration**: Use `npm run migrate:make` for schema changes
3. **Implement Domain Functions**: Add logic in `webpods/src/domain/`
4. **Add Routes**: Implement endpoints in `webpods/src/routes/`
5. **Build**: Run `./build.sh` from root
6. **Test**: Add tests in `webpods-integration-tests`

## Code Patterns

### Domain Function Pattern
```typescript
// ✅ Good - Pure function with Result type
export async function createQueue(
  db: Knex,
  userId: string,
  queueId: string,
  readPermission?: string,
  writePermission?: string
): Promise<Result<Queue>> {
  try {
    const [queue] = await db('queue')
      .insert({
        id: generateId(),
        q_id: queueId,
        creator_id: userId,
        read_permission: readPermission || 'owner',
        write_permission: writePermission || 'owner'
      })
      .returning('*');
    return success(queue);
  } catch (error) {
    return failure({ 
      code: 'QUEUE_CREATE_FAILED',
      message: error.message 
    });
  }
}

// ❌ Bad - Class-based approach
export class QueueService {
  async createQueue(queueId: string): Promise<Queue> {
    // Don't do this
  }
}
```

### REST Route Pattern
```typescript
// ✅ Good - Zod validation, proper error handling
router.post('/q/:q_id', authenticate, async (req, res) => {
  try {
    const qId = queueIdSchema.parse(req.params.q_id);
    const content = writeSchema.parse(req.body);
    
    const result = await writeRecord(
      getDb(),
      req.auth!.userId,
      qId,
      content
    );
    
    if (!result.success) {
      const code = result.error.code === 'FORBIDDEN' ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }
    
    res.status(201).json(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({ 
        error: {
          code: 'INVALID_INPUT',
          message: 'Invalid request',
          details: error.errors
        }
      });
      return;
    }
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});
```

## Key Data Model Concepts

### Users
- Created automatically on first OAuth login
- Identified by provider-specific auth_id
- No password management (OAuth only)

### Queues
- User-defined identifiers (alphanumeric, underscore, hyphen)
- Created automatically on first write
- Permissions: public, auth, owner
- Cannot be modified after creation (except permissions by owner)

### Records
- Append-only entries in queues
- Sequential numbering within each queue
- Support for JSON and plain text content
- Optional metadata via X-* headers
- Immutable once written

### Rate Limiting
- Stored in PostgreSQL (survives restarts)
- Sliding window calculation
- Per-user, per-action limits
- Configurable via environment variables

## Common Tasks

### Adding a New API Endpoint
1. Define request/response types in `types.ts`
2. Create Zod validation schemas
3. Implement domain function with Result type
4. Add route with authentication and validation
5. Update README.md API section

### Database Changes
1. Create migration: `npm run migrate:make your_migration_name`
2. Edit migration file with up/down functions
3. Run migration: `npm run migrate:latest` (only when asked)
4. Update types accordingly

### Adding Authentication Provider
1. Install passport strategy package
2. Configure strategy in `routes/auth.ts`
3. Update user table to handle provider-specific data
4. Add environment variables for provider credentials

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
cd node/packages/webpods-integration-tests
npm test -- --grep "queue operations"
```

## Important Notes

### Security Model
- OAuth-only authentication (no username/password)
- JWT tokens for stateless authentication
- Per-queue permissions (public, auth, owner)
- Rate limiting to prevent abuse
- All database queries parameterized

### Performance Considerations
- Connection pooling for database
- Stateless design for horizontal scaling
- Efficient append operations with sequential IDs
- Pagination for large result sets

### Error Handling
- Use Result types everywhere
- Never throw exceptions for expected errors
- Consistent error response format
- Include error codes for client handling

## Git Workflow

**IMPORTANT**: NEVER commit and push changes without explicit user permission. When the user asks you to commit and push, follow the git commit guidelines in the main Claude system prompt.

## Environment Variables

Key configuration options:
- `JWT_SECRET` - Required in production
- `GOOGLE_CLIENT_ID` - OAuth client ID
- `GOOGLE_CLIENT_SECRET` - OAuth client secret
- `WEBPODS_DB_*` - Database connection settings
- `RATE_LIMIT_*` - Rate limiting configuration

See `.env.example` for complete list.

## Debugging Tips

1. **Enable debug logging**: Set `LOG_LEVEL=debug`
2. **Check database queries**: Look for SQL in logs
3. **Verify JWT tokens**: Use jwt.io to decode
4. **Test with curl**: Simple command-line testing
5. **Check rate limits**: Look for X-RateLimit headers

## Common Issues

### "user" table errors
- Remember `user` is a PostgreSQL reserved word
- Always use backticks: `` `user` ``

### Migration failures
- Check database connection
- Ensure migrations run in order
- Verify table names are singular

### OAuth redirect issues
- Callback URL must match Google Console exactly
- Include protocol (http:// or https://)
- Check GOOGLE_CALLBACK_URL environment variable