# WebPods Refactoring TODO

## Current Status

We have successfully completed the major architectural changes to make WebPods streams hierarchical and are in the process of reorganizing the codebase for better maintainability.

## What Has Been Completed

### 1. Database Schema Changes ✅
- Updated streams table to use hierarchical structure with parent_id relationships
- Stream IDs are now bigint serial primary keys (returned as numbers by pg-promise)
- Records reference streams by stream_id (number) instead of pod_name/stream_name
- All database types updated to use `number` for IDs, not strings

### 2. Domain Functions Updated ✅
- All record domain functions now take `streamId: number`
- Stream domain functions take appropriate parameters (some IDs, some paths)
- Fixed variable naming: `streamId` is only used for numeric IDs
- Path resolution logic moved to domain layer in `/src/domain/resolution/resolve-path.ts`

### 3. Permission System Fixed ✅  
- `checkPermissionStream` now properly resolves stream paths to IDs
- `canRead` and `canWrite` functions work correctly with Stream objects
- Permission inheritance from parent streams works

### 4. Route Handler Issues Fixed ✅
- Fixed all variable naming (streamId vs streamPath) in routes
- Updated database queries to use new schema (stream_id instead of stream_name)
- Fixed resolveLink return type (streamPath instead of streamId)
- All TypeScript compilation errors resolved
- Basic test passes: "should allow anonymous read on public streams"

## PENDING WORK - Route Reorganization

### Current Problem
The `/src/routes/pods.ts` file is 1600+ lines and contains all route handlers in one monolithic file. This makes it hard to maintain and debug.

### Goal
Split the monolithic route file into organized directories:

```
routes/
  pods/
    index.ts        // Main router that imports and wires up all handlers
    get.ts          // GET /* handler (main content retrieval)
    post.ts         // POST /* handler (content creation)
    delete.ts       // DELETE /* handler (content deletion)
    login.ts        // GET /login handler
    streams.ts      // GET /.config/api/streams handler
    auth-callback.ts // GET /auth/callback handler
    transfer.ts     // POST /transfer handler
    ...
```

### Current Route Structure in pods.ts

Based on analysis, here are the main routes to extract:

1. **Line 76**: `GET /login` - OAuth login redirect
2. **Line 103**: `GET /auth/callback` - OAuth callback handler  
3. **Line 151**: `GET /.config/api/streams` - List pod streams
4. **Line 187**: `DELETE /transfer` - Cancel transfer
5. **Line 225**: `POST /transfer` - Transfer ownership
6. **Line 286**: `POST /.config/api/streams` - Create stream
7. **Line 353**: `POST /logout` - Logout
8. **Line 425**: `POST /*` - Main content creation handler (LARGE - ~400 lines)
9. **Line 817**: `GET /logout` - Logout page
10. **Line 903**: `GET /*` - Main content retrieval handler (LARGE - ~500 lines)
11. **Line 1407**: `DELETE /*` - Main content deletion handler (LARGE - ~200 lines)

### Extraction Strategy

#### Phase 1: Extract Utility Functions and Shared Code
1. Create `/src/routes/pods/shared.ts` with:
   - Common imports
   - Shared middleware functions
   - Utility functions used across handlers
   - Type definitions for route handlers

#### Phase 2: Extract Individual Route Files
For each route handler:
1. Create individual file (e.g., `get.ts`, `post.ts`, `delete.ts`)
2. Import necessary dependencies and shared utilities
3. Export the handler function
4. Include proper TypeScript types
5. Test the extracted handler works

#### Phase 3: Create Index Router
1. Create `/src/routes/pods/index.ts` that:
   - Creates the main router
   - Imports all individual handlers
   - Registers routes with correct middleware
   - Exports the complete router

#### Phase 4: Update Main App
1. Update main application to use new pod router structure
2. Remove old monolithic pods.ts file
3. Test all functionality still works

### Detailed Implementation Plan

#### Step 1: Create Shared Utilities (`/src/routes/pods/shared.ts`)

Extract these common imports and utilities:
```typescript
// All the imports from current pods.ts
import { Router, Request as ExpressRequest, Response, NextFunction } from "express";
import type { AuthRequest, StreamRecord } from "../../types.js";
// ... all other imports

// Shared utility functions
export function recordToResponse(record: StreamRecord, streamPath: string) {
  // Implementation from current file
}

// Common validation schemas
export const writeSchema = z.union([...]);

// Common middleware chains
export const readMiddleware = [extractPod, optionalAuth, rateLimit("read")];
export const writeMiddleware = [extractPod, authenticate, rateLimit("write")];
```

#### Step 2: Extract GET Handler (`/src/routes/pods/get.ts`)

