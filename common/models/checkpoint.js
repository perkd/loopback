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
    const checkpoint = await this.findOne({
      order: 'seq DESC',
    })
    
    if (checkpoint) {
      return checkpoint.seq
    }
    
    // Create the first checkpoint
    const newCheckpoint = await this.create({})
    return newCheckpoint.seq
  }

  /**
   * Increase the current checkpoint if it already exists otherwise initialize it
   * @callback {Function} callback
   * @param {Error} err
   * @param {Object} checkpoint The current checkpoint
   */
  Checkpoint.bumpLastSeq = async function() {
    const latest = await Checkpoint.findOne({ order: 'seq DESC' })
    const newSeq = latest ? latest.seq + 1 : 1
    const { seq } = await Checkpoint.create({ seq: newSeq })

    return seq
  }

  Checkpoint._getSingleton = async function() {
    const query = { limit: 1 }  // match all instances, return only one
    const initialData = { seq: 1 }
    const [ instance ] = await this.findOrCreate(query, initialData)
    return instance
  }
}
