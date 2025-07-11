// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module dependencies.
 */

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const ejs = require('ejs');
const juggler = require('loopback-datasource-juggler');
const errorHandler = require('strong-error-handler');
const loopbackExpress = require('./server-app');
const proto = require('./application');
const Registry = require('./registry');
const configureSharedMethods = require('./configure-shared-methods');

/**
 * LoopBack core module. It provides static properties and
 * methods to create models and data sources. The module itself is a function
 * that creates loopback `app`. For example:
 *
 * ```js
 * var loopback = require('loopback');
 * var app = loopback();
 * ```
 *
 * @property {String} version Version of LoopBack framework.  Static read-only property.
 * @property {Boolean} isBrowser True if running in a browser environment; false otherwise.  Static read-only property.
 * @property {Boolean} isServer True if running in a server environment; false otherwise.  Static read-only property.
 * @property {Registry} registry The global `Registry` object.
 * @property {String} faviconFile Path to a default favicon shipped with LoopBack.
 * Use as follows: `app.use(require('serve-favicon')(loopback.faviconFile));`
 * @class loopback
 * @header loopback
 */

const loopback = module.exports = createApplication;

/*!
 * Framework version.
 */

loopback.version = require('../package.json').version;

loopback.registry = new Registry();

Object.defineProperties(loopback, {
  Model: {
    get: function() { return this.registry.getModel('Model'); },
  },
  PersistedModel: {
    get: function() { return this.registry.getModel('PersistedModel'); },
  },
  defaultDataSources: {
    get: function() { return this.registry.defaultDataSources; },
  },
  modelBuilder: {
    get: function() { return this.registry.modelBuilder; },
  },
});

/*!
 * Create an loopback application.
 *
 * @return {Function}
 * @api public
 */

function createApplication(options) {
  const app = loopbackExpress();

  Object.assign(app, proto);

  app.loopback = loopback;

  // Express v5 compatibility: Configure query parser for backward compatibility
  // Express v5 changed default from "extended" to "simple"
  app.set('query parser', 'extended');

  app.on('modelRemoted', function() {
    app.models().forEach(function(Model) {
      if (!Model.config) return;
      configureSharedMethods(Model, app.get('remoting'), Model.config);
    });
  });

  // Create a new instance of models registry per each app instance
  app.models = function() {
    return proto.models.apply(this, arguments);
  };

  // Create a new instance of datasources registry per each app instance
  app.datasources = app.dataSources = {};

  // Create a new instance of connector registry per each app instance
  app.connectors = {};

  // Register built-in connectors. It's important to keep this code
  // hand-written, so that all require() calls are static
  // and thus browserify can process them (include connectors in the bundle)
  app.connector('memory', loopback.Memory);
  app.connector('remote', loopback.Remote);
  app.connector('kv-memory',
    require('loopback-datasource-juggler/lib/connectors/kv-memory'));

  if (loopback.localRegistry || options && options.localRegistry === true) {
    // setup the app registry
    const registry = app.registry = new Registry();
    if (options && options.loadBuiltinModels === true) {
      require('./builtin-models')(registry);
    }
  } else {
    app.registry = loopback.registry;
  }

  return app;
}

function mixin(source) {
  for (const key in source) {
    const desc = Object.getOwnPropertyDescriptor(source, key);

    // Fix for legacy (pre-ES5) browsers like PhantomJS
    if (!desc) continue;

    Object.defineProperty(loopback, key, desc);
  }
}

mixin(require('./runtime'));

/*!
 * Expose static express methods like `express.Router`.
 */

mixin(express);

/*!
 * Express v5 compatibility: Add missing properties and methods
 */
// Add query property that tests expect (Express v5 changed query parsing)
if (!loopback.query) {
  // Express v5 uses a different query parser, provide a compatible one
  loopback.query = require('qs');
}

// Express v5 removed req.param() method, add it back for compatibility
if (!express.request.param) {
  express.request.param = function(name, defaultValue) {
    const params = this.params || {};
    const body = this.body || {};
    const query = this.query || {};

    if (params[name] != null && params.hasOwnProperty(name)) return params[name];
    if (body[name] != null && body.hasOwnProperty(name)) return body[name];
    if (query[name] != null && query.hasOwnProperty(name)) return query[name];

    return defaultValue;
  };
}

/*!
 * Expose additional loopback middleware
 * for example `loopback.configure` etc.
 *
 * ***only in node***
 */

if (loopback.isServer) {
  fs
    .readdirSync(path.join(__dirname, '..', 'server', 'middleware'))
    .filter(function(file) {
      return file.match(/\.js$/);
    })
    .forEach(function(m) {
      loopback[m.replace(/\.js$/, '')] = require('../server/middleware/' + m);
    });

  loopback.urlNotFound = loopback['url-not-found'];
  delete loopback['url-not-found'];

  loopback.errorHandler = errorHandler;
}

// Expose path to the default favicon file
// ***only in node***

if (loopback.isServer) {
  /*!
   * Path to a default favicon shipped with LoopBack.
   *
   * **Example**
   *
   * ```js
   * app.use(require('serve-favicon')(loopback.faviconFile));
   * ```
   */
  loopback.faviconFile = path.resolve(__dirname, '../favicon.ico');
}

/**
 * Add a remote method to a model.
 * @param {Function} fn
 * @param {Object} options (optional)
 */

loopback.remoteMethod = function(fn, options) {
  fn.shared = true;
  if (typeof options === 'object') {
    Object.keys(options).forEach(function(key) {
      fn[key] = options[key];
    });
  }
  fn.http = fn.http || {verb: 'get'};
};

