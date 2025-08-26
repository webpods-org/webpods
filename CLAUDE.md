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

## Code Principles

**NO BACKWARDS COMPATIBILITY**:

- Do not write backwards compatibility code
- Do not maintain legacy interfaces or environment variables
- When refactoring, completely replace old implementations
- Remove all deprecated code paths
- The codebase should represent the current best design, not historical decisions

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

- **All imports MUST include `.js` extension**: `import { foo } from "./bar.js"`
- **TypeScript configured for `"module": "NodeNext"`**
- **Type: `"module"` in all package.json files**

### Database Conventions

- **PostgreSQL** with **pg-promise** for queries
- **Knex.js** ONLY for migrations (in root package)
- **Singular table names**: lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: snake_case for all columns
- **Reserved words**: Use double quotes for PostgreSQL reserved words (e.g., `"user"`)
- **Always use named parameters**: `$(paramName)` not `$1`
- **Always specify type parameters**: `db.one<UserDbRow>(...)`
- **MIGRATION POLICY**: Never create new migration files. All schema changes go in `/database/webpods/migrations/20250810000000_initial_schema.js`

For detailed schema information, see `/docs/database.md`

## Git Workflow

When the user asks you to commit and push:

1. Run `./format-all.sh` to format all files with Prettier
2. Run `./lint-all.sh` to ensure code passes linting
3. Follow the git commit guidelines in the main Claude system prompt

## Essential Commands

### Build Commands

```bash
# Build entire project (from root)
./build.sh              # Standard build with formatting
./build.sh --migrate    # Build + run DB migrations
./build.sh --no-format  # Skip prettier formatting (faster builds during development)

# Clean build artifacts
./clean.sh

# Start the server
./start.sh

# Lint entire project
./lint-all.sh           # Run ESLint on all packages
./lint-all.sh --fix     # Run ESLint with auto-fix

# Format code with Prettier (MUST run before committing)
./format-all.sh         # Format all files
./format-all.sh --check # Check formatting without changing files
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

### API Features

#### Pagination with `after` Parameter

The `after` parameter supports both positive and negative values:

- **Positive values**: Skip records up to that index (`after=10` starts at index 11)
- **Negative values**: Get the last N records (`after=-20` returns last 20 records)
- Works with both regular listing and `unique=true` mode
- Negative values are converted relative to total record count
- If abs(negative value) > total count, returns all records

Examples:
```bash
?after=-20           # Last 20 records
?after=-3&limit=2    # Last 3 records, but limited to 2
?unique=true&after=-10 # Last 10 unique named records
```

## Code Patterns

### Import Patterns

```typescript
// Always include .js extension
import { createStream } from "./domain/streams.js";
import type { Result } from "../types.js";
```

### Result Type Pattern

```typescript
export async function doSomething(): Promise<Result<Data>> {
  if (error) {
    return {
      success: false,
      error: { code: "ERROR_CODE", message: "Description" },
    };
  }
  return { success: true, data: result };
}
```

### Permission Checking

Permission checks are done in-memory after fetching records:

```typescript
// Get ALL records from permission stream
const records = await db("record")
  .where("stream_id", streamId)
  .orderBy("index", "asc");

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

# Run specific test suite with grep (from root directory)
npm run test:grep -- "pattern to match"

# Examples:
npm run test:grep -- "should accept requests with valid auth token"
npm run test:grep -- "OAuth"
npm run test:grep -- "permission"
```

**IMPORTANT**: When running tests with mocha:

- Always use `npm run test:grep -- "pattern"` from the root directory for specific tests
- NEVER use `2>&1` redirection with mocha commands - it will cause errors
- Use plain `npm test` or `npx mocha` without stderr redirection
- If you need to capture output, use `| tee` or similar tools instead

### Optimizing Build Speed During Debugging

**TIP**: Use `./build.sh --no-format` during debugging sessions to skip prettier formatting. This:

- Reduces build time significantly
- Minimizes output that gets sent to the AI model (reducing token count)
- Makes the debugging cycle faster

Only use the standard `./build.sh` (with formatting) for final builds before committing.

## Git Workflow

**IMPORTANT**: NEVER commit and push changes without explicit user permission. When the user asks you to commit and push, follow the git commit guidelines in the main Claude system prompt.

**VERSION UPDATES**: Whenever committing changes, you MUST increment the patch version in `/node/packages/webpods/package.json`. For example, from 0.0.5 to 0.0.6. This ensures proper version tracking for all changes.

## Environment Variables

See `.env.example` for complete list of configuration options. Key variables:

- `HOST` - Server bind address (default: 0.0.0.0)
- `PORT` - Server bind port (default: 3000)
- `PUBLIC_URL` - Public-facing URL for OAuth callbacks
- `JWT_SECRET` - Required in production
- `SESSION_SECRET` - Required for sessions
- `DATABASE_URL` - PostgreSQL connection string
- OAuth provider secrets (as referenced in config.json)

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
