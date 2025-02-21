// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module Dependencies.
 */
'use strict'
const g = require('./globalize')
const runtime = require('./runtime')
const assert = require('assert')
const async = require('async')
const deprecated = require('depd')('loopback')
const debug = require('debug')('loopback:persisted-model')
const PassThrough = require('stream').PassThrough
const utils = require('./utils')
const filterNodes = require('loopback-filters')
const util = require('util')

const REPLICATION_CHUNK_SIZE = -1

module.exports = function(registry) {
  const Model = registry.getModel('Model')

  /**
   * Extends Model with basic query and CRUD support.
   *
   * **Change Event**
   *
   * Listen for model changes using the `change` event.
   *
   * ```js
   * MyPersistedModel.on('changed', function(obj) {
   *    console.log(obj) // => the changed model
   * });
   * ```
   *
   * @class PersistedModel
   */

  const PersistedModel = Model.extend('PersistedModel')

  /*!
   * Setup the `PersistedModel` constructor.
   */

  PersistedModel.setup = function setupPersistedModel() {
    // call Model.setup first
    Model.setup.call(this)

    const PersistedModel = this

    // enable change tracking (usually for replication)
    if (this.settings.trackChanges) {
      PersistedModel._defineChangeModel()
      PersistedModel.once('dataSourceAttached', function() {
        PersistedModel.enableChangeTracking()
      })
    } else if (this.settings.enableRemoteReplication) {
      PersistedModel._defineChangeModel()
    }

    PersistedModel.setupRemoting()
  }

  /*!
   * Throw an error telling the user that the method is not available and why.
   */

  function throwNotAttached(modelName, methodName) {
    throw new Error(
      g.f('Cannot call %s.%s().' +
      ' The %s method has not been setup.' +
      ' The {{PersistedModel}} has not been correctly attached to a {{DataSource}}!',
      modelName, methodName, methodName),
    )
  }

  /*!
   * Convert null callbacks to 404 error objects.
   * @param  {HttpContext} ctx
   */

  async function convertNullToNotFoundError(ctx) {
    if (ctx.result !== null) return

    const modelName = ctx.method.sharedClass.name
    const id = ctx.getArgByName('id')
    const msg = g.f('Unknown "%s" {{id}} "%s".', modelName, id)
    const error = new Error(msg)
    error.statusCode = error.status = 404
    error.code = 'MODEL_NOT_FOUND'
    throw error
  }

  /**
   * Create new instance of Model, and save to database.
   *
   * @param {Object|Object[]} [data] Optional data argument.  Can be either a single model instance or an array of instances.
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} models Model instances or null.
   */

  PersistedModel.create = async function(data, options = {}) {
    throwNotAttached(this.modelName, 'create')
  }

  /**
   * Update or insert a model instance
   * @param {Object} data The model instance data to insert.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} model Updated model instance.
   */

  PersistedModel.upsert = PersistedModel.updateOrCreate = PersistedModel.patchOrCreate =
  async function upsert(data) {
    throwNotAttached(this.modelName, 'upsert')
  }

  /**
   * Update or insert a model instance based on the search criteria.
   * If there is a single instance retrieved, update the retrieved model.
   * Creates a new model if no model instances were found.
   * Returns an error if multiple instances are found.
   * @param {Object} [where]  `where` filter, like
   * ```
   * { key: val, key2: {gt: 'val2'}, ...}
   * ```
   * <br/>see
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-other-methods).
   * @param {Object} data The model instance data to insert.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} model Updated model instance.
   */

  PersistedModel.upsertWithWhere =
  PersistedModel.patchOrCreateWithWhere = async function upsertWithWhere(where, data) {
    throwNotAttached(this.modelName, 'upsertWithWhere')
  }

  /**
   * Replace or insert a model instance; replace existing record if one is found,
   * such that parameter `data.id` matches `id` of model instance; otherwise,
   * insert a new record.
   * @param {Object} data The model instance data.
   * @options {Object} [options] Options for replaceOrCreate
   * @property {Boolean} validate Perform validation before saving.  Default is true.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} model Replaced model instance.
   */

  PersistedModel.replaceOrCreate = async function replaceOrCreate(data) {
    throwNotAttached(this.modelName, 'replaceOrCreate')
  }

  /**
   * Finds one record matching the optional filter object. If not found, creates
   * the object using the data provided as second argument. In this sense it is
   * the same as `find`, but limited to one object. Returns an object, not
   * collection. If you don't provide the filter object argument, it tries to
   * locate an existing object that matches the `data` argument.
   *
   * @options {Object} [filter] Optional Filter object; see below.
   * @property {String|Object|Array} fields Identify fields to include in return result.
   * <br/>See [Fields filter](http://loopback.io/doc/en/lb2/Fields-filter.html).
   * @property {String|Object|Array} include  See PersistedModel.include documentation.
   * <br/>See [Include filter](http://loopback.io/doc/en/lb2/Include-filter.html).
   * @property {Number} limit Maximum number of instances to return.
   * <br/>See [Limit filter](http://loopback.io/doc/en/lb2/Limit-filter.html).
   * @property {String} order Sort order: either "ASC" for ascending or "DESC" for descending.
   * <br/>See [Order filter](http://loopback.io/doc/en/lb2/Order-filter.html).
   * @property {Number} skip Number of results to skip.
   * <br/>See [Skip filter](http://loopback.io/doc/en/lb2/Skip-filter.html).
   * @property {Object} where Where clause, like
   * ```
   * {where: {key: val, key2: {gt: 'val2'}, ...}}
   * ```
   * <br/>See
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-queries).
   * @param {Object} data Data to insert if object matching the `where` filter is not found.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Model instance matching the `where` filter, if found.
   * @param {Boolean} created True if the instance does not exist and gets created.
   */

  PersistedModel.findOrCreate = async function findOrCreate(query, data) {
    throwNotAttached(this.modelName, 'findOrCreate')
  }

  PersistedModel.findOrCreate._delegate = true

  /**
   * Check whether a model instance exists in database.
   *
   * @param {id} id Identifier of object (primary key value).
   *
   * @callback {Function} callback Callback function called with `(err, exists)` arguments.  Required.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Boolean} exists True if the instance with the specified ID exists; false otherwise.
   */

  PersistedModel.exists = async function exists(id) {
    throwNotAttached(this.modelName, 'exists')
  }

  /**
   * Find object by ID with an optional filter for include/fields.
   *
   * @param {*} id Primary key value
   * @options {Object} [filter] Optional Filter JSON object; see below.
   * @property {String|Object|Array} fields Identify fields to include in return result.
   * <br/>See [Fields filter](http://loopback.io/doc/en/lb2/Fields-filter.html).
   * @property {String|Object|Array} include  See PersistedModel.include documentation.
   * <br/>See [Include filter](http://loopback.io/doc/en/lb2/Include-filter.html).
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Model instance matching the specified ID or null if no instance matches.
   */

  PersistedModel.findById = async function findById(id, filter) {
    throwNotAttached(this.modelName, 'findById')
  }

  /**
   * Find all model instances that match `filter` specification.
   * See [Querying models](http://loopback.io/doc/en/lb2/Querying-data.html).
   *
   * @options {Object} [filter] Optional Filter JSON object; see below.
   * @property {String|Object|Array} fields Identify fields to include in return result.
   * <br/>See [Fields filter](http://loopback.io/doc/en/lb2/Fields-filter.html).
   * @property {String|Object|Array} include  See PersistedModel.include documentation.
   * <br/>See [Include filter](http://loopback.io/doc/en/lb2/Include-filter.html).
   * @property {Number} limit Maximum number of instances to return.
   * <br/>See [Limit filter](http://loopback.io/doc/en/lb2/Limit-filter.html).
   * @property {String} order Sort order: either "ASC" for ascending or "DESC" for descending.
   * <br/>See [Order filter](http://loopback.io/doc/en/lb2/Order-filter.html).
   * @property {Number} skip Number of results to skip.
   * <br/>See [Skip filter](http://loopback.io/doc/en/lb2/Skip-filter.html).
   * @property {Object} where Where clause, like
   * ```
   * { where: { key: val, key2: {gt: 'val2'}, ...} }
   * ```
   * <br/>See
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-queries).
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Array} models Model instances matching the filter, or null if none found.
   */

  PersistedModel.find = async function find(filter) {
    throwNotAttached(this.modelName, 'find')
  }

  /**
   * Find one model instance that matches `filter` specification.
   * Same as `find`, but limited to one result;
   * Returns object, not collection.
   *
   * @options {Object} [filter] Optional Filter JSON object; see below.
   * @property {String|Object|Array} fields Identify fields to include in return result.
   * <br/>See [Fields filter](http://loopback.io/doc/en/lb2/Fields-filter.html).
   * @property {String|Object|Array} include  See PersistedModel.include documentation.
   * <br/>See [Include filter](http://loopback.io/doc/en/lb2/Include-filter.html).
   * @property {String} order Sort order: either "ASC" for ascending or "DESC" for descending.
   * <br/>See [Order filter](http://loopback.io/doc/en/lb2/Order-filter.html).
   * @property {Number} skip Number of results to skip.
   * <br/>See [Skip filter](http://loopback.io/doc/en/lb2/Skip-filter.html).
   * @property {Object} where Where clause, like
   * ```
   * {where: { key: val, key2: {gt: 'val2'}, ...} }
   * ```
   * <br/>See
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-queries).
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Array} model First model instance that matches the filter or null if none found.
   */

  PersistedModel.findOne = async function findOne(filter) {
    throwNotAttached(this.modelName, 'findOne')
  }

  /**
   * Destroy all model instances that match the optional `where` specification.
   *
   * @param {Object} [where] Optional where filter, like:
   * ```
   * {key: val, key2: {gt: 'val2'}, ...}
   * ```
   * <br/>See
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-other-methods).
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} info Additional information about the command outcome.
   * @param {Number} info.count Number of instances (rows, documents) destroyed.
   */

  PersistedModel.destroyAll = async function destroyAll(where) {
    throwNotAttached(this.modelName, 'destroyAll')
  }

  /**
   * Alias for `destroyAll`
   */
  PersistedModel.remove = PersistedModel.destroyAll

  /**
   * Alias for `destroyAll`
   */
  PersistedModel.deleteAll = PersistedModel.destroyAll

  /**
   * Update multiple instances that match the where clause.
   *
   * Example:
   *
   *```js
   * Employee.updateAll({managerId: 'x001'}, {managerId: 'x002'}, function(err, info) {
   *     ...
   * });
   * ```
   *
   * @param {Object} [where] Optional `where` filter, like
   * ```
   * { key: val, key2: {gt: 'val2'}, ...}
   * ```
   * <br/>see
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-other-methods).
   * @param {Object} data Object containing data to replace matching instances, if any.
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} info Additional information about the command outcome.
   * @param {Number} info.count Number of instances (rows, documents) updated.
   *
   */ 
  PersistedModel.updateAll = async function updateAll(where, data) {
    throwNotAttached(this.modelName, 'updateAll')
  }

  /**
   * Alias for updateAll.
   */
  PersistedModel.update = PersistedModel.updateAll

  /**
   * Destroy model instance with the specified ID.
   * @param {*} id The ID value of model instance to delete.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   */ 
  PersistedModel.destroyById = async function deleteById(id) {
    throwNotAttached(this.modelName, 'deleteById')
  }

  /**
   * Alias for destroyById.
   */
  PersistedModel.removeById = PersistedModel.destroyById

  /**
   * Alias for destroyById.
   */
  PersistedModel.deleteById = PersistedModel.destroyById

  /**
   * Return the number of records that match the optional "where" filter.
   * @param {Object} [where] Optional where filter, like
   * ```
   * { key: val, key2: {gt: 'val2'}, ...}
   * ```
   * <br/>See
   * [Where filter](http://loopback.io/doc/en/lb2/Where-filter.html#where-clause-for-other-methods).
   * @callback {Function} callback Callback function called with `(err, count)` arguments.  Required.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Number} count Number of instances.
   */

  PersistedModel.count = async function(where) {
    throwNotAttached(this.modelName, 'count')
  }

  /**
   * Save model instance. If the instance doesn't have an ID, then calls [create](#persistedmodelcreatedata-cb) instead.
   * Triggers: validate, save, update, or create.
   * @options {Object} [options] See below.
   * @property {Boolean} validate Perform validation before saving.  Default is true.
   * @property {Boolean} throws If true, throw a validation error; WARNING: This can crash Node.
   * If false, report the error via callback.  Default is false.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Model instance saved or created.
   */

  PersistedModel.prototype.save = async function(options = {}) {
    const Model = this.constructor
    if (!('validate' in options)) {
      options.validate = true
    }
    if (!('throws' in options)) {
      options.throws = false
    }
    const inst = this
    const data = inst.toObject(true)
    const id = inst.getId()
    if (!id) {
      return Model.create(inst)
    }
    if (options.validate) {
      const valid = await inst.isValid()
      if (!valid) {
        const err = new Model.ValidationError(inst)
        if (options.throws) {
          throw err
        }
        return err
      }
    }

    // Helper to wrap inst.trigger() in a Promise
    function triggerAsync(event, data) {
      return new Promise((resolve, reject) => {
        inst.trigger(event, data, function(done) {
          resolve(done)
        })
      })
    }

    // Trigger the pre hooks and wait for hook completion callbacks
    const saveDone = await triggerAsync('save', data)
    const updateDone = await triggerAsync('update', data)

    // Perform the upsert operation and re-initialize instance properties
    await Model.upsert(inst)
    inst._initProperties(data)

    // Await the hook completion functions returned by trigger
    await new Promise((resolve, reject) => updateDone.call(inst, resolve))
    await new Promise((resolve, reject) => saveDone.call(inst, resolve))
    return inst
  }

  /**
   * Determine if the data model is new.
   * @returns {Boolean} Returns true if the data model is new; false otherwise.
   */

  PersistedModel.prototype.isNewRecord = function() {
    throwNotAttached(this.constructor.modelName, 'isNewRecord')
  }

  /**
   * Deletes the model from persistence.
   * Triggers `destroy` hook (async) before and after destroying object.
   * @param {Function} callback Callback function.
   */

  PersistedModel.prototype.destroy = function(cb) {
    throwNotAttached(this.constructor.modelName, 'destroy')
  }

  /**
   * Alias for destroy.
   * @header PersistedModel.remove
   */
  PersistedModel.prototype.remove = PersistedModel.prototype.destroy

  /**
   * Alias for destroy.
   * @header PersistedModel.delete
   */
  PersistedModel.prototype.delete = PersistedModel.prototype.destroy

  PersistedModel.prototype.destroy._delegate = true

  /**
   * Update a single attribute.
   * Equivalent to `updateAttributes({name: 'value'}, cb)`
   *
   * @param {String} name Name of property.
   * @param {Mixed} value Value of property.
   * @callback {Function} callback Callback function called with `(err, instance)` arguments.  Required.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Updated instance.
   */

  PersistedModel.prototype.updateAttribute = async function updateAttribute(name, value) {
    throwNotAttached(this.constructor.modelName, 'updateAttribute');
  };

  /**
   * Update set of attributes.  Performs validation before updating.
   *
   * Triggers: `validation`, `save` and `update` hooks
   * @param {Object} data Data to update.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Updated instance.
   */

  PersistedModel.prototype.updateAttributes = PersistedModel.prototype.patchAttributes =
  function updateAttributes(data) {
    throwNotAttached(this.modelName, 'updateAttributes');
  };

  /**
   * Replace attributes for a model instance and persist it into the datasource.
   * Performs validation before replacing.
   *
   * @param {Object} data Data to replace.
   * @options {Object} [options] Options for replace
   * @property {Boolean} validate Perform validation before saving.  Default is true.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Replaced instance.
   */

  PersistedModel.prototype.replaceAttributes = function replaceAttributes(data) {
    throwNotAttached(this.modelName, 'replaceAttributes');
  };

  /**
   * Replace attributes for a model instance whose id is the first input
   * argument and persist it into the datasource.
   * Performs validation before replacing.
   *
   * @param {*} id The ID value of model instance to replace.
   * @param {Object} data Data to replace.
   * @options {Object} [options] Options for replace
   * @property {Boolean} validate Perform validation before saving.  Default is true.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Replaced instance.
   */

  PersistedModel.replaceById = function replaceById(id, data) {
    throwNotAttached(this.modelName, 'replaceById');
  };

  /**
   * Reload object from persistence.  Requires `id` member of `object` to be able to call `find`.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} instance Model instance.
   */

  PersistedModel.prototype.reload = function reload() {
    throwNotAttached(this.constructor.modelName, 'reload');
  };

  /**
   * Set the correct `id` property for the `PersistedModel`. Uses the `setId` method if the model is attached to
   * connector that defines it.  Otherwise, uses the default lookup.
   * Override this method to handle complex IDs.
   *
   * @param {*} val The `id` value. Will be converted to the type that the `id` property specifies.
   */

  PersistedModel.prototype.setId = function(val) {
    const ds = this.getDataSource();
    this[this.getIdName()] = val;
  };

  /**
   * Get the `id` value for the `PersistedModel`.
   *
   * @returns {*} The `id` value
   */

  PersistedModel.prototype.getId = function() {
    const data = this.toObject();
    if (!data) return;
    return data[this.getIdName()];
  };

  /**
   * Get the `id` property name of the constructor.
   *
   * @returns {String} The `id` property name
   */

  PersistedModel.prototype.getIdName = function() {
    return this.constructor.getIdName();
  };

  /**
   * Get the `id` property name of the constructor.
   *
   * @returns {String} The `id` property name
   */

  PersistedModel.getIdName = function() {
    const Model = this;
    const ds = Model.getDataSource();

    if (ds.idName) {
      return ds.idName(Model.modelName);
    } else {
      return 'id';
    }
  };

  PersistedModel.setupRemoting = function() {
    const PersistedModel = this;
    const typeName = PersistedModel.modelName;
    const options = PersistedModel.settings;

    // if there is atleast one updateOnly property, then we set
    // createOnlyInstance flag in __create__ to indicate loopback-swagger
    // code to create a separate model instance for create operation only
    const updateOnlyProps = this.getUpdateOnlyProperties ?
      this.getUpdateOnlyProperties() : false;
    const hasUpdateOnlyProps = updateOnlyProps && updateOnlyProps.length > 0;

    // This is just for LB 3.x
    options.replaceOnPUT = options.replaceOnPUT !== false;

    function setRemoting(scope, name, options) {
      const fn = scope[name];
      fn._delegate = true;
      options.isStatic = scope === PersistedModel;
      PersistedModel.remoteMethod(name, options);
    }

    setRemoting(PersistedModel, 'create', {
      description: 'Create a new instance of the model and persist it into the data source.',
      accessType: 'WRITE',
      accepts: [
        {
          arg: 'data', type: 'object', model: typeName, allowArray: true,
          createOnlyInstance: hasUpdateOnlyProps,
          description: 'Model instance data',
          http: {source: 'body'},
        },
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: {verb: 'post', path: '/'},
    });

    const upsertOptions = {
      aliases: ['upsert', 'updateOrCreate'],
      description: 'Patch an existing model instance or insert a new one ' +
        'into the data source.',
      accessType: 'WRITE',
      accepts: [
        {
          arg: 'data', type: 'object', model: typeName, http: {source: 'body'},
          description: 'Model instance data',
        },
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: [{verb: 'patch', path: '/'}],
    };

    if (!options.replaceOnPUT) {
      upsertOptions.http.unshift({verb: 'put', path: '/'});
    }
    setRemoting(PersistedModel, 'patchOrCreate', upsertOptions);

    const replaceOrCreateOptions = {
      description: 'Replace an existing model instance or insert a new one into the data source.',
      accessType: 'WRITE',
      accepts: [
        {
          arg: 'data', type: 'object', model: typeName,
          http: {source: 'body'},
          description: 'Model instance data',
        },
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: [{verb: 'post', path: '/replaceOrCreate'}],
    };

    if (options.replaceOnPUT) {
      replaceOrCreateOptions.http.push({verb: 'put', path: '/'});
    }

    setRemoting(PersistedModel, 'replaceOrCreate', replaceOrCreateOptions);

    setRemoting(PersistedModel, 'upsertWithWhere', {
      aliases: ['patchOrCreateWithWhere'],
      description: 'Update an existing model instance or insert a new one into ' +
        'the data source based on the where criteria.',
      accessType: 'WRITE',
      accepts: [
        {arg: 'where', type: 'object', http: {source: 'query'},
          description: 'Criteria to match model instances'},
        {arg: 'data', type: 'object', model: typeName, http: {source: 'body'},
          description: 'An object of model property name/value pairs'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: {verb: 'post', path: '/upsertWithWhere'},
    });

    setRemoting(PersistedModel, 'exists', {
      description: 'Check whether a model instance exists in the data source.',
      accessType: 'READ',
      accepts: [
        {arg: 'id', type: 'any', description: 'Model id', required: true,
          http: {source: 'path'}},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'exists', type: 'boolean'},
      http: [
        {verb: 'get', path: '/:id/exists'},
        {verb: 'head', path: '/:id'},
      ],
      rest: {
        // After hook to map exists to 200/404 for HEAD
        after: function(ctx, cb) {
          if (ctx.req.method === 'GET') {
            // For GET, return {exists: true|false} as is
            return cb();
          }
          if (!ctx.result.exists) {
            const modelName = ctx.method.sharedClass.name;
            const id = ctx.getArgByName('id');
            const msg = 'Unknown "' + modelName + '" id "' + id + '".';
            const error = new Error(msg);
            error.statusCode = error.status = 404;
            error.code = 'MODEL_NOT_FOUND';
            cb(error);
          } else {
            cb();
          }
        },
      },
    });

    setRemoting(PersistedModel, 'findById', {
      description: 'Find a model instance by {{id}} from the data source.',
      accessType: 'READ',
      accepts: [
        {arg: 'id', type: 'any', description: 'Model id', required: true,
          http: {source: 'path'}},
        {arg: 'filter', type: 'object',
          description:
          'Filter defining fields and include - must be a JSON-encoded string (' +
          '{"something":"value"})'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: {verb: 'get', path: '/:id'},
      rest: {after: convertNullToNotFoundError},
    });

    const replaceByIdOptions = {
      description: 'Replace attributes for a model instance and persist it into the data source.',
      accessType: 'WRITE',
      accepts: [
        {arg: 'id', type: 'any', description: 'Model id', required: true,
          http: {source: 'path'}},
        {arg: 'data', type: 'object', model: typeName, http: {source: 'body'}, description:
          'Model instance data'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: [{verb: 'post', path: '/:id/replace'}],
    };

    if (options.replaceOnPUT) {
      replaceByIdOptions.http.push({verb: 'put', path: '/:id'});
    }

    setRemoting(PersistedModel, 'replaceById', replaceByIdOptions);

    setRemoting(PersistedModel, 'find', {
      description: 'Find all instances of the model matched by filter from the data source.',
      accessType: 'READ',
      accepts: [
        {arg: 'filter', type: 'object', description:
        'Filter defining fields, where, include, order, offset, and limit - must be a ' +
        'JSON-encoded string (`{"where":{"something":"value"}}`).  ' +
        'See https://loopback.io/doc/en/lb3/Querying-data.html#using-stringified-json-in-rest-queries ' +
        'for more details.'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: [typeName], root: true},
      http: {verb: 'get', path: '/'},
    });

    setRemoting(PersistedModel, 'findOne', {
      description: 'Find first instance of the model matched by filter from the data source.',
      accessType: 'READ',
      accepts: [
        {arg: 'filter', type: 'object', description:
        'Filter defining fields, where, include, order, offset, and limit - must be a ' +
        'JSON-encoded string (`{"where":{"something":"value"}}`).  ' +
        'See https://loopback.io/doc/en/lb3/Querying-data.html#using-stringified-json-in-rest-queries ' +
        'for more details.'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: {verb: 'get', path: '/findOne'},
      rest: {after: convertNullToNotFoundError},
    });

    setRemoting(PersistedModel, 'destroyAll', {
      description: 'Delete all matching records.',
      accessType: 'WRITE',
      accepts: [
        {arg: 'where', type: 'object', description: 'filter.where object'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {
        arg: 'count',
        type: 'object',
        description: 'The number of instances deleted',
        root: true,
      },
      http: {verb: 'del', path: '/'},
      shared: false,
    });

    setRemoting(PersistedModel, 'updateAll', {
      aliases: ['update'],
      description: 'Update instances of the model matched by {{where}} from the data source.',
      accessType: 'WRITE',
      accepts: [
        {arg: 'where', type: 'object', http: {source: 'query'},
          description: 'Criteria to match model instances'},
        {arg: 'data', type: 'object', model: typeName, http: {source: 'body'},
          description: 'An object of model property name/value pairs'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {
        arg: 'info',
        description: 'Information related to the outcome of the operation',
        type: {
          count: {
            type: 'number',
            description: 'The number of instances updated',
          },
        },
        root: true,
      },
      http: {verb: 'post', path: '/update'},
    });

    setRemoting(PersistedModel, 'deleteById', {
      aliases: ['destroyById', 'removeById'],
      description: 'Delete a model instance by {{id}} from the data source.',
      accessType: 'WRITE',
      accepts: [
        {arg: 'id', type: 'any', description: 'Model id', required: true,
          http: {source: 'path'}},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      http: {verb: 'del', path: '/:id'},
      returns: {arg: 'count', type: 'object', root: true},
    });

    setRemoting(PersistedModel, 'count', {
      description: 'Count instances of the model matched by where from the data source.',
      accessType: 'READ',
      accepts: [
        {arg: 'where', type: 'object', description: 'Criteria to match model instances'},
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'count', type: 'number'},
      http: {verb: 'get', path: '/count'},
    });

    const updateAttributesOptions = {
      aliases: ['updateAttributes'],
      description: 'Patch attributes for a model instance and persist it into ' +
        'the data source.',
      accessType: 'WRITE',
      accepts: [
        {
          arg: 'data', type: 'object', model: typeName,
          http: {source: 'body'},
          description: 'An object of model property name/value pairs',
        },
        {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      ],
      returns: {arg: 'data', type: typeName, root: true},
      http: [{verb: 'patch', path: '/'}],
    };

    setRemoting(PersistedModel.prototype, 'patchAttributes', updateAttributesOptions);

    if (!options.replaceOnPUT) {
      updateAttributesOptions.http.unshift({verb: 'put', path: '/'});
    }

    if (options.trackChanges || options.enableRemoteReplication) {
      setRemoting(PersistedModel, 'diff', {
        description: 'Get a set of deltas and conflicts since the given checkpoint.',
        accessType: 'READ',
        accepts: [
          {arg: 'since', type: 'number', description: 'Find deltas since this checkpoint'},
          {arg: 'remoteChanges', type: 'array', description: 'an array of change objects',
            http: {source: 'body'}},
        ],
        returns: {arg: 'result', type: 'object', root: true},
        http: {verb: 'post', path: '/diff'},
      });

      setRemoting(PersistedModel, 'changes', {
        description: 'Get the changes to a model since a given checkpoint. Provide a filter object to reduce the number of results returned.',
        accessType: 'READ',
        accepts: [
          {arg: 'since', type: 'number', description:
            'Only return changes since this checkpoint'},
          {arg: 'filter', type: 'object', description:
            'Only include changes that match this filter'},
        ],
        returns: {arg: 'changes', type: 'array', root: true},
        http: {verb: 'get', path: '/changes'},
      });

      setRemoting(PersistedModel, 'checkpoint', {
        description: 'Create a checkpoint.',
        // The replication algorithm needs to create a source checkpoint,
        // even though it is otherwise not making any source changes.
        // We need to allow this method for users that don't have full
        // WRITE permissions.
        accessType: 'REPLICATE',
        returns: {arg: 'checkpoint', type: 'object', root: true},
        http: {verb: 'post', path: '/checkpoint'},
      });

      setRemoting(PersistedModel, 'currentCheckpoint', {
        description: 'Get the current checkpoint.',
        accessType: 'READ',
        returns: {arg: 'checkpoint', type: 'object', root: true},
        http: {verb: 'get', path: '/checkpoint'},
      });

      setRemoting(PersistedModel, 'createUpdates', {
        description: 'Create an update list from a delta list.',
        // This operation is read-only, it does not change any local data.
        // It is called by the replication algorithm to compile a list
        // of changes to apply on the target.
        accessType: 'READ',
        accepts: {arg: 'deltas', type: 'array', http: {source: 'body'}},
        returns: {arg: 'updates', type: 'array', root: true},
        http: {verb: 'post', path: '/create-updates'},
      });

      setRemoting(PersistedModel, 'bulkUpdate', {
        description: 'Run multiple updates at once. Note: this is not atomic.',
        accessType: 'WRITE',
        accepts: {arg: 'updates', type: 'array'},
        http: {verb: 'post', path: '/bulk-update'},
      });

      setRemoting(PersistedModel, 'findLastChange', {
        description: 'Get the most recent change record for this instance.',
        accessType: 'READ',
        accepts: {
          arg: 'id', type: 'any', required: true, http: {source: 'path'},
          description: 'Model id',
        },
        returns: {arg: 'result', type: this.Change.modelName, root: true},
        http: {verb: 'get', path: '/:id/changes/last'},
      });

      setRemoting(PersistedModel, 'updateLastChange', {
        description:
          'Update the properties of the most recent change record ' +
          'kept for this instance.',
        accessType: 'WRITE',
        accepts: [
          {
            arg: 'id', type: 'any', required: true, http: {source: 'path'},
            description: 'Model id',
          },
          {
            arg: 'data', type: 'object', model: typeName, http: {source: 'body'},
            description: 'An object of Change property name/value pairs',
          },
        ],
        returns: {arg: 'result', type: this.Change.modelName, root: true},
        http: {verb: 'put', path: '/:id/changes/last'},
      });
    }

    setRemoting(PersistedModel, 'createChangeStream', {
      description: 'Create a change stream.',
      accessType: 'READ',
      http: [
        {verb: 'post', path: '/change-stream'},
        {verb: 'get', path: '/change-stream'},
      ],
      accepts: {
        arg: 'options',
        type: 'object',
      },
      returns: {
        arg: 'changes',
        type: 'ReadableStream',
        json: true,
      },
    });
  };

  /**
   * Get a set of deltas and conflicts since the given checkpoint.
   *
   * See [Change.diff()](#change-diff) for details.
   *
   * @param  {Number}  since  Find deltas since this checkpoint.
   * @param  {Array}  remoteChanges  An array of change objects.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Object} result Object with `deltas` and `conflicts` properties; see [Change.diff()](#change-diff) for details.
   */

  PersistedModel.diff = async function(since, remoteChanges) {
    const Change = this.getChangeModel()
    return Change.diff(this.modelName, since, remoteChanges)
  };

  /**
   * Get the changes to a model since the specified checkpoint. Provide a filter object
   * to reduce the number of results returned.
   * @param  {Number}   since    Return only changes since this checkpoint.
   * @param  {Object}   filter   Include only changes that match this filter, the same as for [#persistedmodel-find](find()).
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Array} changes An array of [Change](#change) objects.
   */

  PersistedModel.changes = async function(since = -1, filter = {}) {
    const idName = this.dataSource.idName(this.modelName);
    const Change = this.getChangeModel();
    const model = this;
    const changeFilter = this.createChangeFilter(since, filter);

    filter = filter || {};
    filter.fields = {};
    filter.where = filter.where || {};
    filter.fields[idName] = true;

    // TODO(ritch) this whole thing could be optimized a bit more
    const changes = await Change.find(changeFilter)

    if (!Array.isArray(changes) || changes.length === 0) return []

    const ids = changes.map((change) => change.getModelId())

    filter.where[idName] = {inq: ids}

    const models = await model.find(filter)

    const modelIds = models.map((m) => m[idName].toString())

    return changes.filter((ch) => {
      return modelIds.indexOf(ch.getModelId()) > -1
    })
  }

  /**
   * Create a checkpoint.
   *
   * Returns a promise that resolves with the new checkpoint sequence.
   */
  PersistedModel.checkpoint = async function() {
    const Checkpoint = this.getChangeModel().getCheckpointModel()
    return Checkpoint.bumpLastSeq()
  }

  /**
   * Get the current checkpoint ID.
   *
   * Returns a promise that resolves with the current checkpoint ID.
   */
  PersistedModel.currentCheckpoint = async function() {
    const Checkpoint = this.getChangeModel().getCheckpointModel()
    return Checkpoint.current()
  }

  /**
   * Replicate changes since the given checkpoint to the given target model.
   *
   * @param  {Number}   [since]  Since this checkpoint
   * @param  {Model}    targetModel  Target this model class
   * @param  {Object} [options] An optional options object to pass to underlying data-access calls.
   * @param {Object} [options.filter] Replicate models that match this filter
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Conflict[]} conflicts A list of changes that could not be replicated due to conflicts.
   * @param {Object} checkpoints The new checkpoints to use as the "since"
   * argument for the next replication.
   *
   * @promise
   */

  PersistedModel.replicate = async function(since = -1, targetModel, options = {}) {
    const MAX_ATTEMPTS = 3
    let attempt = 1
    let currentSince = since
    let result

    while (true) {
      debug(`iteration #${attempt}`)
      result = await tryReplicate(this, targetModel, currentSince, options)
      const {conflicts, checkpoints, updates} = result
      if (conflicts.length || !updates || updates.length === 0 || attempt >= MAX_ATTEMPTS) {
        return result
      }
      currentSince = checkpoints
      attempt++
    }
  }

  // Internal helper; replicates one iteration of changes
  async function tryReplicate(sourceModel, targetModel, since, options) {
    const Change = sourceModel.getChangeModel()
    const TargetChange = targetModel.getChangeModel()
    if (!Change || !TargetChange) {
      throw new Error('You must enable change tracking before replicating')
    }
    let replicationChunkSize = REPLICATION_CHUNK_SIZE
    if (sourceModel.settings && sourceModel.settings.replicationChunkSize) {
      replicationChunkSize = sourceModel.settings.replicationChunkSize
    }
    const {newSourceCp, newTargetCp} = await getCheckpoints(sourceModel, targetModel)
    const sourceChanges = await getSourceChanges(sourceModel, since.source, options.filter, replicationChunkSize)
    const diff = await getDiffFromTarget(targetModel, since.target, sourceChanges, replicationChunkSize)
    diff.conflicts = diff.conflicts || []
    let updates = []
    if (diff.deltas && diff.deltas.length) {
      debug('\tbuilding a list of updates')
      updates = await createSourceUpdates(sourceModel, diff.deltas, replicationChunkSize)
    } else {
      // nothing to replicate
      return {conflicts: diff.conflicts, checkpoints: {source: newSourceCp, target: newTargetCp}, updates: []}
    }
    await bulkUpdate(targetModel, updates, options, replicationChunkSize)
    return {conflicts: diff.conflicts, checkpoints: {source: newSourceCp, target: newTargetCp}, updates}
  }

  // Create new checkpoints for both the source and target models
  async function getCheckpoints(sourceModel, targetModel) {
    const sourceCp = await sourceModel.checkpoint()
    const targetCp = await targetModel.checkpoint()
    debug(`\tcreated checkpoints`)
    debug(`\t\t${sourceCp.seq} for source model ${sourceModel.modelName}`)
    debug(`\t\t${targetCp.seq} for target model ${targetModel.modelName}`)
    return {newSourceCp: sourceCp.seq, newTargetCp: targetCp.seq}
  }

  // Download changes (in chunks) from the source model
  async function getSourceChanges(sourceModel, sinceSource, filter, replicationChunkSize) {
    const result = await utils.downloadInChunks(
      filter,
      replicationChunkSize,
      (localFilter) => sourceModel.changes(sinceSource, localFilter)
    )

    debug('\tusing source changes')
    if (debug.enabled) {
      result.forEach(it => debug(`\t\t${JSON.stringify(it)}`))
    }

    return result
  }

  // Upload changes (in chunks) to compute the diff from the target model
  async function getDiffFromTarget(targetModel, sinceTarget, sourceChanges, replicationChunkSize) {
    const result = await utils.uploadInChunks(
      sourceChanges,
      replicationChunkSize,
      (smallArray) => targetModel.diff(sinceTarget, smallArray)
    )

    if (result.conflicts && result.conflicts.length) {
      debug('\tdiff conflicts')
      result.conflicts.forEach(d => debug(`\t\t${JSON.stringify(d)}`))
    }
    if (result.deltas && result.deltas.length) {
      debug('\tdiff deltas')
      result.deltas.forEach(it => debug(`\t\t${JSON.stringify(it)}`))
    }

    return result
  }

  // Build an update list from the source model's deltas using chunked uploads
  async function createSourceUpdates(sourceModel, deltas, replicationChunkSize) {
    return utils.uploadInChunks(
      deltas,
      replicationChunkSize,
      (smallArray) => sourceModel.createUpdates(smallArray)
    )
  }

  // Perform bulk update on the target model; aggregate errors related to conflicts
  async function bulkUpdate(targetModel, updates, options, replicationChunkSize) {
    try {
      await utils.uploadInChunks(
        updates,
        replicationChunkSize,
        (smallArray) => targetModel.bulkUpdate(smallArray, options)
      )
    } catch (error) {
      const conflicts = error && error.details && error.details.conflicts
      if (conflicts && error.statusCode == 409) {
        updates = updates.filter(u => {
          return conflicts.filter(d => d.modelId === u.change.modelId).length === 0
        })
        return
      }
      throw error
    }
  }

  PersistedModel.createUpdates = async function(deltas) {
    const Change = this.getChangeModel()
    const updates = []
    const Model = this
    const tasks = deltas.map(changeData => {
      const change = new Change(changeData)
      const type = change.type()
      const update = {type, change}

      if (type === Change.CREATE || type === Change.UPDATE) {
        return async function() {
          const inst = await Model.findById(change.modelId)
          if (!inst) {
            throw new Error(g.f(`Missing data for change: ${change.modelId}`))
          }
          update.data = inst.toObject ? inst.toObject() : inst
          updates.push(update)
        }
      }
      else if (type === Change.DELETE) {
        updates.push(update)
        return async function() {}
      }
    })
    await Promise.all(tasks.map(fn => fn()))
    return updates
  }

  // Convert bulkUpdate to promise–only; note that this function is not atomic
  PersistedModel.bulkUpdate = async function(updates, options) {
    const Model = this
    const Change = this.getChangeModel()
    const conflicts = []
    options = options || {}
    const currentMap = await buildLookupOfAffectedModelData(Model, updates)
    const tasks = updates.map(update => {
      const id = update.change.modelId
      const current = currentMap[id]
      if (update.type === Change.UPDATE) {
        return applyUpdate(Model, id, current, update.data, update.change, conflicts, options)
      }
      else if (update.type === Change.CREATE) {
        return applyCreate(Model, id, current, update.data, update.change, conflicts, options)
      }
      else if (update.type === Change.DELETE) {
        return applyDelete(Model, id, current, update.change, conflicts, options)
      }
    })
    await Promise.all(tasks)
    if (conflicts.length) {
      const err = new Error(g.f('Conflict'))
      err.statusCode = 409
      err.details = {conflicts}
      throw err
    }
  }

  // Build a lookup table of the current data for all affected model instances
  async function buildLookupOfAffectedModelData(Model, updates) {
    const idName = Model.dataSource.idName(Model.modelName)
    const affectedIds = updates.map(u => u.change.modelId)
    const whereAffected = {}
    whereAffected[idName] = {inq: affectedIds}
    const affectedList = await Model.find({where: whereAffected})
    const dataLookup = {}
    affectedList.forEach(it => {
      dataLookup[it[idName]] = it
    })
    return dataLookup
  }

  // Update an instance – now returning a promise
  async function applyUpdate(Model, id, current, data, change, conflicts, options) {
    const Change = Model.getChangeModel()
    const rev = current ? Change.revisionForInst(current) : null
    if (rev !== change.prev) {
      debug(`Detected non-rectified change of ${Model.modelName} ${id}`)
      debug(`\tExpected revision: ${change.rev}`)
      debug(`\tActual revision:   ${rev}`)
      conflicts.push(change)
      await Change.rectifyModelChanges(Model.modelName, [id])
      return
    }

    const result = await Model.updateAll(current.toObject(), data, options)
    const count = result && result.count

    switch (count) {
      case 1:
        return
      case 0:
        debug(`UpdateAll detected non-rectified change of ${Model.modelName} ${id}`)
        conflicts.push(change)
        return
      case undefined:
      case null:
        throw new Error(g.f('Cannot apply bulk updates, the connector does not correctly report the number of updated records.'))
      default:
        debug(`${Model.modelName}.updateAll modified unexpected number of instances: ${JSON.stringify(count)}`)
        throw new Error(g.f('Bulk update failed, the connector has modified unexpected number of records: %s', JSON.stringify(count)))
    }
  }

  // Create a new instance (or detect duplicate) using promise–only
  async function applyCreate(Model, id, current, data, change, conflicts, options) {
    try {
      await Model.create(data, options)
    }
    catch (createErr) {
      const inst = await Model.findById(id)
      if (!inst) {
        throw createErr
      }
      debug(`Detected non-rectified new instance of ${Model.modelName} ${id}`)
      conflicts.push(change)
      await Model.getChangeModel().rectifyModelChanges(Model.modelName, [id])
    }
  }

  // Delete an instance using promise–only
  async function applyDelete(Model, id, current, change, conflicts, options) {
    if (!current) return
    const Change = Model.getChangeModel()
    const rev = Change.revisionForInst(current)
    if (rev !== change.prev) {
      debug(`Detected non-rectified change of ${Model.modelName} ${id}`)
      debug(`\tExpected revision: ${change.rev}`)
      debug(`\tActual revision:   ${rev}`)
      conflicts.push(change)
      await Change.rectifyModelChanges(Model.modelName, [id])
      return
    }
    const result = await Model.deleteAll(current.toObject(), options)
    const count = result && result.count

    switch (count) {
      case 1:
        return
      case 0:
        debug(`DeleteAll detected non-rectified change of ${Model.modelName} ${id}`)
        conflicts.push(change)
        return
      case undefined:
      case null:
        throw new Error(g.f('Cannot apply bulk updates, the connector does not correctly report the number of deleted records.'))
      default:
        debug(`${Model.modelName}.deleteAll modified unexpected number of instances: ${JSON.stringify(count)}`)
        throw new Error(g.f('Bulk update failed, the connector has deleted unexpected number of records: %s', JSON.stringify(count)))
    }
  }

  /**
   * Create an update list (for `Model.bulkUpdate()`) from a delta list
   * (result of `Change.diff()`).
   *
   * @param  {Array}    deltas
   */

  PersistedModel.createUpdates = async function(deltas) {
    const Model = this
    const Change = this.getChangeModel()
    const updates = []
    const tasks = []

    for (const change of deltas) {
      change = new Change(change)
      const type = change.type()
      const update = {type: type, change: change}
      switch (type) {
        case Change.CREATE:
        case Change.UPDATE:
          tasks.push(async function(cb) {
            const inst = await Model.findById(change.modelId)
            if (!inst) {
              return cb &&
                cb(new Error(g.f('Missing data for change: %s', change.modelId)))
            }
            if (inst.toObject) {
              update.data = inst.toObject()
            } else {
              update.data = inst
            }
            updates.push(update)
            cb()
          })
          break;
        case Change.DELETE:
          updates.push(update);
          break;
      }
    }

    return new Promise((resolve, reject) => {
      async.parallel(tasks, function(err) {
        if (err) return reject(err)
        resolve(updates)
      })
    })
  }

  /**
   * Apply an update list.
   *
   * **Note: this is not atomic**
   *
   * @param  {Array} updates An updates list, usually from [createUpdates()](#persistedmodel-createupdates).
   * @param  {Object} [options] An optional options object to pass to underlying data-access calls.
   */

  PersistedModel.bulkUpdate = async function(updates, options = {}) {
    const tasks = [];
    const Model = this;
    const Change = this.getChangeModel();
    const conflicts = []
    const currentMap = await buildLookupOfAffectedModelData(Model, updates)

    for (const update of updates) {
      const id = update.change.modelId
      const current = currentMap[id]

        switch (update.type) {
          case Change.UPDATE:
            tasks.push(function(cb) {
              applyUpdate(Model, id, current, update.data, update.change, conflicts, options, cb);
            });
            break;

          case Change.CREATE:
            tasks.push(function(cb) {
              applyCreate(Model, id, current, update.data, update.change, conflicts, options, cb);
            });
            break;
          case Change.DELETE:
            tasks.push(function(cb) {
              applyDelete(Model, id, current, update.change, conflicts, options, cb);
            });
            break;
        }
      }

      return new Promise((resolve, reject) => {
        async.parallel(tasks, function(err) {
          if (err) return reject(err);
          if (conflicts.length) {
            const err = new Error(g.f('Conflict'))
            err.statusCode = 409
            err.details = {conflicts}
            return reject(err)
          }
          resolve()
      })
    })
  }

  async function buildLookupOfAffectedModelData(Model, updates) {
    const idName = Model.dataSource.idName(Model.modelName)
    const affectedIds = updates.map(u => u.change.modelId)
    const whereAffected = { [idName]: { inq: affectedIds } }
    const affectedList = await Model.find({where: whereAffected})
    const dataLookup = {}

    for (const it of affectedList) {
      dataLookup[it[idName]] = it
    }

    return dataLookup
  }

  async function applyUpdate(Model, id, current, data, change, conflicts, options) {
    const Change = Model.getChangeModel();
    const rev = current ? Change.revisionForInst(current) : null;

    if (rev !== change.prev) {
      debug('Detected non-rectified change of %s %j',
        Model.modelName, id);
      debug('\tExpected revision: %s', change.rev);
      debug('\tActual revision:   %s', rev);
      conflicts.push(change)

      return Change.rectifyModelChanges(Model.modelName, [id])
    }

    // TODO(bajtos) modify `data` so that it instructs
    // the connector to remove any properties included in "inst"
    // but not included in `data`
    // See https://github.com/strongloop/loopback/issues/1215
    const result = await Model.updateAll(current.toObject(), data, options)
    const count = result && result.count

    switch (count) {
      case 1:
        // The happy path, exactly one record was updated
        return

      case 0:
        debug('UpdateAll detected non-rectified change of %s %j',
          Model.modelName, id);
        conflicts.push(change);
        // NOTE(bajtos) updateAll triggers change rectification
        // for all model instances, even when no records were updated,
        // thus we don't need to rectify explicitly ourselves
        return

      case undefined:
      case null:
        throw new Error(
          g.f('Cannot apply bulk updates, ' +
          'the connector does not correctly report ' +
          'the number of updated records.'),
        )

      default:
        debug('%s.updateAll modified unexpected number of instances: %j',
          Model.modelName, count);
        throw new Error(
          g.f('Bulk update failed, the connector has modified unexpected ' +
          'number of records: %s', JSON.stringify(count)),
        )
    }
  }

  async function applyCreate(Model, id, current, data, change, conflicts, options) {
    const result = await Model.create(data, options)
    if (result) return

      // We don't have a reliable way how to detect the situation
      // where he model was not create because of a duplicate id
      // The workaround is to query the DB to check if the model already exists
    const inst = await Model.findById(id)
    if (inst) {
      // There isn't any instance with the same id, thus there isn't
      // any conflict and we just report back the original error.
      throw new Error(g.f('Duplicate model instance: %s %j', Model.modelName, id))
    }

    // The instance already exists - report a conflict
    debug('Detected non-rectified new instance of %s %j',
    Model.modelName, id);
    conflicts.push(change);

    const Change = Model.getChangeModel()
    await Change.rectifyModelChanges(Model.modelName, [id])
  }

  async function applyDelete(Model, id, current, change, conflicts, options) {
    if (!current) {
      // The instance was either already deleted or not created at all,
      // we are done.
      return
    }

    const Change = Model.getChangeModel();
    const rev = Change.revisionForInst(current);
    if (rev !== change.prev) {
      debug('Detected non-rectified change of %s %j',
        Model.modelName, id);
      debug('\tExpected revision: %s', change.rev);
      debug('\tActual revision:   %s', rev);
      conflicts.push(change);
      return Change.rectifyModelChanges(Model.modelName, [id], cb);
    }

    const result = await Model.deleteAll(current.toObject(), options)
    const count = result && result.count

    switch (count) {
      case 1:
        // The happy path, exactly one record was updated
        return

      case 0:
        debug('DeleteAll detected non-rectified change of %s %j',
          Model.modelName, id);
        conflicts.push(change);
        // NOTE(bajtos) deleteAll triggers change rectification
        // for all model instances, even when no records were updated,
        // thus we don't need to rectify explicitly ourselves
        return

      case undefined:
      case null:
        throw new Error(
          g.f('Cannot apply bulk updates, ' +
          'the connector does not correctly report ' +
          'the number of deleted records.'),
        );

      default:
        debug('%s.deleteAll modified unexpected number of instances: %j',
          Model.modelName, count);
        throw new Error(
          g.f('Bulk update failed, the connector has deleted unexpected ' +
          'number of records: %s', JSON.stringify(count)),
        )
    }
  }

  /**
   * Get the `Change` model.
   * Throws an error if the change model is not correctly setup.
   * @return {Change}
   */

  PersistedModel.getChangeModel = function() {
    const changeModel = this.Change;
    const isSetup = changeModel && changeModel.dataSource;

    assert(isSetup, 'Cannot get a setup Change model for ' + this.modelName);

    return changeModel;
  };

  /**
   * Get the source identifier for this model or dataSource.
   *
   * @callback {Function} callback Callback function called with `(err, id)` arguments.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {String} sourceId Source identifier for the model or dataSource.
   */

  PersistedModel.getSourceId = async function() {
    const dataSource = this.dataSource;
    if (!dataSource) {
      this.once('dataSourceAttached', this.getSourceId.bind(this))
    }
    assert(
      dataSource.connector.name,
      'Model.getSourceId: cannot get id without dataSource.connector.name',
    )

    const id = [dataSource.connector.name, this.modelName].join('-');
    return id
  }

  /**
   * Enable the tracking of changes made to the model. Usually for replication.
   */

  PersistedModel.enableChangeTracking = function() {
    const Model = this;
    const Change = this.Change || this._defineChangeModel();
    const cleanupInterval = Model.settings.changeCleanupInterval || 30000;

    assert(this.dataSource, 'Cannot enableChangeTracking(): ' + this.modelName +
      ' is not attached to a dataSource');

    const idName = this.getIdName();
    const idProp = this.definition.properties[idName];
    const idType = idProp && idProp.type;
    const idDefn = idProp && idProp.defaultFn;
    if (idType !== String || !(idDefn === 'uuid' || idDefn === 'guid')) {
      deprecated('The model ' + this.modelName + ' is tracking changes, ' +
        'which requires a string id with GUID/UUID default value.');
    }

    Model.observe('after save', rectifyOnSave);

    Model.observe('after delete', rectifyOnDelete);

    // Only run if the run time is server
    // Can switch off cleanup by setting the interval to -1
    if (runtime.isServer && cleanupInterval > 0) {
      // initial cleanup
      cleanup();

      // cleanup
      setInterval(cleanup, cleanupInterval);
    }

    function cleanup() {
      Model.rectifyAllChanges().catch(err => {
        Model.handleChangeError(err, 'cleanup')
      })
    }
  }

  async function rectifyOnSave(ctx) {
    const instance = ctx.instance || ctx.currentInstance;
    const id = instance ? instance.getId() :
      getIdFromWhereByModelId(ctx.Model, ctx.where);

    if (debug.enabled) {
      debug('rectifyOnSave %s -> ' + (id ? 'id %j' : '%s'),
        ctx.Model.modelName, id ? id : 'ALL');
      debug('context instance:%j currentInstance:%j where:%j data %j',
        ctx.instance, ctx.currentInstance, ctx.where, ctx.data);
    }

    if (id != null) {
      ctx.Model.rectifyChange(id).catch(reportError)
    }
    else {
      ctx.Model.rectifyAllChanges().catch(reportError)
    }

    function reportError(err) {
        ctx.Model.handleChangeError(err, 'after save');
    }
  }

  async function rectifyOnDelete(ctx) {
    const id = ctx.instance ? ctx.instance.getId() :
      getIdFromWhereByModelId(ctx.Model, ctx.where);

    if (debug.enabled) {
      debug('rectifyOnDelete %s -> ' + (id ? 'id %j' : '%s'),
        ctx.Model.modelName, id ? id : 'ALL');
      debug('context instance:%j where:%j', ctx.instance, ctx.where);
    }

    if (id != null) {
      ctx.Model.rectifyChange(id).catch(reportError)
    }
    else {
      ctx.Model.rectifyAllChanges().catch(reportError)
    }

    function reportError(err) {
      ctx.Model.handleChangeError(err, 'after delete')
    }
  }

  function getIdFromWhereByModelId(Model, where) {
    const idName = Model.getIdName();
    if (!(idName in where)) return undefined;

    const id = where[idName];
    // TODO(bajtos) support object values that are not LB conditions
    if (typeof id === 'string' || typeof id === 'number') {
      return id;
    }
    return undefined;
  }

  PersistedModel._defineChangeModel = function() {
    const BaseChangeModel = this.registry.getModel('Change')
    assert(BaseChangeModel,
      'Change model must be defined before enabling change replication')

    const additionalChangeModelProperties =
      this.settings.additionalChangeModelProperties || {}

    this.Change = BaseChangeModel.extend(
      this.modelName + '-change',
      additionalChangeModelProperties,
      {trackModel: this}
    )

    if (this.dataSource) {
      attachRelatedModels(this)
    }

    this.on('dataSourceAttached', () => {
      attachRelatedModels(this)
    })

    return this.Change

    async function attachRelatedModels(self) {
      if (!self.Change.dataSource) {
        if (typeof self.Change.attachTo === 'function') {
          await self.Change.attachTo(self.dataSource)
        }
      }
      const checkpoint = self.Change.getCheckpointModel()
      if (checkpoint && !checkpoint.dataSource) {
        if (typeof checkpoint.attachTo === 'function') {
          await checkpoint.attachTo(self.dataSource)
        }
      }
    }
  };

  PersistedModel.rectifyAllChanges = async function() {
    await this.getChangeModel().rectifyAll()
  }

  /**
   * Handle a change error. Override this method in a subclassing model to customize
   * change error handling.
   *
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   */

  PersistedModel.handleChangeError = function(err, operationName) {
    if (!err) return;
    this.emit('error', err, operationName);
  };

  /**
   * Specify that a change to the model with the given ID has occurred.
   *
   * @param {*} id The ID of the model that has changed.
   * @callback {Function} callback
   * @param {Error} err
   */

  PersistedModel.rectifyChange = async function(id) {
    const Change = this.getChangeModel()
    return Change.rectifyModelChanges(this.modelName, [id])
  }

  PersistedModel.findLastChange = async function(id) {
    const Change = this.getChangeModel()
    return Change.findOne({where: {modelId: id}})
  }

  PersistedModel.updateLastChange = async function(id, data) {
    const inst = await this.findLastChange(id)
    if (!inst) {
      const err = new Error(g.f('No change record found for %s with id %s', this.modelName, id))
      err.statusCode = 404
      throw err
    }
    return inst.updateAttributes(data)
  }

  /**
   * Create a change stream. [See here for more info](http://loopback.io/doc/en/lb2/Realtime-server-sent-events.html)
   *
   * @param {Object} options
   * @param {Object} options.where Only changes to models matching this where filter will be included in the `ChangeStream`.
   * @callback {Function} callback
   * @param {Error} err
   * @param {ChangeStream} changes
   */

  PersistedModel.createChangeStream = async function(options) {
    const idName = this.getIdName()
    const Model = this
    const changes = new PassThrough({objectMode: true})

    changes._destroy = function() {
      changes.end();
      changes.emit('end');
      changes.emit('close');
    };

    changes.destroy = changes.destroy || changes._destroy; // node 8 compability

    changes.on('error', removeHandlers);
    changes.on('close', removeHandlers);
    changes.on('finish', removeHandlers);
    changes.on('end', removeHandlers);

    Model.observe('after save', changeHandler);
    Model.observe('after delete', deleteHandler);

    return changes

    async function changeHandler(ctx) {
      const change = createChangeObject(ctx, 'save');
      if (change) {
        changes.write(change);
      }
    }

    async function deleteHandler(ctx) {
      const change = createChangeObject(ctx, 'delete')
      if (change) {
        changes.write(change)
      }
    }

    function createChangeObject(ctx, type) {
      const where = ctx.where;
      let data = ctx.instance || ctx.data;
      const whereId = where && where[idName];

      // the data includes the id
      // or the where includes the id
      let target;

      if (data && (data[idName] || data[idName] === 0)) {
        target = data[idName];
      } else if (where && (where[idName] || where[idName] === 0)) {
        target = where[idName];
      }

      const hasTarget = target === 0 || !!target;

      // apply filtering if options is set
      if (options) {
        const filtered = filterNodes([data], options);
        if (filtered.length !== 1) {
          return null;
        }
        data = filtered[0];
      }

      const change = {
        target: target,
        where: where,
        data: data,
      };

      switch (type) {
        case 'save':
          if (ctx.isNewInstance === undefined) {
            change.type = hasTarget ? 'update' : 'create';
          } else {
            change.type = ctx.isNewInstance ? 'create' : 'update';
          }

          break;
        case 'delete':
          change.type = 'remove';
          break;
      }

      return change;
    }

    function removeHandlers() {
      Model.removeObserver('after save', changeHandler);
      Model.removeObserver('after delete', deleteHandler);
    }
  };

  /**
   * Get the filter for searching related changes.
   *
   * Models should override this function to copy properties
   * from the model instance filter into the change search filter.
   *
   * ```js
   * module.exports = (TargetModel, config) => {
   *   TargetModel.createChangeFilter = function(since, modelFilter) {
   *     const filter = this.base.createChangeFilter.apply(this, arguments);
   *     if (modelFilter && modelFilter.where && modelFilter.where.tenantId) {
   *       filter.where.tenantId = modelFilter.where.tenantId;
   *     }
   *     return filter;
   *   };
   * };
   * ```
   *
   * @param {Number} since Return only changes since this checkpoint.
   * @param {Object} modelFilter Filter describing which model instances to
   * include in the list of changes.
   * @returns {Object} The filter object to pass to `Change.find()`. Default:
   * ```
   * {where: {checkpoint: {gte: since}, modelName: this.modelName}}
   * ```
   */
  PersistedModel.createChangeFilter = function(since, modelFilter) {
    return {
      where: {
        checkpoint: {gte: since},
        modelName: this.modelName,
      },
    };
  };

  /**
   * Add custom data to the Change instance.
   *
   * Models should override this function to duplicate model instance properties
   * to the Change instance properties, typically to allow the changes() method
   * to filter the changes using these duplicated properties directly while
   * querying the Change model.
   *
   * ```js
   * module.exports = (TargetModel, config) => {
   *   TargetModel.prototype.fillCustomChangeProperties = function(change, cb) {
   *     var inst = this;
   *     const base = this.constructor.base;
   *     base.prototype.fillCustomChangeProperties.call(this, change, err => {
   *       if (err) return cb(err);
   *
   *       if (inst && inst.tenantId) {
   *         change.tenantId = inst.tenantId;
   *       } else {
   *         change.tenantId = null;
   *       }
   *
   *       cb();
   *     });
   *   };
   * };
   * ```
   *
   * @callback {Function} callback
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb3/Error-object.html).
   */
  PersistedModel.prototype.fillCustomChangeProperties = async function(change) {
    // Original no-op implementation
  }

  PersistedModel.setup()
  return PersistedModel
}
