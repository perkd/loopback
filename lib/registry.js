// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const g = require('./globalize');
const assert = require('assert');
const extend = require('util')._extend;
const juggler = require('loopback-datasource-juggler');
const debug = require('debug')('loopback:registry');
const DataSource = juggler.DataSource;
const ModelBuilder = juggler.ModelBuilder;
const deprecated = require('depd')('strong-remoting');

module.exports = Registry;

/**
 * Define and reference `Models` and `DataSources`.
 *
 * @class
 */

function Registry() {
  this.defaultDataSources = {};
  this.modelBuilder = new ModelBuilder();
  require('./model')(this);
  require('./persisted-model')(this);

  // Set the default model base class.
  this.modelBuilder.defaultModelBaseClass = this.getModel('Model');
}

/**
 * Create a named vanilla JavaScript class constructor with an attached
 * set of properties and options.
 *
 * This function comes with two variants:
 *  * `loopback.createModel(name, properties, options)`
 *  * `loopback.createModel(config)`
 *
 * In the second variant, the parameters `name`, `properties` and `options`
 * are provided in the config object. Any additional config entries are
 * interpreted as `options`, i.e. the following two configs are identical:
 *
 * ```js
 * { name: 'Customer', base: 'User' }
 * { name: 'Customer', options: { base: 'User' } }
 * ```
 *
 * **Example**
 *
 * Create an `Author` model using the three-parameter variant:
 *
 * ```js
 * loopback.createModel(
 *   'Author',
 *   {
 *     firstName: 'string',
 *     lastName: 'string'
 *   },
 *   {
 *     relations: {
 *       books: {
 *         model: 'Book',
 *         type: 'hasAndBelongsToMany'
 *       }
 *     }
 *   }
 * );
 * ```
 *
 * Create the same model using a config object:
 *
 * ```js
 * loopback.createModel({
 *   name: 'Author',
 *   properties: {
 *     firstName: 'string',
 *     lastName: 'string'
 *   },
 *   relations: {
 *     books: {
 *       model: 'Book',
 *       type: 'hasAndBelongsToMany'
 *     }
 *   }
 * });
 * ```
 *
 * @param {String} name Unique name.
 * @param {Object} properties
 * @param {Object} options (optional)
 *
 * @header loopback.createModel
 */

Registry.prototype.createModel = function(name, properties, options) {
  if (arguments.length === 1 && typeof name === 'object') {
    const config = name;
    name = config.name;
    properties = config.properties;
    options = buildModelOptionsFromConfig(config);

    assert(typeof name === 'string',
      'The model-config property `name` must be a string');
  }

  options = options || {};
  let BaseModel = options.base || options.super;

  if (typeof BaseModel === 'string') {
    const baseName = BaseModel;
    BaseModel = this.findModel(BaseModel);
    if (!BaseModel) {
      throw new Error(g.f('Model not found: model `%s` is extending an unknown model `%s`.',
        name, baseName));
    }
  }

  BaseModel = BaseModel || this.getModel('PersistedModel');
  const model = BaseModel.extend(name, properties, options);
  model.registry = this;

  this._defineRemoteMethods(model, model.settings.methods);

  return model;
};

function buildModelOptionsFromConfig(config) {
  const options = extend({}, config.options);
  for (const key in config) {
    if (['name', 'properties', 'options'].indexOf(key) !== -1) {
      // Skip items which have special meaning
      continue;
    }

    if (options[key] !== undefined) {
      // When both `config.key` and `config.options.key` are set,
      // use the latter one
      continue;
    }

    options[key] = config[key];
  }
  return options;
}

/*
 * Add the acl entry to the acls
 * @param {Object[]} acls
 * @param {Object} acl
 */
function addACL(acls, acl) {
  for (let i = 0, n = acls.length; i < n; i++) {
    // Check if there is a matching acl to be overriden
    if (acls[i].property === acl.property &&
      acls[i].accessType === acl.accessType &&
      acls[i].principalType === acl.principalType &&
      acls[i].principalId === acl.principalId) {
      acls[i] = acl;
      return;
    }
  }
  acls.push(acl);
}

/**
 * Alter an existing Model class.
 * @param {Model} ModelCtor The model constructor to alter.
 * @options {Object} config Additional configuration to apply
 * @property {DataSource} dataSource Attach the model to a dataSource.
 * @property {Object} [relations] Model relations to add/update.
 *
 * @header loopback.configureModel(ModelCtor, config)
 */

