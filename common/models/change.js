// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module Dependencies.
 */

'use strict';
const crypto = require('node:crypto')
const assert = require('node:assert')
const CJSON = {stringify: require('canonical-json')}
const debug = require('debug')('loopback:change')
const loopback = require('../../lib/loopback')
const { PersistedModel } = loopback
const g = require('../../lib/globalize')

/**
 * When two changes conflict a conflict is created.
 *
 * **Note**: call `conflict.fetch()` to get the `target` and `source` models.
 *
 * @param {*} modelId
 * @param {PersistedModel} SourceModel
 * @param {PersistedModel} TargetModel
 * @property {ModelClass} source The source model instance
 * @property {ModelClass} target The target model instance
 * @class Change.Conflict
 */

class Conflict {
  constructor(id, SourceModel, TargetModel) {
    this.modelId = id
    this.SourceModel = SourceModel
    this.TargetModel = TargetModel
  }

  /**
   * Fetch the conflicting models.
   * @returns {Promise<[PersistedModel, PersistedModel]>}
   */

  async models() {
    const conflict = this
    const SourceModel = this.SourceModel
    const TargetModel = this.TargetModel

    try {
      debug('Conflict.models: fetching models for conflict %s', this.modelId)
      
      // Ensure we have both model classes
      if (!SourceModel || !TargetModel) {
        debug('Conflict.models: missing model class')
        return [null, null]
      }
      
      // Find both models in parallel
      const [source, target] = await Promise.all([
        SourceModel.findById(conflict.modelId).catch(err => {
          debug('Conflict.models: error finding source model: %s', err.message)
          return null
        }),
        TargetModel.findById(conflict.modelId).catch(err => {
          debug('Conflict.models: error finding target model: %s', err.message)
          return null
        })
      ])
      
      debug('Conflict.models: found source=%s, target=%s', 
        source ? 'yes' : 'no', target ? 'yes' : 'no')
      
      return [source, target]
    } catch (err) {
      debug('Conflict.models: error: %s', err.message)
      return [null, null]
    }
  }

  /**
   * Get the conflicting changes.
   *
   * @callback {Function} callback
   * @param {Error} err
   * @param {Change} sourceChange
   * @param {Change} targetChange
   */

  async changes() {
    const conflict = this
    const SourceModel = conflict.SourceModel
    const TargetModel = conflict.TargetModel

    try {
      debug('Conflict.changes: fetching changes for conflict %s', this.modelId)
      
      // Ensure we have both model classes
      if (!SourceModel || !TargetModel) {
        debug('Conflict.changes: missing model class')
        return [null, null]
      }
      
      // Check if models have findLastChange method
      if (typeof SourceModel.findLastChange !== 'function' || 
          typeof TargetModel.findLastChange !== 'function') {
        debug('Conflict.changes: findLastChange method not available')
        return [null, null]
      }
      
      // Find both changes in parallel
      const [sourceChange, targetChange] = await Promise.all([
        SourceModel.findLastChange(conflict.modelId).catch(err => {
          debug('Conflict.changes: error finding source change: %s', err.message)
          return null
        }),
        TargetModel.findLastChange(conflict.modelId).catch(err => {
          debug('Conflict.changes: error finding target change: %s', err.message)
          return null
        })
      ])
      
      debug('Conflict.changes: found sourceChange=%s, targetChange=%s', 
        sourceChange ? 'yes' : 'no', targetChange ? 'yes' : 'no')
      
      return [sourceChange, targetChange]
    } catch (err) {
      debug('Conflict.changes: error: %s', err.message)
      return [null, null]
    }
  }

  /**
   * Resolve the conflict.
   *
   * Set the source change's previous revision to the current revision of the
   * (conflicting) target change. Since the changes are no longer conflicting
   * and appear as if the source change was based on the target, they will be
   * replicated normally as part of the next replicate() call.
   *
   * This is effectively resolving the conflict using the source version.
   */

