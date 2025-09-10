# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the WebPods codebase.

## CRITICAL: NEVER ACT WITHOUT EXPLICIT USER APPROVAL

**YOU MUST ALWAYS ASK FOR PERMISSION BEFORE:**

- Making architectural decisions or changes
- Implementing new features or functionality
- Modifying APIs, interfaces, or data structures
- Changing expected behavior or test expectations
- Adding new dependencies or patterns

**ONLY make changes AFTER the user explicitly approves.** When you identify issues or potential improvements, explain them clearly and wait for the user's decision. Do NOT assume what the user wants or make "helpful" changes without permission.

## CRITICAL: NEVER USE MULTIEDIT

**NEVER use the MultiEdit tool.** It has caused issues in multiple projects. Always use individual Edit operations instead, even if it means more edits. This ensures better control and prevents unintended changes.

## IMPORTANT: First Steps When Starting a Session

When you begin working on this project, you MUST:

1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and API specification
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `/docs/architecture.md` - System architecture and design decisions
   - `.env.example` - Configuration options

Only after reading these documents should you proceed with any implementation or analysis tasks.

**IMPORTANT**: After every conversation compact/summary, you MUST re-read this CLAUDE.md file again as your first action. The conversation context gets compressed and critical project-specific instructions may be lost. Always start by reading CLAUDE.md after a compact.

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
- **NO DYNAMIC IMPORTS**: Always use static imports. Never use `await import()` or `import()` in the code

### Database Conventions

- **PostgreSQL** with **pg-promise** for queries
- **Knex.js** ONLY for migrations (in root package)
- **Singular table names**: lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: snake_case for all columns
- **Reserved words**: Use double quotes for PostgreSQL reserved words (e.g., `"user"`)
- **Always use named parameters**: `$(paramName)` not `$1`
- **Always specify type parameters**: `db.one<UserDbRow>(...)`
- **MIGRATION POLICY**: Never create new migration files. All schema changes go in `/database/webpods/migrations/20250810000000_initial_schema.js`

### Query Optimization Guidelines

- **Prefer simple separate queries over complex joins** when it only saves 1-3 database calls
- **Use joins only to prevent N+1 query problems** (e.g., fetching data for many items in a loop)
- **Prioritize code simplicity and readability** over minor performance optimizations
- **Example**: Instead of a complex join to fetch owner record, use 3 simple queries:
  1. Get config stream
  2. Get owner stream (child of config)
  3. Get owner record from owner stream
- This approach makes the code easier to understand and maintain

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

#### Record Limit Configuration

The server enforces a maximum number of records per request:

- **Default max**: 1000 records (configurable via `MAX_RECORD_LIMIT`)
- **Behavior**: If `limit` exceeds max, it's silently capped (no error)
- **Configuration**: Set in `config.json` under `rateLimits.maxRecordLimit` or via `MAX_RECORD_LIMIT` env var
- **Testing**: Test config uses a low limit (10) for easier testing

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
  if (content.userId === userId) {
    userPermission = content; // Last record wins
  }
}
```

## Testing

### Test Output Strategy for Full Test Suites

**IMPORTANT**: When running the full test suite (which takes 3+ minutes), use `tee` to both display output to the user AND save to a file:

```bash
# Create .tests directory if it doesn't exist (gitignored)
mkdir -p .tests

# Run full test suite with tee - shows output to user AND saves to file
npm test | tee .tests/run-$(date +%s).txt

# Then you can analyze the saved output multiple times without re-running tests:
grep "failing" .tests/run-*.txt
tail -50 .tests/run-*.txt
grep -A10 "specific test name" .tests/run-*.txt
```

**NEVER use plain redirection (`>` or `2>&1`) as it hides output from the user.** Always use `tee` so the user can see test progress in real-time while you also get a saved copy for analysis.

This strategy prevents the need to re-run lengthy test suites when you need different information from the output. The `.tests/` directory is gitignored to keep test outputs from cluttering the repository.

## Analysis and Documentation

### Analysis Working Directory

**IMPORTANT**: When performing long-running analysis, research, or documentation tasks, use the `.analysis/` directory as your working space:

```bash
# Create .analysis directory if it doesn't exist (gitignored)
mkdir -p .analysis

# Use for analysis outputs, reports, and working files
cd .analysis

# Examples of analysis work:
# - Code complexity reports
# - API documentation generation
# - Dependency analysis
# - Performance profiling results
# - Architecture diagrams and documentation
# - Database schema analysis
# - Security audit reports
```

**Benefits of using `.analysis/` directory:**

- Keeps analysis artifacts separate from source code
- Allows iterative work without cluttering the repository
- Can save large analysis outputs without affecting git
- Provides a consistent location for all analysis work
- Enables saving intermediate results for complex multi-step analysis

**Common analysis patterns:**

```bash
# Save analysis results with timestamps
echo "Analysis results" > .analysis/api-analysis-$(date +%Y%m%d).md

# Create subdirectories for different analysis types
mkdir -p .analysis/performance
mkdir -p .analysis/security
mkdir -p .analysis/dependencies

# Use for generating documentation
npx typedoc --out .analysis/api-docs src/

# Save database schema analysis
pg_dump --schema-only webpodsdb > .analysis/schema-$(date +%Y%m%d).sql
```

The `.analysis/` directory is gitignored to prevent temporary analysis files from being committed to the repository.

**Note**: This approach is NOT needed for selective test runs, which complete quickly:

```bash
# For specific tests, run directly without saving (they're fast)
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

**IMPORTANT**: NEVER commit, push, revert, or perform ANY git operations (including but not limited to: git checkout, git reset, git stash, git merge, git rebase) without explicit user permission. This includes never reverting changes unless explicitly asked by the user. When the user asks you to commit and push, follow the git commit guidelines in the main Claude system prompt.

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

## CLI Command Structure

The CLI follows a consistent `<resource> <action>` pattern for all commands:

### Resource Groups

- **auth**: Authentication management (`login`, `logout`, `info`)
- **pod**: Pod management (`create`, `list`, `delete`, `info`, `transfer`)
- **stream**: Stream management (`create`, `delete`, `list`)
- **record**: Record operations (`write`, `read`, `delete`, `list`, `verify`)
- **permission**: Permission management (`grant`, `revoke`, `list`)
- **link**: Link management (`set`, `list`, `remove`)
- **oauth**: OAuth client management (`register`, `list`, `info`, `delete`)
- **limit**: Rate limit information (`info`)
- **config**: Configuration management

### Command Examples

```bash
# Authentication
podctl auth login
podctl auth info
podctl auth logout

# Pod operations
podctl pod create my-pod
podctl pod list
podctl pod delete my-pod --force
podctl pod transfer my-pod new-owner-id --force

# Stream operations
podctl stream create my-pod my-stream --access public
podctl stream list my-pod
podctl stream delete my-pod my-stream --force

# Record operations
podctl record write my-pod my-stream record-name "data"
podctl record read my-pod my-stream record-name
podctl record delete my-pod my-stream record-name --force
podctl record list my-pod my-stream
podctl record verify my-pod my-stream --check-integrity

# Permission operations
podctl permission grant my-pod my-stream user-id
podctl permission revoke my-pod my-stream user-id
podctl permission list my-pod my-stream
```

This structure ensures consistency and scalability across all CLI commands.

## Additional Resources

- `/CODING-STANDARDS.md` - Detailed coding conventions
- `/docs/api-examples.md` - API usage examples
- `/docs/deployment.md` - Production deployment guide