Registry.prototype.configureModel = function(ModelCtor, config) {
  const settings = ModelCtor.settings;
  const modelName = ModelCtor.modelName;

  ModelCtor.config = config;

  // Relations
  if (typeof config.relations === 'object' && config.relations !== null) {
    const relations = settings.relations = settings.relations || {};
    Object.keys(config.relations).forEach(function(key) {
      // FIXME: [rfeng] We probably should check if the relation exists
      relations[key] = extend(relations[key] || {}, config.relations[key]);
    });
  } else if (config.relations != null) {
    g.warn('The relations property of `%s` configuration ' +
      'must be an object', modelName);
  }

  // ACLs
  if (Array.isArray(config.acls)) {
    const acls = settings.acls = settings.acls || [];
    config.acls.forEach(function(acl) {
      addACL(acls, acl);
    });
  } else if (config.acls != null) {
    g.warn('The acls property of `%s` configuration ' +
      'must be an array of objects', modelName);
  }

  // Settings
  const excludedProperties = {
    base: true,
    'super': true,
    relations: true,
    acls: true,
    dataSource: true,
  };
  if (typeof config.options === 'object' && config.options !== null) {
    for (const p in config.options) {
      if (!(p in excludedProperties)) {
        settings[p] = config.options[p];
      } else {
        g.warn('Property `%s` cannot be reconfigured for `%s`',
          p, modelName);
      }
    }
  } else if (config.options != null) {
    g.warn('The options property of `%s` configuration ' +
      'must be an object', modelName);
  }

  // It's important to attach the datasource after we have updated
  // configuration, so that the datasource picks up updated relations
  if (config.dataSource) {
    assert(config.dataSource instanceof DataSource,
      'Cannot configure ' + ModelCtor.modelName +
        ': config.dataSource must be an instance of DataSource');
    ModelCtor.attachTo(config.dataSource);
    debug('Attached model `%s` to dataSource `%s`',
      modelName, config.dataSource.name);
  } else if (config.dataSource === null || config.dataSource === false) {
    debug('Model `%s` is not attached to any DataSource by configuration.',
      modelName);
  } else {
    debug('Model `%s` is not attached to any DataSource, possibly by a mistake.',
      modelName);
    g.warn(
      'The configuration of `%s` is missing {{`dataSource`}} property.\n' +
      'Use `null` or `false` to mark models not attached to any data source.',
      modelName,
    );
  }

  const newMethodNames = config.methods && Object.keys(config.methods);
  const hasNewMethods = newMethodNames && newMethodNames.length;
  const hasDescendants = this.getModelByType(ModelCtor) !== ModelCtor;
  if (hasNewMethods && hasDescendants) {
    g.warn(
      'Child models of `%s` will not inherit newly defined remote methods %s.',
      modelName, newMethodNames,
    );
  }

  // Remote methods
  this._defineRemoteMethods(ModelCtor, config.methods);
};

Registry.prototype._defineRemoteMethods = function(ModelCtor, methods) {
  if (!methods) return;
  if (typeof methods !== 'object') {
    g.warn('Ignoring non-object "methods" setting of "%s".',
      ModelCtor.modelName);
    return;
  }

  Object.keys(methods).forEach(function(key) {
    let meta = methods[key];
    const m = key.match(/^prototype\.(.*)$/);
    const isStatic = !m;

    if (typeof meta.isStatic !== 'boolean') {
      key = isStatic ? key : m[1];
      meta = Object.assign({}, meta, {isStatic});
    } else if (meta.isStatic && m) {
      throw new Error(g.f('Remoting metadata for %s.%s {{"isStatic"}} does ' +
      'not match new method name-based style.', ModelCtor.modelName, key));
    } else {
      key = isStatic ? key : m[1];
      deprecated(g.f('Remoting metadata {{"isStatic"}} is deprecated. Please ' +
      'specify {{"prototype.name"}} in method name instead for {{isStatic=false}}.'));
    }
    ModelCtor.remoteMethod(key, meta);
  });
};

/**
 * Look up a model class by name from all models created by
 * `loopback.createModel()`
 * @param {String|Function} modelOrName The model name or a `Model` constructor.
 * @returns {Model} The model class
 *
 * @header loopback.findModel(modelName)
 */
Registry.prototype.findModel = function(modelName) {
  if (typeof modelName === 'function') return modelName;
  return this.modelBuilder.models[modelName];
};

