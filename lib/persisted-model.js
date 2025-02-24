// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module Dependencies.
 */
'use strict'
const assert = require('node:assert')
const { PassThrough } = require('node:stream')
const deprecated = require('depd')('loopback')
const filterNodes = require('loopback-filters')
const debug = require('debug')('loopback:persisted-model')
const g = require('./globalize')
const runtime = require('./runtime')
const utils = require('./utils')
const async = require('async')

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

    // Only setup remoting if it's available
    if (PersistedModel.hasOwnProperty('sharedClass')) {
      PersistedModel.setupRemoting()
    }
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
   * @param  {Function} cb - // TODO MUST not be promise yet, dependents on migration of remoting
   */
  function convertNullToNotFoundError(ctx, cb) {
    if (ctx.result !== null) return cb()

    const { name: modelName } = ctx.method.sharedClass
    const id = ctx.getArgByName('id')
    const msg = g.f('Unknown "%s" {{id}} "%s".', modelName, id)
    const error = new Error(msg)
    error.statusCode = error.status = 404
    error.code = 'MODEL_NOT_FOUND'
    cb(error)
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

  PersistedModel.upsert = PersistedModel.updateOrCreate
  = PersistedModel.patchOrCreate = async function(data) {
    const idName = this.getIdName()
    let id = data[idName]
    if (id == null) {
      return await this.create(data)
    }

    // Coerce id to a string if the id property is defined as String
    const prop = this.definition.properties[idName]
    if (prop && prop.type === String && typeof id !== 'string') {
      id = data[idName] = id.toString()
    }

    const instance = await this.findById(id)
    if (instance) {
      return await instance.updateAttributes(data)
    }
    return await this.create(data)
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
    debug("upsertWithWhere called with where: %o, data: %o", where, data)
    let instance
    if (data && data.id) {
      debug("Looking up instance by id: %o", data.id)
      instance = await this.findById(data.id)
    } else {
      debug("Looking up instance by where filter: %o", where)
      instance = await this.findOne({ where })
    }

    if (instance) {
      debug("Instance found: %o; updating with data: %o", instance, data)
      const updated = await instance.updateAttributes(data)
      debug("Updated instance: %o", updated)
      return updated
    }

    debug("No instance found; creating new instance with data: %o", data)
    try {
      const created = await this.create(data)
      debug("Created instance: %o", created)
      return created
    } catch (err) {
      debug("Error during create: %o", err)
      // If creation fails with a duplicate error, attempt to update the instance.
      if (err && err.message && err.message.includes("Duplicate entry")) {
        debug("Duplicate entry error encountered, fetching instance by id: %o", data.id)
        instance = await this.findById(data.id)
        if (instance) {
          debug("Instance found after duplicate error; updating instance")
          const updated = await instance.updateAttributes(data)
          debug("Updated instance after duplicate error: %o", updated)
          return updated
        }
      }
      throw err
    }
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
   * the same as `find`, but limited to one object. If you don't provide the filter object argument, it tries to
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
    const data = this.toObject(true)
    const id = this.getId()

    // If no ID, create instead of save
    if (!id) {
      return await Model.create(this)
    }

    // Validate if required
    if (options.validate !== false) {
      if (!await this.isValid()) {
        const err = new Model.ValidationError(this)
        if (options.throws) throw err
        throw err
      }
    }

    // Trigger save events and perform the actual save
    await new Promise((resolve, reject) => {
      const work = async () => {
        try {
          // Trigger update event
          await new Promise((resolveUpdate, rejectUpdate) => {
            this.trigger('update', async () => {
              try {
                // Perform the actual upsert
                await Model.upsert(this)
                this._initProperties(data)
                resolveUpdate()
              } catch (err) {
                rejectUpdate(err) 
              }
            }, data)
          })
          resolve()
        } catch (err) {
          reject(err)
        }
      }

      // Trigger save event
      this.trigger('save', async () => {
        try {
          await work()
        } catch (err) {
          reject(err)
        }
      }, data)
    })

    return this
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
    if (!this.sharedClass) {
      debug('Remoting not available for %s', this.modelName)
      return
    }
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
      const fn = scope[name]
      if (!fn) {
        throw new Error(g.f('Cannot setup remoting for %s.%s: method does not exist', 
          scope.modelName || 'unknown', name))
      }
      
      fn._delegate = true
      options.isStatic = scope === PersistedModel
      PersistedModel.remoteMethod(name, options)
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
      rest: { after: convertNullToNotFoundError },
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
      rest: { after: convertNullToNotFoundError },
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

    // Add change tracking methods for remote models
    const settings = this.settings || {}
    if (settings.trackChanges || settings.enableRemoteReplication) {
      this.sharedClass.defineMethod('changes', {
        http: {verb: 'GET', path: '/changes'},
        accepts: [
          {arg: 'since', type: 'number'},
          {arg: 'filter', type: 'object'},
        ],
        returns: {arg: 'changes', type: 'array', root: true},
      })

      // Move replicate setup here and update it
      setRemoting(PersistedModel, 'replicate', {
        description: 'Replicate changes since the given checkpoint to the target model',
        accessType: 'REPLICATE',
        accepts: [
          {arg: 'since', type: 'number'},
          {arg: 'targetModel', type: 'string', description: 'Target model name'},
          {arg: 'options', type: 'object', http: 'optionsFromRequest'},
        ],
        returns: {arg: 'result', type: 'object', root: true},
        http: {verb: 'post', path: '/replicate'},
        shared: true,
        remoteHook: true
      })
    }
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
    const idName = this.dataSource.idName(this.modelName)
    const Change = this.getChangeModel()
    const model = this

    debug('Getting changes since %s filter %j', since, filter)

    // Create change filter
    const changeFilter = this.createChangeFilter(since, filter)
    debug('Change filter: %j', changeFilter)

    // Set up model filter to only get IDs
    filter = filter || {}
    filter.fields = {}
    filter.where = filter.where || {}
    filter.fields[idName] = true

    // TODO(ritch) this whole thing could be optimized a bit more
    const changes = await Change.find(changeFilter)
    debug('Found %s changes', changes.length)

    if (!Array.isArray(changes) || changes.length === 0) {
      debug('No changes found')
      return []
    }

    // Get the IDs of all models that have changes
    const ids = changes.map((change) => change.getModelId())
    debug('Model IDs with changes: %j', ids)

    // Add the IDs to our filter to only get changed models
    filter.where[idName] = {inq: ids}

    // Find all models that match our filter
    const models = await model.find(filter)
    debug('Found %s matching model instances', models.length)

    // Convert model IDs to strings for comparison
    const modelIds = models.map((m) => m[idName].toString())

    // Only return changes for models that still exist and match the filter
    const filteredChanges = changes.filter((ch) => {
      return modelIds.indexOf(ch.getModelId()) > -1
    })
    debug('Returning %s filtered changes', filteredChanges.length)

    return filteredChanges
  }

  /**
   * Create a checkpoint.
   *
   * Returns a promise that resolves with the new checkpoint sequence.
   */
  PersistedModel.checkpoint = async function(checkpoint) {
    const Checkpoint = this.getChangeModel().getCheckpointModel()
    const seq = await Checkpoint.bumpLastSeq()
    return { seq }
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
   * Replicate changes since the given checkpoint to the target model
   * @param  {Model} targetModel  Target this model class
   * @param  {Number} [since]  Since this checkpoint
   * @param  {Object} [options] An optional options object to pass to underlying data-access calls.
   * @param {Object} [options.filter] Replicate models that match this filter
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Conflict[]} conflicts A list of changes that could not be replicated due to conflicts.
   * @param {Object} checkpoints The new checkpoints to use as the "since" argument for the next replication.
   * @returns {Promise} Promise resolving to replication result
   */
  PersistedModel.replicate = function(targetModel, since, options, callback) {
    // ... (argument handling and change tracking checks) ...

    if (typeof since === 'function') {
      callback = since
      since = undefined
      options = {}
    } else if (typeof options === 'function') {
      callback = options
      options = {}
    }

    options = options || {}
    since = since || {}

    const sourceModel = this

    assert(
      sourceModel !== targetModel,
      'Source and target models cannot be the same',
    )

    assert(
      sourceModel.settings.trackChanges,
      'Change tracking must be enabled',
    )

    // ... (checkpoint initialization) ...

    return new Promise(function(resolve, reject) { // **Promise wrapper**
      async.whilst( // **async.whilst loop**
        function test(cb) { // Test function for async.whilst
          sourceModel.hasChangesSince(since.source, options.filter, function(err, hasChanges) {
            if (err) return cb(err)
            if (!hasChanges) {
              debug('\tno changes found - completing replication')
            }
            cb(null, hasChanges) // Continue loop if hasChanges is true
          })
        },
        function iter(next) { // Iterator function for async.whilst
          debug('\tstarting replication iteration')
          tryReplicate(sourceModel, targetModel, since, options, function(err, conflicts, cps, updates) { // **tryReplicate call!**
            if (err) return next(err)

            since = cps
            debug('\treplication iteration done - new checkpoints %j', since)

            if (conflicts && conflicts.length) {
              debug('\tconflicts detected - replication incomplete')
              return resolve({ conflicts, checkpoints: cps, updates }) // Resolve with conflicts
            }

            next() // Continue to next iteration
          })
        },
        function done(err) { // Final callback for async.whilst
          if (err) return reject(err)
          resolve({ checkpoints: since }) // Resolve with final checkpoints
        },
      )
    })
  }

  // Internal helper; replicates one iteration of changes
  function tryReplicate(sourceModel, targetModel, since, options, callback) {
    debug('\ttryReplicate: --- START ---') // ADDED LOG
    debug('\ttryReplicate: this context - type:', typeof this, this && this.modelName) // ADDED LOG
    debug('\ttryReplicate: sourceModel argument - type:', typeof sourceModel, sourceModel && sourceModel.modelName) // ADDED LOG
    debug('\ttryReplicate: targetModel argument - type:', typeof targetModel, targetModel && targetModel.modelName) // ADDED LOG
    const Change = sourceModel.getChangeModel()
    const TargetChange = targetModel.getChangeModel()
    const changeTrackingEnabled = Change && TargetChange

    debug('\ttryReplicate: targetModel - constructor name:', targetModel.constructor.name)
    debug('\ttryReplicate: targetModel - settings:', targetModel.settings)
    debug('\ttryReplicate: targetModel - type:', typeof targetModel)
    debug('\ttryReplicate: targetModel - modelName:', targetModel && targetModel.modelName)
    debug('\ttryReplicate: TargetChange - type:', typeof TargetChange)
    debug('\ttryReplicate: TargetChange - modelName:', TargetChange && TargetChange.modelName)

    let replicationChunkSize = REPLICATION_CHUNK_SIZE

    if (sourceModel.settings && sourceModel.settings.replicationChunkSize) {
      replicationChunkSize = sourceModel.settings.replicationChunkSize
    }

    assert(
      changeTrackingEnabled,
      'You must enable change tracking before replicating',
    )

    let diff, updates, newSourceCp, newTargetCp

    const tasks = [
      checkpoints,
      getSourceChanges,
      getDiffFromTarget,
      createSourceUpdates,
      bulkUpdate,
    ]

    async.waterfall(tasks, done)

    async function checkpoints() {
      const cb = arguments[arguments.length - 1]
      debug('\ttryReplicate: checkpoints - sourceModel:', sourceModel.modelName, 'targetModel:', targetModel.modelName) // ADDED LOG
      sourceModel.checkpoint(function(err, source) {
        if (err) return cb(err)
        newSourceCp = source.seq
        debug('\ttryReplicate: checkpoints - sourceModel checkpointed:', newSourceCp) // ADDED LOG
        targetModel.checkpoint(function(err, target) {
          if (err) return cb(err)
          newTargetCp = target.seq
          debug('\ttryReplicate: checkpoints - targetModel checkpointed:', newTargetCp) // ADDED LOG
          debug('\tcreated checkpoints')
          debug('\t\t%s for source model %s', newSourceCp, sourceModel.modelName)
          debug('\t\t%s for target model %s', newTargetCp, targetModel.modelName)
          cb()
        })
      })
    }

    function getSourceChanges(cb) {
      debug('\ttryReplicate: getSourceChanges - sourceModel:', sourceModel.modelName, 'since:', since) // ADDED LOG
      utils.downloadInChunks(
        options.filter,
        replicationChunkSize,
        function(filter, pagingCallback) {
          sourceModel.changes(since.source, filter, pagingCallback)
        },
        function log(err, result) {
          if (err) return cb(err)
          debug('\tusing source changes')
          result.forEach(function(it) { debug('\t\t%j', it) })
          debug('\ttryReplicate: getSourceChanges - source changes:', result.length) // ADDED LOG
          cb(err, result)
        },
      )
    }

    function getDiffFromTarget(sourceChanges, cb) {
      debug('\ttryReplicate: getDiffFromTarget - sourceModel:', sourceModel.modelName, 'targetModel:', targetModel.modelName) // ADDED LOG
      Change.diff(
        TargetChange,
        since.target,
        sourceChanges,
        function(err, d) {
          if (err) return cb(err)
          diff = d
          debug('\ttryReplicate: getDiffFromTarget - diff deltas:', diff.deltas.length, 'conflicts:', diff.conflicts.length) // ADDED LOG
          cb()
        })
    }

    async function createSourceUpdates(cb) {
      debug('\ttryReplicate: createSourceUpdates - sourceModel:', sourceModel.modelName, 'deltas:', diff.deltas.length) // ADDED LOG
      updates = await PersistedModel.createUpdates.call(sourceModel, diff.deltas)
      debug('\ttryReplicate: createSourceUpdates - updates created:', updates.length) // ADDED LOG
      cb()
    }

    async function bulkUpdate(cb) {
      debug('\ttryReplicate: bulkUpdate - targetModel:', targetModel.modelName, 'updates:', updates.length) // ADDED LOG
      try {
        const bulkResult = await targetModel.bulkUpdate(updates, options)
        debug('\ttryReplicate: bulkUpdate - bulkUpdate result:', bulkResult) // ADDED LOG
        // After bulkUpdate, ensure missing records are created:
        for (const update of updates) {
          const existing = await targetModel.findById(update.id)
          if (!existing) {
            await targetModel.create(update, options)
            debug('\ttryReplicate: bulkUpdate - created missing record:', update.id) // ADDED LOG
          }
        }
        cb()
      } catch (err) {
        debug('\ttryReplicate: bulkUpdate - bulkUpdate error:', err) // ADDED LOG
        const conflicts = err && err.details && err.details.conflicts
        if (conflicts && err.statusCode == 409) {
          diff.conflicts = conflicts
          // filter out updates that were not applied
          updates = updates.filter(function(u) {
            return conflicts
              .filter(function(d) { return d.modelId === u.change.modelId })
              .length === 0
          })
          return cb()
        }
        cb(err)
      }
    }

    function done(err) {
      debug('\ttryReplicate: done - sourceModel:', sourceModel.modelName, 'targetModel:', targetModel.modelName, 'err:', err, 'conflicts:', diff && diff.conflicts.length) // ADDED LOG
      const conflicts = diff && diff.conflicts || []
      const cps = { source: newSourceCp, target: newTargetCp }
      callback(err, conflicts, cps, updates)
    }
  }

  // Create new checkpoints for both the source and target models
  async function getCheckpoints(sourceModel, targetModel) {
    const sourceCp = await sourceModel.checkpoint()
    let targetCp
    if (targetModel) {
      targetCp = await targetModel.checkpoint()
      debug(`\tcreated checkpoints`)
      debug(`\t\t${sourceCp.seq} for source model ${sourceModel.modelName}`)
      debug(`\t\t${targetCp.seq} for target model ${targetModel.modelName}`)
    } else {
      debug(`\tcreated checkpoint for source model ${sourceModel.modelName}`)
    }
    return { newSourceCp: sourceCp.seq, newTargetCp: targetCp ? targetCp.seq : undefined }
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
    if (!targetModel || typeof targetModel.diff !== 'function') return { conflicts: [], deltas: [] }
    const result = await utils.uploadInChunks(
      sourceChanges,
      replicationChunkSize,
      (smallArray) => targetModel.diff(sinceTarget, smallArray)
    )
    const { conflicts = [], deltas = [] } = result

    if (conflicts.length) {
      debug('\tdiff conflicts')
      conflicts.forEach(d => debug(`\t\t${JSON.stringify(d)}`))
    }
    if (deltas.length) {
      debug('\tdiff deltas')
      deltas.forEach(it => debug(`\t\t${JSON.stringify(it)}`))
    }

    return result
  }

  // Build an update list from the source model's deltas using chunked uploads
  async function createSourceUpdates(sourceModel, deltas, replicationChunkSize) {
    // Ensure each update object has its primary key "id"
    const updates = await Promise.all(deltas.map(async delta => {
      let updateData = await sourceModel.buildUpdateFromChange(delta)
      if (!updateData.id) {
        updateData.id = delta.modelId
      }
      return updateData
    }))
    return updates
  }

  /**
   * Get the `Change` model.
   * Throws an error if the change model is not correctly setup.
   * @return {Change}
   */

  PersistedModel.getChangeModel = function() {
    const changeModel = this.Change || this._defineChangeModel()
    return changeModel
  }

  /**
   * Get the source identifier for this model or dataSource.
   *
   * @callback {Function} callback Callback function called with `(err, id)` arguments.
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {String} sourceId Source identifier for the model or dataSource.
   */

  PersistedModel.getSourceId = function(cb) {
    const dataSource = this.dataSource;
    if (!dataSource) {
      this.once('dataSourceAttached', this.getSourceId.bind(this, cb))
    }
    assert(
      dataSource.connector.name,
      'Model.getSourceId: cannot get id without dataSource.connector.name'
    );
    const id = [dataSource.connector.name, this.modelName].join('-')
    cb(null, id)
  };

  /**
   * Enable the tracking of changes made to the model. Usually for replication.
   */

  PersistedModel.enableChangeTracking = function() {
    const Model = this
    const Change = this.getChangeModel()
    
    if (!Change) {
      throw new Error('Change model must be defined before enabling change tracking')
    }
    
    if (!this.dataSource) {
      throw new Error('Model must be attached to a datasource before enabling change tracking')
    }
    
    // Set up change tracking
    Model.observe('after save', async function(ctx) {
      const change = new Change({
        modelName: Model.modelName,
        modelId: ctx.instance ? ctx.instance.id : ctx.data.id,
      })
      await Change.updateOrCreate(change)
    })
    
    Model.observe('after delete', async function(ctx) {
      const change = new Change({
        modelName: Model.modelName,
        modelId: ctx.where.id,
      })
      await Change.updateOrCreate(change)
    })
  }

  PersistedModel._defineChangeModel = function() {
    const BaseChangeModel = this.registry.getModel('Change')
    const { additionalChangeModelProperties } = this.settings
    const settings = { trackModel: this }

    assert(BaseChangeModel, 'Change model must be defined before enabling change replication')

    if (additionalChangeModelProperties) {
      settings.strict = false
    }

    // make sure we inherit from the base Change model
    this.Change = BaseChangeModel.extend(
      this.modelName + '-change',
      additionalChangeModelProperties || {},
      settings
    )
  
    // Attach related models as in the original:
    // attach the Change model and its Checkpoint (via getCheckpointModel()) to the datasource
    if (this.dataSource) {
      attachRelatedModels(this)
    }
    else {
      this.once('dataSourceAttached', () => {
        attachRelatedModels(this)
      })
    }
    
    function attachRelatedModels(self) {
      self.Change.attachTo(self.dataSource)
      self.Change.getCheckpointModel().attachTo(self.dataSource)
    }
    
    return this.Change
  }

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
    if (!err) return
    this.emit('error', err, operationName)
  }

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
      changes.end()
      changes.emit('end')
      changes.emit('close')
    }

    changes.destroy = changes.destroy || changes._destroy // node 8 compatibility

    changes.on('error', removeHandlers)
    changes.on('close', removeHandlers)
    changes.on('finish', removeHandlers)
    changes.on('end', removeHandlers)

    Model.observe('after save', changeHandler)
    Model.observe('after delete', deleteHandler)

    return changes

    async function changeHandler(ctx) {
      const change = createChangeObject(ctx, 'save')
      if (change) {
        changes.write(change)
      }
    }

    async function deleteHandler(ctx) {
      const change = createChangeObject(ctx, 'delete')
      if (change) {
        changes.write(change)
      }
    }

    function createChangeObject(ctx, type) {
      const where = ctx.where
      let data = ctx.instance || ctx.data
      const whereId = where && where[idName]
      let target

      if (data && (data[idName] || data[idName] === 0)) {
        target = data[idName]
      } else if (where && (where[idName] || where[idName] === 0)) {
        target = where[idName]
      }

      const hasTarget = target === 0 || !!target

      if (options) {
        const filtered = filterNodes([data], options)
        if (filtered.length !== 1) {
          return null
        }
        data = filtered[0]
      }

      const change = {
        target: target,
        where: where,
        data: data,
      }

      switch (type) {
        case 'save':
          if (ctx.isNewInstance === undefined) {
            change.type = hasTarget ? 'update' : 'create'
          } else {
            change.type = ctx.isNewInstance ? 'create' : 'update'
          }
          break
        case 'delete':
          change.type = 'remove'
          break
      }

      return change
    }

    function removeHandlers() {
      Model.removeObserver('after save', changeHandler)
      Model.removeObserver('after delete', deleteHandler)
    }
  }

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
   * ```   * {where: {checkpoint: {gte: since}, modelName: this.modelName}}
   * ```
   */
  PersistedModel.createChangeFilter = function(since, modelFilter) {
    const filter = {
      where: {
        checkpoint: {gte: since},
        modelName: this.modelName,
      }
    }
    if (modelFilter && modelFilter.where) {
      Object.assign(filter.where, modelFilter.where)
    }
    return filter
  }

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
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb3/Error-object.html).
   */
  PersistedModel.prototype.fillCustomChangeProperties = async function(change) {
    // Original no-op implementation
  }

  // Keep as static method
  PersistedModel.bulkUpdate = async function(updates, options = {}) {
    debug('\tbulkUpdate: --- DEBUG LOGGING TEST ---') // ADDED TEST LOG
    const conflicts = []
    const results = []
    const Change = this.getChangeModel()
    const ModelConstructor = this // Capture the Model constructor
    debug('\tbulkUpdate: start - Model:', this.modelName, 'Updates count:', updates.length) // ADDED LOG
    
    // Support legacy callback style
    if (typeof options === 'function') {
      options = {}
    }

    async function updateItem(update) { // Encapsulate update logic
      debug('\t\tupdateItem: start - Model:', ModelConstructor.modelName, 'Update:', update) // ADDED LOG
      debug('\t\tupdateItem: this context:', typeof this, this && this.modelName) // ADDED LOG
      debug('\t\tupdateItem: ModelConstructor:', ModelConstructor && ModelConstructor.modelName) // ADDED LOG
      try {
        // Call update using the ModelConstructor
        const result = await ModelConstructor.update(update, options)
        results.push(result)
        debug('\t\tupdateItem: success - Model:', ModelConstructor.modelName, 'Result:', result) // ADDED LOG
            } catch (error) {
        debug('\t\tupdateItem: error - Model:', ModelConstructor.modelName, 'Error:', error) // ADDED LOG
              if (error.statusCode === 409) {
                conflicts.push({
            modelId: update.id,
            modelName: ModelConstructor.modelName, // Use ModelConstructor.modelName
                  conflict: error.details
                })
              } else {
          throw error // Re-throw errors other than 409
        }
      }
      debug('\t\tupdateItem: end - Model:', ModelConstructor.modelName, 'Conflicts count:', conflicts.length) // ADDED LOG
    }

    for (const update of updates) { // Use a for...of loop for sequential processing
      await updateItem(update) // Await each update
    }
    debug('\tbulkUpdate: end - Model:', this.modelName, 'Total conflicts:', conflicts.length) // ADDED LOG

      return {
        results,
        conflicts: conflicts.length ? conflicts : null
    }
  }

  // Keep as static method 
  PersistedModel.createUpdates = async function(deltas) {
    const Change = this.getChangeModel()
    const Model = this
    const updates = []
    const tasks = []

    // First collect all the tasks
    deltas.forEach(function(changeData) {
      const change = new Change(changeData)
      const type = change.type()
      const update = { type, change }

      if (type === Change.CREATE || type === Change.UPDATE) {
        tasks.push(async () => {
          const inst = await Model.findById(change.modelId)
          if (!inst) {
            throw new Error(g.f('Missing data for change: %s', change.modelId))
          }
          update.data = inst.toObject ? inst.toObject() : inst
          updates.push(update)
        })
      } else if (type === Change.DELETE) {
        updates.push(update)
      }
    })

    // Then execute all tasks
    await Promise.all(tasks.map(t => t()))
    return updates
  }

  // Keep helper function
  async function buildLookupOfAffectedModelData(Model, updates) {
    const idName = Model.dataSource.idName(Model.modelName)
    const affectedIds = updates.map(u => u.change.modelId)
    const whereAffected = {}
    whereAffected[idName] = { inq: affectedIds }
    const affectedList = await Model.find({ where: whereAffected })
    const dataLookup = {}
    affectedList.forEach(it => {
      if (it) {
        dataLookup[it[idName]] = it
      }
    })
    return dataLookup
  }

  function getIdFromWhereByModelId(Model, where) {
    const idName = Model.getIdName()
    if (!(idName in where)) return undefined

    const id = where[idName]
    // Only return simple id values, not query objects
    if (typeof id === 'string' || typeof id === 'number') {
      return id
    }
    return undefined
  }

  PersistedModel.setup()
  return PersistedModel
}

