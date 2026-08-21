# Test Journal

## Replication Test Issues (2024)

### Issue: Replication Test Failures
The replication tests in `test/e2e/replication.e2e.js` were failing due to several issues:

1. **API Route Mounting Issue**
   - Problem: API routes were incorrectly mounted at `/api`, while test was accessing `/RemoteTestModel-changes` directly
   - Fix: Changed REST API mounting from `/api` prefix to root path in `server.js`
   - Learning: Route prefixes need to be consistent between server setup and client access

2. **Error Handling Middleware**
   - Problem: Error handling middleware was not properly chained
   - Fix: Adjusted error handling middleware to capture all errors and provide better error details
   - Learning: Error middleware ordering is crucial, and error details help with debugging

3. **Change Tracking Setup Timing**
   - Problem: Change tracking setup was occurring too late in the boot process
   - Fix: Moved change tracking enablement before mounting REST API
   - Learning: Order of operations in server setup can affect feature availability

4. **URL Consistency Issue**
   - Problem: Client datasource URL still included `/api` prefix after server changes
   - Fix: Updated datasource URL in test to match server route configuration
   - Learning: Client configuration must be updated to match server changes

5. **Test Cleanup Timing Issue**
   - Problem: `beforeEach` and `afterEach` hooks were calling `done()` multiple times due to async operations
   - Fix: Added flags to ensure `done()` is called only once
   - Learning: Careful management of async cleanup is crucial in test hooks

6. **Model ID Configuration**
   - Problem: Change tracking models required string IDs with UUID default values
   - Fix: Updated model configuration to properly set up string IDs with UUID generation
   - Learning: Change tracking has specific model configuration requirements

### Current Status
- Modified server setup in `test/fixtures/e2e/server/server.js`
- Improved error handling and logging
- Adjusted change tracking initialization timing
- Added better debugging information
- Fixed URL consistency between client and server
- Improved test cleanup reliability
- Added proper model ID configuration

### Next Steps
- Monitor test execution for any remaining timing issues
- Consider adding more detailed logging for change tracking operations
- May need to review cleanup procedures in test teardown
- Consider adding more robust async operation handling in tests
- Review model configuration requirements for all test models

### Learnings
1. Server setup order matters significantly for feature availability
2. Error handling should be comprehensive and informative
3. Test infrastructure needs careful consideration of timing and cleanup
4. Route mounting and URL construction must be consistent across server and client
5. Async operations in test hooks require careful management of cleanup
6. Configuration changes must be synchronized between client and server components
7. Model configuration, especially for IDs, is critical for change tracking

### Related Files
- `test/e2e/replication.e2e.js` - Main replication test
- `test/fixtures/e2e/server/server.js` - Test server setup
- `common/models/change.js` - Change tracking implementation

### Progress Update (Latest)
- Attempted to run replication test with improved async/await handling and dynamic port allocation
- Test is still failing with consistent errors on `/RemoteTestModel-changes` endpoint
- Key observations from latest test run:
  1. Multiple "Internal Server Error" responses from `/RemoteTestModel-changes` endpoint
  2. Test fails with "Remote instance should exist" assertion
  3. Multiple `done()` calls in the "after each" hook still occurring

### Current Issues
1. **Change Model API Access**
   - The `/RemoteTestModel-changes` endpoint is consistently returning 500 errors
   - This suggests potential issues with:
     - Change model registration
     - REST API endpoint configuration
     - Error handling in the Change model routes

2. **Test Cleanup Issues**
   - Multiple `done()` calls in cleanup indicate async operations are not properly coordinated
   - Need to ensure cleanup operations are properly sequenced and handled

### Next Steps
1. **Change Model Investigation**
   - Review Change model registration in server setup
   - Verify Change model REST API endpoints are properly exposed
   - Add more detailed logging for Change model operations

2. **Test Infrastructure**
   - Implement more robust cleanup handling
   - Add better error logging for Change model API calls
   - Review async operation sequencing in test setup/teardown

3. **Server Configuration**
   - Verify model relations are properly set up
   - Ensure Change model endpoints are accessible
   - Add more detailed request/response logging

### Learnings
1. Change tracking API requires careful coordination between model registration and REST endpoint exposure
2. Test cleanup with multiple async operations needs more robust handling
3. Internal server errors need more detailed logging to diagnose root causes

### Related Files
- `test/e2e/replication.e2e.js` - Main replication test
- `test/fixtures/e2e/server/server.js` - Test server setup
- `common/models/change.js` - Change tracking implementation

### Critical Breakthrough (2024-06-15)
**Issue**: Persistent 500 errors on change endpoints  
**Root Cause**:
- Model name mismatch in relations ('Change' vs 'ChangeModel')
- Over-configuration of framework-managed properties  
**Solution**:
1. Use exact auto-generated change model names
2. Remove redundant model configuration
3. Add functional endpoint verification  
**Learning**: 
- Trust framework's model naming conventions
- Verify endpoints functionally, not just route existence
- Relations require exact model names 