/**
 * Look up a model class by name from all models created by
 * `loopback.createModel()`. **Throw an error when no such model exists.**
 *
 * @param {String} modelOrName The model name or a `Model` constructor.
 * @returns {Model} The model class
 *
 * @header loopback.getModel(modelName)
 */
Registry.prototype.getModel = function(modelName) {
  const model = this.findModel(modelName);
  if (model) return model;

  throw new Error(g.f('Model not found: %s', modelName));
};

/**
 * Look up a model class by the base model class.
 * The method can be used by LoopBack
 * to find configured models in models.json over the base model.
 * @param {Model} modelType The base model class
 * @returns {Model} The subclass if found or the base class
 *
 * @header loopback.getModelByType(modelType)
 */
Registry.prototype.getModelByType = function(modelType) {
  const type = typeof modelType;
  const accepted = ['function', 'string'];

  assert(accepted.indexOf(type) > -1,
    'The model type must be a constructor or model name');

  if (type === 'string') {
    modelType = this.getModel(modelType);
  }

  const models = this.modelBuilder.models;
  for (const m in models) {
    if (models[m].prototype instanceof modelType) {
      return models[m];
    }
  }
  return modelType;
};

/**
 * Create a data source with passing the provided options to the connector.
 *
 * @param {String} name Optional name.
 * @options {Object} options Data Source options
 * @property {Object} connector LoopBack connector.
 * @property {*} [*] Other&nbsp;connector properties.
 *   See the relevant connector documentation.
 */

Registry.prototype.createDataSource = function(name, options) {
  const self = this;

  const ds = new DataSource(name, options, self.modelBuilder);
  ds.createModel = function(name, properties, settings) {
    settings = settings || {};
    let BaseModel = settings.base || settings.super;
    if (!BaseModel) {
      // Check the connector types
      const connectorTypes = ds.getTypes();
      if (Array.isArray(connectorTypes) && connectorTypes.indexOf('db') !== -1) {
        // Only set up the base model to PersistedModel if the connector is DB
        BaseModel = self.PersistedModel;
      } else {
        BaseModel = self.Model;
      }
      settings.base = BaseModel;
    }
    const ModelCtor = self.createModel(name, properties, settings);
    ModelCtor.attachTo(ds);
    return ModelCtor;
  };

  if (ds.settings && ds.settings.defaultForType) {
    const msg = g.f('{{DataSource}} option {{"defaultForType"}} is no longer supported');
    throw new Error(msg);
  }

  return ds;
};

/**
 * Get an in-memory data source. Use one if it already exists.
 *
 * @param {String} [name] The name of the data source.
 * If not provided, the `'default'` is used.
 */

Registry.prototype.memory = function(name) {
  name = name || 'default';
  let memory = (
    this._memoryDataSources || (this._memoryDataSources = {})
  )[name];

  if (!memory) {
    memory = this._memoryDataSources[name] = this.createDataSource({
      connector: 'memory',
    });
  }

  return memory;
};

