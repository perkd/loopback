# LoopBack Modernization by Perkd

This document summarizes all significant changes made to the LoopBack repository by Young (GitHub: @youngtt), focusing on the comprehensive modernization journey from legacy callback-based patterns to modern JavaScript practices.

## 2025

### May 21, 2025

#### Dependency Updates and Package Manager Upgrade
- **Commit**: [`f6b1f49`](https://github.com/perkd/loopback/commit/f6b1f49f0af9c687e0091df8f2e4e8c6c421abdd)
- **Date**: April 27, 2025 (committed May 21, 2025)
- **Changes**: Major dependency updates across the project
  - Updated `body-parser` from `^1.20.3` to `^2.2.0`
  - Updated `express` to `4.21.2` (pinned version)
  - Updated `nodemailer` from `^6.10.0` to `^6.10.1`
  - Updated `strong-remoting` from `^3.20.1` to `^3.20.2`
  - Updated development dependencies:
    - `@babel/eslint-parser` from `^7.26.8` to `^7.27.0`
    - `c8` from `^8.0.1` to `^10.1.3`
    - `eslint` from `^9.21.0` to `^9.25.1`
    - `eslint-plugin-jsonc` from `^2.19.1` to `^2.20.0`
    - `eslint-plugin-mocha` from `^10.5.0` to `^11.0.0`
    - `eslint-plugin-n` from `^17.16.2` to `^17.17.0`
    - `sinon` from `^19.0.2` to `^20.0.0`
    - `supertest` from `^7.0.0` to `^7.1.0`
- **Impact**: Keeps the project up-to-date with latest security patches and features

#### Yarn Package Manager Update
- **Commit**: [`80c6636`](https://github.com/perkd/loopback/commit/80c66360129be53d143a425080805b87c27d8f9a)
- **Date**: April 27, 2025 (committed May 21, 2025)
- **Changes**: Updated Yarn package manager from version 4.7.0 to 4.9.1
- **Impact**: Improved package management performance and bug fixes

### March 5, 2025

#### Version 3.34.1 Release - Coverage System Modernization
- **Commit**: [`6ce55c7`](https://github.com/perkd/loopback/commit/6ce55c7fc4f215029470608f2ee404f2ca5764f6)
- **Date**: March 5, 2025
- **Changes**: Major testing and coverage infrastructure update
  - **Version bump**: Updated from 3.34.0 to 3.34.1
  - **Coverage system migration**: Replaced NYC with C8 for code coverage
    - Added `.c8rc.json` configuration file with 80% coverage thresholds
    - Removed `nyc` dependency
    - Added `c8` as development dependency
  - **Script updates**:
    - Updated test script to use `c8 mocha` instead of `nyc mocha`
    - Updated coverage script to use `c8 report`
    - Added `report-coverage` script for CI integration
    - Added `reinstall` script for clean dependency installation
  - **Package metadata**: Reorganized package.json structure with license and author information
  - **Dependency updates**: Updated `eslint-plugin-n` from `^17.15.1` to `^17.16.2`
- **Impact**: Modernized testing infrastructure with faster and more accurate coverage reporting

#### Yarn Version Update
- **Commit**: [`96d189c`](https://github.com/perkd/loopback/commit/96d189c7d36d8d31d54d781322afed83e8ccfe37)
- **Date**: March 5, 2025
- **Changes**: Updated Yarn package manager from version 4.6.0 to 4.7.0
- **Impact**: Package management improvements and bug fixes

### March 1, 2025

#### JavaScript Modernization - Async Library Removal
- **Commit**: [`eb910b9`](https://github.com/perkd/loopback/commit/eb910b9c21c374b146950f5017c043f140772237)
- **Date**: March 1, 2025
- **Changes**: REST middleware modernization - deprecated `async.eachSeries()`
  - **Removed dependency**: Eliminated `async` library usage in REST middleware
  - **Modern implementation**: Replaced `async.eachSeries()` with native async/await pattern
  - **Before**:
    ```javascript
    async.eachSeries(handlers, function(handler, done) {
      handler(req, res, done);
    }, next);
    ```
  - **After**:
    ```javascript
    (async () => {
      for (const handler of handlers) {
        await new Promise((resolve, reject) => {
          handler(req, res, (err) => err ? reject(err) : resolve());
        });
      }
    })()
      .then(() => next())
      .catch(next);
    ```
- **Impact**: Eliminated external async library dependency, improved performance and maintainability

### February 28, 2025

#### Version 3.34.0 Release - Testing Infrastructure Overhaul
- **Commit**: [`a3df870`](https://github.com/perkd/loopback/commit/a3df8706c5ee8d6ad4a25a7cb6ad031cdfe9772b)
- **Date**: February 28, 2025
- **Changes**: Major testing infrastructure simplification and dependency cleanup
  - **Version bump**: Updated from 3.33.0 to 3.34.0
  - **Testing simplification**:
    - Replaced complex Grunt-based testing with direct Mocha execution
    - Updated test script from `nyc grunt mocha-and-karma` to `nyc mocha test/**/*.js --exit --timeout 5000 --color --reporter spec`
    - Removed Karma testing framework and all related dependencies
  - **Removed dependencies** (major cleanup):
    - Removed `async` from main dependencies
    - Removed all Karma-related packages:
      - `karma`, `karma-browserify`, `karma-chrome-launcher`
      - `karma-es6-shim`, `karma-firefox-launcher`, `karma-html2js-preprocessor`
      - `karma-junit-reporter`, `karma-mocha`, `karma-script-launcher`
    - Removed `grunt-karma` from Grunt tasks
  - **Dependency updates**: Updated `eslint-plugin-n` from `^17.15.1` to `^17.16.2`
- **Impact**: Significantly simplified testing setup, reduced build complexity, and improved development experience

#### Promise-Only API Migration - Core Models Completed
- **Commit**: [`cb55831`](https://github.com/perkd/loopback/commit/cb558317c40a2ad445e79e59a9f68d783072342d)
- **Date**: February 27, 2025
- **Changes**: **BREAKING CHANGE** - Role model converted to promise-only API
  - **Eliminated dual callback/promise support**: All Role methods now exclusively return native promises
  - **Methods affected**:
    - `Role.isInRole()`, `Role.getRoles()`, `Role.isOwner()`, `Role.isMappedToRole()`
    - `Role.registerResolver()` and all role relation accessors
  - **Migration pattern**:
    ```javascript
    // Before (dual API)
    Role.isInRole('admin', context, function(err, isInRole) {
      if (err) return handleError(err)
      // Handle result
    })

    // After (promise-only)
    try {
      const isInRole = await Role.isInRole('admin', context)
      // Handle result
    } catch (err) {
      handleError(err)
    }
    ```
  - **Files modified**: `common/models/role.js` (543 lines changed), `test/role.test.js` (1,513 lines changed)
- **Impact**: Completed Phase 4 of modernization - eliminated callback fallbacks for cleaner, more maintainable code

#### Core Model Modernization - User, ACL, and Persisted Models
- **Commits**: Multiple commits between February 27-28, 2025
  - [`f372dcd`](https://github.com/perkd/loopback/commit/f372dcdee9e8c4b0ec4c9da584cfc125184df082) - User model (February 28)
  - [`d4fd85b`](https://github.com/perkd/loopback/commit/d4fd85bd26a9808581c6566e973eed0e266085ca) - ACL model (February 28)
  - [`6c17fd0`](https://github.com/perkd/loopback/commit/6c17fd0167a5bc17dadc314a10e374e0fdc66179) - Persisted model (February 27)
- **Changes**: Comprehensive promise migration across core models
  - **User model**: 81 lines modified in `common/models/user.js`, 2,053 lines in tests
    - Methods: `verify()`, `resetPassword()`, `confirm()`, `changePassword()`
    - Removed `utils.createPromiseCallback` usage
    - Added promise return guards and normalized parameter handling
  - **ACL model**: 263 lines modified in `common/models/acl.js`, 99 lines in tests
    - Methods: `checkPermission()`, `checkAccessForContext()`, `resolvePrincipal()`
    - Converted nested promise chains to async/await
    - Removed 14 instances of `.promise` returns
  - **Persisted model**: 112 lines added/modified in `lib/persisted-model.js`
    - Enhanced replication functionality with promise-based error handling
    - Improved conflict resolution and bulk update operations
- **Impact**: Core framework models now use modern promise patterns exclusively

### February 21, 2025

#### Promise Migration - Application and Access Control
- **Commit**: [`8c3916a`](https://github.com/perkd/loopback/commit/8c3916a)
- **Date**: February 21, 2025
- **Changes**: Updated Application model methods to promise-based patterns
  - **Methods modernized**: `checkAccess()` and `getApp()` converted to promise-only
  - **Eliminated callback fallbacks**: Consistent with overall modernization strategy
- **Impact**: Application security and access control now uses modern async patterns

### February 19, 2025

#### **MAJOR MODERNIZATION**: Complete Bluebird to Native Promise Migration
- **Commits**: Series of 7 commits ([`df5fabb`](https://github.com/perkd/loopback/commit/df5fabbcbe638f7591854b018935cbb7d662cf58) through [`0e5ecae`](https://github.com/perkd/loopback/commit/0e5ecae))
- **Date**: February 19, 2025
- **Changes**: **BREAKING CHANGE** - Complete removal of Bluebird promise library

  #### Phase 1: Preparation and Planning
  - **Commit**: [`df5fabb`](https://github.com/perkd/loopback/commit/df5fabbcbe638f7591854b018935cbb7d662cf58) - Created comprehensive enhancement plan
  - **Analysis**: Identified 200+ instances of Bluebird-dependent `createPromiseCallback` utility
  - **Critical features identified**:
    - `Promise.spread()` usage in test files
    - Custom promise constructor overrides in `lib/utils.js`
    - Promise cancellation patterns

  #### Phase 2: Core Infrastructure Migration
  - **Commits**: [`727c36b`](https://github.com/perkd/loopback/commit/727c36b44986e6a1302a049fabecfe793a230d7d) through [`0e5ecae`](https://github.com/perkd/loopback/commit/0e5ecae)
  - **Removed Bluebird dependency**: Uninstalled package and removed from 12 files
  - **Updated core utilities**: Replaced Bluebird's `Promise.pending()` with native constructor in `lib/utils.js`
  - **Test modernization**: Updated 58 test files to handle native promise rejection patterns
  - **Files affected**:
    - `lib/utils.js` - Core promise utility updates
    - `test/helpers/wait-for-event.js` - Promise helper modernization
    - Multiple test files: `user.integration.js`, `role.test.js`, `acl.test.js`, etc.

  #### Key Migration Patterns:
  ```javascript
  // Before: Bluebird promise
  User.prototype.verify = function(options, cb) {
    cb = cb || utils.createPromiseCallback()
    // ... logic ...
    return cb.promise
  }

  // After: Native implementation
  User.prototype.verify = function(options, cb) {
    if (!cb) {
      return new Promise((resolve, reject) => {
        this.verify(options, (err, result) => err ? reject(err) : resolve(result))
      })
    }
    // ... same logic ...
  }
  ```

  #### Promise Chain Modernization:
  ```javascript
  // Before: Bluebird .spread()
  Promise.all([getUser(), getRole()])
    .spread((user, role) => {
      // Handle results
    })

  // After: Native destructuring
  const [user, role] = await Promise.all([getUser(), getRole()])
  // Handle results
  ```

- **Impact**:
  - **Performance**: Eliminated external promise library overhead
  - **Maintainability**: Reduced dependency complexity and improved code clarity
  - **Compatibility**: Full compatibility with modern JavaScript environments
  - **Bundle size**: Reduced package footprint by removing Bluebird dependency

## Summary of Major Changes

### Key Modernization Achievements:
1. **Promise Modernization**: Complete migration from Bluebird to native JavaScript promises
   - Eliminated 200+ instances of `createPromiseCallback` utility
   - Converted all model methods to promise-only APIs (breaking change)
   - Modernized error handling patterns across the codebase

2. **JavaScript Modernization**:
   - Replaced callback-based patterns with async/await
   - Eliminated `async` library dependency in favor of native constructs
   - Updated promise chain patterns from `.spread()` to array destructuring

3. **API Modernization**:
   - **Breaking Change**: Removed dual callback/promise support
   - All asynchronous methods now exclusively return native promises
   - Consistent error handling with promise rejections

4. **Testing Infrastructure Modernization**:
   - Migrated from complex Karma/Grunt setup to streamlined Mocha + C8 coverage
   - Removed browser-based testing in favor of Node.js-only testing
   - Updated 58+ test files to handle native promise patterns

5. **Architecture Improvements**:
   - Simplified build process and dependency management
   - Enhanced replication and conflict resolution systems
   - Improved error propagation and handling patterns

### Breaking Changes:
- **Promise API**: All methods now return native promises exclusively (no callback support)
- **Testing**: Removed browser-based Karma testing in favor of Node.js-only testing
- **Dependencies**: Removed `async` and `bluebird` from dependencies
- **Coverage**: Switched from NYC to C8 for coverage reporting
- **Error Handling**: Changed from Bluebird-specific to native promise error patterns

### Development Experience Improvements:
- **Modern JavaScript**: Full ES6+ async/await patterns throughout codebase
- **Simplified Dependencies**: Reduced external library dependencies
- **Better Error Handling**: Consistent native promise rejection patterns
- **Improved Performance**: Eliminated promise library overhead
- **Enhanced Maintainability**: Cleaner, more readable asynchronous code

### Migration Guide:
For applications upgrading to these versions, see:
- [`docs/migrating-from-callbacks-to-promises.md`](migrating-from-callbacks-to-promises.md) - Comprehensive migration guide
- [`docs/promise-migration.md`](promise-migration.md) - Technical analysis and action plan
- [`docs/phase-4-migration.md`](phase-4-migration.md) - Detailed implementation analysis

---

*This changelog documents the complete modernization journey from legacy callback-based patterns to modern JavaScript practices. All changes maintain backward compatibility where possible, with clear documentation for breaking changes.*