/**
 * Create a template helper.
 *
 *     var render = loopback.template('foo.ejs');
 *     var html = render({foo: 'bar'});
 *
 * @param {String} file Path to the template file.
 * @returns {Function}
 */

loopback.template = function(file) {
  const templates = this._templates || (this._templates = {});
  const str = templates[file] || (templates[file] = fs.readFileSync(file, 'utf8'));
  return ejs.compile(str, {
    filename: file,
  });
};

require('../lib/current-context')(loopback);

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

loopback.createModel = function(name, properties, options) {
  return this.registry.createModel.apply(this.registry, arguments);
};

/**
 * Alter an existing Model class.
 * @param {Model} ModelCtor The model constructor to alter.
 * @options {Object} config Additional configuration to apply
 * @property {DataSource} dataSource Attach the model to a dataSource.
 * @property {Object} [relations] Model relations to add/update.
 *
 * @header loopback.configureModel(ModelCtor, config)
 */

loopback.configureModel = function(ModelCtor, config) {
  return this.registry.configureModel.apply(this.registry, arguments);
};

/**
 * Look up a model class by name from all models created by
 * `loopback.createModel()`
 * @param {String} modelName The model name
 * @returns {Model} The model class
 *
 * @header loopback.findModel(modelName)
 */
loopback.findModel = function(modelName) {
  return this.registry.findModel.apply(this.registry, arguments);
};

/**
 * Look up a model class by name from all models created by
 * `loopback.createModel()`. Throw an error when no such model exists.
 *
 * @param {String} modelName The model name
 * @returns {Model} The model class
 *
 * @header loopback.getModel(modelName)
 */
loopback.getModel = function(modelName) {
  return this.registry.getModel.apply(this.registry, arguments);
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
loopback.getModelByType = function(modelType) {
  return this.registry.getModelByType.apply(this.registry, arguments);
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

loopback.createDataSource = function(name, options) {
  return this.registry.createDataSource.apply(this.registry, arguments);
};

/**
 * Get an in-memory data source. Use one if it already exists.
 *
 * @param {String} [name] The name of the data source.
 * If not provided, the `'default'` is used.
 */

loopback.memory = function(name) {
  return this.registry.memory.apply(this.registry, arguments);
};
/*!
 * Built in models / services
 */

require('./builtin-models')(loopback);

loopback.DataSource = juggler.DataSource;

/**
 * Check if the centralized model registry is available and provide migration guidance.
 * This utility helps developers understand if they can use the new owner-aware ModelRegistry methods.
 *
 * @returns {Object} Information about centralized model registry availability
 */
loopback.checkModelRegistrySupport = function() {
  const { ModelRegistry } = require('loopback-datasource-juggler');
  const hasOwnerAwareMethods = typeof ModelRegistry.getModelsForOwner === 'function';

  // Create API aliases to match documented signatures if they don't exist
  if (hasOwnerAwareMethods && !ModelRegistry._aliasesCreated) {
    // Store original methods
    const originalGetModelsForOwner = ModelRegistry.getModelsForOwner;
    const originalGetModelNamesForOwner = ModelRegistry.getModelNamesForOwner;
    const originalHasModelForOwner = ModelRegistry.hasModelForOwner;
    const originalGetModelForOwner = ModelRegistry.getModelForOwner;

    // Create documented API signatures as aliases
    ModelRegistry.getModelsForOwner = function(owner, ownerType) {
      if (arguments.length === 2) {
        // Use explicit API for both App and DataSource ownership
        return ModelRegistry.getModelsForOwnerWithType(owner, ownerType);
      } else {
        // Use simplified API (auto-detect owner type)
        return originalGetModelsForOwner.call(this, owner);
      }
    };

    ModelRegistry.getModelNamesForOwner = function(owner, ownerType) {
      if (arguments.length === 2) {
        // Use explicit API for both App and DataSource ownership
        return ModelRegistry.getModelNamesForOwnerWithType(owner, ownerType);
      } else {
        // Use simplified API (auto-detect owner type)
        return originalGetModelNamesForOwner.call(this, owner);
      }
    };

    ModelRegistry.hasModelForOwner = function(owner, modelName, ownerType) {
      if (arguments.length === 3) {
        // Use explicit API for both App and DataSource ownership
        return ModelRegistry.hasModelForOwnerWithType(owner, modelName, ownerType);
      } else {
        // Use simplified API (auto-detect owner type)
        return originalHasModelForOwner.call(this, owner, modelName);
      }
    };

    ModelRegistry.getModelForOwner = function(owner, modelName, ownerType) {
      if (arguments.length === 3) {
        // Use explicit API for both App and DataSource ownership
        return ModelRegistry.getModelForOwnerWithType(owner, modelName, ownerType);
      } else {
        // Use simplified API (auto-detect owner type)
        return originalGetModelForOwner.call(this, owner, modelName);
      }
    };

    ModelRegistry._aliasesCreated = true;
  }

  return {
    available: hasOwnerAwareMethods,
    version: require('loopback-datasource-juggler/package.json').version,
    recommendation: hasOwnerAwareMethods ?
      'Centralized model registry is available. Consider using ModelRegistry.getModelsForOwner() and related methods for better performance.' :
      'Centralized model registry is not available. Consider upgrading loopback-datasource-juggler to version 5.2.2 or later.',
    methods: hasOwnerAwareMethods ? [
      'ModelRegistry.getModelsForOwner(owner)',
      'ModelRegistry.getModelNamesForOwner(owner)',
      'ModelRegistry.hasModelForOwner(owner, modelName)',
      'ModelRegistry.getModelForOwner(owner, modelName)'
    ] : []
  };
};

// Initialize the centralized model registry aliases on module load
loopback.checkModelRegistrySupport();
