# Promise Migration Analysis and Action Plan

## Overview
This document outlines issues discovered during migration from callback-based to Promise-based implementation, focusing on replication functionality. It provides a prioritized list of issues and an action plan to address them.

## Critical Issues

### 1. Error Handling in Utils (Critical)
**Location**: `lib/utils.js` (Lines 40-65)

**Problem**:
- Variable reference error: `throw err` instead of `throw error`
- Missing initialization of `aggregatedConflicts`
- Incorrect conflict aggregation logic

**Impact**:
- Unhandled exceptions in production
- Lost conflict tracking during replication
- Incomplete bulk operations

**Fix Required**:
```javascript
// Before processing chunks
let aggregatedConflicts = []

// In catch block
catch (error) {
  if (error.statusCode === 409) {
    const conflicts = (error.details && error.details.conflicts) || error.conflicts
    if (conflicts) {
      aggregatedConflicts = aggregatedConflicts.concat(conflicts)
      continue
    }
  }
  throw error // Fix variable reference
}
```

### 2. Bulk Update Error Handling (Critical)
**Location**: `lib/persisted-model.js` (Lines 1344-1367)

**Problem**:
- `Promise.all()` fails fast on first error
- Subsequent chunks not processed after conflict
- Lost error context from original implementation

**Impact**: 
- Partial updates during replication
- Missing conflict information
- Inconsistent state between source/target

**Fix Required**:
```javascript
async function bulkUpdate(targetModel, updates, options) {
  const conflicts = []
  
  for (const update of updates) {
    try {
      await targetModel.bulkUpdate([update], options)
    } catch (error) {
      if (error.statusCode === 409) {
        conflicts.push(...(error.details?.conflicts || []))
        continue
      }
      throw error
    }
  }

  if (conflicts.length) {
    const error = new Error('Conflict')
    error.statusCode = 409
    error.details = { conflicts }
    throw error
  }
}
```

## High Priority Issues

### 3. Change Model Rectification
**Location**: `common/models/change.js` (Lines 82-123)

**Problem**:
- `Promise.all()` fails fast vs original `async.parallel()`
- Error aggregation only works with `ignoreErrors=true`
- Potential unhandled rejections

**Impact**:
- Incomplete error reporting
- Changed behavior from original implementation
- Potential process crashes

**Fix Required**:
```javascript
Change.rectifyModelChanges = async function(modelName, modelIds) {
  const errors = []
  
  for (const id of modelIds) {
    try {
      const change = await this.findOrCreateChange(modelName, id)
      await change.rectify()
    } catch (err) {
      err.modelName = modelName
      err.modelId = id
      errors.push(err)
      if (!this.settings.ignoreErrors) break
    }
  }

  if (errors.length) {
    const error = new Error(g.f('Cannot rectify %s changes', modelName))
    error.details = { errors }
    throw error
  }
}
```

### 4. Checkpoint Validation
**Location**: `lib/persisted-model.js` (Lines 1236-1243)

**Problem**:
- Missing validation for increasing checkpoint sequences
- No handling of clock skew between source/target
- Limited checkpoint debugging information

**Fix Required**:
```javascript
async function validateCheckpoints(sourceCp, targetCp, previousSource, previousTarget) {
  if (sourceCp.seq <= previousSource || targetCp.seq <= previousTarget) {
    throw new Error(g.f('Invalid checkpoint sequence'))
  }
  
  if (Math.abs(sourceCp.seq - targetCp.seq) > MAX_CHECKPOINT_DELTA) {
    throw new Error(g.f('Clock skew detected between source and target'))
  }
}
```

## Medium Priority Issues

### 5. Replication Retry Logic
**Location**: `lib/persisted-model.js` (Lines 1120-1134)

**Problem**:
- While loop implementation vs original recursive approach
- Missing conflict accumulation between attempts
- No backoff strategy

**Fix Required**:
```javascript
async function replicateWithRetry(sourceModel, targetModel, since, options) {
  const MAX_ATTEMPTS = 3
  let attempt = 1
  let allConflicts = []
  
  while (attempt <= MAX_ATTEMPTS) {
    const result = await tryReplicate(sourceModel, targetModel, since, options)
    allConflicts = allConflicts.concat(result.conflicts)
    
    if (!result.conflicts.length) break
    
    attempt++
    await delay(attempt * 1000) // Exponential backoff
  }
  
  return { conflicts: allConflicts }
}
```

### 6. Stream Implementation
**Problem**:
- Missing createChangeStream implementation
- Incomplete event handler cleanup
- Stream destruction not properly handled

**Impact**:
- Missing real-time update functionality
- Potential memory leaks
- Changed behavior from original implementation

## Action Plan

### Sprint 1: Critical Fixes (Week 1)
1. Fix utils.js error handling
   - Correct variable reference
   - Initialize conflict aggregation
   - Add error tests

2. Implement proper bulk update handling
   - Sequential processing with conflict collection
   - Maintain original error context
   - Add regression tests

### Sprint 2: High Priority (Week 2)
1. Improve Change model rectification
   - Sequential processing option
   - Complete error collection
   - Add timeout handling

2. Add checkpoint validation
   - Sequence validation
   - Clock skew detection
   - Enhanced debugging

### Sprint 3: Medium Priority (Week 3)
1. Enhance replication retry logic
   - Implement backoff strategy
   - Add conflict accumulation
   - Improve logging

2. Port stream functionality
   - Implement createChangeStream
   - Add proper cleanup
   - Add stream tests

### Sprint 4: Testing & Documentation (Week 4)
1. Add comprehensive tests
   - Conflict scenarios
   - Network failures
   - Clock skew cases

2. Update documentation
   - API changes
   - Migration guide
   - Best practices

## Success Metrics

### 1. Reliability
- Zero unhandled promise rejections
- All conflicts properly detected and reported
- No checkpoint regressions

### 2. Performance
- Bulk update performance within 10% of original
- Replication completion time comparable to callback version
- Memory usage stable during long-running operations

### 3. Maintainability
- 90%+ test coverage
- All error paths documented
- Consistent error handling patterns

## Monitoring Recommendations

1. Add metrics for:
   - Conflict resolution time
   - Replication attempts
   - Checkpoint deltas

2. Add logging for:
   - Conflict detection
   - Retry attempts
   - Checkpoint transitions

3. Add alerts for:
   - Checkpoint regressions
   - High conflict rates
   - Replication failures
