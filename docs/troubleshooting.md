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