Registry.prototype.detachModel = function(modelName, app) {
  // Get a reference to the model before removing it from the registry
  const modelToDetach = this.modelBuilder.models[modelName];
  if (!modelToDetach) {
    debug('Model %s not found, nothing to detach', modelName);
    return;
  }

  debug('Detaching model %s', modelName);

  // Keep track of visited objects to prevent infinite recursion
  const visited = new WeakSet();

  // Helper function to deeply clean an object
  const deepClean = (obj, maxDepth = 3, currentDepth = 0) => {
    if (!obj || typeof obj !== 'object' || visited.has(obj) || currentDepth > maxDepth) {
      return;
    }

    // Mark as visited to prevent circular references issues
    visited.add(obj);

    // Clean each property
    Object.keys(obj).forEach(key => {
      const prop = obj[key];

      // Check if this property points to our model
      if (prop === modelToDetach) {
        obj[key] = null;
        return;
      }

      // If the property is an object/array, recursively clean it
      if (prop && typeof prop === 'object') {
        // Handle arrays
        if (Array.isArray(prop)) {
          for (let i = 0; i < prop.length; i++) {
            if (prop[i] === modelToDetach) {
              prop[i] = null;
            } else if (prop[i] && typeof prop[i] === 'object') {
              deepClean(prop[i], maxDepth, currentDepth + 1);
            }
          }
        } else {
          // Handle normal objects
          deepClean(prop, maxDepth, currentDepth + 1);
        }
      }

      // For functions that might be closures holding references
      if (typeof prop === 'function' && key !== 'constructor') {
        obj[key] = null;
      }
    });
  };

  // Helper function specifically for cleaning relation objects
  const cleanRelationObject = (relation) => {
    if (!relation || typeof relation !== 'object' || visited.has(relation)) {
      return;
    }

    visited.add(relation);

    // Clear direct model references
    if (relation.modelTo === modelToDetach) relation.modelTo = null;
    if (relation.modelFrom === modelToDetach) relation.modelFrom = null;

    // Clean all object properties recursively (up to depth 5 for relations)
    Object.keys(relation).forEach(key => {
      const value = relation[key];

      // Skip primitives and already handled references
      if (!value || typeof value !== 'object' || visited.has(value)) return;

      // If it's an object containing properties that might have nested references
      if (typeof value === 'object') {
        deepClean(value, 5);
      }

      // For any remaining complex objects, just null them
      if (key !== 'modelTo' && key !== 'modelFrom' && typeof value === 'object') {
        relation[key] = null;
      }
    });
  };

  // Remove from the registry's models collection
  delete this.modelBuilder.models[modelName];

  // ----- ENHANCED CLEANUP PROCESS -----

  // 1. Clean up RemotingMetadata (SharedClass and SharedMethods)
  if (modelToDetach.sharedClass) {
    const sharedClass = modelToDetach.sharedClass;

    // Find the app reference through multiple possible paths
    let app;

    // Try to find app using different paths
    if (sharedClass.ctor && sharedClass.ctor.app) {
      app = sharedClass.ctor.app;
    } else if (sharedClass.app) {
      app = sharedClass.app;
    } else if (modelToDetach.constructor && modelToDetach.constructor.app) {
      app = modelToDetach.constructor.app;
    } else if (modelToDetach.dataSource && modelToDetach.dataSource.app) {
      app = modelToDetach.dataSource.app;
    }

    // Clean up remotes if we found an app reference
    if (app && app.remotes) {
      if (app.remotes.classes) {
        const idx = app.remotes.classes.indexOf(sharedClass);
        if (idx !== -1) {
          app.remotes.classes.splice(idx, 1);
        }
      }

      // Also clean up from exports which can retain references
      if (app.remotes.exports && app.remotes.exports[modelName]) {
        delete app.remotes.exports[modelName];
      }
    } else {
      // If we can't find the app, try to clean shared class references directly
      debug('App reference not found, attempting direct sharedClass cleanup');

      // If there's a parent registry with remotes, try to clean up there
      if (this.parent && this.parent.remotes && this.parent.remotes.classes) {
        const idx = this.parent.remotes.classes.indexOf(sharedClass);
        if (idx !== -1) {
          this.parent.remotes.classes.splice(idx, 1);
        }
      }

      // Try to find remotes directly on registry
      if (this.remotes && this.remotes.classes) {
        const idx = this.remotes.classes.indexOf(sharedClass);
        if (idx !== -1) {
          this.remotes.classes.splice(idx, 1);
        }
      }
    }

    // Enhanced SharedMethod cleanup - thoroughly break all method references
    if (sharedClass._methods) {
      sharedClass._methods.forEach(method => {
        if (method.ctor) method.ctor = null;
        if (method.fn) method.fn = null;
        if (method.resolver) method.resolver = null;

        // Clear accept definitions which might contain closures
        if (method.accepts) {
          method.accepts.forEach(accept => {
            if (accept.resolver) accept.resolver = null;
            Object.keys(accept).forEach(key => {
              if (typeof accept[key] === 'function') {
                accept[key] = null;
              }
            });
          });
          method.accepts = [];
        }

        // Clear return definitions
        if (method.returns) {
          method.returns.forEach(ret => {
            if (ret.resolver) ret.resolver = null;
            Object.keys(ret).forEach(key => {
              if (typeof ret[key] === 'function') {
                ret[key] = null;
              }
            });
          });
          method.returns = [];
        }

        // Nullify all other properties that could hold references
        Object.keys(method).forEach(key => {
          if (!['name', 'isStatic', 'http'].includes(key) &&
              (typeof method[key] === 'function' ||
               typeof method[key] === 'object')) {
            method[key] = null;
          }
        });
      });

      // Clear the methods array
      sharedClass._methods = [];
    }
    delete sharedClass.methods


    // Clean up SharedClass properties
    Object.keys(sharedClass).forEach(key => {
      if (key !== '_disableRemoting' &&
          (typeof sharedClass[key] === 'function' ||
           typeof sharedClass[key] === 'object')) {
        sharedClass[key] = null;
      }
    });

    sharedClass._disableRemoting = true;
    modelToDetach.sharedClass = null;
  }

  // 2. Clean up relation definitions - thoroughly break all links
  if (modelToDetach.relations) {
    Object.keys(modelToDetach.relations).forEach(relationName => {
      const relation = modelToDetach.relations[relationName];
      if (!relation) return;

      // Clean up the related model's relation pointing back to this model
      if (relation.modelTo && relation.modelTo !== modelToDetach) {
        // Handle case where the relation points to same model (self-relation)
        const relatedModel = relation.modelTo;

        if (relatedModel.relations) {
          // Find and clean reverse relations that point to the model being detached
          Object.keys(relatedModel.relations).forEach(otherRelName => {
            const otherRel = relatedModel.relations[otherRelName];
            if (otherRel && otherRel.modelTo === modelToDetach) {
              debug('Cleaning reverse relation %s from %s', otherRelName, relatedModel.modelName);
              cleanRelationObject(otherRel);
              delete relatedModel.relations[otherRelName];
            }
          });
        }
      }

      // Use our helper to deeply clean the relation object
      cleanRelationObject(relation);
    });

    // Clear all relations
    delete modelToDetach.relations;
  }

  // 3. Special cleanup for RelationDefinition references
  if (modelToDetach.modelFrom) {
    // Clean up any ModelFrom relationships
    if (Array.isArray(modelToDetach.modelFrom)) {
      modelToDetach.modelFrom.forEach(def => {
        if (def && typeof def === 'object') {
          // Use our deep cleaning helper
          deepClean(def, 5);
        }
      });
    } else if (modelToDetach.modelFrom && typeof modelToDetach.modelFrom === 'object') {
      deepClean(modelToDetach.modelFrom, 5);
    }
    modelToDetach.modelFrom = null;
  }

  // Find and clean all RelationDefinition instances that might reference this model
  Object.keys(this.modelBuilder.models || {}).forEach(otherModelName => {
    const otherModel = this.modelBuilder.models[otherModelName];
    if (!otherModel) return;

    // Check if other models have relationDefinitions referencing this model
    if (otherModel.modelFrom) {
      // Ensure it's always treated as an array
      const modelFromArray = Array.isArray(otherModel.modelFrom) ?
        otherModel.modelFrom : [otherModel.modelFrom];

      // Filter out references to the detached model
      otherModel.modelFrom = modelFromArray.filter(def => {
        if (!def) return false;

        // Check if this definition references our model
        let referencesModel = false;
        if (def.modelTo === modelToDetach ||
            def.modelFrom === modelToDetach ||
            def.model === modelToDetach ||
            def.modelName === modelName) {
          referencesModel = true;
        }

        // Also check nested references using our deep clean helper
        if (referencesModel) {
          deepClean(def, 5);
          return false; // Remove from array
        }

        return true; // Keep in array
      });

      // Clean any remaining modelFrom references that might indirectly reference our model
      if (Array.isArray(otherModel.modelFrom)) {
        otherModel.modelFrom.forEach(def => {
          if (def && typeof def === 'object') {
            // Look for nested references and clean them
            Object.keys(def).forEach(key => {
              const val = def[key];
              if (val && typeof val === 'object' && !visited.has(val)) {
                deepClean(val, 4);
              }
            });
          }
        });
      }
    }

    // Also check relations on other models that might reference our model indirectly
    if (otherModel.relations) {
      Object.keys(otherModel.relations).forEach(relationName => {
        const relation = otherModel.relations[relationName];
        if (!relation) return;

        // Check if this relation indirectly references our model through nested properties
        let props = Object.keys(relation).filter(k =>
          relation[k] && typeof relation[k] === 'object' && k !== 'modelTo' && k !== 'modelFrom');

        props.forEach(propName => {
          if (!visited.has(relation[propName])) {
            deepClean(relation[propName], 5);
          }
        });
      });
    }
  });

  // 4. Clean up scope definitions - ScopeDefinition instances
  if (modelToDetach.scopes) {
    Object.keys(modelToDetach.scopes).forEach(scopeName => {
      const scope = modelToDetach.scopes[scopeName];
      if (!scope) return;

      // Use our generic deep clean helper for ScopeDefinition
      deepClean(scope, 5);

      // Special handling for specific scope properties
      if (scope.definition) scope.definition = null;
      if (scope.model) scope.model = null;
      // if (scope.targetModel) scope.targetModel = null;
      if (scope.methods) scope.methods = {};
    });
    modelToDetach.scopes = {};
  }

  // 5. Remove from dataSource if still attached
  if (modelToDetach.dataSource) {
    const ds = modelToDetach.dataSource;

    // Remove from connector models if present
    if (ds.connector && ds.connector.models && ds.connector.models[modelName]) {
      delete ds.connector.models[modelName];
    }

    // Remove from dataSource models if present
    if (ds.models && ds.models[modelName]) {
      delete ds.models[modelName];
    }

    // Clear any model-specific settings in the dataSource
    if (ds.settings && ds.settings.models && ds.settings.models[modelName]) {
      delete ds.settings.models[modelName];
    }

    // Clean up any references to this model in the dataSource's juggler
    if (ds.constructor && ds.constructor.modelBuilder &&
        ds.constructor.modelBuilder.models &&
        ds.constructor.modelBuilder.models[modelName]) {
      delete ds.constructor.modelBuilder.models[modelName];
    }

    // Remove any registered model observers
    if (ds.constructor && ds.constructor.observers) {
      Object.keys(ds.constructor.observers).forEach(event => {
        if (!Array.isArray(ds.constructor.observers[event])) return;

        const observers = ds.constructor.observers[event];
        const newObservers = observers.filter(o =>
          !(o.model === modelName || o.model === modelToDetach));
        ds.constructor.observers[event] = newObservers;
      });
    }

    // Special handling for MongoDB connector
    if (ds.connector && ds.connector.dataSource === ds) {
      // MongoDB-specific collection cleanup
      if (ds.connector.collection && typeof ds.connector.collection === 'function') {
        try {
          // Safe attempt to release MongoDB collection references
          const collection = ds.connector.collection(modelName);
          if (collection) {
            // More thorough MongoDB collection cleanup
            if (collection._collection) {
              // Clean MongoDB native collection references
              if (collection._collection.s) {
                collection._collection.s = null;
              }
              if (collection._collection.namespace) {
                collection._collection.namespace = null;
              }
              if (collection._collection.opts) {
                collection._collection.opts = null;
              }
              collection._collection = null;
            }

            // Clear MongoDB indices which often hold model references
            if (collection._indices) {
              collection._indices = [];
            }

            // Clear any command listeners
            if (collection.listeners) {
              collection.removeAllListeners();
            }

            // Clean any other properties that might hold references
            deepClean(collection, 3);
          }
        } catch (e) {
          debug('Error cleaning MongoDB collection: %s', e.message);
        }
      }
    }

    // Clear the dataSource reference
    modelToDetach.dataSource = null;
  }

  // 6. Clean up any model event listeners
  if (typeof modelToDetach.removeAllListeners === 'function') {
    modelToDetach.removeAllListeners();
  }

  // 7. Clean up inheritance relationships
  if (modelToDetach.__proto__ && modelToDetach.__proto__.modelName) {
    // Break reference to parent model
    const baseModelName = modelToDetach.__proto__.modelName;
    debug('Breaking inheritance from base model %s', baseModelName);
    // We can't fully delete __proto__ but we can minimize its content
    Object.setPrototypeOf(modelToDetach, Object.prototype);
  }

  // 8. Clear settings that might contain references
  if (modelToDetach.settings) {
    // Save a few primitive settings but clear complex objects
    const primitiveSettings = {};
    ['name', 'strict', 'idInjection', 'public'].forEach(key => {
      if (modelToDetach.settings[key] !== undefined) {
        primitiveSettings[key] = modelToDetach.settings[key];
      }
    });
    modelToDetach.settings = primitiveSettings;
  }

  // 9. Clean up definition object
  if (modelToDetach.definition) {
    const definition = modelToDetach.definition;
  }

  // 10. Clean up static methods and properties
  for (const key in modelToDetach) {
    // Skip the basic properties that shouldn't cause memory leaks
    if (['modelName', 'name', 'definition', 'settings'].includes(key)) continue;

    // Enhanced PropertyCtrl detection
    const value = modelToDetach[key];
    const isPropertyCtrl = value && typeof value === 'object' && (
      // Check for PropertyCtrl indicators - multiple detection strategies
      (value.__proto__ && value.__proto__.constructor &&
       (value.__proto__.constructor.name === 'PropertyCtrl' ||
        value.__proto__.constructor.name === 'Property')) ||
      // Alternative detection via property inspection
      (typeof value.propertyName === 'string' &&
       typeof value.define === 'function' &&
       typeof value.getDefault === 'function') ||
      // Check by pattern of keys
      (value._model && value._name && value._type) ||
      // Detect by structure
      (value.model && value.name && value.type && value.id) ||
      // Check for presence in the path shown in heap snapshot
      key === 'propertyCtrl' || key.endsWith('Ctrl')
    );

    if (isPropertyCtrl) {
      debug('Clearing PropertyCtrl reference: %s', key);

      // More thorough cleaning
      if (value._model) value._model = null;
      if (value.model) value.model = null;
      if (value.related) value.related = null;
      if (value.list) value.list = null;
      if (value.items) value.items = null;
      if (value.fn) value.fn = null;
      if (value.definition) value.definition = null;

      // Remove all function references which could be closures
      Object.keys(value).forEach(propKey => {
        if (typeof value[propKey] === 'function') {
          value[propKey] = null;
        }
        // Also clean nested objects that might contain model references
        if (value[propKey] && typeof value[propKey] === 'object') {
          const nestedObj = value[propKey];
          Object.keys(nestedObj).forEach(nestedKey => {
            if (nestedObj[nestedKey] === modelToDetach) {
              nestedObj[nestedKey] = null;
            }
          });
        }
      });

      // Finally null out the entire property
      modelToDetach[key] = null;
      continue;
    }

    // Remove functions and objects that might contain closures or references
    if (typeof value === 'function' ||
        (typeof value === 'object' && value !== null)) {
      debug('Clearing model static property: %s', key);
      modelToDetach[key] = null;
    }
  }

  // 11. Special handling for anonymous models
  if (modelName.indexOf('AnonymousModel_') === 0) {
    // Anonymous models often have circular references and require special handling

    // Clean up prototype to break inheritance chain
    if (modelToDetach.prototype) {
      // Save reference to constructor
      const oldCtor = modelToDetach.prototype.constructor;

      // Replace with a simple object to break circular references
      modelToDetach.prototype = {
        constructor: oldCtor
      };
    }

    // Try to break constructor chains
    try {
      Object.setPrototypeOf(modelToDetach, Object);
    } catch (e) {
      debug('Could not reset anonymous model prototype: %s', e.message);
    }
  }

  // 12. Handle multitenant context-specific cleanup
  // Check for global context references
  if (global.__loopback_contexts) {
    // Attempt to clear any model references in context objects
    Object.keys(global.__loopback_contexts).forEach(contextKey => {
      const context = global.__loopback_contexts[contextKey];
      if (!context) return;

      // Check all properties for references to this model
      Object.keys(context).forEach(key => {
        if (context[key] === modelToDetach) {
          debug('Cleaned model reference from global context: %s', key);
          context[key] = null;
        }
      });
    });
  }

  // Multitenant specific cleanup for tenant models
  if (global.__tenant_models) {
    // Clean from any tenant contexts
    Object.keys(global.__tenant_models).forEach(tenantId => {
      const tenantModels = global.__tenant_models[tenantId];
      if (tenantModels && tenantModels[modelName]) {
        delete tenantModels[modelName];
        debug('Removed model %s from tenant %s models collection', modelName, tenantId);
      }
    });
  }

  // Clean PropertyCtrl instances in prototype chain
  if (modelToDetach.prototype) {
    for (const key in modelToDetach.prototype) {
      if (key === 'constructor' || key === '__proto__') continue;

      const protoValue = modelToDetach.prototype[key];

      // Check if this might be a PropertyCtrl
      if (protoValue && typeof protoValue === 'object') {
        // Property controllers often have these properties
        if (protoValue._model || protoValue.model ||
            (typeof protoValue.propertyName === 'string') ||
            (protoValue._name && protoValue._type)) {

          debug('Clearing PropertyCtrl in prototype: %s', key);

          // Clean all possible references
          if (protoValue._model) protoValue._model = null;
          if (protoValue.model) protoValue.model = null;
          if (protoValue.definition) protoValue.definition = null;

          // Clean all function references
          Object.keys(protoValue).forEach(propKey => {
            if (typeof protoValue[propKey] === 'function') {
              protoValue[propKey] = null;
            }
          });

          // Replace with empty object to maintain structure but break references
          modelToDetach.prototype[key] = {};
        }
      }
    }
  }

  // Check for globally cached Property controllers in juggler
  try {
    if (juggler && juggler.ModelBuilder && juggler.ModelBuilder.propertyTypes) {
      // This is where globally cached property definitions might be stored
      Object.keys(juggler.ModelBuilder.propertyTypes).forEach(typeName => {
        const propType = juggler.ModelBuilder.propertyTypes[typeName];
        if (propType && propType.modelName === modelName) {
          debug('Clearing global PropertyCtrl reference for type: %s', typeName);
          // Clean model reference but keep type definition
          if (propType.model === modelToDetach) propType.model = null;
        }
      });
    }
  } catch (err) {
    debug('Error cleaning global PropertyCtrl references: %s', err.message);
  }

  // 13. Clean up middleware references
  if (app && app.middleware) {
    debug('Cleaning up middleware references');
    Object.keys(app.middleware).forEach(phase => {
      const middlewareList = app.middleware[phase];
      if (Array.isArray(middlewareList)) {
        middlewareList.forEach(middleware => {
          if (middleware.model === modelToDetach) {
            debug('Cleaned model reference from middleware in phase %s', phase);
            middleware.model = null;
          }

          // Also check for nested references in middleware options
          if (middleware.options && typeof middleware.options === 'object') {
            Object.keys(middleware.options).forEach(key => {
              if (middleware.options[key] === modelToDetach) {
                middleware.options[key] = null;
              }
            });
          }
        });
      }
    });
  }

  // 14. Clean up application caches
  if (app && app.locals && typeof app.locals === 'object') {
    debug('Cleaning up application local caches');
    Object.keys(app.locals).forEach(key => {
      if (app.locals[key] === modelToDetach) {
        debug('Cleaned model reference from app.locals.%s', key);
        app.locals[key] = null;
      }

      // Also check for nested references in complex objects
      const value = app.locals[key];
      if (value && typeof value === 'object' && !visited.has(value)) {
        deepClean(value, 3);
      }
    });
  }

  // 15. Clean up hooks
  if (modelToDetach._hooks) {
    debug('Cleaning up model hooks');
    // First try to remove all listeners from each hook
    Object.keys(modelToDetach._hooks).forEach(hookType => {
      const hooks = modelToDetach._hooks[hookType];
      if (Array.isArray(hooks)) {
        // Clear each hook function which might contain closures
        hooks.forEach((hook, index) => {
          if (typeof hook === 'function') {
            hooks[index] = null;
          } else if (hook && typeof hook === 'object') {
            // Some hooks might be objects with a fn property
            if (hook.fn) hook.fn = null;
          }
        });
      }
    });

    // Then clear the entire hooks collection
    modelToDetach._hooks = {};
  }

  // 16. Clean up validation contexts
  if (modelToDetach.validations) {
    debug('Cleaning up model validations');

    // First clean any validation functions which might contain closures
    Object.keys(modelToDetach.validations).forEach(validationName => {
      const validation = modelToDetach.validations[validationName];

      if (Array.isArray(validation)) {
        // Replace each validation function with null
        validation.forEach((validator, index) => {
          if (typeof validator === 'function') {
            validation[index] = null;
          } else if (validator && typeof validator === 'object') {
            // Some validators might be objects with properties
            Object.keys(validator).forEach(key => {
              if (typeof validator[key] === 'function') {
                validator[key] = null;
              }
            });
          }
        });
      }
    });

    // Then clear the entire validations collection
    modelToDetach.validations = {};
  }

  // 17. Clean up any Express route handlers that might reference the model
  if (app && app._router && app._router.stack) {
    debug('Checking Express route handlers for model references');

    // We can't directly modify the route handlers as they're functions
    // But we can look for route.controller properties that might reference our model
    app._router.stack.forEach(route => {
      if (route.route) {
        // Check if this route has a controller property referencing our model
        if (route.route.controller === modelToDetach) {
          debug('Found route handler referencing model, clearing controller reference');
          route.route.controller = null;
        }

        // Also check for model references in route.keys
        if (route.keys && Array.isArray(route.keys)) {
          route.keys.forEach(key => {
            if (key && key.model === modelToDetach) {
              key.model = null;
            }
          });
        }
      }
    });
  }

  debug('Model %s completely detached and all references cleaned', modelName);
};
