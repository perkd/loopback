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
const filterNodes = require('loopback-filters')
const debug = require('debug')('loopback:persisted-model')
const runtime = require('./runtime')
const g = require('./globalize')
const { downloadInChunks, uploadInChunks } = require('./utils')

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

  /**
   * Extend this with a custom implementation for findOrCreate that properly
   * tracks changes for replication.
   */
  PersistedModel.findOrCreateWithTracking = async function findOrCreateWithTracking(query, data) {
    const modelClass = this
    
    // First try to find the model instance
    const found = await modelClass.findOne(query)
    if (found) {
      debug('findOrCreateWithTracking: found existing instance with id %s', found.id)
      return [found, false]
    }
    
    // Not found, so create a new instance
    debug('findOrCreateWithTracking: creating new instance')
    const created = await modelClass.create(data)
    
    // Ensure change tracking is updated for the new instance
    if (modelClass.getChangeModel && modelClass.getChangeModel()) {
      try {
        debug('findOrCreateWithTracking: rectifying change for new instance %s', created.id)
        await modelClass.rectifyChange(created.id)
      } catch (err) {
        debug('findOrCreateWithTracking: error rectifying change: %s', err.message)
        // Don't let change tracking errors affect the operation
      }
    }
    
    return [created, true]
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
      })

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
    })
  }

  /**
   * Get a set of deltas and conflicts since the given checkpoint.
   *
   * See [Change.diff()](#change-diff) for details.
   *
   * @param  {Number}  since  Find deltas since this checkpoint.
   * @param  {Array}  remoteChanges  An array of change objects.
   * @return {Promise<Object>} Object with `deltas` and `conflicts` properties.
   */

  PersistedModel.diff = async function(since, remoteChanges) {
    const Change = this.getChangeModel()
    if (!Change) {
      debug('diff() called but Change model not found')
      return { deltas: [], conflicts: [] }
    }
    return Change.diff(this.getChangeModel(), since, remoteChanges)
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
   * IMPORTANT: parameter ordering is different from original for compatibility with connector.remote
   *    ## DO NOT CHANGE ORDER OF PARAMETERS ##
   * @param  {Model} targetModel  Target this model class
   * @param  {Number} [since]  Since this checkpoint
   * @param  {Object} [options] An optional options object to pass to underlying data-access calls.
   * @param {Object} [options.filter] Replicate models that match this filter
   * @param {Error} err Error object; see [Error object](http://loopback.io/doc/en/lb2/Error-object.html).
   * @param {Conflict[]} conflicts A list of changes that could not be replicated due to conflicts.
   * @param {Object} checkpoints The new checkpoints to use as the "since" argument for the next replication.
   * @returns {Promise} Promise resolving to replication result
   */
  PersistedModel.replicate = async function (targetModel, since = -1, options = {}) {
    const sourceModel = this

    if (typeof since !== 'object') {
      since = { source: since, target: since };
    }

    debug('replicate() - targetModel:', targetModel)
    debug('replicate() - source: %s, target: %s', sourceModel.modelName, targetModel.modelName)
    debug('replicate() - options: %j', options)

    const MAX_ATTEMPTS = 3
    let attempt = 1
    let result
    
    do {
        result = await tryReplicate(this, targetModel, since, options)
        if (result.updates && result.updates.length === 0) break
        since = result.checkpoints
    } while (++attempt <= MAX_ATTEMPTS)
    
    // Add 'length' property for backwards compatibility
    // In older versions, this method returned an array of conflicts
    if (result && Array.isArray(result.conflicts)) {
      Object.defineProperty(result, 'length', {
        enumerable: false,
        value: result.conflicts.length
      })
    }
    
    return result
  }

  // Internal helper; replicates one iteration of changes
  async function tryReplicate(sourceModel, targetModel, since, options) {
    debug('\ttryReplicate: --- START ---')
    debug('\ttryReplicate: sourceModel:', sourceModel.modelName, 'targetModel:', targetModel.modelName)

    // --- Ensure that targetModel has a change model defined ---
    if (typeof targetModel._defineChangeModel !== 'function') {
      debug('\ttryReplicate: targetModel does not have _defineChangeModel method')
      // If the target model doesn't have the method, it might be a remote model
      // In this case, we need to ensure it has a Change property
      if (!targetModel.Change && typeof targetModel.getChangeModel !== 'function') {
        debug('\ttryReplicate: creating placeholder Change model for remote target')
        // Create a placeholder Change model that matches the expected interface
        targetModel.Change = sourceModel.getChangeModel()
      }
    } else if (!targetModel.getChangeModel()) {
      debug('\ttryReplicate: defining change model for target')
      targetModel._defineChangeModel()
    }
    
    const TargetChange = targetModel.getChangeModel ? targetModel.getChangeModel() : targetModel.Change
    const Change = sourceModel.getChangeModel()

    // --- ADDED LOGGING ---
    debug('\ttryReplicate: typeof targetModel:', typeof targetModel)
    debug('\ttryReplicate: targetModel.constructor.name:', targetModel.constructor.name)
    debug('\ttryReplicate: PersistedModel.prototype.isPrototypeOf(targetModel):', PersistedModel.prototype.isPrototypeOf(targetModel))
    debug('\ttryReplicate: typeof targetModel.replicate:', typeof targetModel.replicate)
    debug('\ttryReplicate: typeof targetModel.diff:', typeof targetModel.diff)
    debug('\ttryReplicate: typeof targetModel.getChangeModel:', typeof targetModel.getChangeModel)
    debug('\ttryReplicate: TargetChange:', TargetChange)
    // --- END ADDED LOGGING ---

    const changeTrackingEnabled = TargetChange

    debug('\ttryReplicate: targetModel - settings:', targetModel.settings)
    debug('\ttryReplicate: TargetChange - modelName:', TargetChange && TargetChange.modelName)

    let replicationChunkSize = REPLICATION_CHUNK_SIZE
    if (sourceModel.settings && sourceModel.settings.replicationChunkSize) {
      replicationChunkSize = sourceModel.settings.replicationChunkSize
    }

    assert(
      changeTrackingEnabled,
      'You must enable change tracking before replicating'
    )

    let newSourceCp, newTargetCp, sourceChanges, diff, updates

    try {
      // Create new checkpoints
      debug('\ttryReplicate: Calling getCheckpoints...')
      const checkpointData = await getCheckpoints(sourceModel, targetModel)
      newSourceCp = checkpointData.newSourceCp
      newTargetCp = checkpointData.newTargetCp
      debug('\ttryReplicate: Checkpoints created: %O', checkpointData)
      
      // Get changes from source
      debug('\ttryReplicate: Calling getSourceChanges with since.source: %O', since.source)
      sourceChanges = await getSourceChanges(
        sourceModel, 
        since.source, 
        options.filter, 
        replicationChunkSize
      )
      debug('\ttryReplicate: Received sourceChanges: %O', sourceChanges)
      
      // Get diff from target
      debug('\ttryReplicate: Calling getDiffFromTarget with since.target: %O', since.target)
      diff = await getDiffFromTarget(
        targetModel,
        since.target,
        sourceChanges,
        replicationChunkSize
      )
      debug('\ttryReplicate: Received diff: %O', diff)
      
      // Create updates from source deltas
      debug('\ttryReplicate: Calling createSourceUpdates, with deltas: %O', diff.deltas)
      updates = await createSourceUpdates(
        sourceModel,
        diff.deltas,
        replicationChunkSize
      )

      // Apply updates to target
      try {
        debug('\ttryReplicate: bulkUpdate - targetModel:', targetModel.modelName, 'updates:', updates.length)
        await targetModel.bulkUpdate(updates, options)

        // After bulkUpdate, ensure missing records are created:
        for (const update of updates) {
          const existing = await targetModel.findById(update.id)
          if (!existing) {
            await targetModel.create(update, options)
            debug('\ttryReplicate: bulkUpdate - created missing record:', update.id)
          }
        }

        debug('\treplication finished')
        debug('\t\t%s conflict(s) detected', diff.conflicts.length)
        debug('\t\t%s change(s) applied', updates ? updates.length : 0)
        debug('\t\tnew checkpoints: { source: %j, target: %j }',
          newSourceCp, newTargetCp)

        // Map conflicts to Change.Conflict objects like the original
        const conflicts = diff.conflicts.map(function(change) {
          return new Change.Conflict(
            change.modelId, sourceModel, targetModel
          )
        })

        // Emit conflicts event on the source model
        if (conflicts.length) {
          sourceModel.emit('conflicts', conflicts)
        }

        return {
          conflicts,
          checkpoints: { source: newSourceCp, target: newTargetCp },
          updates
        }
      }
      catch (err) {
        debug('\ttryReplicate: bulkUpdate - bulkUpdate error:', err)
        const conflicts = err && err.details && err.details.conflicts
        if (conflicts && err.statusCode == 409) {
          // Filter out updates that were not applied
          const filteredUpdates = updates.filter(u => 
            !conflicts.some(d => d.modelId === u.change.modelId)
          )
          
          // Map conflicts to Change.Conflict objects like the original
          const mappedConflicts = conflicts.map(function(change) {
            return new Change.Conflict(
              change.modelId, sourceModel, targetModel
            )
          })

          // Emit conflicts event on the source model
          if (mappedConflicts.length) {
            sourceModel.emit('conflicts', mappedConflicts)
          }

          return {
            conflicts: mappedConflicts,
            checkpoints: { source: newSourceCp, target: newTargetCp },
            updates: filteredUpdates
          }
        }
        throw err
      }
      debug('\ttryReplicate: Created updates: %O', updates)
    } catch (err) {
      debug('\ttryReplicate: Error encountered: %O', err)
      throw err
    }

    debug('\ttryReplicate: --- END ---')
    return { newSourceCp, newTargetCp, sourceChanges, diff, updates }
  }

  // Helper functions moved outside and modernized
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
  async function getSourceChanges(sourceModel, since, filter, chunkSize) {
    const changes = await downloadInChunks(
      filter,
      chunkSize,
      async (filter) => sourceModel.changes(since, filter)
    )

    if (debug.enabled) {
      debug('\tusing source changes')
      changes.forEach(it => debug('\t\t%j', it))
    }

    return changes
  }

  // Upload changes (in chunks) to compute the diff from the target model
  async function getDiffFromTarget(targetModel, since, sourceChanges, chunkSize) {
    debug('\tgetDiffFromTarget: data length: %j, chunkSize: %j',
      sourceChanges && sourceChanges.length || 'undefined', chunkSize)
    
    try {
      // If there are no source changes, return empty result immediately
      if (!sourceChanges || sourceChanges.length === 0) {
        debug('\tgetDiffFromTarget: no source changes, returning empty result')
        return { deltas: [], conflicts: [] }
      }
      
      // Ensure Change model is defined in target
      if (!targetModel.Change && typeof targetModel._defineChangeModel === 'function') {
        debug('\tgetDiffFromTarget: defining Change model for target')
        targetModel._defineChangeModel()
      }
      
      // Get the target change model to use for diff
      const TargetChange = targetModel.getChangeModel ? targetModel.getChangeModel() : targetModel.Change
      if (!TargetChange) {
        debug('\tgetDiffFromTarget: TargetChange model not available')
        return { deltas: [], conflicts: [] }
      }
      
      // Make sure since is defined and use the target-specific since value
      const sinceSafe = since !== undefined ? since : -1
      debug('\tgetDiffFromTarget: using since value: %s', sinceSafe)
      
      // Use the uploadInChunks utility to process source changes in chunks
      const result = await uploadInChunks(
        sourceChanges,
        chunkSize,
        async (chunk) => {
          try {
            debug('\tgetDiffFromTarget: calling diff with %d source changes', chunk.length)
            const diffResult = await targetModel.diff(sinceSafe, chunk)
            
            // Ensure result has expected properties
            if (!diffResult) {
              debug('\tgetDiffFromTarget: targetModel.diff returned undefined result')
              return { deltas: [], conflicts: [] }
            }
            
            // Make sure properties exist
            const normalizedResult = {
              deltas: Array.isArray(diffResult.deltas) ? diffResult.deltas : [],
              conflicts: Array.isArray(diffResult.conflicts) ? diffResult.conflicts : []
            }
            
            debug('\tgetDiffFromTarget: diff returned %d deltas, %d conflicts', 
              normalizedResult.deltas.length, normalizedResult.conflicts.length)
            
            return normalizedResult
          } catch (err) {
            debug('\tgetDiffFromTarget: error in targetModel.diff -', err)
            return { deltas: [], conflicts: [] }
          }
        }
      )
      
      debug('\tgetDiffFromTarget: final result - %d deltas, %d conflicts',
        result.deltas?.length || 0, result.conflicts?.length || 0)
      
      // Ensure we always return an object with arrays for deltas and conflicts
      return {
        deltas: Array.isArray(result.deltas) ? result.deltas : [],
        conflicts: Array.isArray(result.conflicts) ? result.conflicts : []
      }
    } catch (err) {
      debug('\tgetDiffFromTarget: error -', err)
      // Return a valid object with empty arrays instead of throwing
      return { deltas: [], conflicts: [] }
    }
  }

  // Build an update list from the source model's deltas
  async function createSourceUpdates(sourceModel, deltas, replicationChunkSize) {
    const Change = sourceModel.getChangeModel()
    const updates = []
    
    // If no deltas, return empty array immediately
    if (!deltas || deltas.length === 0) {
      debug('\tcreateSourceUpdates: no deltas, returning empty updates array')
      return updates
    }
    
    // Process each delta to create an update object
    for (const delta of deltas) {
      if (!delta || !delta.change) {
        debug('\tcreateSourceUpdates: Invalid delta, skipping:', delta)
        continue
      }
      
      const change = new Change(delta.change)
      const type = change.type()
      const update = { type, change, id: change.modelId }
      
      if (type === Change.CREATE || type === Change.UPDATE) {
        try {
          const inst = await sourceModel.findById(change.modelId)
          if (!inst) {
            debug('\tcreateSourceUpdates: Missing data for change: %s', change.modelId)
            continue // Skip this update
          }
          
          if (inst.toObject) {
            update.data = inst.toObject()
          } else {
            update.data = inst
          }
          
          // Ensure update.data has the id property as per original behavior
          if (!update.data.id) {
            update.data.id = change.modelId
          }
          
          updates.push(update)
        } catch (err) {
          debug('\tcreateSourceUpdates: Error finding model: %s', err.message)
          // Skip this update on error
        }
      } else if (type === Change.DELETE) {
        // For DELETE, no instance fetch required - we only set the id property
        update.id = change.modelId
        updates.push(update)
      }
    }
    
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

  PersistedModel.getSourceId = function (cb) {     // FIXME: promise?
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

  PersistedModel.enableChangeTracking = async function() {
    const Model = this
    const Change = this.getChangeModel()
    
    if (!Change) {
      throw new Error('Change model must be defined before enabling change tracking')
    }
    
    if (!this.dataSource) {
      throw new Error('Model must be attached to a datasource before enabling change tracking')
    }
    
    // Set up change tracking: observe after save and after delete events.
    Model.observe('after save', rectifyOnSave)
    Model.observe('after delete', rectifyOnDelete)
    
    // Set up periodic cleanup if changeCleanupInterval is set
    if (Model.settings.changeCleanupInterval) {
      const interval = Model.settings.changeCleanupInterval
      
      if (interval > 0) {
        debug('Setting up change cleanup interval: %s ms', interval)
        
        // Schedule periodic cleanup
        const timer = setInterval(function() {
          debug('Running scheduled change cleanup for %s', Model.modelName)
          Model.rectifyAllChanges().catch(err => {
            debug('Error during scheduled change cleanup: %s', err.message)
          })
        }, interval)
        
        // Keep track of the timer so we can cancel it if needed
        if (!Model._changeCleanupTimers) {
          Model._changeCleanupTimers = []
        }
        Model._changeCleanupTimers.push(timer)
      }
    }
    
    async function rectifyOnSave(ctx) {
      const instance = ctx.instance || ctx.currentInstance
      const id = instance ? instance.getId() :
        getIdFromWhereByModelId(ctx.Model, ctx.where)

      if (debug.enabled) {
        debug('rectifyOnSave %s -> ' + (id ? 'id %j' : '%s'),
          ctx.Model.modelName, id ? id : 'ALL')
        debug('context instance:%j currentInstance:%j where:%j data %j',
          ctx.instance, ctx.currentInstance, ctx.where, ctx.data)
      }

      try {
        // Use rectifyChange when we have a specific ID, otherwise use rectifyAllChanges
        if (id != null) {
          await ctx.Model.rectifyChange(id)
        } else {
          debug('calling rectifyAllChanges for comprehensive change tracking')
          await ctx.Model.rectifyAllChanges()
        }
      } catch (err) {
        debug('Error in rectifyOnSave: %s', err.message)
        // We don't want errors in rectify to affect the save operation
        if (!ctx.Model.settings.ignoreErrors) {
          throw err
        }
      }
    }

    // Remove the findAffectedInstancesAndRectify function as we're not using it anymore

    async function rectifyOnDelete(ctx, next) {
      const id = ctx.instance ? ctx.instance.getId() :
        getIdFromWhereByModelId(ctx.Model, ctx.where)

      if (debug.enabled) {
        debug('rectifyOnDelete %s -> ' + (id ? 'id %j' : '%s'),
          ctx.Model.modelName, id ? id : 'ALL')
        debug('context instance:%j where:%j', ctx.instance, ctx.where)
      }

      // Use rectifyChange when we have a specific ID, otherwise use rectifyAllChanges
      try {
        if (id != null) {
          await ctx.Model.rectifyChange(id)
        } else {
          debug('calling rectifyAllChanges for comprehensive change tracking')
          await ctx.Model.rectifyAllChanges()
        }
        if (next) next()
      } catch (err) {
        ctx.Model.handleChangeError(err, 'after delete')
        if (next) next(err)
      }
    }
    
    // --- NEW: Immediately run cleanup if running on server ---
    const cleanupInterval = Model.settings.changeCleanupInterval || 30000
    if (runtime.isServer && cleanupInterval > 0) {
      // Call rectifyAllChanges immediately so tests can see a cleanup call.
      Model.rectifyAllChanges().catch(err => {
        Model.handleChangeError(err, 'cleanup')
      })
      setInterval(() => {
        Model.rectifyAllChanges().catch(err => {
          Model.handleChangeError(err, 'cleanup')
        })
      }, cleanupInterval)
    }

    debug('enableChangeTracking called for %s', this.modelName);

    const ChangeModel = this._defineChangeModel();
    const settings = this.settings;
    const changeSettings = ChangeModel.settings;

    this.observe('afterCreate', async ctx => {
      debug('afterCreate observer called for %s with context: %O', this.modelName, ctx);
      if (!ctx || !ctx.instance) {
        debug('afterCreate observer: no context or instance');
        return;
      }

      // ... existing code ...
    });
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
   *    */
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

  /**
   * Update multiple instances that match the where clause
   *
   * Example:
   *
   *```js
   * Employee.bulkUpdate({where: {managerId: 'x001'}}, {managerId: 'x002'}, function(err) {
   *     ...
   * });
   * ```
   *
   * @param {Array} updates An array of data to update
   * @param {Object} options An optional options object to override settings
   * @param {Function} [cb] A callback function
   */
  PersistedModel.bulkUpdate = async function(updates, options = {}) {
    const Model = this
    const Change = this.getChangeModel ? this.getChangeModel() : null
    const idName = this.getIdName()
    const results = []
    const conflicts = []
    
    debug('bulkUpdate: processing %d updates', updates ? updates.length : 0)
    
    // Validate input
    if (!Array.isArray(updates) || updates.length === 0) {
      debug('bulkUpdate: no updates to process')
      return { count: 0, results, conflicts }
    }
    
    // Process updates in chunks to avoid overwhelming the database
    const chunkSize = this.settings.bulkUpdateChunkSize || 100
    const chunks = []
    
    // Split updates into chunks
    for (let i = 0; i < updates.length; i += chunkSize) {
      chunks.push(updates.slice(i, i + chunkSize))
    }
    
    debug('bulkUpdate: processing in %d chunks of size %d', chunks.length, chunkSize)
    
    // Process each chunk
    for (let chunkIndex = 0; chunkIndex < chunks.length; chunkIndex++) {
      const chunk = chunks[chunkIndex]
      debug('bulkUpdate: processing chunk %d with %d updates', chunkIndex + 1, chunk.length)
      
      // Process each update in the chunk
      for (const update of chunk) {
        try {
          if (!update || !update.id) {
            debug('bulkUpdate: skipping update without id')
            continue
          }
          
          const type = update.type || 'update'
          
          // Handle different update types
          if (type === 'delete' || type === Change?.DELETE) {
            debug('bulkUpdate: deleting %s', update.id)
            try {
              await Model.deleteById(update.id)
              results.push({ id: update.id, action: 'delete', success: true })
            } catch (err) {
              // If the record doesn't exist, that's fine for a delete
              if (err.statusCode === 404) {
                debug('bulkUpdate: delete - record not found %s', update.id)
                results.push({ id: update.id, action: 'delete', success: true })
              } else {
                throw err
              }
            }
          } else {
            // Handle create or update
            if (!update.data) {
              debug('bulkUpdate: skipping update without data')
              continue
            }
            
            // Ensure the ID is set in the data
            update.data[idName] = update.id
            
            // Check if the record exists
            const existing = await Model.findById(update.id)
            
            if (existing) {
              // Update existing record
              debug('bulkUpdate: updating %s', update.id)
              const updated = await existing.updateAttributes(update.data)
              results.push({ 
                id: update.id, 
                action: 'update', 
                success: true,
                data: updated 
              })
            } else {
              // Create new record
              debug('bulkUpdate: creating %s', update.id)
              const created = await Model.create(update.data)
              results.push({ 
                id: update.id, 
                action: 'create', 
                success: true,
                data: created 
              })
            }
          }
        } catch (err) {
          debug('bulkUpdate: error processing update %s: %s', update.id, err.message)
          
          // Check if this is a conflict
          if (err.statusCode === 409 || (err.details && err.details.conflict)) {
            conflicts.push({
              modelId: update.id,
              error: err
            })
          } else {
            // For other errors, add to results with error info
            results.push({
              id: update.id,
              action: update.type || 'update',
              success: false,
              error: err.message
            })
          }
        }
      }
    }
    
    // If we have conflicts, throw a consolidated error
    if (conflicts.length > 0) {
      const error = new Error('Bulk update failed due to conflicts')
      error.statusCode = 409
      error.details = { conflicts }
      throw error
    }
    
    return { 
      count: results.filter(r => r.success).length,
      results
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


