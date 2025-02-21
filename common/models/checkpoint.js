// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/**
 * Module Dependencies.
 */

'use strict'

/**
 * Checkpoint list entry.
 *
 * @property id {Number} the sequencial identifier of a checkpoint
 * @property time {Number} the time when the checkpoint was created
 * @property sourceId {String}  the source identifier
 *
 * @class Checkpoint
 * @inherits {PersistedModel}
 */

module.exports = function(Checkpoint) {
  // Workaround for https://github.com/strongloop/loopback/issues/292
  Checkpoint.definition.rawProperties.time.default =
    Checkpoint.definition.properties.time.default = function() {
      return new Date()
    }

  /**
   * Retrieves the current (highest) checkpoint sequence number.
   * @callback {Function} callback
   * @param {Error} err
   * @param {Number} checkpoint The current checkpoint seq
   */
  Checkpoint.current = async function() {
    // Use findOrCreate to ensure we always have a valid checkpoint with seq
    const query = { limit: 1 }  // match any record
    const initialData = { seq: 1 }
    const [ checkpoint ] = await this.findOrCreate(query, initialData)
    return checkpoint.seq
  }

  /**
   * Increase the current checkpoint if it already exists otherwise initialize it
   * @callback {Function} callback
   * @param {Error} err
   * @param {Object} checkpoint The current checkpoint
   */
  Checkpoint.bumpLastSeq = async function() {
    const { id, seq } = await this._getSingleton()
    const nextSeq = seq + 1
    
    // Update only if not changed by another process
    await this.updateAll(
      { id, seq },
      { seq: nextSeq }
    )

    return nextSeq
  }

  Checkpoint._getSingleton = async function() {
    const query = { limit: 1 }  // match any record
    const initialData = { seq: 1 }
    const [ instance ] = await this.findOrCreate(query, initialData)
    return instance
  }
}
