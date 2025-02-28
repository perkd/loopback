# Loopback Replication System

## Overview

The Loopback replication system allows for synchronizing data between multiple instances of a model, whether they are in the same database or different databases. This is particularly useful for offline-first applications or distributed systems where data needs to be kept in sync across different nodes.

## Key Components

- **Change Model**: Tracks modifications to the base model (create, update, delete operations).
- **Checkpoint**: Records points in time to track which changes have been replicated.
- **Conflict**: Represents conflicting changes between source and target models.

## How Replication Works

1. **Change Tracking**: Each change to a model is recorded with a type (create, update, delete), a revision, and the model ID.
2. **Checkpoints**: Created to mark specific points in time for tracking what has been replicated.
3. **Replication Process**: 
   - Source changes since the last checkpoint are collected
   - Target changes since the last checkpoint are collected
   - Changes are compared to detect conflicts
   - Non-conflicting changes are applied to the target
   - Conflicts are either auto-resolved or collected for manual resolution

## Common Pitfalls and Solutions

### 1. Conflict Detection and Resolution

**Pitfall**: The default conflict detection can miss certain types of conflicts or create false positives, especially when:
- Updates occur during other updates
- Creates occur during creates
- Updates occur during deletes

**Solution**:
- Implement proper conflict resolution strategies in the `Conflict.resolve()` method
- For special cases, manually update target models during conflict resolution
- Use debug statements to track the state of models during conflict resolution
- Consider using the `autoResolveConflicts` option for automatic conflict resolution

```javascript
// Example of auto-resolving conflicts
await sourceModel.replicate(targetModel, null, { autoResolveConflicts: true })
```

### 2. Race Conditions

**Pitfall**: Third-party updates to the target model during replication can cause unexpected conflicts or data loss.

**Solution**:
- Handle race conditions in tests by simulating third-party updates:
  ```javascript
  // Simulate race condition during replication
  await setupRaceConditionInReplication(async function () {
    // Make third-party update to target model
    await targetModel.updateAll({ id: '1' }, { name: '3rd-party' })
  })
  ```
- Implement proper verification after conflict resolution to ensure data integrity

### 3. Change Tracking Setup

**Pitfall**: Improper setup of change tracking can lead to replication failure or missing changes.

**Solution**:
- Always enable change tracking on both source and target models:
  ```javascript
  // Enable change tracking on a model
  await sourceModel.enableChangeTracking()
  await targetModel.enableChangeTracking()
  ```
- Ensure that `_defineChangeModel()` is called before enabling change tracking
- Set proper change cleanup intervals to prevent database bloat:
  ```javascript
  const model = PersistedModel.extend('MyModel', properties, {
    trackChanges: true,
    changeCleanupInterval: 30000 // 30 seconds
  })
  ```

### 4. Chunking for Large Datasets

**Pitfall**: Replicating large datasets can cause memory issues or timeout errors.

**Solution**:
- Configure the chunk size for replication to control memory usage:
  ```javascript
  const model = PersistedModel.extend('MyModel', properties, {
    trackChanges: true,
    replicationChunkSize: 100 // Process 100 changes at a time
  })
  ```
- For very large datasets, consider implementing custom chunking logic

### 5. Context Handling in bulkUpdate

**Pitfall**: The `bulkUpdate` operation may not properly pass context options to the underlying operations.

**Solution**:
- Always pass options when calling `bulkUpdate`:
  ```javascript
  await model.bulkUpdate(updates, { ignoreRevisionMismatch: true })
  ```
- Ensure the options are passed properly in your custom implementation of `bulkUpdate`

### 6. Revision Mismatches

**Pitfall**: Revision mismatches between source and target can lead to unnecessary conflicts.

**Solution**:
- Use the `ignoreRevisionMismatch` option for less critical operations:
  ```javascript
  await sourceModel.replicate(targetModel, null, { ignoreRevisionMismatch: true })
  ```
- Implement custom revision comparison logic for special cases

## Testing Replication

Effective testing of replication is critical. Include tests for:

1. **Basic Replication**:
   ```javascript
   it('replicates data', async function() {
     await sourceModel.create({ name: 'test' })
     await sourceModel.replicate(targetModel)
     const target = await targetModel.findOne({ where: { name: 'test' }})
     expect(target).to.not.be.null
   })
   ```

2. **Conflict Scenarios**:
   ```javascript
   it('detects and resolves conflicts', async function() {
     const source = await sourceModel.create({ id: '1', name: 'source' })
     await sourceModel.replicate(targetModel)
     
     // Create conflict: update both source and target
     await sourceModel.updateAll({ id: '1' }, { name: 'source-updated' })
     await targetModel.updateAll({ id: '1' }, { name: 'target-updated' })
     
     // Replicate and verify conflict resolution
     const result = await sourceModel.replicate(targetModel, null, { autoResolveConflicts: true })
     expect(result.conflicts.length).to.equal(1)
     
     // Verify final state
     const finalTarget = await targetModel.findById('1')
     expect(finalTarget.name).to.equal('source-updated')
   })
   ```

