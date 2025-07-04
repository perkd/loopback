# Migrating from Callback-based to Promise-based Role Methods

## Overview

This guide outlines the changes needed to update your application code after the Role model methods have been converted from callback-based to Promise/async-based implementations.

## Major Changes

All Role model methods now return Promises instead of accepting callbacks. Key methods affected include:

- `Role.isInRole()`
- `Role.getRoles()`
- `Role.isOwner()`
- `Role.isMappedToRole()`
- `Role.registerResolver()`
- Role relation accessors (e.g., `role.principals()`, `role.users()`, etc.)

## Migration Steps

### 1. Using with async/await (Recommended)

```javascript
// Old callback-based code
Role.isInRole('admin', context, function(err, isInRole) {
  if (err) return handleError(err)
  
  if (isInRole) {
    // Grant access
  } else {
    // Deny access
  }
})

// New async/await based code
try {
  const isInRole = await Role.isInRole('admin', context)
  
  if (isInRole) {
    // Grant access
  } else {
    // Deny access
  }
} catch (err) {
  handleError(err)
}
```

### 2. Using with Promises

```javascript
// Old callback-based code
Role.getRoles(context, function(err, roles) {
  if (err) return handleError(err)
  
  // Process roles
})

// New Promise-based code
Role.getRoles(context)
  .then(roles => {
    // Process roles
  })
  .catch(err => {
    handleError(err)
  })
```

### 3. Updating Role Resolvers

Custom role resolvers should also be updated to return Promises:

```javascript
// Old callback-based resolver
Role.registerResolver('myRole', function(role, context, callback) {
  // Do some async work
  someAsyncOperation(function(err, result) {
    if (err) return callback(err)
    callback(null, result)
  })
})

// New Promise-based resolver
Role.registerResolver('myRole', function(role, context) {
  // Return a Promise
  return new Promise((resolve, reject) => {
    someAsyncOperation(function(err, result) {
      if (err) return reject(err)
      resolve(result)
    })
  })
  
  // Or better yet, if someAsyncOperation has been updated to return a Promise:
  return someAsyncOperation()
})

// Best: async/await based resolver
Role.registerResolver('myRole', async function(role, context) {
  try {
    const result = await someAsyncOperation()
    return result
  } catch (err) {
    throw err
  }
})
```

### 4. Updating Tests

Update your tests to use async/await or Promise-based assertions:

```javascript
// Old callback-based test
it('should check if user is in role', function(done) {
  Role.isInRole('admin', context, function(err, isInRole) {
    if (err) return done(err)
    assert(isInRole)
    done()
  })
})

// New async/await based test
it('should check if user is in role', async function() {
  const isInRole = await Role.isInRole('admin', context)
  assert(isInRole)
})
```

## Common Patterns

### Checking Multiple Roles

```javascript
// Old approach
async.parallel([
  function(callback) {
    Role.isInRole('admin', context, callback)
  },
  function(callback) {
    Role.isInRole('editor', context, callback)
  }
], function(err, results) {
  if (err) return handleError(err)
  const isAdmin = results[0]
  const isEditor = results[1]
  // Process results
})

// New approach
try {
  const [isAdmin, isEditor] = await Promise.all([
    Role.isInRole('admin', context),
    Role.isInRole('editor', context)
  ])
  // Process results
} catch (err) {
  handleError(err)
}
```

## Troubleshooting

If you encounter any issues during migration, please refer to the [troubleshooting guide](troubleshooting.md) or open an issue in the repository. 