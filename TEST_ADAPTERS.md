# Testing with Different Adapter Combinations

The test suite now supports running with different cache and rate limit adapter combinations via environment variables.

## Environment Variables

- `TEST_CACHE_ADAPTER`: Sets the cache adapter for tests
  - Options: `in-memory`, `none`
  - Default: Uses test-config.json settings

- `TEST_RATELIMIT_ADAPTER`: Sets the rate limit adapter for tests
  - Options: `in-memory`, `postgres`, `none`
  - Default: Uses test-config.json settings (postgres for integration tests)

## Examples

### Run all tests with in-memory adapters

```bash
TEST_CACHE_ADAPTER=in-memory TEST_RATELIMIT_ADAPTER=in-memory npm test
```

### Run integration tests with no cache and PostgreSQL rate limiting

```bash
TEST_CACHE_ADAPTER=none TEST_RATELIMIT_ADAPTER=postgres npm run test:integration
```

### Run specific test with in-memory rate limiting

```bash
TEST_RATELIMIT_ADAPTER=in-memory npm run test:grep -- "Rate Limiting"
```

### Test different combinations

```bash
# All in-memory (fastest)
TEST_CACHE_ADAPTER=in-memory TEST_RATELIMIT_ADAPTER=in-memory npm test

# PostgreSQL rate limiting with cache disabled
TEST_CACHE_ADAPTER=none TEST_RATELIMIT_ADAPTER=postgres npm test

# Mixed mode
TEST_CACHE_ADAPTER=in-memory TEST_RATELIMIT_ADAPTER=postgres npm test

# No caching or rate limiting
TEST_CACHE_ADAPTER=none TEST_RATELIMIT_ADAPTER=none npm test
```

## Notes

- The integration tests default to PostgreSQL rate limiting because some tests directly check the database
- For fastest test runs, use in-memory adapters
- When debugging specific features, you can disable them entirely with the `none` option