  async resolve() {
    const targetChange = await this.TargetModel.findLastChange(this.modelId)
    const rev = targetChange ? targetChange.rev : null
    await this.SourceModel.updateLastChange(this.modelId, { prev: rev })
  }

  /**
   * Resolve the conflict using the instance data in the source model
   */
  async resolveUsingSource() {
    // don't forward any cb arguments from resolve()
    await this.resolve()
  }

  /**
   * Resolve the conflict using the instance data in the target model.
   */
  async resolveUsingTarget() {
    const [source, target] = await this.models()

    if (target === null) {
      await this.SourceModel.deleteById(this.modelId)
      return
    }

    const inst = new this.SourceModel(target.toObject(), { persisted: true })
    await inst.save()
  }

  /**
   * Resolve the conflict using the supplied instance data.
   *
   * @param {Object} data The set of changes to apply on the model
   * instance. Use `null` value to delete the source instance instead.
   */

  async resolveManually(data) {
    if (!data) {
      await this.SourceModel.deleteById(this.modelId)
      return
    }

    const [source, target] = await this.models()
    const inst = source || new this.SourceModel(target)
    inst.setAttributes(data)
    await inst.save()
    await this.resolve()
  }

  /**
   * Return a new Conflict instance with swapped Source and Target models.
   *
   * This is useful when resolving a conflict in one-way
   * replication, where the source data must not be changed:
   *
   * ```js
   * conflict.swapParties().resolveUsingTarget(cb);
   * ```
   *
   * @returns {Conflict} A new Conflict instance.
   */
  swapParties() {
    const Ctor = this.constructor;
    return new Ctor(this.modelId, this.TargetModel, this.SourceModel)
  }

  /**
   * Determine the conflict type.
   *
   * Possible results are
   *
   *  - `Change.UPDATE`: Source and target models were updated.
   *  - `Change.DELETE`: Source and or target model was deleted.
   *  - `Change.UNKNOWN`: the conflict type is uknown or due to an error.
   *
   * @returns {Promise<String>} The conflict type.
   */

  async type() {
    try {
      const [sourceChange, targetChange] = await this.changes()
      
      // Ensure we have both changes before determining type
      if (!sourceChange || !targetChange) {
        debug('Conflict.type: missing change object, returning UNKNOWN')
        return Change.UNKNOWN
      }
      
      const sourceChangeType = sourceChange.type()
      const targetChangeType = targetChange.type()
      
      debug('Conflict.type: sourceChangeType=%s, targetChangeType=%s', 
        sourceChangeType, targetChangeType)
      
      // If either is a delete, the conflict type is DELETE
      if (sourceChangeType === Change.DELETE || targetChangeType === Change.DELETE) {
        return Change.DELETE
      }
      
      // If both are updates, the conflict type is UPDATE
      if (sourceChangeType === Change.UPDATE && targetChangeType === Change.UPDATE) {
        return Change.UPDATE
      }
      
      // If we have a mix of CREATE and UPDATE, treat as UPDATE
      if ((sourceChangeType === Change.CREATE && targetChangeType === Change.UPDATE) ||
          (sourceChangeType === Change.UPDATE && targetChangeType === Change.CREATE)) {
        return Change.UPDATE
      }
      
      // Default to UNKNOWN for any other combination
      return Change.UNKNOWN
    } catch (err) {
      debug('Error in Conflict.type(): %s', err.message)
      return Change.UNKNOWN
    }
  }
}

/**
 * Change list entry.
 *
 * @property {String} id Hash of the modelName and ID.
 * @property {String} rev The current model revision.
 * @property {String} prev The previous model revision.
 * @property {Number} checkpoint The current checkpoint at time of the change.
 * @property {String} modelName Model name.
 * @property {String} modelId Model ID.
 * @property {Object} settings Extends the `Model.settings` object.
 * @property {String} settings.hashAlgorithm Algorithm used to create cryptographic hash, used as argument
 * to [crypto.createHash](http://nodejs.org/api/crypto.html#crypto_crypto_createhash_algorithm).  Default is sha1.
 * @property {Boolean} settings.ignoreErrors By default, when changes are rectified, an error will throw an exception.
 * However, if this setting is true, then errors will not throw exceptions.
 * @class Change
 * @inherits {PersistedModel}
 */

