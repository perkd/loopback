// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const loopback = require('../');

describe('DataSource', function() {
  let memory;

  beforeEach(function() {
    memory = loopback.createDataSource({
      connector: loopback.Memory,
    });

    assertValidDataSource(memory);
  });

  describe('dataSource.createModel(name, properties, settings)', function() {
    it('Define a model and attach it to a `DataSource`', function() {
      const Color = memory.createModel('color', {name: String});
      assert.isFunc(Color, 'find');
      assert.isFunc(Color, 'findById');
      assert.isFunc(Color, 'findOne');
      assert.isFunc(Color, 'create');
      assert.isFunc(Color, 'updateOrCreate');
      assert.isFunc(Color, 'upsertWithWhere');
      assert.isFunc(Color, 'upsert');
      assert.isFunc(Color, 'findOrCreate');
      assert.isFunc(Color, 'exists');
      assert.isFunc(Color, 'destroyAll');
      assert.isFunc(Color, 'count');
      assert.isFunc(Color, 'include');
      assert.isFunc(Color, 'hasMany');
      assert.isFunc(Color, 'belongsTo');
      assert.isFunc(Color, 'hasAndBelongsToMany');
      assert.isFunc(Color.prototype, 'save');
      assert.isFunc(Color.prototype, 'isNewRecord');
      assert.isFunc(Color.prototype, 'destroy');
      assert.isFunc(Color.prototype, 'updateAttribute');
      assert.isFunc(Color.prototype, 'updateAttributes');
      assert.isFunc(Color.prototype, 'reload');
    });

    it('should honor settings.base', function() {
      const Base = memory.createModel('base');
      const Color = memory.createModel('color', {name: String}, {base: Base});
      assert(Color.prototype instanceof Base);
      assert.equal(Color.base, Base);
    });

    it('should use loopback.PersistedModel as the base for DBs', function() {
      const Color = memory.createModel('color', {name: String});
      assert(Color.prototype instanceof loopback.PersistedModel);
      assert.equal(Color.base, loopback.PersistedModel);
    });

    it('should use loopback.Model as the base for non DBs', function() {
      // Mock up a non-DB connector
      const Connector = function() {
      };
      Connector.prototype.getTypes = function() {
        return ['rest'];
      };

      const ds = loopback.createDataSource({
        connector: new Connector(),
      });

      const Color = ds.createModel('color', {name: String});
      assert(Color.prototype instanceof Color.registry.getModel('Model'));
      assert.equal(Color.base.modelName, 'PersistedModel');
    });
  });

  describe.skip('PersistedModel Methods', function() {
    it('List the enabled and disabled methods', function() {
      const TestModel = loopback.PersistedModel.extend('TestPersistedModel');
      TestModel.attachTo(loopback.memory());

      // assert the defaults
      // - true: the method should be remote enabled
      // - false: the method should not be remote enabled
      // -
      existsAndShared('_forDB', false);
      existsAndShared('create', true);
      existsAndShared('updateOrCreate', true);
      existsAndShared('upsertWithWhere', true);
      existsAndShared('upsert', true);
      existsAndShared('findOrCreate', false);
      existsAndShared('exists', true);
      existsAndShared('find', true);
      existsAndShared('findOne', true);
      existsAndShared('destroyAll', false);
      existsAndShared('count', true);
      existsAndShared('include', false);
      existsAndShared('hasMany', false);
      existsAndShared('belongsTo', false);
      existsAndShared('hasAndBelongsToMany', false);
      existsAndShared('save', false);
      existsAndShared('isNewRecord', false);
      existsAndShared('_adapter', false);
      existsAndShared('destroyById', true);
      existsAndShared('destroy', false);
      existsAndShared('updateAttributes', true);
      existsAndShared('updateAll', true);
      existsAndShared('reload', false);

      function existsAndShared(Model, name, isRemoteEnabled, isProto) {
        const scope = isProto ? Model.prototype : Model;
        const fn = scope[name];
        const actuallyEnabled = Model.getRemoteMethod(name);
        assert(fn, name + ' should be defined!');
        assert(actuallyEnabled === isRemoteEnabled,
          name + ' ' + (isRemoteEnabled ? 'should' : 'should not') +
            ' be remote enabled');
      }
    });
  });
});

function assertValidDataSource(dataSource) {
  // has methods
  assert.isFunc(dataSource, 'createModel');
  assert.isFunc(dataSource, 'discoverModelDefinitions');
  assert.isFunc(dataSource, 'discoverSchema');
  assert.isFunc(dataSource, 'enableRemote');
  assert.isFunc(dataSource, 'disableRemote');
  assert.isFunc(dataSource, 'defineOperation');
  assert.isFunc(dataSource, 'operations');
}

assert.isFunc = function(obj, name) {
  assert(obj, 'cannot assert function ' + name + ' on object that doesnt exist');
  assert(typeof obj[name] === 'function', name + ' is not a function');
};
