# WebPods TODO

## Hierarchical Streams Refactoring - Remaining Work

### 1. CLI Package Updates ⚠️ PRIORITY

The CLI package (`/node/packages/webpods-cli`) has not been updated to work with the new hierarchical streams architecture. Many CLI tests are failing because:

- CLI commands still use the old flat stream model (pod_name/stream_name)
- Database queries in CLI use old schema with `pod_name` and `stream_name` columns
- CLI needs to be updated to work with:
  - Hierarchical stream paths (e.g., `/parent/child/grandchild`)
  - Stream IDs as numbers instead of strings
  - New database schema with `parent_id` relationships

**Required Changes:**

- Update all CLI commands to use hierarchical paths
- Fix database queries to use `stream_id` instead of `pod_name`/`stream_name`
- Update stream creation/deletion to handle parent-child relationships
- Fix record operations to use numeric stream IDs
- Update test helpers to work with new schema

### 2. Field Naming Standardization

Currently there's inconsistency in user ID field naming across the codebase:

- **Current State:**
  - Permission streams use `id` field for user identification
  - Owner records use `owner` field for user identification
  - Some places use `userId`

- **Target State:**
  - Standardize to `userId` everywhere for consistency
  - Update all API endpoints to expect `userId`
  - Update tests to use `userId`
  - No backward compatibility needed (greenfield project)

### 3. Documentation Updates

- Update CLAUDE.md to reflect:
  - Hierarchical streams architecture
  - Field naming standardization (userId)
  - New path resolution patterns
- Update README.md API examples with hierarchical paths
- Document the parent-child stream relationships

## Completed Items ✅

### Hierarchical Streams Core Implementation

- ✅ Database schema migrated to hierarchical structure with `parent_id`
- ✅ Stream IDs converted to bigint serial primary keys
- ✅ Records reference streams by `stream_id` instead of `pod_name`/`stream_name`
- ✅ All domain functions updated to use numeric `streamId`
- ✅ Path resolution logic centralized in `/src/domain/resolution/resolve-path.ts`
- ✅ Permission system with inheritance from parent streams
- ✅ Route handlers fixed with proper variable naming
- ✅ TypeScript compilation errors resolved
- ✅ Integration tests passing

### Route Reorganization

- ✅ Split monolithic `/src/routes/pods.ts` into organized modules
- ✅ Created separate files for each route handler
- ✅ Shared utilities extracted
- ✅ Proper route registration order maintained

## Next Steps

1. **Immediate Priority:** Fix CLI package to work with hierarchical streams
2. **Then:** Standardize field naming to `userId` everywhere
3. **Finally:** Update all documentation

## Notes

- The server and integration tests are working correctly with hierarchical streams
- The main gap is the CLI package which needs updating
- Field naming inconsistency should be fixed for better maintainability
- This is a greenfield project, so no backward compatibility constraints
