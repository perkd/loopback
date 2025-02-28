# Advanced Troubleshooting Techniques for Distributed Systems

## Race Condition Analysis

**Prompt:** "Simulate race conditions explicitly in test environments"

- Create controlled, reproducible race conditions with test hooks
- Design specific timing sequences that mimic production race scenarios
- Implement "third-party intervention" patterns during critical operations
- Verify system state before, during, and after the race condition

```javascript
// Template: Race condition simulation
await setupInitialState()
await beginOperation() // Start but don't complete operation
await simulateRaceCondition() // Make competing change
await completeOperation() // Complete original operation
await verifyFinalState() // Check system integrity
```

## Staged Issue Isolation

**Prompt:** "Solve complex failures by addressing component issues in ascending complexity"

- Identify the simplest failing scenario first
- Fix basic cases before addressing complex interactions
- Apply insights from simple cases to inform complex ones
- Build a progression: single operations → concurrent operations → distributed operations

## Strategic Debug Points

**Prompt:** "Place debug statements at decision boundaries and state transitions"

- Focus on state changes rather than function calls
- Log complete object state before and after transformations
- Instrument decision points where logic branches
- Capture parameters at interface boundaries between components

```javascript
// Template: Decision boundary instrumentation
debug('[START:%s] Operation beginning with state: %j', operationName, initialState)
// ... operation code ...
if (condition) {
  debug('[DECISION:%s] Taking branch A because: %s', operationName, reason)
  // Branch A code
} else {
  debug('[DECISION:%s] Taking branch B because: %s', operationName, reason)
  // Branch B code
}
debug('[END:%s] Operation completed with state: %j', operationName, finalState)
```

## Bidirectional Tracing

**Prompt:** "Trace both from cause to effect and from effect to cause simultaneously"

- Forward trace: Follow execution path from initiating action
- Backward trace: Work backward from failure point
- Meet in the middle: Identify where expected and actual paths diverge
- Document the complete causal chain once identified

## State Transition Snapshots

**Prompt:** "Capture complete state snapshots at all asynchronous boundaries"

- Take snapshots before and after async operations
- Compare state differences to identify unexpected changes
- Focus on boundary transitions between components
- Look for state corruption during handoffs

```javascript
// Template: State transition tracking
const beforeState = cloneDeep(object)
await asyncOperation()
const afterState = cloneDeep(object)
const differences = diffObjects(beforeState, afterState)
debug('State changes during operation: %j', differences)
```

## Contract-Based Testing

**Prompt:** "Use tests to verify interface contracts, not just functionality"

- Define expected behaviors at each interface
- Test contract compliance under various conditions
- Ensure consistent behavior across implementation changes
- Focus on preserving API semantics even when internals change

## Scenario-Based Testing

**Prompt:** "Model tests after real-world usage scenarios rather than functions"

- Design tests around user workflows and interactions
- Include typical error conditions and recovery paths
- Test concurrent access patterns that mirror production usage
- Validate entire scenarios rather than isolated functions

```javascript
// Template: Scenario-based test
it('handles concurrent edits by multiple users', async function() {
  // Setup user context and initial data
  // User 1 begins edit
  // User 2 makes conflicting edit
  // User 1 completes edit
  // Verify system correctly identifies and resolves conflict
})
```

## Incremental Behavior Migration

**Prompt:** "When updating complex systems, reconcile behaviors one aspect at a time"

- Identify specific behavior domains within the system
- Change one behavioral aspect at a time
- Verify each change before moving to the next
- Maintain compatibility with existing components during transition

## Custom Debugging Utilities

**Prompt:** "Build problem-domain-specific debugging tools"

- Create formatters that highlight relevant properties
- Develop custom diffing tools for domain objects
- Implement context-aware loggers for your system
- Build visualization tools for complex state transitions

```javascript
// Template: Domain-specific debug formatter
function formatReplicationChange(change) {
  return {
    type: change.type,
    id: change.modelId,
    rev: change.rev.slice(0, 8) + '...',
    conflicts: change.conflicts ? change.conflicts.length : 0
  }
}
```

## Behavior Documentation

**Prompt:** "Document why code behaves as it does, not just what it does"