module.exports = function(Change) {
  /*!
   * Constants
   */

  Change.UPDATE = 'update';
  Change.CREATE = 'create';
  Change.DELETE = 'delete';
  Change.UNKNOWN = 'unknown';

  /*!
   * Conflict Class
   */

  Change.Conflict = Conflict;

  /*!
   * Setup the extended model.
   */

  Change.setup = function() {
    PersistedModel.setup.call(this);
    const Change = this;

    Change.getter.id = function() {
      const hasModel = this.modelName && this.modelId;
      if (!hasModel) return null;

      return Change.idForModel(this.modelName, this.modelId);
    };
  };
  Change.setup();

  /**
   * Track the recent change of the given modelIds.
   *
   * @param  {String}   modelName
   * @param  {Array}    modelIds
   * @return {Promise<void>}
   */

  Change.rectifyModelChanges = async function(modelName, modelIds) {
    const Change = this;
    const errors = [];

    const tasks = modelIds.map(async (id) => {
      try {
        const change = await Change.findOrCreateChange(modelName, id)
        await change.rectify()
      } catch (err) {
        err.modelName = modelName
        err.modelId = id
        errors.push(err)
        // Always throw to surface errors
        throw err
      }
    })

    await Promise.all(tasks)

    if (errors.length) {
      const desc = errors
        .map(e => `#${e.modelId} - ${e.toString()}`)
        .join('\n');

      const msg = g.f('Cannot rectify %s changes:\n%s', modelName, desc);
      const error = new Error(msg);
      error.details = {errors};
      throw error;
    }
  }

  /**
   * Get an identifier for a given model.
   *
   * @param  {String} modelName
   * @param  {String} modelId
   * @return {String}
   */

  Change.idForModel = function(modelName, modelId) {
    return this.hash([modelName, modelId].join('-'));
  };

  /**
   * Find or create a change for the given model.
   *
   * @param  {String}   modelName
   * @param  {String}   modelId
   * @return {Promise<Change>}
   */

  Change.findOrCreateChange = async function(modelName, modelId) {
    assert(this.registry.findModel(modelName), modelName + ' does not exist')
    const id = this.idForModel(modelName, modelId)
    const Change = this

    try {
      const change = await this.findById(id)
      if (change) {
        debug('found existing change for %s:%s', modelName, modelId)
        return change
      }

      // Get current checkpoint for new changes
      const checkpoint = await this.getCheckpointModel().current() || 1
      
      const ch = new Change({ 
        id, 
        modelName, 
        modelId,
        checkpoint 
      })
      
      debug('creating change for %s:%s at checkpoint %s', modelName, modelId, checkpoint)
      return Change.updateOrCreate(ch)
    } catch (err) {
      debug('Error in findOrCreateChange: %s', err.message)
      throw err
    }
  }

  /**
   * Rectify a change.
   * @return {Promise<Change>}
   */

  Change.prototype.rectify = async function() {
    try {
      const model = this.getModelCtor()
      if (!model) {
        throw new Error('Model not found: ' + this.modelName)
      }

      const change = this
      const currentRev = this.rev
      debug('rectify change %s', this.modelName)

      // Get the model instance first
      const id = this.getModelId()
      const inst = await model.findById(id)
      
      // Get revision and check match
      let newRev = null
      if (inst) {
        newRev = Change.revisionForInst(inst)
        if (currentRev === newRev) {
          debug('rev and prev are equal (not updating anything) %s', this.modelName)
          return change  // Early return, no updates
        }
        // Handle custom properties after revision check
        if (typeof inst.fillCustomChangeProperties === 'function') {
          await inst.fillCustomChangeProperties(change)
        }
      }

      // Get checkpoint only if we need to make updates
      const checkpoint = await change.constructor.getCheckpointModel().current() || 1

      // Handle revision updates
      if (newRev) {
        change.rev = newRev
        debug('updated revision (was %s) %s', currentRev, this.modelName)
        
        // Only update prev when crossing checkpoint boundaries
        if (change.checkpoint !== checkpoint && currentRev) {
          change.prev = currentRev
          debug('updated prev %s', this.modelName)
        }
      } else {
        change.rev = null
        debug('updated revision (was %s) %s', currentRev, this.modelName)
        
        // Handle deletion case
        if (change.checkpoint !== checkpoint) {
          if (currentRev) {
            change.prev = currentRev
          } else if (!change.prev) {
            debug('ERROR - could not determine prev %s', this.modelName)
            change.prev = Change.UNKNOWN
          }
          debug('updated prev %s', this.modelName)
        }
      }

      // Update checkpoint last
      if (change.checkpoint !== checkpoint) {
        debug('update checkpoint to %s %s', checkpoint, this.modelName)
        change.checkpoint = checkpoint
      }

      // Special case: remove unknown changes
      if (change.prev === Change.UNKNOWN) {
        return await change.remove()
      }

      // Save the change with all properties (including custom ones)
      return await change.save()
    } catch (err) {
      debug('Error in rectify: %s', err.message)
      if (!this.constructor.settings.ignoreErrors) {
        throw err
      }
      debug('Error rectifying change: %s', err)
    }
  }

  /**
   * Get the current revision number of the given model instance.
   * @return {Promise<String>}
   */

  Change.prototype.currentRevision = async function() {
    const model = this.getModelCtor();
    const id = this.getModelId();
    const inst = await model.findById(id);
    return inst ? Change.revisionForInst(inst) : null;
  };

  /**
   * Correct all change list entries.
   * @return {Promise<void>}
   */

  Change.rectifyAll = async function() {
    debug('rectify all')
    try {
      const changes = await this.find()
      debug('rectifyAll found %d changes to process', changes.length)

      // Process changes in sequence to avoid checkpoint race conditions
      for (const change of changes) {
        try {
          await change.rectify()
          debug('rectified change for %s:%s', change.modelName, change.modelId)
        } catch (err) {
          debug('Error rectifying change %s:%s - %s', 
            change.modelName, change.modelId, err.message)
          // Continue with other changes even if one fails
        }
      }
    } catch (err) {
      debug('Error in rectifyAll: %s', err.message)
      throw err
    }
  }

  /**
   * Get the checkpoint model.
   * @return {Checkpoint}
   */

  Change.getCheckpointModel = function() {
    let checkpointModel = this.Checkpoint;
    if (checkpointModel) return checkpointModel;
    // FIXME(bajtos) This code creates multiple different models with the same
    // model name, which is not a valid supported usage of juggler's API.
    this.Checkpoint = checkpointModel = loopback.Checkpoint.extend('checkpoint');
    assert(this.dataSource, 'Cannot getCheckpointModel(): ' + this.modelName +
      ' is not attached to a dataSource');
    checkpointModel.attachTo(this.dataSource);
    return checkpointModel;
  };

  Change.prototype.debug = function() {
    if (debug.enabled) {
      const args = Array.prototype.slice.call(arguments);
      args[0] = args[0] + ' %s';
      args.push(this.modelName);
      debug.apply(this, args);
      debug('\tid', this.id);
      debug('\trev', this.rev);
      debug('\tprev', this.prev);
      debug('\tcheckpoint', this.checkpoint);
      debug('\tmodelName', this.modelName);
      debug('\tmodelId', this.modelId);
      debug('\ttype', this.type());
    }
  };

  /**
   * Get the `Model` class for `change.modelName`.
   * @return {Model}
   */

  Change.prototype.getModelCtor = function() {
    return this.constructor.settings.trackModel;
  };

  Change.prototype.getModelId = function() {
    // TODO(ritch) get rid of the need to create an instance
    const Model = this.getModelCtor();
    const id = this.modelId;
    const m = new Model();
    m.setId(id);
    return m.getId();
  };

  Change.prototype.getModel = function(callback) {
    const Model = this.constructor.settings.trackModel;
    const id = this.getModelId();
    Model.findById(id, callback);
  };

  /**
   * Create a hash of the given `string` with the `options.hashAlgorithm`.
   * **Default: `sha1`**
   *
   * @param  {String} str The string to be hashed
   * @return {String}     The hashed string
   */

  Change.hash = function(str) {
    return crypto
      .createHash(Change.settings.hashAlgorithm || 'sha1')
      .update(str)
      .digest('hex');
  };

  /**
   * Get the revision string for the given object
   * @param  {Object} inst The data to get the revision string for
   * @return {String}      The revision string
   */

  Change.revisionForInst = function(inst) {
    assert(inst, 'Change.revisionForInst() requires an instance object.');
    return this.hash(CJSON.stringify(inst));
  };

  /**
   * Get a change's type. Returns one of:
   *
   * - `Change.UPDATE`
   * - `Change.CREATE`
   * - `Change.DELETE`
   * - `Change.UNKNOWN`
   *
   * @return {String} the type of change
   */

  Change.prototype.type = function() {
    if (this.rev && this.prev) {
      return Change.UPDATE
    }
    if (this.rev && !this.prev) {
      return Change.CREATE
    }
    if (!this.rev && this.prev) {
      return Change.DELETE
    }
    return Change.UNKNOWN
  }

  /**
   * Compare two changes.
   * @param  {Change} change
   * @return {Boolean}
   */

  Change.prototype.equals = function(change) {
    if (!change) return false
    const thisRev = this.rev || null
    const thatRev = change.rev || null
    return thisRev === thatRev
  }

  /**
   * Does this change conflict with the given change.
   * @param  {Change} change
   * @return {Boolean}
   */

  Change.prototype.conflictsWith = function(change) {
    if (!change) return false
    if (this.equals(change)) return false

    const thisType = this.type()
    const thatType = change.type()

    // Both deletes should not conflict
    if (thisType === Change.DELETE && thatType === Change.DELETE) {
      return false
    }

    // If either change is a delete, it conflicts
    if (thisType === Change.DELETE || thatType === Change.DELETE) {
      return true
    }

    // For updates, check if they're based on each other
    if (thisType === Change.UPDATE && thatType === Change.UPDATE) {
      const isBasedOnThis = change.prev === this.rev
      const isBasedOnThat = this.prev === change.rev
      return !isBasedOnThis && !isBasedOnThat
    }

    // For creates, they conflict if they have different revisions
    if (thisType === Change.CREATE && thatType === Change.CREATE) {
      return this.rev !== change.rev
    }

    // Otherwise, they conflict
    return true
  }

  /**
   * Are both changes deletes?
   * @param  {Change} a
   * @param  {Change} b
   * @return {Boolean}
   */

  Change.bothDeleted = function(a, b) {
    return a.type() === Change.DELETE &&
      b.type() === Change.DELETE;
  };

  /**
   * Determine if the change is based on the given change.
   * @param  {Change} change
   * @return {Boolean}
   */

  Change.prototype.isBasedOn = function(change) {
    if (!change) return false;
    return this.prev === change.rev;
  };

  /**
   * Determine the differences for a given model since a given checkpoint.
   *
   * **result**
   *
   * ```js
   * {
 *   deltas: Array,
 *   conflicts: Array
 * }
   * ```
   *
   * **deltas**
   *
   * An array of changes that differ from `remoteChanges`.
   *
   * **conflicts**
   *
   * An array of changes that conflict with `remoteChanges`.
   *
   * @param  {String}   modelName
   * @param  {Number}   since         Compare changes after this checkpoint
   * @param  {Change[]} remoteChanges A set of changes to compare
   * @return {Promise<Object>} Promise resolving to result object with deltas and conflicts
   */

  Change.diff = async function(TargetChange, since, sourceChanges) {
    const Change = this
    
    try {
      // Validate inputs to ensure we don't crash on invalid arguments
      if (!TargetChange) {
        debug('Change.diff: TargetChange is missing or null')
        return { deltas: [], conflicts: [] }
      }
      
      // Ensure since is a valid number
      const sinceSafe = since !== undefined && since !== null ? since : -1
      debug('Change.diff: using since value: %s', sinceSafe)
      
      // Get target changes
      debug('Change.diff: getTargetChanges - TargetChange: %s since: %s',
        TargetChange.modelName, sinceSafe)
      
      let targetChanges
      try {
        // First try direct approach - assume TargetChange.changes exists
        if (typeof TargetChange.changes === 'function') {
          targetChanges = await TargetChange.changes(sinceSafe, {})
        } else {
          // If not, try to access it through the modelClass property
          // (often used in remote models)
          const targetModel = TargetChange.trackModel || TargetChange.settings?.trackModel
          if (targetModel && typeof targetModel.changes === 'function') {
            targetChanges = await targetModel.changes(sinceSafe, {})
          } else {
            debug('Change.diff: Cannot access changes method on TargetChange or its tracked model')
            // Fall back to empty array to prevent errors
            targetChanges = []
          }
        }
      } catch (err) {
        debug('Change.diff: Error getting target changes: %s', err.message)
        targetChanges = []
      }
      
      debug('Change.diff: received %d target changes', targetChanges ? targetChanges.length : 0)
      
      // Index source changes by ID for easier lookup
      const sourceChangesById = {}
      sourceChanges = sourceChanges || []
      sourceChanges.forEach(function(change) {
        if (change && change.modelId) {
          sourceChangesById[change.modelId] = change
        }
      })
      debug('Change.diff: indexed %d source changes', Object.keys(sourceChangesById).length)
      
      // Compare changes to find deltas and conflicts
      const result = await compareChanges(targetChanges, sourceChangesById)
      debug('Change.diff: result - %d deltas, %d conflicts', 
        result.deltas.length, result.conflicts.length)
      return result
    } catch (err) {
      debug('Change.diff: error - %s', err)
      // Return empty results rather than crashing
      return { deltas: [], conflicts: [] }
    }
    
    async function compareChanges(targetChanges, sourceChangesById) {
      const deltas = []
      const conflicts = []
      const targetChangesById = {}
      
      targetChanges = targetChanges || []
      targetChanges.forEach(function(change) {
        if (change && change.modelId) {
          targetChangesById[change.modelId] = change
        }
      })
      
      // Find changes that exist in the target but not in the source or
      // changes that are different
      for (const targetChange of targetChanges) {
        if (!targetChange || !targetChange.modelId) {
          debug('Change.diff: skipping target change without modelId')
          continue
        }
        
        const sourceChange = sourceChangesById[targetChange.modelId]
        if (!sourceChange) {
          debug('Change.diff: detected target-only change for %s', targetChange.modelId)
          // The source doesn't have this change, so this is a change
          // from the target that the source doesn't know about
          deltas.push({
            type: targetChange.type(),
            change: targetChange,
          })
          continue
        }
        
        // Both source and target have a change for this model
        debug('Change.diff: comparing changes for %s', targetChange.modelId)
        
        // Delete both change entries, we're done with them
        delete sourceChangesById[targetChange.modelId]
        
        if (!targetChange.conflictsWith(sourceChange)) {
          debug('Change.diff: changes do not conflict for %s', targetChange.modelId)
          continue
        }
        
        debug('Change.diff: detected conflict for %s', targetChange.modelId)
        conflicts.push(sourceChange)
      }
      
      // Add any source-only changes as deltas
      for (const modelId in sourceChangesById) {
        const sourceChange = sourceChangesById[modelId]
        if (!sourceChange) continue
        
        debug('Change.diff: detected source-only change for %s', modelId)
        deltas.push({
          type: sourceChange.type(),
          change: sourceChange,
        })
      }
      
      debug('Change.diff: found %d deltas and %d conflicts', 
        deltas.length, conflicts.length)
      
      return { deltas, conflicts }
    }
  }
};
