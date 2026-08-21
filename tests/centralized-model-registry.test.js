// Copyright IBM Corp. 2024. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const expect = require('chai').expect;
const loopback = require('../lib/loopback');
const { DataSource, ModelRegistry } = require('loopback-datasource-juggler');

describe('Centralized Model Registry Integration', function() {
  let app, dataSource;

  beforeEach(function() {
    app = loopback({ localRegistry: true, loadBuiltinModels: true });
    dataSource = app.dataSource('db', { connector: 'memory' });
  });

  describe('DataSource.models proxy integration', function() {
    it('should register models in centralized registry when created via dataSource.define()', function() {
      // Before creation
      expect(Object.keys(dataSource.models)).to.not.include('User');

      // Create DataSource-owned model
      const User = dataSource.define('User', {
        name: { type: 'string' },
        email: { type: 'string' }
      });

      // After creation - should be accessible via proxy
      expect(dataSource.models.User).to.equal(User);
      expect(Object.keys(dataSource.models)).to.include('User');
    });

    it('should support all Object operations on DataSource.models proxy', function() {
      // Create DataSource-owned models
      const User = dataSource.define('User', { name: 'string' });
      const Product = dataSource.define('Product', { title: 'string' });

      // Object.keys()
      const keys = Object.keys(dataSource.models);
      expect(keys).to.include.members(['User', 'Product']);

      // Object.values()
      const values = Object.values(dataSource.models);
      expect(values).to.include.members([User, Product]);

      // Object.entries()
      const entries = Object.entries(dataSource.models);
      expect(entries).to.deep.include(['User', User]);
      expect(entries).to.deep.include(['Product', Product]);

      // 'in' operator
      expect('User' in dataSource.models).to.be.true;
      expect('Product' in dataSource.models).to.be.true;
      expect('NonExistent' in dataSource.models).to.be.false;

      // hasOwnProperty
      expect(dataSource.models.hasOwnProperty('User')).to.be.true;
      expect(dataSource.models.hasOwnProperty('Product')).to.be.true;

      // for...in enumeration
      const enumerated = [];
      for (const modelName in dataSource.models) {
        enumerated.push(modelName);
      }
      expect(enumerated).to.include.members(['User', 'Product']);
    });

    it('should maintain isolation between different DataSources', function() {
      const dataSource2 = app.dataSource('db2', { connector: 'memory' });

      // Create DataSource-owned models (not App-owned)
      const User = dataSource.define('User', { name: 'string' });
      const Product = dataSource2.define('Product', { title: 'string' });

      // DataSource 1 should only have User
      expect(Object.keys(dataSource.models)).to.deep.equal(['User']);
      expect(dataSource.models.User).to.equal(User);
      expect(dataSource.models.Product).to.be.undefined;

      // DataSource 2 should only have Product
      expect(Object.keys(dataSource2.models)).to.deep.equal(['Product']);
      expect(dataSource2.models.Product).to.equal(Product);
      expect(dataSource2.models.User).to.be.undefined;
    });
  });

  describe('Owner-aware ModelRegistry queries', function() {
    beforeEach(function() {
      // Skip tests if owner-aware methods are not available
      if (typeof ModelRegistry.getModelsForOwner !== 'function') {
        this.skip();
      }
    });

    it('should return models owned by specific DataSource', function() {
      // Create DataSource-owned models using dataSource.define() (not app.model())
      const User = dataSource.define('User', { name: 'string' });
      const Product = dataSource.define('Product', { title: 'string' });

      const models = ModelRegistry.getModelsForOwner(dataSource, 'dataSource');
      const modelNames = models.map(m => m.modelName);

      expect(models).to.have.length(2);
      expect(modelNames).to.include.members(['User', 'Product']);
      expect(models).to.include.members([User, Product]);
    });

    it('should return model names owned by specific DataSource', function() {
      // Create DataSource-owned models using dataSource.define() (not app.model())
      const User = dataSource.define('User', { name: 'string' });

      const modelNames = ModelRegistry.getModelNamesForOwner(dataSource, 'dataSource');

      expect(modelNames).to.be.an('array');
      expect(modelNames).to.include('User');
    });

    it('should check if model exists for specific owner', function() {
      // Create DataSource-owned models using dataSource.define() (not app.model())
      const User = dataSource.define('User', { name: 'string' });

      const hasUser = ModelRegistry.hasModelForOwner(dataSource, 'User', 'dataSource');
      const hasProduct = ModelRegistry.hasModelForOwner(dataSource, 'Product', 'dataSource');

      expect(hasUser).to.be.true;
      expect(hasProduct).to.be.false;
    });

    it('should get specific model for owner', function() {
      // Create DataSource-owned models using dataSource.define() (not app.model())
      const User = dataSource.define('User', { name: 'string' });

      const foundUser = ModelRegistry.getModelForOwner(dataSource, 'User', 'dataSource');
      const foundProduct = ModelRegistry.getModelForOwner(dataSource, 'Product', 'dataSource');

      expect(foundUser).to.equal(User);
      expect(foundProduct).to.be.undefined;
    });

    it('should return models owned by app', function() {
      const User = app.registry.createModel('User', { name: 'string' });
      const Product = app.registry.createModel('Product', { title: 'string' });

      app.model(User, { dataSource: 'db' });
      app.model(Product, { dataSource: 'db' });

      const appModels = ModelRegistry.getModelsForOwner(app, 'app');
      const modelNames = appModels.map(m => m.modelName);

      expect(modelNames).to.include.members(['User', 'Product']);
    });

    it('should verify API parameter order consistency', function() {
      // Create DataSource-owned model
      const User = dataSource.define('User', { name: 'string' });

      // Test simplified API (owner, modelName)
      const foundUser1 = ModelRegistry.getModelForOwner(dataSource, 'User');
      const hasUser1 = ModelRegistry.hasModelForOwner(dataSource, 'User');

      expect(foundUser1).to.equal(User);
      expect(hasUser1).to.be.true;

      // Test explicit API (owner, modelName, ownerType)
      const foundUser2 = ModelRegistry.getModelForOwner(dataSource, 'User', 'dataSource');
      const hasUser2 = ModelRegistry.hasModelForOwner(dataSource, 'User', 'dataSource');

      expect(foundUser2).to.equal(User);
      expect(hasUser2).to.be.true;

      // Test non-existent model
      const foundProduct = ModelRegistry.getModelForOwner(dataSource, 'Product');
      const hasProduct = ModelRegistry.hasModelForOwner(dataSource, 'Product');

      expect(foundProduct).to.be.undefined;
      expect(hasProduct).to.be.false;
    });
  });

  describe('Enhanced LoopBack application methods', function() {
    it('should use owner-aware queries in enableAuth when available', function() {
      // Create a custom User subclass
      const CustomUser = app.registry.createModel('CustomUser', {
        customField: { type: 'string' }
      }, {
        base: 'User'
      });

      app.model(CustomUser, { dataSource: 'db' });

      // Enable auth - should detect the attached subclass
      app.enableAuth({ dataSource: dataSource });

      // Built-in User should not be attached since CustomUser is already attached
      const builtinUser = app.registry.findModel('User');
      expect(builtinUser.dataSource).to.be.oneOf([null, undefined]);
      expect(CustomUser.dataSource).to.equal(dataSource);
    });

    it('should use owner-aware queries in Registry.getModelByType when available', function() {
      const CustomUser = app.registry.createModel('CustomUser', {
        customField: { type: 'string' }
      }, {
        base: 'User'
      });

      app.model(CustomUser, { dataSource: 'db' });

      // getModelByType should work with enhanced logic
      const foundModel = app.registry.getModelByType('User');
      expect(foundModel).to.be.a('function');
      expect(foundModel.modelName).to.be.a('string');
    });
  });

  describe('Backward compatibility', function() {
    it('should maintain compatibility with existing model access patterns', function() {
      const User = app.registry.createModel('User', { name: 'string' });
      app.model(User, { dataSource: 'db' });

      // Traditional app.models access
      expect(app.models.User).to.equal(User);

      // Check app.models() array contains the User model
      const appModelsArray = app.models();
      expect(appModelsArray).to.be.an('array');
      expect(appModelsArray.some(model => model === User)).to.be.true;

      // DataSource.models proxy access - App-owned models are not shown in DataSource proxy (v5.2.4 behavior)
      // This is the new correct behavior for perfect isolation
      expect(dataSource.models.User).to.be.undefined;

      // Registry access
      expect(app.registry.findModel('User')).to.equal(User);
    });

    it('should work when owner-aware methods are not available', function() {
      // Temporarily remove the method to test fallback
      const originalMethod = ModelRegistry.getModelsForOwner;
      delete ModelRegistry.getModelsForOwner;

      try {
        const User = app.registry.createModel('User', { name: 'string' });
        app.model(User, { dataSource: 'db' });

        // Should still work with fallback logic
        app.enableAuth({ dataSource: dataSource });
        expect(User.dataSource).to.equal(dataSource);

        const foundModel = app.registry.getModelByType('User');
        expect(foundModel).to.be.a('function');
      } finally {
        // Restore the method
        ModelRegistry.getModelsForOwner = originalMethod;
      }
    });
  });

  describe('Performance characteristics', function() {
    it('should handle large numbers of models efficiently', function() {
      const modelCount = 50;
      const models = [];

      // Create many DataSource-owned models
      for (let i = 0; i < modelCount; i++) {
        const TestModel = dataSource.define(`TestModel${i}`, {
          value: { type: 'string' }
        });
        models.push(TestModel);
      }

      // Verify all models are accessible
      expect(Object.keys(dataSource.models)).to.have.length(modelCount);

      // Test owner-aware queries if available
      if (typeof ModelRegistry.getModelsForOwner === 'function') {
        const startTime = Date.now();
        const foundModels = ModelRegistry.getModelsForOwner(dataSource);
        const queryTime = Date.now() - startTime;

        expect(foundModels).to.have.length(modelCount);
        expect(queryTime).to.be.below(100); // Should be fast
      }
    });
  });
});
