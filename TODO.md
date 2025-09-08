# WebPods TODO

## Next Work Items

### 1. Documentation Updates

- Update README.md API examples with hierarchical paths
- Document the parent-child stream relationships
- Add examples of the new .config/api/streams endpoint

## Completed Items ✅

### User ID Field Standardization (COMPLETE)

- ✅ Changed owner records from `{ owner: "userId" }` to `{ userId: "userId" }`
- ✅ Changed permission records from `{ id: "userId" }` to `{ userId: "userId" }`
- ✅ Updated all domain functions to use consistent field names
- ✅ Updated CLI commands to use new format
- ✅ Updated tests and test helpers
- ✅ Updated documentation (CLAUDE.md)

### Hierarchical Streams Refactoring (COMPLETE)

- ✅ Database schema migrated to hierarchical structure with `parent_id`
- ✅ Stream IDs converted to bigint serial primary keys
- ✅ Records reference streams by `stream_id` instead of `pod_name`/`stream_name`
- ✅ All domain functions updated to use numeric `streamId`
- ✅ Path resolution logic centralized in `/src/domain/resolution/resolve-path.ts`
- ✅ Permission system with inheritance from parent streams
- ✅ Route handlers fixed with proper variable naming
- ✅ TypeScript compilation errors resolved
- ✅ Integration tests passing (249 tests)
- ✅ CLI package updated for hierarchical streams
- ✅ CLI tests passing (103 tests)
- ✅ New `.config/api/streams` endpoint with filtering options
- ✅ All TypeScript lint errors fixed
- ✅ Export command removed

### Route Reorganization

- ✅ Split monolithic `/src/routes/pods.ts` into organized modules
- ✅ Created separate files for each route handler
- ✅ Shared utilities extracted
- ✅ Proper route registration order maintained

## Next Steps

1. **Immediate Priority:** Standardize field naming to `userId` everywhere
2. **Then:** Update all documentation

## Notes

- The server and integration tests are working correctly with hierarchical streams
- The main gap is the CLI package which needs updating
- Field naming inconsistency should be fixed for better maintainability
- This is a greenfield project, so no backward compatibility constraints