The GET /* handler (lines 903-~1400) should be extracted to:
```typescript
import { Response, NextFunction } from "express";
import type { AuthRequest } from "../../types.js";
import { readMiddleware, recordToResponse } from "./shared.js";
// ... other imports

export const getHandler = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Current implementation from line ~908 to ~1400
  // This is the main content retrieval logic
};

// Export the complete route definition
export const getRoute = {
  path: "/*",
  middleware: readMiddleware,
  handler: getHandler
};
```

#### Step 3: Extract POST Handler (`/src/routes/pods/post.ts`)

The POST /* handler (lines 425-~816) should be extracted to:
```typescript
import { Response, NextFunction } from "express";
import type { AuthRequest } from "../../types.js";
import { writeMiddleware } from "./shared.js";
// ... other imports

export const postHandler = async (req: AuthRequest, res: Response, next: NextFunction) => {
  // Current implementation from line ~430 to ~816
  // This is the main content creation logic
};

export const postRoute = {
  path: "/*", 
  middleware: writeMiddleware,
  handler: postHandler
};
```

#### Step 4: Extract DELETE Handler (`/src/routes/pods/delete.ts`)

The DELETE /* handler (lines 1407-end) should be extracted similarly.

#### Step 5: Extract Other Handlers

Each of the other smaller handlers should be extracted to their own files:
- `login.ts` - Login redirect
- `auth-callback.ts` - OAuth callback  
- `streams.ts` - Stream management API
- `transfer.ts` - Ownership transfer
- `logout.ts` - Logout functionality

#### Step 6: Create Index Router (`/src/routes/pods/index.ts`)

```typescript
import { Router } from "express";
import { getRoute } from "./get.js";
import { postRoute } from "./post.js";
import { deleteRoute } from "./delete.js";
// ... import all other routes

const router = Router({ mergeParams: true });
const logger = createLogger("webpods:routes:pods");

// Register all routes
router.get(getRoute.path, ...getRoute.middleware, getRoute.handler);
router.post(postRoute.path, ...postRoute.middleware, postRoute.handler);
router.delete(deleteRoute.path, ...deleteRoute.middleware, deleteRoute.handler);
// ... register all other routes

export default router;
```

### Implementation Notes

#### Critical Considerations:
1. **Order Matters**: Some routes must be registered in specific order (more specific routes before catch-all routes)
2. **Middleware**: Each route needs correct middleware chain (auth, rate limiting, etc.)
3. **Error Handling**: Ensure error handling is consistent across all handlers
4. **Imports**: Be careful about circular dependencies between shared.ts and individual handlers
5. **Testing**: After each extraction, test that specific functionality still works

#### Route Registration Order:
Must register routes in this order to avoid catch-all conflicts:
1. `/login` 
2. `/logout`
3. `/auth/callback`  
4. `/.config/api/streams`
5. `/transfer`
6. `/*` (catch-all routes last)

#### Shared Code Extraction:
These utilities are used across multiple handlers and should be in shared.ts:
- `recordToResponse()` - Converts records to API response format
- `parseIndexQuery()` - Parses query parameters for record access
- `detectContentType()` - Content type detection
- `isSystemStream()` - Checks for system streams
- Zod schemas for request validation

### Path Resolution Integration (Future Enhancement)

After route splitting is complete, the next major enhancement would be to integrate the new path resolution domain function:

1. Replace manual path resolution in route handlers with calls to `resolvePath()`
2. This will make route handlers much simpler and more consistent
3. All resolution logic will be centralized in the domain layer
4. Better error handling and consistency

### Testing Strategy

After each extraction:
1. Run `npm run test:grep -- "should allow anonymous read on public streams"` to verify basic functionality
2. Test specific functionality for the extracted route
3. Run full test suite before final completion
4. Manual testing of key workflows

### Files That Will Be Created/Modified:

#### New Files:
- `/src/routes/pods/shared.ts`
- `/src/routes/pods/index.ts` 
- `/src/routes/pods/get.ts`
- `/src/routes/pods/post.ts`
- `/src/routes/pods/delete.ts`
- `/src/routes/pods/login.ts`
- `/src/routes/pods/auth-callback.ts`
- `/src/routes/pods/streams.ts`
- `/src/routes/pods/transfer.ts`
- `/src/routes/pods/logout.ts`

#### Modified Files:
- Main app router (wherever pods.ts is imported)
- `/src/routes/pods.ts` will be deleted after extraction is complete

### Current State Summary

- ✅ All architectural changes complete (hierarchical streams, proper types)
- ✅ Domain functions properly organized  
- ✅ Database schema updated and working
- ✅ Basic functionality tested and working
- 🔄 **NEXT**: Route reorganization (split monolithic file)
- ⏳ **AFTER**: Path resolution integration in routes
- ⏳ **AFTER**: Full test suite validation

The system is fully functional but needs better organization for maintainability. The route splitting is purely an organizational improvement and should not change any functionality.