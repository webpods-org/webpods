# Coding Standards

This document outlines the coding standards and patterns used throughout the WebPods codebase. All contributors should follow these guidelines to maintain consistency and quality.

## Core Principles

### 1. Functional Programming First

**PREFER FUNCTIONS OVER CLASSES** - Export functions from modules when possible. Classes should only be used when they provide clear benefits.

```typescript
// ✅ Good - Pure function with explicit dependencies
export async function writeRecord(
  db: Knex,
  queueId: string,
  content: any,
  contentType: string,
  authorId: string,
  alias?: string | null
): Promise<Result<QueueItem>> {
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
export class QueueService {
  constructor(private db: Knex) {}
  
  async writeRecord(queueId: string, content: any): Promise<QueueItem> {
    // This doesn't need to be a class
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
export async function findQueue(
  db: Knex,
  queueId: string
): Promise<Result<Queue>> {
  try {
    const queue = await db('queue')
      .where('q_id', queueId)
      .first();
    
    if (!queue) {
      return failure({
        code: 'NOT_FOUND',
        message: 'Queue not found'
      });
    }
    
    return success(queue);
  } catch (error) {
    return failure({
      code: 'DATABASE_ERROR',
      message: error.message
    });
  }
}

// ❌ Bad - Throwing exceptions
export async function findQueue(db: Knex, queueId: string): Promise<Queue> {
  const queue = await db('queue').where('q_id', queueId).first();
  if (!queue) throw new Error('Queue not found');
  return queue;
}
```

### 3. Database Patterns

#### Direct Knex Usage
Use Knex query builder directly. No ORMs or abstraction layers.

```typescript
// ✅ Good - Direct Knex with type safety
const queue = await db<Queue>('queue')
  .where('q_id', queueId)
  .first();

const [record] = await db('record')
  .insert({
    queue_id: queue.id,
    sequence_num: nextSeq,
    content: JSON.stringify(content),
    content_type: contentType,
    created_by: userId
  })
  .returning('*');

// ❌ Bad - Unnecessary abstraction
const queue = await this.repository.findOne({ q_id: queueId });
```

#### Reserved Words
PostgreSQL reserved words like `user` must be quoted:

```typescript
// ✅ Good - Quoted reserved word
const user = await db('`user`')
  .where('auth_id', authId)
  .first();

// ❌ Bad - Unquoted reserved word
const user = await db('user')  // Will fail!
  .where('auth_id', authId)
  .first();
```

### 4. Module Structure

#### Imports
All imports MUST include the `.js` extension:

```typescript
// ✅ Good
import { createQueue } from './domain/queue/create-queue.js';
import { authenticate } from './middleware/auth.js';
import { Result } from './types.js';

// ❌ Bad
import { createQueue } from './domain/queue/create-queue';
import { authenticate } from './middleware/auth';
```

#### Exports
Use named exports, avoid default exports:

```typescript
// ✅ Good
export function writeRecord() { ... }
export function readRecords() { ... }
export type QueueRecord = { ... };

// ❌ Bad
export default class QueueService { ... }
```

### 5. Naming Conventions

#### General Rules
- **Functions**: camelCase (`writeRecord`, `checkPermission`, `createQueue`)
- **Types/Interfaces**: PascalCase (`Queue`, `QueueRecord`, `User`)
- **Constants**: UPPER_SNAKE_CASE (`MAX_RETRIES`, `DEFAULT_LIMIT`)
- **Files**: kebab-case (`create-queue.ts`, `check-permission.ts`)
- **Database**: snake_case tables and columns (`queue`, `created_at`, `sequence_num`)

#### Database Naming
- **Tables**: singular, lowercase (`user`, `queue`, `record`, `rate_limit`)
- **Columns**: snake_case (`queue_id`, `created_at`, `content_type`)
- **Foreign Keys**: `{table}_id` (`creator_id`, `queue_id`)

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
type Queue = {
  id: string;
  q_id: string;
  creator_id: string;
  read_permission: string;
  write_permission: string;
};

