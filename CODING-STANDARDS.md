# Coding Standards

This document outlines the coding standards and patterns used throughout the WebPods codebase. All contributors should follow these guidelines to maintain consistency and quality.

## Core Principles

### 1. Functional Programming First

**PREFER FUNCTIONS OVER CLASSES** - Export functions from modules when possible. Classes should only be used when they provide clear benefits.

```typescript
// ✅ Good - Pure function with explicit dependencies
export async function writeRecord(
  db: Database,
  streamId: string,
  content: any,
  contentType: string,
  authorId: string,
  alias?: string | null,
): Promise<Result<StreamRecord>> {
  // Implementation
}

// ✅ Acceptable - Class when it provides clear value
// Example: Stateful connection management
export class WebSocketConnection {
  private socket: WebSocket;
  private reconnectAttempts = 0;

  constructor(private config: WebSocketConfig) {
    this.socket = new WebSocket(config.url);
  }

  async send(message: Message): Promise<void> {
    if (this.socket.readyState !== WebSocket.OPEN) {
      await this.reconnect();
    }
    this.socket.send(JSON.stringify(message));
  }

  private async reconnect(): Promise<void> {
    // Reconnection logic with exponential backoff
  }
}

// ❌ Bad - Class used unnecessarily for stateless operations
export class StreamService {
  constructor(private db: Database) {}

  async writeRecord(streamId: string, content: any): Promise<StreamRecord> {
    // This doesn"t need to be a class
  }
}
```

### 2. Explicit Error Handling with Result Types

Use `Result<T>` for all operations that can fail. Never throw exceptions for expected errors.

```typescript
// Result type definition (in types.ts)
export interface DomainError {
  code: string;
  message: string;
}

export type Result<T, E = DomainError> =
  | { success: true; data: T }
  | { success: false; error: E };

// ✅ Good - Using Result type
export async function findStream(
  db: Database,
  streamId: string,
): Promise<Result<Stream>> {
  try {
    const stream = await db("stream").where("stream_id", streamId).first();

    if (!stream) {
      return failure({
        code: "NOT_FOUND",
        message: "Stream not found",
      });
    }

    return success(stream);
  } catch (error) {
    return failure({
      code: "DATABASE_ERROR",
      message: error.message,
    });
  }
}

// ❌ Bad - Throwing exceptions
export async function findStream(
  db: Database,
  streamId: string,
): Promise<Stream> {
  const stream = await db("stream").where("stream_id", streamId).first();
  if (!stream) throw new Error("Stream not found");
  return stream;
}
```

### 3. Database Patterns

#### DbRow Types

All database interactions use `*DbRow` types that exactly mirror the database schema with snake_case:

```typescript
// Database type (snake_case)
type UserDbRow = {
  id: string;
  created_at: Date;
  updated_at: Date | null;
};

type IdentityDbRow = {
  id: string;
  user_id: string;
  provider: string;
  provider_id: string;
  email: string | null;
  name: string | null;
  metadata: any;
  created_at: Date;
  updated_at: Date | null;
};

type StreamDbRow = {
  id: string;
  pod_id: string;
  stream_id: string;
  user_id: string; // Creator user ID
  access_permission: string;
  created_at: Date;
};
```

#### Direct pg-promise Usage

Use pg-promise directly with typed queries and named parameters:

```typescript
// ✅ Good - Type-safe query with named parameters
const stream = await db.oneOrNone<StreamDbRow>(
  `SELECT * FROM stream WHERE stream_id = $(streamId) AND pod_id = $(podId)`,
  { streamId, podId },
);

const record = await db.one<RecordDbRow>(
  `INSERT INTO record (stream_id, index, content, content_type, author_id)
   VALUES ($(streamId), $(index), $(content), $(contentType), $(authorId))
   RETURNING *`,
  { streamId, index, content, contentType, authorId },
);

// ❌ Bad - Positional parameters
const stream = await db.oneOrNone(
  `SELECT * FROM stream WHERE stream_id = $1 AND pod_id = $2`,
  [streamId, podId],
);

// ❌ Bad - No type parameter
const stream = await db.oneOrNone(
  `SELECT * FROM stream WHERE stream_id = $(streamId)`,
  { streamId },
);
```

#### Reserved Words

PostgreSQL reserved words like `user` must be double-quoted:

```typescript
// ✅ Good - Double-quoted reserved word
const user = await db.oneOrNone<UserDbRow>(
  `SELECT * FROM "user" WHERE id = $(userId)`,
  { userId },
);

// ❌ Bad - Unquoted reserved word
const user = await db.oneOrNone<UserDbRow>(
  `SELECT * FROM user WHERE id = $(userId)`, // Will fail!
  { userId },
);
```

### 4. Module Structure

#### Imports

All imports MUST include the `.js` extension:

```typescript
// ✅ Good
import { createStream } from "./domain/stream/create-stream.js";
import { authenticate } from "./middleware/auth.js";
import { Result } from "./types.js";

// ❌ Bad
import { createStream } from "./domain/stream/create-stream";
import { authenticate } from "./middleware/auth";
```

#### Exports

