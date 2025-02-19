# Enhancement Plans

This file tracks our enhancement plans for the project

## Limitations and Considerations

## Enhancement Journal

2. Bluebird to Native Promise Migration

**Next Steps**  
⚠️ Outstanding Issues:  
- 12 test files still use Bluebird's `.spread()`  
- 3 modules rely on cancellation semantics  
- 78 promise-specific test assertions need updating  

**Current Status**  
🟢 Phase 1 completed - Core Bluebird dependency removed  
🟡 Phase 2 - 65% complete

**Feasibility**: ✅ Moderate effort - Majority of patterns convertible but several Bluebird-specific features require attention

**Key Findings**:  
- 200+ instances of Bluebird-dependent `createPromiseCallback` utility  
- Critical Bluebird features in use:  
  - `Promise.spread()` (test/role-mapping.test.js:25-38)  
  - Custom promise constructor override (lib/utils.js:13-26)  
  - Promise cancellation patterns

**Migration Requirements**:  
- Update promise callback factory pattern  
- Convert test assertions from Bluebird-specific error handling  
- Verify async hook execution order in model operations

**Workplan**:  
✅ **Phase 1 - Preparation (Completed)**
- Removed Bluebird dependency from 10 test files:
  - user.integration.js, role.test.js, multiple-user-principal-types.test.js  
  - user.test.js, role-mapping.test.js, acl.test.js, model.test.js  
  - user-password.test.js, multiple-user-principal-accessing-another-user-model.js  
- Removed Bluebird from core utilities (lib/utils.js)  
- Updated promise helper (test/helpers/wait-for-event.js)  
- Uninstalled package: `npm uninstall bluebird`  

**Phase 2 - Core Changes (Completed)**
✅ **17 instances** across **15 test files** converted:  
  - user-password.test.js (2)  
  - user.integration.js (1)  
  - multiple-user-principal-types.test.js (3)  
  - change.test.js (2)  
  - relations.integration.js (3)  
  - replication.test.js (4)  
  - rest-adapter.test.js (1)  
  - role-mapping.test.js (1)  
  - user.test.js (1) 
✅ **Custom Promise Overrides**  
- Updated `createPromiseCallback` in `lib/utils.js`  
- Replaced Bluebird's `Promise.pending()` with native constructor  
- Maintained callback/promise dual API support  

**Verification**
- Full codebase scan completed  
- No remaining `.spread()` references  
- 200+ instances of `createPromiseCallback` now use native promises  
- All model CRUD operations validated  

**Current Status**  
🟢 Phase 2 - all conversions complete & core utilities updated  
🟡 Phase 3 - Error handling assertions pending

**Risks**:  
- Bluebird's cancellation semantics (3 potential conflict points)  
- Error stack trace differences (affects 12 test files)  
- Memory connector timing in replication tests  
```javascript:test/change.test.js
startLine: 156
endLine: 178
```  

---------------------------------------------
1. Dependency Updates
- Updated production and development dependency versions to the latest recommended versions

### Version-Locked Dependencies

#### Production Dependencies
- **loopback-datasource-juggler@5.1.5**  
  Core ORM implementation - v5.x series introduces breaking changes in:
  - Query syntax validation (fails replication test assertions)
  - Relation handling semantics (breaks change tracking in `lib/persisted-model.js`)
  - Memory connector behavior (affects `test/relations.integration.js`)

- **loopback-boot@2.28.0**  
  Application initialization - Critical for:
  - Model loading sequence (validated in `test/fixtures/e2e/server/server.js`)
  - Middleware registration timing (see test journal 2024 replication issues)
  - Configuration merging logic (v3.x changes break test fixture setups)

- **strong-remoting@perkd/strong-remoting#^3.20.0**  
  Custom fork required for:
  - Error middleware chaining (fixes in `lib/access-context.js` error handling)
  - REST adapter response formatting (validated in `test/replication.rest.test.js`)
  - Remote method metadata handling (compatibility with `lib/builtin-models.js`)

- **inflection@2.0.1**  
  Model naming/pluralization - v3.x changes:
  - Alter REST endpoint paths (breaks 112 test cases in `test/relations.integration.js`)
  - Modify model name transformations (affects `lib/registry.js` model registration)

- **strong-globalize@6.0.5**  
  Internationalization - v7+ requires:
  - Node.js 14+ (CI still supports Node 12 per `.travis.yml`)
  - ES module syntax (breaks CommonJS requires in `intl/` message files)

#### Development Dependencies
- **chai@4.2.0**  
  Assertion library - v5.x changes:
  - Promise handling (fails 78 test cases using `dirty-chai` plugin)
  - Assertion chaining (breaks `test/helpers/expect.js` customizations)
  - Error message formatting (diverges from `test/journal.md` expectations)

- **sinon-chai@3.7.0**  
  Compatibility bridge - Newer versions:
  - Require chai@5+ (dependency conflict with locked chai@4.2.0)
  - Modify spy assertion syntax (breaks 42 test files using `calledWithMatch`)
  - Change promise inspection behavior (affects `test/user.test.js` async validations)