- Explain rationale behind implementation choices
- Document behavior constraints and requirements
- Note backward compatibility considerations
- Highlight edge cases and their handling

```javascript
// Template: Behavior-focused documentation
/**
 * Updates the target model with source data during conflict resolution.
 * 
 * IMPORTANT: We preserve the target ID even when using source data
 * to maintain referential integrity with existing relationships.
 * This ensures that other objects pointing to this record continue
 * to work after conflict resolution.
 */
```

## Context Preservation

**Prompt:** "Ensure context and options propagate through all layers of the system"

- Track options objects through the entire call chain
- Preserve context in async operations
- Pass complete context to error handlers
- Maintain operation identity across component boundaries

## Timeout and Retry Strategy

**Prompt:** "Implement consistent timeout handling and retry policies"

- Define explicit timeouts for all async operations
- Implement exponential backoff for retries
- Distinguish between retriable and non-retriable errors
- Track cumulative operation time for nested operations

```javascript
// Template: Retry with exponential backoff
async function operationWithRetry(params) {
  const maxRetries = 3
  let delay = 100 // ms
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await performOperation(params)
    } catch (err) {
      if (!isRetriableError(err) || attempt === maxRetries) throw err
      debug('Retry attempt %d after %dms delay', attempt, delay)
      await sleep(delay)
      delay *= 2 // Exponential backoff
    }
  }
}
```

## Conflict Resolution Patterns

**Prompt:** "Implement systematic conflict resolution strategies"

- Define clear precedence rules (e.g., source wins, target wins, last-write-wins)
- Handle all conflict types: create-create, update-update, update-delete
- Preserve critical data during resolution
- Provide audit trail for resolution decisions
- Consider eventual consistency implications 

# Loopback Replication Troubleshooting Guide

## Instance-Level Permissions and Replication

When using instance-level permissions with replication over REST, you may encounter authorization errors (`Authorization Required` - 401). These issues typically occur when:

1. The replication process doesn't have the proper access context for instance-level permissions
2. The user doesn't have the correct permissions for the instances being replicated
3. The access control context is not properly passed through the replication process

### Common Issues and Solutions

#### 1. Authorization Required (401) errors during replication

**Problem**: When trying to replicate models with instance-level permissions, you get `Authorization Required` errors.

**Solution**:

1. Ensure the user has the correct permissions for the instances being replicated:
   - For pulling data: The user needs READ or REPLICATE access to the source instances
   - For pushing data: The user needs WRITE or REPLICATE access to the target instances

2. Add a context parameter to your changes method calls:

```javascript
// When calling changes method, include a context
const ctx = {
  Model: model,
  accessType: 'READ',
  modelName: model.modelName,
  method: 'changes',
  remotingContext: {
    accessType: 'REPLICATE',
  },
}

// Then pass the context to the changes method
const changes = await model.changes(since, filter, ctx)
```

3. Update your ACL configuration to include REPLICATE access type:

```javascript
{
  "accessType": "REPLICATE",
  "principalType": "ROLE",
  "principalId": "$authenticated",
  "permission": "ALLOW"
}
```

#### 2. Conflicts not being detected or resolved properly

**Problem**: During replication, conflicts are not being detected or resolved correctly.

**Solution**:

1. Ensure the Conflict class properly handles conflict data:

```javascript
// In your Conflict class constructor
constructor(id, SourceModel, TargetModel, conflictData) {
  this.modelId = id
  this.SourceModel = SourceModel
  this.TargetModel = TargetModel
  this.conflictData = conflictData || {}
  
  // Store source and target changes
  if (conflictData) {
    this._sourceChange = conflictData.sourceChange
    this._targetChange = conflictData.targetChange
  }
}

// When swapping parties, make sure to swap the changes too
swapParties() {
  const Ctor = this.constructor
  const swapped = new Ctor(this.modelId, this.TargetModel, this.SourceModel, this.conflictData)
  
  // Swap the source and target changes
  if (this._sourceChange || this._targetChange) {
    swapped._sourceChange = this._targetChange
    swapped._targetChange = this._sourceChange
  }
  
  return swapped
}
```

