# Centralized Model Registry Migration Guide

## Overview

This guide provides step-by-step instructions for migrating existing LoopBack applications to use the Centralized Model Registry enhancement. The migration is designed to be **zero-effort** for most applications, with optional optimizations available.

## Migration Strategy

### Zero-Effort Migration (Recommended)

The Centralized Model Registry is designed for **100% backward compatibility**. Most applications can migrate with no code changes:

1. **Update Package**: Update loopback-datasource-juggler
2. **Restart Application**: No code changes required
3. **Verify Operation**: Application works identically

### Optimization Migration (Optional)

For applications that want to leverage new features:

1. **Update Package**: Update loopback-datasource-juggler
2. **Replace Deprecated Patterns**: Update direct model assignments
3. **Use New APIs**: Leverage owner-aware model queries
4. **Optimize Performance**: Cache proxy references

## Pre-Migration Assessment

### Compatibility Check

Before migrating, verify your application's compatibility:

```javascript
// compatibility-check.js
const semver = require('semver');
const pkg = require('./node_modules/loopback-datasource-juggler/package.json');

console.log('Current version:', pkg.version);
console.log('Compatible:', semver.gte(pkg.version, '5.2.1'));

if (!semver.gte(pkg.version, '5.2.1')) {
  console.log('Please update: npm update loopback-datasource-juggler');
}
```

### Code Pattern Analysis

Identify patterns in your codebase that may need attention:

```bash
# Search for direct model assignments (will show deprecation warnings)
grep -r "\.models\s*=" src/

# Search for manual model management
grep -r "delete.*\.models\." src/

# Search for model enumeration patterns
grep -r "Object\.keys.*\.models" src/
```

## Step-by-Step Migration

### Step 1: Update Dependencies

Update to the latest version of loopback-datasource-juggler:

```bash
# Check current version
npm list loopback-datasource-juggler

# Update to latest version
npm update loopback-datasource-juggler

# Verify version is 5.2.1 or higher
npm list loopback-datasource-juggler
```

For applications with locked dependencies:

```bash
# Update package.json
npm install loopback-datasource-juggler@^5.2.1

# Update package-lock.json
npm install
```

### Step 2: Verify Basic Functionality

Create a simple test to verify the migration:

```javascript
// test-migration.js
const { DataSource, ModelRegistry } = require('loopback-datasource-juggler');

function testMigration() {
  console.log('Testing Centralized Model Registry migration...');
  
  try {
    // Test 1: Basic model creation
    const dataSource = new DataSource('memory');
    const User = dataSource.define('User', { name: 'string' });
    
    console.assert(dataSource.models.User === User, 'Basic access failed');
    console.log('✅ Basic model access working');
    
    // Test 2: Object operations
    const keys = Object.keys(dataSource.models);
    console.assert(keys.includes('User'), 'Object.keys failed');
    console.log('✅ Object operations working');
    
    // Test 3: New API methods
    const models = ModelRegistry.getModelsForOwner(dataSource, 'dataSource');
    console.assert(models.length === 1, 'Owner-aware query failed');
    console.log('✅ New API methods working');
    
    console.log('🎉 Migration successful!');
    return true;
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    return false;
  }
}

testMigration();
```

Run the test:

```bash
node test-migration.js
```

### Step 3: Handle Deprecation Warnings

If you see deprecation warnings, update the problematic code:

#### Direct Model Assignment

**Before (Deprecated):**
```javascript
// This will show deprecation warning
dataSource.models = { User: userModel };
dataSource.models.User = userModel;
```

**After (Recommended):**
```javascript
// Use proper model definition
const User = dataSource.define('User', {
  name: { type: 'string', required: true },
  email: { type: 'string', required: true }
});

// Or if you have an existing model instance
if (userModel && !dataSource.models.User) {
  // Register through ModelRegistry
  const { ModelRegistry } = require('loopback-datasource-juggler');
  userModel.dataSource = dataSource;
  ModelRegistry.registerModel(userModel);
}
```

