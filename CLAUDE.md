# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with the WebPods codebase.

## Critical Guidelines

### NEVER ACT WITHOUT EXPLICIT USER APPROVAL

**YOU MUST ALWAYS ASK FOR PERMISSION BEFORE:**
- Making architectural decisions or changes
- Implementing new features or functionality
- Modifying APIs, interfaces, or data structures
- Changing expected behavior or test expectations
- Adding new dependencies or patterns

**ONLY make changes AFTER the user explicitly approves.** When you identify issues or potential improvements, explain them clearly and wait for the user's decision. Do NOT assume what the user wants or make "helpful" changes without permission.

### FINISH DISCUSSIONS BEFORE WRITING CODE

**IMPORTANT**: When the user asks a question or you're in the middle of a discussion, DO NOT jump to writing code. Always:
1. **Complete the discussion first** - Understand the problem fully
2. **Analyze and explain** - Work through the issue verbally
3. **Get confirmation** - Ensure the user agrees with the approach
4. **Only then write code** - After the user explicitly asks you to implement

### NEVER USE MULTIEDIT

**NEVER use the MultiEdit tool.** It has caused issues in multiple projects. Always use individual Edit operations instead, even if it means more edits. This ensures better control and prevents unintended changes.

## Session Startup & Task Management

### First Steps When Starting a Session

When you begin working on this project, you MUST:
1. **Read this entire CLAUDE.md file** to understand the project structure and conventions
2. **Check for ongoing tasks in `.todos/` directory** - Look for any in-progress task files
3. **Read the key documentation files** in this order:
   - `/README.md` - Project overview and API specification
   - `/CODING-STANDARDS.md` - Mandatory coding patterns and conventions
   - `/docs/architecture.md` - System architecture and design decisions
   - `.env.example` - Configuration options

Only after reading these documents should you proceed with any implementation or analysis tasks.

**IMPORTANT**: After every conversation compact/summary, you MUST re-read this CLAUDE.md file again as your first action.

### Task Management with .todos Directory

**For major multi-step tasks that span sessions:**

1. **Before starting**, create a detailed task file in `.todos/` directory:
   - Filename format: `YYYY-MM-DD-task-name.md` (e.g., `2025-01-13-caching-implementation.md`)
   - Include ALL context, decisions, completed work, and remaining work
   - Write comprehensively so the task can be resumed in any future session