type Permission = 'public' | 'auth' | 'owner';

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
  if (typeof content === 'string') {
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
export async function createQueueWithRecord(
  db: Knex,
  userId: string,
  queueId: string,
  content: any
): Promise<Result<QueueRecord>> {
  const queueResult = await createQueue(db, userId, queueId);
  if (!queueResult.success) {
    return queueResult;
  }
  
  const recordResult = await writeRecord(
    db,
    userId,
    queueResult.data.id,
    content
  );
  
  return recordResult;
}

// ❌ Bad - Promise chains
export function createQueueWithRecord(
  db: Knex,
  userId: string,
  queueId: string,
  content: any
): Promise<Result<QueueRecord>> {
  return createQueue(db, userId, queueId).then(queueResult => {
    if (!queueResult.success) {
      return queueResult;
    }
    return writeRecord(db, userId, queueResult.data.id, content);
  });
}
```

### 8. Express Route Patterns

```typescript
// ✅ Good - Proper error handling and validation
router.post('/q/:q_id', authenticate, async (req, res) => {
  try {
    // Validate input
    const qId = queueIdSchema.parse(req.params.q_id);
    const content = writeSchema.parse(req.body);
    
    // Check rate limit
    const rateLimit = await checkRateLimit(db, req.auth!.userId, 'write');
    if (!rateLimit.allowed) {
      res.status(429).json({
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: 'Too many requests'
        }
      });
      return;
    }
    
    // Execute business logic
    const result = await writeRecord(
      db,
      req.auth!.userId,
      qId,
      content
    );
    
    // Handle result
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
    
    logger.error('Failed to write to queue', { error });
    res.status(500).json({ 
      error: {
        code: 'INTERNAL_ERROR',
        message: 'Internal server error'
      }
    });
  }
});
```

### 9. Documentation

Add JSDoc comments for exported functions:

```typescript
/**
 * Writes a record to a queue, creating the queue if it doesn't exist.
 * 
 * @param db - Database connection
 * @param userId - ID of the user writing the record
 * @param queueId - User-defined queue identifier
 * @param content - Content to write (string or JSON)
 * @param contentType - MIME type of the content
 * @param metadata - Optional metadata for the record
 * @returns Result containing the created record or an error
 */
export async function writeRecord(
  db: Knex,
  userId: string,
  queueId: string,
  content: any,
  contentType: string = 'application/json',
  metadata?: Record<string, any>
): Promise<Result<QueueRecord>> {
  // Implementation
}
```

### 10. Testing

```typescript
describe('Queue Operations', () => {
  let db: Knex;
  let userId: string;
  
  beforeEach(async () => {
    // Setup
    db = getTestDb();
    userId = await createTestUser(db);
  });
  
  afterEach(async () => {
    // Cleanup
    await db('record').delete();
    await db('queue').delete();
    await db('`user`').delete();
  });
  
  it('should create queue on first write', async () => {
    // Act
    const result = await writeRecord(
      db,
      userId,
      'test-queue',
      { message: 'Hello' }
    );
    
    // Assert
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.content).toEqual({ message: 'Hello' });
      
      // Verify queue was created
      const queue = await db('queue')
        .where('q_id', 'test-queue')
        .first();
      expect(queue).toBeDefined();
      expect(queue.creator_id).toBe(userId);
    }
  });
});
```

### 11. Security Patterns

#### Input Validation
Always validate input with Zod:

```typescript
import { z } from 'zod';

const queueIdSchema = z.string()
  .min(1)
  .max(256)
  .regex(/^[a-zA-Z0-9_-]+$/);

const writeSchema = z.union([
  z.string(),
  z.record(z.unknown()),
  z.array(z.unknown())
]);

// Use in routes
const qId = queueIdSchema.parse(req.params.q_id);
const content = writeSchema.parse(req.body);
```

#### SQL Injection Prevention
Always use parameterized queries:

```typescript
// ✅ Good - Parameterized
const queue = await db('queue')
  .where('q_id', queueId)
  .andWhere('creator_id', userId)
  .first();

// ❌ Bad - String concatenation
const queue = await db.raw(
  `SELECT * FROM queue WHERE q_id = '${queueId}'`
);
```

### 12. Performance Patterns

#### Batch Operations
```typescript
// ✅ Good - Single query for count
const [{ count }] = await db('record')
  .where('queue_id', queueId)
  .count('* as count');

// ❌ Bad - Loading all records to count
const records = await db('record')
  .where('queue_id', queueId);
const count = records.length;
```

#### Pagination
```typescript
// ✅ Good - Limit-based pagination
const records = await db('record')
  .where('queue_id', queueId)
  .where('sequence_num', '>', after || 0)
  .orderBy('sequence_num', 'asc')
  .limit(limit + 1);  // +1 to check if there are more

const hasMore = records.length > limit;
if (hasMore) {
  records.pop();  // Remove the extra record
}
```

## Code Review Checklist

Before submitting a PR, ensure:

- [ ] All functions use Result types for error handling
- [ ] No classes used (functions only)
- [ ] All imports include `.js` extension
- [ ] Database queries use Knex query builder
- [ ] Reserved words like `user` are quoted
- [ ] JSDoc comments for public functions
- [ ] Input validation with Zod
- [ ] No `any` types used
- [ ] Proper error codes in Result types
- [ ] Tests included for new functionality
- [ ] No console.log statements (use logger)