Use named exports, avoid default exports:

```typescript
// ✅ Good
export function writeRecord() { ... }
export function readRecords() { ... }
export type StreamRecord = { ... };

// ❌ Bad
export default class StreamService { ... }
```

### 5. Naming Conventions

#### General Rules

- **Functions**: camelCase (`writeRecord`, `checkPermission`, `createStream`)
- **Types/Interfaces**: PascalCase (`Stream`, `StreamRecord`, `User`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_LIMIT`)
- **Files**: kebab-case (`create-stream.ts`, `check-permission.ts`)
- **Database**: snake_case tables and columns (`stream`, `created_at`, `index`)

#### Database Naming

- **Tables**: singular, lowercase (`user`, `stream`, `record`, `rate_limit`)
- **Columns**: snake_case (`stream_id`, `created_at`, `content_type`)
- **Foreign Keys**: `{table}_id` (`creator_id`, `stream_id`)

### 6. TypeScript Guidelines

#### Strict Mode

Always use TypeScript strict mode:

```json
{
  "compilerOptions": {
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noImplicitReturns": true,
    "noFallthroughCasesInSwitch": true
  }
}
```

#### Type vs Interface

Prefer `type` over `interface`:

```typescript
// ✅ Good - Using type
type Stream = {
  id: string;
  q_id: string;
  creator_id: string;
  read_permission: string;
  write_permission: string;
};

type Permission = "public" | "auth" | "owner";

// Use interface only for extensible contracts
interface AuthProvider {
  authenticate(token: string): Promise<User>;
  refresh(token: string): Promise<string>;
}
```

#### Avoid `any`

Never use `any`. Use `unknown` if type is truly unknown:

```typescript
// ✅ Good
function parseContent(content: unknown): any {
  if (typeof content === "string") {
    try {
      return JSON.parse(content);
    } catch {
      return content;
    }
  }
  return content;
}

// ❌ Bad
function parseContent(content: any): any {
  return content;
}
```

### 7. Async/Await Pattern

Always use async/await instead of promises:

```typescript
// ✅ Good
export async function createStreamWithRecord(
  db: Database,
  userId: string,
  streamId: string,
  content: any,
): Promise<Result<StreamRecord>> {
  const streamResult = await createStream(db, userId, streamId);
  if (!streamResult.success) {
    return streamResult;
  }

  const recordResult = await writeRecord(
    db,
    userId,
    streamResult.data.id,
    content,
  );

  return recordResult;
}

// ❌ Bad - Promise chains
export function createStreamWithRecord(
  db: Database,
  userId: string,
  streamId: string,
  content: any,
): Promise<Result<StreamRecord>> {
  return createStream(db, userId, streamId).then((streamResult) => {
    if (!streamResult.success) {
      return streamResult;
    }
    return writeRecord(db, userId, streamResult.data.id, content);
  });
}
```

### 8. Express Route Patterns

```typescript
// ✅ Good - Proper error handling and validation
router.post("/:stream_path(*)", authenticate, async (req, res) => {
  try {
    // Validate input
    const streamPath = streamPathSchema.parse(req.params.stream_path);
    const content = writeSchema.parse(req.body);

    // Check rate limit
    const rateLimit = await checkRateLimit(db, req.auth!.userId, "write");
    if (!rateLimit.allowed) {
      res.status(429).json({
        error: {
          code: "RATE_LIMIT_EXCEEDED",
          message: "Too many requests",
        },
      });
      return;
    }

    // Execute business logic
    const result = await writeRecord(db, req.auth!.userId, qId, content);

    // Handle result
    if (!result.success) {
      const code = result.error.code === "FORBIDDEN" ? 403 : 400;
      res.status(code).json({ error: result.error });
      return;
    }

    res.status(201).json(result.data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      res.status(400).json({
        error: {
          code: "INVALID_INPUT",
          message: "Invalid request",
          details: error.errors,
        },
      });
      return;
    }

    logger.error("Failed to write to stream", { error });
    res.status(500).json({
      error: {
        code: "INTERNAL_ERROR",
        message: "Internal server error",
      },
    });
  }
});
```

### 9. Documentation

Add JSDoc comments for exported functions:

```typescript
/**
 * Writes a record to a stream, creating the stream if it doesn"t exist.
 *
 * @param db - Database connection
 * @param userId - ID of the user writing the record
 * @param streamId - User-defined stream identifier
 * @param content - Content to write (string or JSON)
 * @param contentType - MIME type of the content
 * @param metadata - Optional metadata for the record
 * @returns Result containing the created record or an error
 */
export async function writeRecord(
  db: Database,
  userId: string,
  streamId: string,
  content: any,
  contentType: string = "application/json",
  metadata?: Record<string, any>,
): Promise<Result<StreamRecord>> {
  // Implementation
}
```

### 10. Testing

```typescript
describe("Stream Operations", () => {
  let db: Database;
  let userId: string;

  beforeEach(async () => {
    // Setup
    db = getTestDb();
    userId = await createTestUser(db);
  });

  afterEach(async () => {
    // Cleanup
    await db("record").delete();
    await db("stream").delete();
    await db('"user"').delete();
  });

  it("should create stream on first write", async () => {
    // Act
    const result = await writeRecord(db, userId, "test-stream", {
      message: "Hello",
    });

    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toEqual({ message: "Hello" });

      // Verify stream was created
      const stream = await db("stream")
        .where("stream_id", "test-stream")
        .first();
      expect(stream).toBeDefined();
      expect(stream.creator_id).toBe(userId);
    }
  });
});
```

### 11. Security Patterns

#### Input Validation

Always validate input with Zod:

```typescript
import { z } from "zod";