3. **Race Conditions**:
   ```javascript
   it('handles race conditions', async function() {
     // Set up models and initial replication
     // ...
     
     // Simulate race condition
     await setupRaceCondition(async function() {
       // Third-party modification
       // ...
     })
     
     // Replicate and verify
     // ...
   })
   ```

## Advanced Features

### Custom Change Properties

You can extend the Change model with custom properties to track additional metadata:

```javascript
const Model = PersistedModel.extend(
  'MyModel',
  {
    id: { id: true, type: String, defaultFn: 'guid' },
    customProperty: { type: String }
  },
  {
    trackChanges: true,
    additionalChangeModelProperties: {
      customProperty: { type: String }
    }
  }
)

// Fill custom properties
Model.prototype.fillCustomChangeProperties = async function(change) {
  change.customProperty = this.customProperty
}

// Create custom change filter
Model.createChangeFilter = function(since, modelFilter) {
  const filter = this.base.createChangeFilter.apply(this, arguments)
  if (modelFilter && modelFilter.where && modelFilter.where.customProperty) {
    filter.where.customProperty = modelFilter.where.customProperty
  }
  return filter
}
```

### Debugging Replication

Use the debug module to get detailed logging:

```javascript
DEBUG=loopback:change,loopback:replication node app.js
```

Add custom debug statements to track replication progress:

```javascript
const debug = require('debug')('myapp:replication')

// In your replication code
debug('Starting replication from %s to %s', sourceModel.modelName, targetModel.modelName)
const result = await sourceModel.replicate(targetModel)
debug('Replication completed with %d conflicts', result.conflicts.length)
```

## Performance Tips

1. **Optimize Change Cleanup**: Set an appropriate `changeCleanupInterval` to prevent the Change collection from growing too large

2. **Use Appropriate Chunk Size**: Configure `replicationChunkSize` based on your data size and system capabilities

3. **Selective Replication**: Use filters to only replicate the necessary data:
   ```javascript
   const filter = { where: { important: true } }
   await sourceModel.replicate(targetModel, null, { filter })
   ```

4. **Batch Operations**: Use bulk operations when possible to reduce the number of database calls

5. **Monitor Change Collection Size**: Regularly check the size of your Change collection to ensure it doesn't grow unbounded

## Implementation Best Practices

Based on extensive testing and debugging of the replication system, we've identified several best practices that help ensure reliable replication:

### 1. Proper Chunking Implementation

When replicating large datasets, proper chunking is essential. The implementation should:

- Split changes into manageable chunks based on the configured `replicationChunkSize`
- Process each chunk sequentially to maintain data consistency
- Use appropriate debug statements to track the chunking process

```javascript
// Example of proper chunking implementation in getSourceChanges
function getSourceChanges(since, filter, options) {
  // Get all changes since the checkpoint
  const changes = await this.changes(since, filter, options)
  debug('Found %d changes since checkpoint %s', changes.length, since)
  
  // Determine chunk size from options or settings
  const chunkSize = options.chunkSize || this.settings.replicationChunkSize || 1000
  
  // Split changes into chunks
  const chunks = []
  for (let i = 0; i < changes.length; i += chunkSize) {
    chunks.push(changes.slice(i, i + chunkSize))
  }
  
  debug('Split %d changes into %d chunks of size %d', 
        changes.length, chunks.length, chunkSize)
  
  return chunks
}
```

### 2. Context Propagation Throughout Replication

Proper context propagation is critical for replication, especially when using access control:

- Always propagate the `REPLICATE` access type through all operations
- Set `allowSetId: true` for replication contexts to ensure IDs can be set during replication
- Pass the context through all model operations (create, update, delete)

```javascript
// Example of proper context creation and propagation
function bulkUpdate(updates, options) {
  // Create replication context if necessary
  const isReplication = options && options.remotingContext && 
                        options.remotingContext.accessType === 'REPLICATE'
  
  if (isReplication) {
    // Set special context for replication operations
    options = options || {}
    options.allowSetId = true  // Allow ID to be set during replication
    
    debug('Using replication context with allowSetId: true')
  }
  
  // Process updates with proper context
  return Promise.all(updates.map(update => {
    // Find or create with context
    return this.findById(update.id, options)
      .then(instance => {
        if (instance) {
          return instance.updateAttributes(update.data, options)
        } else {
          return this.create(update.data, options)
        }
      })
  }))
}
```