2. **Task file must include**:
   - Task overview and objectives
   - Current status (what's been completed)
   - Detailed list of remaining work
   - Important decisions made
   - Code locations affected
   - Testing requirements
   - Any gotchas or special considerations

3. **When resuming work**, always check `.todos/` first for in-progress tasks
4. **Update the task file** as you make progress
5. **Mark as complete** by renaming to `YYYY-MM-DD-task-name-COMPLETED.md`

The `.todos/` directory is gitignored for persistent task tracking across sessions.

## Project Overview & Principles

WebPods is a comprehensive API and platform for decentralized data management. For project overview, see [README.md](../README.md).

### Greenfield Development Context

**IMPORTANT**: WebPods is a greenfield project with no legacy constraints:
- **No backward compatibility concerns** - No existing deployments or users to migrate
- **No legacy code patterns** - All code should follow current best practices without compromise
- **No migration paths needed** - Database schemas, APIs, and data structures can be designed optimally
- **Write code as if starting fresh** - Every implementation should be clean and modern
- **No change tracking in comments** - Avoid "changed from X to Y" since there is no "previous" state
- **No deprecation warnings** - Nothing is deprecated because nothing is legacy

This means: Focus on clean, optimal implementations without worrying about existing systems. Design for the ideal case, not for compatibility.

### Documentation & Code Principles

**Documentation Guidelines:**
- Write as if the spec was designed from the beginning, not evolved over time
- Avoid phrases like "now allows", "changed from", "previously was"
- Present features and constraints as inherent design decisions
- Be concise and technical - avoid promotional language, superlatives
- Use active voice and include code examples
- Keep README.md as single source of truth

**Code Principles:**
- **NO BACKWARDS COMPATIBILITY** - Do not write backwards compatibility code
- **PREFER FUNCTIONS OVER CLASSES** - Export functions from modules when possible, use classes only when beneficial for stateful connections or complex state management
- **NO DYNAMIC IMPORTS** - Always use static imports, never `await import()` or `import()` in the code
- Use pure functions with explicit dependency injection and Result types for error handling
- Prefer `type` over `interface` (use `interface` only for extensible contracts)

## Key Technical Decisions

### Security: Never Use npx

**CRITICAL SECURITY REQUIREMENT**: NEVER use `npx` for any commands. This poses grave security risks by executing arbitrary code.
- **ALWAYS use exact dependency versions** in package.json
- **ALWAYS use local node_modules binaries** (e.g., `prettier`, `mocha`, `http-server`)
- **NEVER use `npx prettier`** - use `prettier` from local dependencies
- **NEVER use `npx mocha`** - use `mocha` from local dependencies

**Exception**: Only acceptable `npx` usage is for one-time project initialization when explicitly setting up new projects.

### Database Conventions

- **PostgreSQL** with **pg-promise** for queries, **Knex.js** ONLY for migrations (in root package)
- **Singular table names**: lowercase (e.g., `pod`, `stream`, `record`)
- **Column names**: snake_case for all columns
- **Reserved words**: Use double quotes for PostgreSQL reserved words (e.g., `"user"`)
- **Always use named parameters**: `$(paramName)` not `$1`
- **Always specify type parameters**: `db.one<UserDbRow>(...)`
- **MIGRATION POLICY**: Never create new migration files. All schema changes go in `/database/webpods/migrations/20250810000000_initial_schema.js`

**Query Optimization Guidelines**:
- **Prefer simple separate queries over complex joins** when it only saves 1-3 database calls
- **Use joins only to prevent N+1 query problems** (e.g., fetching data for many items in a loop)
- **Prioritize code simplicity and readability** over minor performance optimizations

### ESM Modules

- **All imports MUST include `.js` extension**: `import { foo } from "./bar.js"`
- **TypeScript configured for `"module": "NodeNext"`**
- **Type: `"module"` in all package.json files**
- **NO DYNAMIC IMPORTS**: Always use static imports. Never use `await import()` or `import()` in the code

## Essential Commands & Workflow

### Build & Development Commands

```bash
# Build entire project (from root)
./scripts/build.sh              # Standard build with formatting
./scripts/build.sh --migrate    # Build + run DB migrations
./scripts/build.sh --no-format  # Skip prettier formatting (faster builds during development)

# Clean build artifacts
./scripts/clean.sh

# Start the server
./scripts/start.sh

# Lint entire project
./scripts/lint-all.sh           # Run ESLint on all packages
./scripts/lint-all.sh --fix     # Run ESLint with auto-fix

# Format code with Prettier (MUST run before committing)
./scripts/format-all.sh         # Format all files
./scripts/format-all.sh --check # Check formatting without changing files

# Docker commands (if applicable)
./scripts/docker-build.sh       # Build Docker image
./scripts/docker-test.sh        # Test Docker image
./scripts/docker-push.sh latest ghcr.io/webpods-org  # Push to registry
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

# Create seed file (safe to run)
npm run seed:make seed_name

# Run seeds (ONLY when explicitly asked)
npm run seed:run
```

### Testing Commands

**IMPORTANT**: The test database is automatically recreated for each test run. You do NOT need to run migrations manually for tests or create the test database.

```bash
# Run specific tests (fast)
npm run test:grep -- "pattern to match"

# Examples:
npm run test:grep -- "should accept requests with valid auth token"
npm run test:grep -- "OAuth"
npm run test:grep -- "permission"
```

**IMPORTANT**: When running tests with mocha, always use `npm run test:grep -- "pattern"` from the root directory for specific tests. NEVER use `2>&1` redirection with mocha commands. Use `| tee` for output capture.

### Git Workflow

**CRITICAL GIT SAFETY RULES**:
1. **NEVER use `git push --force` or `git push -f`** - Force pushing destroys history
2. **ALL git push commands require EXPLICIT user authorization**
3. **Use revert commits instead of force push** - To undo changes, create revert commits
4. **If you need to overwrite remote**, explain consequences and get explicit confirmation

**IMPORTANT**: NEVER commit, push, revert, or perform ANY git operations without explicit user permission.

**NEW BRANCH REQUIREMENT**: ALL changes must be made on a new feature branch, never directly on main.

When the user asks you to commit and push:
1. Run `./scripts/format-all.sh` to format all files with Prettier
2. Run `./scripts/lint-all.sh` to ensure code passes linting
3. Follow the git commit guidelines in the main Claude system prompt
4. Get explicit user confirmation before any `git push`

**VERSION UPDATES**: Whenever committing changes, you MUST increment the patch version in `/node/packages/webpods/package.json`. For example, from 0.0.5 to 0.0.6.

## Core Architecture

For detailed architecture information, see `/docs/architecture.md` and `/README.md`.

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

## Testing & Development Optimization

### Test Output Strategy

**For full test suites (3+ minutes)**, use `tee` to display output AND save to file:

```bash
# Create .tests directory if it doesn't exist (gitignored)
mkdir -p .tests

# Run full test suite with tee - shows output to user AND saves to file
npm test | tee .tests/run-$(date +%s).txt

# Then analyze saved output without re-running tests:
grep "failing" .tests/run-*.txt
tail -50 .tests/run-*.txt
grep -A10 "specific test name" .tests/run-*.txt
```

**NEVER use plain redirection (`>` or `2>&1`)** - use `tee` for real-time output visibility.

### Analysis Working Directory

**For long-running analysis, research, or documentation tasks**, use `.analysis/` directory:

```bash
# Create .analysis directory if it doesn't exist (gitignored)
mkdir -p .analysis

# Examples of analysis work:
# - Code complexity reports
# - API documentation generation
# - Dependency analysis
# - Performance profiling results
# - Architecture diagrams and documentation
# - Database schema analysis
# - Security audit reports
```

Benefits: Keeps analysis artifacts separate from source code, allows iterative work without cluttering repository.

### Build & Lint Workflow

**ALWAYS follow this sequence:**
1. Run `./scripts/lint-all.sh` first
2. Run `./scripts/build.sh`
3. **If build fails and you make changes**: You MUST run `./scripts/lint-all.sh` again before building

**TIP**: Use `./scripts/build.sh --no-format` during debugging sessions to skip prettier formatting for faster builds.

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

## Environment Variables

See `.env.example` for complete list of configuration options. Key variables:
- `HOST` - Server bind address (default: 0.0.0.0)
- `PORT` - Server bind port (default: 3000)
- `PUBLIC_URL` - Public-facing URL for OAuth callbacks
- `JWT_SECRET` - Required in production
- `SESSION_SECRET` - Required for sessions
- `DATABASE_URL` - PostgreSQL connection string
- OAuth provider secrets (as referenced in config.json)

## Additional Resources

- `/CODING-STANDARDS.md` - Detailed coding conventions
- `/docs/api-examples.md` - API usage examples
- `/docs/deployment.md` - Production deployment guide

## Debugging Tips

1. **Pod resolution issues**: Check wildcard DNS configuration
2. **Permission denied**: Trace through in-memory permission processing
3. **Negative indexing**: Verify record count calculations
4. **Content serving**: Check Content-Type headers
5. **OAuth issues**: Verify callback URLs match provider configuration

## Common Issues

For troubleshooting common issues, refer to:
- Wildcard DNS configuration
- Permission stream processing (now done in-memory)
- Content type handling
- Hash chain verification