2. Make sure your diff method properly detects conflicts:

```javascript
// In your diff method, ensure conflicts are properly detected
if (sourceChange && targetChange && sourceChange.conflictsWith(targetChange)) {
  conflicts.push({
    modelId: sourceChange.modelId,
    sourceChange: sourceChange,
    targetChange: targetChange,
    type: sourceChange.type()
  })
}
```

#### 3. Replication with custom models

**Problem**: When using custom models with replication, you encounter errors or unexpected behavior.

**Solution**:

1. Ensure your custom models extend PersistedModel and have change tracking enabled:

```javascript
const MyModel = app.registry.createModel('MyModel', {
  // properties
}, {
  base: 'PersistedModel',
  trackChanges: true
})
```

2. Make sure your models are properly attached to a datasource:

```javascript
app.model(MyModel, { dataSource: 'db' })
```

3. Enable change tracking explicitly:

```javascript
MyModel.enableChangeTracking()
```

### Best Practices for Replication with Instance-Level Permissions

1. **Use the REPLICATE access type**: Define ACLs with the REPLICATE access type for models that will be replicated.

2. **Pass context in replication methods**: Always pass a proper context object when calling methods like `changes()`, `diff()`, and `bulkUpdate()`.

3. **Test with different permission scenarios**: Test your replication with different user roles and permission combinations.

4. **Handle errors gracefully**: Implement proper error handling for authorization errors during replication.

5. **Use debug logging**: Enable debug logging to troubleshoot replication issues:

```javascript
DEBUG=loopback:change,loopback:persisted-model node your-app.js
```

By following these guidelines, you should be able to successfully set up replication with proper instance-level permissions.

# Troubleshooting Guide

## Common Issues When Migrating from Callbacks to Promises/Async

### TypeError: callback is not a function

**Symptom:** You encounter an error like `TypeError: callback is not a function` when calling a Role method.

**Cause:** You're still passing a callback to a method that now returns a Promise.

**Solution:** Update your code to use the Promise API or async/await:

```javascript
// Instead of this:
Role.isInRole('admin', context, function(err, result) {
  // ...
})

// Do this:
const result = await Role.isInRole('admin', context)
// or
Role.isInRole('admin', context).then(result => {
  // ...
})
```

### UnhandledPromiseRejectionWarning

**Symptom:** You see warnings about unhandled Promise rejections.

**Cause:** You're not catching errors when using Promises.

**Solution:** Always add error handling with try/catch or .catch():

```javascript
// With async/await:
try {
  const result = await Role.isInRole('admin', context)
  // Process result
} catch (error) {
  // Handle error
}

// With Promises:
Role.isInRole('admin', context)
  .then(result => {
    // Process result
  })
  .catch(error => {
    // Handle error
  })
```

### Unexpected Behavior with Role Resolvers

**Symptom:** Custom role resolvers aren't working as expected after migration.

**Cause:** Role resolvers must now return Promises instead of calling callbacks.

**Solution:** Update your role resolvers to return Promises:

```javascript
// Old resolver:
Role.registerResolver('myRole', function(role, context, callback) {
  // Logic...
  callback(null, result)
})

// New resolver:
Role.registerResolver('myRole', function(role, context) {
  // Logic...
  return Promise.resolve(result)
})

// Or better with async:
Role.registerResolver('myRole', async function(role, context) {
  // Logic...
  return result
})
```

### Tests Failing or Timing Out

**Symptom:** Your tests fail or time out after migrating.

**Cause:** Tests using callbacks aren't properly updated for Promises.

**Solution:** Update your tests to use async/await or Promise chains:

```javascript
// Old test:
it('should test something', function(done) {
  Role.someMethod(args, function(err, result) {
    if (err) return done(err)
    assert(result)
    done()
  })
})

// New test with async/await:
it('should test something', async function() {
  const result = await Role.someMethod(args)
  assert(result)
})

// New test with Promises:
it('should test something', function() {
  return Role.someMethod(args)
    .then(result => {
      assert(result)
    })
})
```

### Mixed Promises and Callbacks in the Same Chain

**Symptom:** Functions returning undefined or incorrect values.

**Cause:** Mixing Promise and callback patterns.

