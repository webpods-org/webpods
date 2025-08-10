# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the WebPods codebase.

## IMPORTANT: First Steps When Starting a Session

When you begin working on this project, you MUST:

1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and API specification
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `/docs/architecture.md` - System architecture and design decisions
   - `/docs/database.md` - Database schema and migrations
   - `.env.example` - Configuration options

Only after reading these documents should you proceed with any implementation or analysis tasks.

## Documentation Principles

**IMPORTANT**: When writing or updating documentation:
- Write as if the spec was designed from the beginning, not evolved over time
- Avoid phrases like "now allows", "changed from", "previously was", "only X is allowed"
- Present features and constraints as inherent design decisions
- Documentation should be timeless - readable as a complete spec at any point

## Project Structure

The codebase follows a functional programming approach with these key directories:
- `/node/packages/webpods/` - Main server implementation
- `/node/packages/webpods-integration-tests/` - Integration test suite
- `/database/webpods/migrations/` - Database migrations
- `/docs/` - Technical documentation

## Key Technical Decisions

### Functional Programming First
- **PREFER FUNCTIONS OVER CLASSES** - Export functions from modules when possible
- **Classes only when beneficial**: Use classes for stateful connections, complex state management
- **Pure Functions**: Use explicit dependency injection
- **Result Types**: Use Result<T> for error handling (no exceptions)
- **Type over Interface**: Prefer `type` over `interface`

### ESM Modules
- **All imports MUST include `.js` extension**: `import { foo } from './bar.js'`
- **TypeScript configured for `"module": "NodeNext"`**
- **Type: `"module"` in all package.json files**

### Database Conventions
- **PostgreSQL** with **Knex.js** for migrations and queries
- **Singular table names**: lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: snake_case for all columns
- **Reserved words**: Use backticks for PostgreSQL reserved words

For detailed schema information, see `/docs/database.md`

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

## Core Architecture

For detailed architecture information, see:
- `/docs/architecture.md` - System design and component interaction
- `/README.md` - API specification and examples

Key concepts:
- **Pods**: Subdomains that act as namespaces
- **Streams**: Append-only logs within pods (supports nested paths)
- **Records**: Immutable entries with hash chains
- **Permissions**: Unified access control using `access_permission` field

## Code Patterns

### Import Patterns
```typescript
// Always include .js extension
import { createStream } from './domain/streams.js';
import type { Result } from '../types.js';
```

### Result Type Pattern
```typescript
export async function doSomething(): Promise<Result<Data>> {
  if (error) {
    return { 
      success: false, 
      error: { code: 'ERROR_CODE', message: 'Description' }
    };
  }
  return { success: true, data: result };
}
```

### Permission Checking
Permission checks are done in-memory after fetching records:
```typescript
// Get ALL records from permission stream
const records = await db('record')
  .where('stream_id', streamId)
  .orderBy('sequence_num', 'asc');

// Process in memory to find latest permission
for (const record of records) {
  const content = JSON.parse(record.content);
  if (content.id === userId) {
    userPermission = content; // Last record wins
  }
}
```

## Testing

```bash
# Run all tests
npm test

# Run specific test suite
cd node/packages/webpods-integration-tests
npm test -- --grep "permission"
```

## Git Workflow

**IMPORTANT**: NEVER commit and push changes without explicit user permission. When the user asks you to commit and push, follow the git commit guidelines in the main Claude system prompt.

## Environment Variables

See `.env.example` for complete list of configuration options. Key variables:
- `DOMAIN` - Base domain for pods
- `JWT_SECRET` - Required in production
- `DATABASE_URL` - PostgreSQL connection string
- OAuth provider credentials (GitHub, Google)

## Debugging Tips

1. **Pod resolution issues**: Check wildcard DNS configuration
2. **Permission denied**: Trace through in-memory permission processing
3. **Negative indexing**: Verify record count calculations
4. **Content serving**: Check Content-Type and X-Content-Type headers
5. **OAuth issues**: Verify callback URLs match provider configuration

## Common Issues

For troubleshooting common issues, refer to:
- Wildcard DNS configuration
- Permission stream processing (now done in-memory)
- Content type handling
- Hash chain verification

## Additional Resources

- `/CODING-STANDARDS.md` - Detailed coding conventions
- `/docs/api-examples.md` - API usage examples
- `/docs/deployment.md` - Production deployment guide