const streamPathSchema = z
  .string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_\-/.]+$/);

const writeSchema = z.union([
  z.string(),
  z.record(z.unknown()),
  z.array(z.unknown()),
]);

// Use in routes
const streamPath = streamPathSchema.parse(req.params.stream_path);
const content = writeSchema.parse(req.body);
```

#### SQL Injection Prevention

Always use parameterized queries with named parameters:

```typescript
// ✅ Good - Named parameters with pg-promise
const stream = await db.oneOrNone<StreamDbRow>(
  `SELECT * FROM stream 
   WHERE stream_id = $(streamId) 
   AND creator_id = $(userId)`,
  { streamId, userId },
);

// ✅ Good - Named parameters with raw queries
const result = await db.raw(
  `SELECT * FROM stream 
   WHERE pod_id = :podId 
   AND stream_id = :streamId`,
  { podId, streamId },
);

// ❌ Bad - Positional parameters (avoid!)
const result = await db.raw(
  `SELECT * FROM stream WHERE pod_id = $1 AND stream_id = $2`,
  [podId, streamId],
);

// ❌ Bad - String concatenation (NEVER do this!)
const stream = await db.raw(
  `SELECT * FROM stream WHERE stream_id = "${streamId}"`,
);
```

#### Database Parameter Convention

**IMPORTANT**: Always use named parameters instead of positional parameters:

```typescript
// ✅ Good - Named parameters are self-documenting
await db.raw(
  `INSERT INTO record (stream_id, index, content, author_id)
   SELECT :streamId, COALESCE(MAX(index), -1) + 1, :content, :authorId
   FROM record WHERE stream_id = :streamId`,
  { streamId, content, authorId },
);

// ❌ Bad - Positional parameters are error-prone
await db.raw(
  `INSERT INTO record (stream_id, index, content, author_id)
   SELECT $1, COALESCE(MAX(index), -1) + 1, $2, $3
   FROM record WHERE stream_id = $1`,
  [streamId, content, authorId],
);
```

Benefits of named parameters:

- Self-documenting queries
- Reusable parameters (use `:streamId` multiple times)
- Less error-prone (no counting positions)
- Easier refactoring

### 12. Performance Patterns

#### Batch Operations

```typescript
// ✅ Good - Single query for count
const [{ count }] = await db("record")
  .where("stream_id", streamId)
  .count("* as count");

// ❌ Bad - Loading all records to count
const records = await db("record").where("stream_id", streamId);
const count = records.length;
```

#### Pagination

```typescript
// ✅ Good - Limit-based pagination
const records = await db("record")
  .where("stream_id", streamId)
  .where("index", ">", after || 0)
  .orderBy("index", "asc")
  .limit(limit + 1); // +1 to check if there are more

const hasMore = records.length > limit;
if (hasMore) {
  records.pop(); // Remove the extra record
}
```

### 13. Adapter Patterns

When implementing adapters for external systems, use functional interfaces instead of classes:

```typescript
// ✅ Good - Functional adapter pattern
// types.ts
export type ConnectFunction = (
  config: ConnectionConfig,
) => Promise<Result<Connection>>;

export type SendFunction = (
  connection: Connection,
  data: any,
) => Promise<Result<void>>;

export type CloseFunction = (connection: Connection) => Promise<Result<void>>;

export type Adapter = {
  connect: ConnectFunction;
  send: SendFunction;
  close: CloseFunction;
};

// implementation.ts
export const connect: ConnectFunction = async (config) => {
  // Implementation
};

export const send: SendFunction = async (connection, data) => {
  // Implementation
};

export const close: CloseFunction = async (connection) => {
  // Implementation
};

// Export the adapter
export const adapter: Adapter = {
  connect,
  send,
  close,
};

// ❌ Bad - Class-based adapter
export class ServiceAdapter implements Adapter {
  constructor(private config: Config) {}

  async connect(): Promise<Result<Connection>> {
    // Implementation
  }

  async send(data: any): Promise<Result<void>> {
    // Implementation
  }
}
```

## Code Review Checklist

Before submitting a PR, ensure:

- [ ] All functions use Result types for error handling
- [ ] No classes used (functions only)
- [ ] All imports include `.js` extension
- [ ] Database queries use pg-promise with named parameters
- [ ] Reserved words like `user` are quoted
- [ ] JSDoc comments for public functions
- [ ] Input validation with Zod
- [ ] No `any` types used
- [ ] Proper error codes in Result types
- [ ] Tests included for new functionality
- [ ] No console.log statements (use logger)
