// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert')
const debug = require('debug')('test:e2e:replication')
const loopback = require('../../');
const models = require('../fixtures/e2e/server/models')

const TestModel = models.TestModel;
const LocalTestModel = TestModel.extend('LocalTestModel', {}, {
  trackChanges: true,
});
const RemoteTestModel = TestModel.extend('RemoteTestModel', {}, {
  trackChanges: true,
  forceId: false, // Allow explicit id assignment
});

describe('Replication', function () {
  before(function () {
    // Setup both models with memory connectors
    const localMemory = loopback.memory()
    const remoteMemory = loopback.memory()
    
    LocalTestModel.attachTo(localMemory)
    RemoteTestModel.attachTo(remoteMemory)
  })

  it('should replicate local data to the remote', async function () {    
    const RANDOM = Math.random()
    const created = await LocalTestModel.create({ n: RANDOM })
    
    // Reset checkpoints to ensure we capture all changes
    await LocalTestModel.getChangeModel().getCheckpointModel().create({
      seq: 0,
      time: new Date()
    })
    await RemoteTestModel.getChangeModel().getCheckpointModel().create({
      seq: 0,
      time: new Date()
    })
    
    // Ensure changes are detected properly
    await created.updateAttributes({ updated: true })
    
    // Use replication with explicit since values
    const replicationResult = await LocalTestModel.replicate(
      RemoteTestModel,
      { source: 0, target: 0 },
      { autoResolveConflicts: true }
    )
    debug('Replication result:', replicationResult)

    // Log the models before checking
    debug('LocalTestModel contents:')
    const localRecords = await LocalTestModel.find()
    debug('Local records:', localRecords)
    
    debug('RemoteTestModel contents:')
    const remoteRecords = await RemoteTestModel.find()
    debug('Remote records:', remoteRecords)

    // Check if replication was successful
    const replicatedRecord = await RemoteTestModel.findOne({ where: { n: RANDOM }})
    assert.ok(replicatedRecord, 'Record should be found in RemoteTestModel')
    debug('Replicated record:', replicatedRecord)
    
    // Verify replication was accurate
    assert.equal(created.id, replicatedRecord.id, 'IDs should match')
    assert.equal(replicatedRecord.updated, true, 'The updated property should be replicated')
  })
})