#### Manual Model Deletion

**Before:**
```javascript
// Manual cleanup
delete dataSource.models.User;
```

**After:**
```javascript
// Use ModelRegistry cleanup
const { ModelRegistry } = require('loopback-datasource-juggler');
ModelRegistry.cleanupTenant(tenantCode); // Cleans all models for tenant
```

### Step 4: Optimize Performance (Optional)

Optimize your code for better performance with the new architecture:

#### Cache Proxy References

**Before:**
```javascript
// Repeated proxy access
function processModels() {
  const user = dataSource.models.User;
  const product = dataSource.models.Product;
  const order = dataSource.models.Order;
  
  // Process models...
}
```

**After (Optimized):**
```javascript
// Cache proxy reference
function processModels() {
  const models = dataSource.models; // Cache proxy
  const user = models.User;
  const product = models.Product;
  const order = models.Order;
  
  // Process models...
}
```

#### Use Owner-Aware Queries

**Before:**
```javascript
// Manual model search
function findUserModel(dataSources) {
  for (const ds of dataSources) {
    if (ds.models.User) {
      return ds.models.User;
    }
  }
  return null;
}
```

**After (Optimized):**
```javascript
// Use owner-aware queries
const { ModelRegistry } = require('loopback-datasource-juggler');

function findUserModel(dataSources) {
  for (const ds of dataSources) {
    const model = ModelRegistry.getModelForOwner('User', ds, 'dataSource');
    if (model) return model;
  }
  return null;
}
```

#### Bulk Model Operations

**Before:**
```javascript
// Individual model access
function processAllModels(dataSource) {
  const modelNames = Object.keys(dataSource.models);
  modelNames.forEach(name => {
    const model = dataSource.models[name];
    // Process model...
  });
}
```

**After (Optimized):**
```javascript
// Bulk model retrieval
const { ModelRegistry } = require('loopback-datasource-juggler');

function processAllModels(dataSource) {
  const models = ModelRegistry.getModelsForOwner(dataSource, 'dataSource');
  models.forEach(model => {
    // Process model...
  });
}
```

## Application-Specific Migration

### LoopBack 3.x Applications

LoopBack 3.x applications typically use DataSource instances directly:

```javascript
// Typical LoopBack 3.x pattern
const app = require('./app');
const dataSource = app.dataSources.db;

// This continues to work unchanged
const User = dataSource.models.User;
const users = await User.find();
```

**Migration:** No changes required. The enhancement is transparent.

### LoopBack 4.x Applications

LoopBack 4.x applications use dependency injection but may access DataSource.models:

```javascript
// LoopBack 4.x pattern
@inject('datasources.db')
dataSource: DataSource;

// This continues to work unchanged
const User = this.dataSource.models.User;
```

**Migration:** No changes required. The enhancement is transparent.

### Custom Model Management

Applications with custom model management may need updates:

**Before:**
```javascript
class CustomModelManager {
  constructor(dataSource) {
    this.dataSource = dataSource;
    this.models = {}; // Custom model storage
  }
  
  addModel(name, model) {
    this.models[name] = model;
    this.dataSource.models[name] = model; // Direct assignment
  }
  
  removeModel(name) {
    delete this.models[name];
    delete this.dataSource.models[name]; // Direct deletion
  }
}
```

**After:**
```javascript
const { ModelRegistry } = require('loopback-datasource-juggler');

class CustomModelManager {
  constructor(dataSource) {
    this.dataSource = dataSource;
    // No need for custom model storage
  }
  
  addModel(name, model) {
    // Set up ownership and register
    model.dataSource = this.dataSource;
    model.modelName = name;
    ModelRegistry.registerModel(model);
  }
  
  removeModel(name) {
    // Use ModelRegistry for removal
    const model = ModelRegistry.getModelForOwner(name, this.dataSource, 'dataSource');
    if (model) {
      ModelRegistry.unregisterModel(model);
    }
  }
  
  getModels() {
    return ModelRegistry.getModelsForOwner(this.dataSource, 'dataSource');
  }
}
```