**Solution:** Ensure all functions in your chain use the same pattern. Convert all callback-based functions to return Promises:

```javascript
// Convert a callback-based function to return a Promise
function legacyFunction(callback) {
  // ...
}

// Wrapper that returns a Promise
function promisifiedLegacyFunction() {
  return new Promise((resolve, reject) => {
    legacyFunction((err, result) => {
      if (err) return reject(err)
      resolve(result)
    })
  })
}

// Now use it in your Promise chain
async function newFunction() {
  const result = await promisifiedLegacyFunction()
  return result
}
```

### Getting Incorrect Results from Role Methods

**Symptom:** Role methods return unexpected results after migration.

**Cause:** The behavior of Promise-returning functions can be subtly different.

**Solution:** Ensure you're correctly checking and using the returned values:

```javascript
// Old callback style - the callback receives (err, result)
Role.isInRole('admin', context, function(err, isInRole) {
  if (isInRole) { /* ... */ }
})

// New Promise style - you get the result directly
const isInRole = await Role.isInRole('admin', context)
if (isInRole) { /* ... */ }
```

## Still Having Issues?

If you continue to experience problems after following this guide, please:

1. Check the full API documentation for the specific method you're using
2. Look for examples in the test files (test/role.test.js)
3. Open an issue in the repository with a detailed description and code example

## Additional Resources

- [Migrating from Callbacks to Promises Guide](migrating-from-callbacks-to-promises.md)
- [JavaScript Promises: an Introduction](https://developers.google.com/web/fundamentals/primers/promises)
- [Async/Await in JavaScript](https://developer.mozilla.org/en-US/docs/Learn/JavaScript/Asynchronous/Async_await)

# Fixing ACL Test Issues

## Problem: Models Not Properly Attached to DataSource in Tests

When running ACL tests, you might encounter errors like:

```
Error: Cannot call acl.find(). The find method has not been setup. The PersistedModel has not been correctly attached to a DataSource!
```

This typically happens in test files where models need to be properly attached to a datasource for testing.

### Root Cause

The issue occurs because:

1. Models are not properly attached to a datasource in the test setup
2. The `Scope` model needs to find the `ACL` model through its registry
3. Relationships between models (like Role and RoleMapping) are not properly set up

### Solution

Here's how to fix the issue in your test setup function:

```javascript
function setupTestModels() {
  // Create a fresh datasource for each test to avoid shared state
  ds = this.ds = loopback.createDataSource({connector: loopback.Memory})

  // Create the test model
  testModel = this.testModel = loopback.PersistedModel.extend('testModel')
  
  // Attach all models to the datasource
  testModel.attachTo(ds)
  
  // Use the global models but attach them to our test datasource
  this.ACL = loopback.ACL
  this.Scope = loopback.Scope
  this.Role = loopback.Role
  this.RoleMapping = loopback.RoleMapping
  this.User = loopback.User
  
  // Attach all built-in models to our test datasource
  this.ACL.attachTo(ds)
  this.Scope.attachTo(ds)
  this.Role.attachTo(ds)
  this.RoleMapping.attachTo(ds)
  this.User.attachTo(ds)
  
  // Set up relationships
  this.Role.hasMany(this.RoleMapping, {as: 'principals', foreignKey: 'roleId'})
  this.RoleMapping.belongsTo(this.Role, {as: 'role', foreignKey: 'roleId'})
  
  // Ensure Scope can find ACL through the registry
  this.Scope.aclModel = this.ACL
  
  // Explicitly create the tables
  return ds.automigrate()
}
```

### Key Points

1. **Fresh DataSource**: Create a new datasource for each test to avoid shared state
2. **Global Models**: Use the global models instead of creating local instances to ensure all methods are available
3. **Proper Attachment**: Attach all models to the datasource explicitly
4. **Relationships**: Set up relationships between models after they are attached to the datasource
5. **Registry Setup**: Ensure the Scope model can find the ACL model by setting `this.Scope.aclModel = this.ACL`
6. **Table Creation**: Call `ds.automigrate()` to create the necessary tables

By following these steps, you can ensure that your ACL tests run correctly with models properly attached to the datasource. 