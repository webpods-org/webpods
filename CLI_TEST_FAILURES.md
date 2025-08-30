# CLI Test Failures Analysis

## Summary
- **89 tests passing**
- **28 tests failing**

## Detailed Failure Analysis

### 1. Domain Commands (4 failures)

#### Test: "should validate domain format"
- **Location**: `src/tests/domains.test.ts:114`
- **Issue**: Domain validation is not rejecting invalid formats
- **Expected**: Exit code should not be 0 for invalid domain
- **Actual**: Exit code is 0 (success)
- **Root Cause**: CLI doesn't validate domain format before sending to server

#### Test: "should list all domains for a pod"  
- **Location**: `src/tests/domains.test.ts:152`
- **Issue**: List command fails with exit code 1
- **Expected**: Should list domains that were previously added
- **Actual**: Command exits with error
- **Root Cause**: The `.meta/domains` stream doesn't exist when no domains have been added

#### Test: "should show verification status"
- **Location**: `src/tests/domains.test.ts:164`
- **Issue**: Same as above - list command fails
- **Root Cause**: Same - missing `.meta/domains` stream

#### Test: "should remove a specific domain"
- **Location**: `src/tests/domains.test.ts:221`
- **Issue**: Remove command fails with exit code 1
- **Expected**: Should remove domain successfully
- **Actual**: Command exits with error
- **Root Cause**: The domain remove logic fails when trying to update non-existent stream

### 2. Export/Import Commands (4 failures)

#### Test: "should import pod data from JSON file"
- **Location**: `src/tests/export-import.test.ts:222`
- **Issue**: Import doesn't preserve stream data
- **Expected**: Should have at least 3 streams after import
- **Actual**: 0 streams found
- **Root Cause**: Import logic may not be creating streams correctly

#### Test: "should prevent overwriting existing data without --overwrite"
- **Location**: `src/tests/export-import.test.ts:276`
- **Issue**: Not detecting existing data properly
- **Expected**: Should warn about existing data
- **Actual**: Proceeds with import
- **Root Cause**: Check for existing streams may be incorrect

#### Test: "should require file parameter"
- **Location**: `src/tests/export-import.test.ts:313`
- **Issue**: Wrong error message format
- **Expected**: Message should include "specify input file"
- **Actual**: Message is "Missing required argument: file"
- **Root Cause**: Using yargs default error instead of custom message

#### Test: "should preserve all data in round trip"
- **Location**: `src/tests/export-import.test.ts:377`
- **Issue**: Data not preserved after export/import
- **Expected**: 9 records after round trip
- **Actual**: 0 records
- **Root Cause**: Export or import logic not handling records correctly

### 3. Limits Commands (10 failures)

All limits tests fail because the command now returns exit code 1 with a "not implemented" message. This is intentional since the server doesn't have a rate limits endpoint.

#### Affected tests:
- "should show rate limit information"
- "should show current usage if available"  
- "should work without authentication"
- "should show limits for specific action"
- "should handle read action"
- "should handle podCreate action"
- "should handle streamCreate action"
- "should output in JSON format"
- "should output in YAML format"
- "should output in table format by default"

**Solution**: These tests should be updated to expect the "not implemented" response, or the tests should be skipped until the server feature is implemented.

### 4. Links Commands (2 failures)

#### Test: "should list all links for a pod"
- **Location**: `src/tests/links.test.ts:139`
- **Issue**: List command fails after setting links
- **Expected**: Should show all 3 links that were set
- **Actual**: Exit code 1
- **Root Cause**: The links are being set but the list command can't retrieve them

#### Test: "should remove a specific link"
- **Location**: `src/tests/links.test.ts:206`
- **Issue**: Link not actually removed
- **Expected**: Should not see "/blog → blog/posts" after removal
- **Actual**: Link still appears in list
- **Root Cause**: Remove operation may not be working correctly

### 5. Transfer Commands (4 failures)

#### Test: "should show warning without --force flag"
- **Location**: `src/tests/transfer.test.ts:111`
- **Issue**: Warning message format incorrect
- **Expected**: Should include "WARNING" in output
- **Actual**: Message doesn't include "WARNING" (uses warning symbol instead)
- **Root Cause**: Output uses `⚠️` symbol instead of "WARNING" text

#### Test: "should transfer ownership with --force flag"
- **Location**: `src/tests/transfer.test.ts:141`
- **Issue**: Success message format incorrect
- **Expected**: Should include "You no longer have access"
- **Actual**: Different success message
- **Root Cause**: Message text doesn't match expected

#### Test: "should validate new owner exists"
- **Location**: `src/tests/transfer.test.ts:193`
- **Issue**: Not validating if new owner exists
- **Expected**: Should fail for non-existent user
- **Actual**: Returns success (exit code 0)
- **Root Cause**: CLI doesn't validate user existence before transfer

#### Test: "should prevent old owner from accessing pod after transfer"
- **Location**: `src/tests/transfer.test.ts:216`
- **Issue**: Old owner can still access pod
- **Expected**: Should get error when old owner tries to access
- **Actual**: Access succeeds
- **Root Cause**: Transfer may not be working correctly on server side

### 6. Verify Commands (4 failures)

#### Test: "should verify valid hash chain"
- **Location**: `src/tests/verify.test.ts:159`
- **Issue**: Verify command fails
- **Expected**: Should successfully verify valid chain
- **Actual**: Exit code 1
- **Root Cause**: Hash calculation may still be incorrect

#### Test: "should detect broken hash chain"
- **Location**: `src/tests/verify.test.ts:186`
- **Issue**: Not detecting broken chain
- **Expected**: Should report "Hash chain broken"
- **Actual**: Different error message
- **Root Cause**: Verification logic not detecting breaks

#### Test: "should detect invalid first record with previous_hash"
- **Location**: `src/tests/verify.test.ts:211`
- **Issue**: Not detecting invalid first record
- **Expected**: Should report "First record should not have previous_hash"
- **Actual**: Different error message
- **Root Cause**: Verification logic not checking first record properly

#### Test: "should work for public streams without auth"
- **Location**: `src/tests/verify.test.ts:263`
- **Issue**: Can't verify public streams
- **Expected**: Should show stream summary
- **Actual**: Empty output
- **Root Cause**: May be requiring auth even for public streams

## Recommendations

1. **High Priority Fixes** (affect core functionality):
   - Fix links list/remove commands
   - Fix domain list/remove commands  
   - Fix export/import round trip
   - Fix transfer command validation

2. **Medium Priority** (validation/messages):
   - Add domain format validation
   - Fix warning/success messages to match tests
   - Fix verify command hash calculation

3. **Low Priority** (stub implementations):
   - Update limits tests to expect "not implemented" response
   - Or implement basic rate limit endpoint on server

4. **Test Updates Needed**:
   - Some tests expect specific message formats that don't match implementation
   - Consider updating tests to match actual (reasonable) output