### Multi-Tenant Applications

Multi-tenant applications benefit significantly from the enhancement:

**Before:**
```javascript
// Manual tenant isolation
class TenantModelManager {
  constructor() {
    this.tenantDataSources = new Map();
  }
  
  getModelsForTenant(tenantId) {
    const dataSource = this.tenantDataSources.get(tenantId);
    return dataSource ? dataSource.models : {};
  }
  
  cleanupTenant(tenantId) {
    const dataSource = this.tenantDataSources.get(tenantId);
    if (dataSource) {
      // Manual cleanup required
      Object.keys(dataSource.models).forEach(name => {
        delete dataSource.models[name];
      });
    }
  }
}
```

**After:**
```javascript
// Automatic tenant isolation
const { ModelRegistry } = require('loopback-datasource-juggler');

class TenantModelManager {
  constructor() {
    this.tenantDataSources = new Map();
  }
  
  getModelsForTenant(tenantId) {
    const dataSource = this.tenantDataSources.get(tenantId);
    return dataSource ? dataSource.models : {}; // Proxy handles isolation
  }
  
  cleanupTenant(tenantId) {
    // Single operation cleans everything
    ModelRegistry.cleanupTenant(tenantId);
  }
}
```

## Testing Migration

### Unit Tests

Update unit tests to work with the new architecture:

```javascript
// test/model-registry.test.js
const { DataSource, ModelRegistry } = require('loopback-datasource-juggler');

describe('Model Registry Migration', () => {
  let dataSource;
  
  beforeEach(() => {
    dataSource = new DataSource('memory');
    ModelRegistry.clear(); // Clean state
  });
  
  afterEach(() => {
    ModelRegistry.clear(); // Clean state
  });
  
  it('should maintain backward compatibility', () => {
    const User = dataSource.define('User', { name: 'string' });
    
    // All existing patterns should work
    expect(dataSource.models.User).toBe(User);
    expect(Object.keys(dataSource.models)).toContain('User');
    expect('User' in dataSource.models).toBe(true);
  });
  
  it('should support new owner-aware queries', () => {
    const User = dataSource.define('User', { name: 'string' });
    
    const models = ModelRegistry.getModelsForOwner(dataSource, 'dataSource');
    expect(models).toHaveLength(1);
    expect(models[0]).toBe(User);
  });
});
```

### Integration Tests

Test the migration in a realistic application context:

```javascript
// test/integration.test.js
const app = require('../app'); // Your LoopBack app

describe('Application Integration', () => {
  it('should work with existing application code', async () => {
    // Test existing model access patterns
    const User = app.models.User;
    expect(User).toBeDefined();
    
    // Test model operations
    const user = await User.create({ name: 'Test User' });
    expect(user.name).toBe('Test User');
    
    // Test model enumeration
    const modelNames = Object.keys(app.models);
    expect(modelNames).toContain('User');
  });
});
```

### Performance Tests

Verify that performance hasn't degraded:

```javascript
// test/performance.test.js
const { DataSource } = require('loopback-datasource-juggler');

describe('Performance', () => {
  it('should maintain model access performance', () => {
    const dataSource = new DataSource('memory');
    const User = dataSource.define('User', { name: 'string' });
    
    const start = process.hrtime.bigint();
    
    // Perform many model accesses
    for (let i = 0; i < 10000; i++) {
      const model = dataSource.models.User;
    }
    
    const end = process.hrtime.bigint();
    const duration = Number(end - start) / 1000000; // Convert to milliseconds
    
    // Should complete in reasonable time (adjust threshold as needed)
    expect(duration).toBeLessThan(100);
  });
});
```

## Rollback Plan

If issues arise, you can rollback to the previous version:

### Immediate Rollback

```bash
# Rollback to previous version
npm install loopback-datasource-juggler@5.1.x

# Restart application
npm restart
```

### Gradual Rollback

For production environments, use a gradual rollback:

1. **Deploy Previous Version**: Deploy the previous package version
2. **Monitor Application**: Ensure functionality is restored
3. **Investigate Issues**: Analyze logs and error reports
4. **Plan Re-migration**: Address issues and plan new migration

### Data Integrity

The migration doesn't affect data storage, only in-memory model management:

- **Database Data**: Unchanged and safe
- **Model Definitions**: Unchanged and safe
- **Application Logic**: Should work identically

## Post-Migration Validation

### Functional Validation

Verify all application functionality works correctly:

```bash
# Run full test suite
npm test

# Run specific model tests
npm test -- --grep "model"

# Run integration tests
npm run test:integration
```

### Performance Validation

Monitor application performance after migration:

```javascript
// performance-monitor.js
const { performance } = require('perf_hooks');

function monitorModelAccess(dataSource) {
  const start = performance.now();
  
  // Typical model access patterns
  const User = dataSource.models.User;
  const modelNames = Object.keys(dataSource.models);
  const hasUser = 'User' in dataSource.models;
  
  const end = performance.now();
  console.log(`Model access took ${end - start} milliseconds`);
}

// Monitor periodically
setInterval(() => monitorModelAccess(app.dataSources.db), 60000);
```

### Memory Validation

Monitor memory usage to verify efficiency gains:

```javascript
// memory-monitor.js
function monitorMemory() {
  const usage = process.memoryUsage();
  console.log('Memory usage:', {
    rss: Math.round(usage.rss / 1024 / 1024) + 'MB',
    heapUsed: Math.round(usage.heapUsed / 1024 / 1024) + 'MB',
    heapTotal: Math.round(usage.heapTotal / 1024 / 1024) + 'MB'
  });
}

// Monitor memory usage
setInterval(monitorMemory, 300000); // Every 5 minutes
```

## Common Migration Issues

### Issue: Deprecation Warnings

**Symptoms:** Console warnings about deprecated DataSource.models setter

**Solution:**
```javascript
// Replace direct assignment
// dataSource.models = { User: userModel }; // ❌

// With proper model definition
const User = dataSource.define('User', properties); // ✅
```

### Issue: Model Not Found

**Symptoms:** `dataSource.models.ModelName` returns undefined

**Cause:** Model not properly registered during creation

**Solution:**
```javascript
// Ensure models are created through dataSource.define()
const User = dataSource.define('User', properties); // ✅

// Not through modelBuilder directly
// const User = modelBuilder.define('User', properties); // ❌
```

### Issue: Performance Degradation

**Symptoms:** Slower model access than before

**Solution:**
```javascript
// Cache proxy references
const models = dataSource.models;
const User = models.User; // ✅

// Instead of repeated access
// const User = dataSource.models.User; // Less efficient
```

### Issue: Test Failures

**Symptoms:** Existing tests fail after migration

**Solution:**
```javascript
// Ensure proper test cleanup
afterEach(() => {
  ModelRegistry.clear(); // Clean registry state
});

// Update test assertions if needed
expect(dataSource.models.User).toBe(User); // ✅
expect(dataSource.models.User).toEqual(User); // May fail due to proxy
```

## Support and Resources

### Getting Help

1. **Documentation**: Refer to the comprehensive documentation
2. **GitHub Issues**: Report bugs with reproduction steps
3. **Community Forums**: Ask questions in LoopBack community
4. **Professional Support**: Contact IBM for enterprise support

### Debug Information

Enable debug logging for troubleshooting:

```bash
DEBUG=loopback:juggler:model-registry-proxy node app.js
```

### Migration Checklist

- [ ] Updated loopback-datasource-juggler to 5.2.1+
- [ ] Verified basic functionality with test script
- [ ] Addressed any deprecation warnings
- [ ] Updated custom model management code
- [ ] Ran full test suite
- [ ] Monitored performance and memory usage
- [ ] Documented any application-specific changes

The migration to Centralized Model Registry is designed to be seamless and beneficial for all LoopBack applications. Follow this guide to ensure a smooth transition and take advantage of the enhanced architecture.