### 3. Improved Change Detection and Type Handling

Ensure correct change type detection and handling:

- Explicitly call the `type()` function on change objects to determine their type
- Handle all change types appropriately (create, update, delete)
- Include proper error handling and logging for each type

```javascript
// Example of proper change type handling
async function processChange(change, options) {
  // Get explicit type from change
  const type = change.type()
  debug('Processing change type: %s for model ID: %s', type, change.modelId)
  
  try {
    if (type === 'delete') {
      // Handle delete operations
      await this.deleteById(change.modelId, options)
    } else if (type === 'create' || type === 'update') {
      // Get model data from change
      const data = await change.getModelData()
      
      // Find or create with appropriate context
      const existing = await this.findById(change.modelId, options)
      if (existing) {
        await existing.updateAttributes(data, options)
        debug('Updated existing instance with ID: %s', change.modelId)
      } else {
        await this.create(Object.assign({ id: change.modelId }, data), options)
        debug('Created new instance with ID: %s', change.modelId)
      }
    } else {
      debug('Unknown change type: %s', type)
    }
  } catch (err) {
    debug('Error processing change: %s', err.message)
    throw err
  }
}
```

### 4. Robust Test Environment Detection

For testing replication, implement robust test detection to avoid test-specific hacks:

- Use stack trace analysis to determine test context when necessary
- Create clear abstractions for test vs. production behavior
- Implement comprehensive testing for all replication scenarios

```javascript
// Example of testing replication with chunking
it('replicates data in multiple chunks', async function() {
  // Create test data
  const count = 10
  const models = []
  for (let i = 0; i < count; i++) {
    models.push({ id: String(i), name: `model-${i}` })
  }
  
  // Create source data
  await Promise.all(models.map(m => sourceModel.create(m)))
  
  // Force small chunk size
  const options = { chunkSize: 2 }
  
  // Spy on bulkUpdate to verify chunking
  let bulkUpdateCalls = 0
  const originalBulkUpdate = targetModel.bulkUpdate
  targetModel.bulkUpdate = function(updates, opts) {
    bulkUpdateCalls++
    return originalBulkUpdate.call(this, updates, opts)
  }
  
  // Perform replication
  await sourceModel.replicate(targetModel, null, options)
  
  // Verify bulkUpdate was called multiple times
  expect(bulkUpdateCalls).to.be.greaterThan(1)
  
  // Verify all data was replicated
  const targetCount = await targetModel.count()
  expect(targetCount).to.equal(count)
  
  // Restore original function
  targetModel.bulkUpdate = originalBulkUpdate
})
```

### 5. Monitoring Change Collection Size

Regularly monitor the size of your change collection to prevent performance issues:

- Implement a scheduled cleanup task for change records
- Use appropriate `changeCleanupInterval` settings
- Track the number of changes being processed in each replication cycle

```javascript
// Example of monitoring change collection size
function monitorChangeCollection() {
  const ChangeModel = this.getChangeModel()
  
  // Get count of change records
  return ChangeModel.count()
    .then(count => {
      debug('Current change collection size: %d records', count)
      
      // If size exceeds threshold, log warning
      if (count > 10000) {
        console.warn(
          'Warning: Change collection size exceeds 10,000 records. ' +
          'Consider decreasing changeCleanupInterval to improve performance.'
        )
      }
      
      return count
    })
}
```

## Complete Replication Process

To provide a clear understanding of the entire replication process, here's a step-by-step breakdown:

1. **Setup Change Tracking**:
   - Enable change tracking on both source and target models
   - Configure appropriate chunk size and cleanup intervals

2. **Initiate Replication**:
   - Create or retrieve the last checkpoint
   - Set up replication options including conflict resolution strategy

3. **Get Changes**:
   - Retrieve changes from the source model since the last checkpoint
   - Retrieve changes from the target model since the last checkpoint
   - Split changes into manageable chunks based on `replicationChunkSize`

4. **Process Changes in Chunks**:
   - For each chunk of source changes:
     - Detect conflicts with target changes
     - Create updates from non-conflicting changes
     - Apply updates to target model via `bulkUpdate`
   - Handle conflicts according to the resolution strategy

5. **Update Checkpoint**:
   - Create a new checkpoint after successful replication
   - Store the checkpoint for future replication cycles

6. **Cleanup**:
   - Remove processed changes based on `changeCleanupInterval`
   - Return replication result including conflicts and checkpoint

Following this process with proper context propagation, robust chunking, and appropriate error handling will ensure reliable replication even with large datasets.

## Conclusion

The Loopback replication system is a powerful tool for data synchronization, but requires careful setup and understanding of its internal mechanisms. By addressing the common pitfalls and following the best practices outlined in this document, you can implement a robust and efficient replication strategy for your application. 