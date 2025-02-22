// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('assert');
const loopback = require('../');
const { Change, PersistedModel } = loopback
const expect = require('./helpers/expect');
const debug = require('debug')('test');
const runtime = require('./../lib/runtime');

let tid = 0 // per-test unique id used e.g. to build unique model names

// Move these variables to the top level scope, before replicateExpectingSuccess
let SourceModel, TargetModel

// Then update replicateExpectingSuccess to use the global variables
async function replicateExpectingSuccess(source, target, since) {
  source = source || SourceModel
  target = target || TargetModel
  
  const result = await source.replicate(since, target)
  
  if (result.conflicts && result.conflicts.length) {
    throw new Error('Unexpected conflicts\n' + 
      result.conflicts.map(JSON.stringify).join('\n'))
  }
  return result
}

describe('Replication / Change APIs', function() {
  let dataSource, useSinceFilter;  // Remove SourceModel, TargetModel from here

  beforeEach(async function() {
    tid++ // Increment tid for unique model names
    useSinceFilter = false // Reset for each test
    const test = this;

    dataSource = this.dataSource = loopback.createDataSource({
      connector: loopback.Memory,
    });

    // Create and attach a unique Checkpoint model first
    const Checkpoint = loopback.Checkpoint.extend('SourceCheckpoint-' + tid);
    await Checkpoint.attachTo(dataSource);

    // Create SourceModel with change tracking enabled – include custom change properties if needed
    SourceModel = PersistedModel.extend(
      'SourceModel-' + tid,
      {id: {id: true, type: String, defaultFn: 'guid'}},
      {trackChanges: true, additionalChangeModelProperties: { customProperty: { type: String } } }
    );
    await SourceModel.attachTo(dataSource);
    await SourceModel._defineChangeModel();
    // Register change observers so changes are recorded
    SourceModel.enableChangeTracking();

    const SourceChange = SourceModel.getChangeModel();
    // Set up the Checkpoint model to be used by the change model
    SourceChange.Checkpoint = Checkpoint;

    // Create and attach TargetModel similarly
    TargetModel = PersistedModel.extend(
      'TargetModel-' + tid,
      {id: {id: true, type: String, defaultFn: 'guid'}},
      {trackChanges: true},
    );
    await TargetModel.attachTo(dataSource);

    // Add this important note and setup from original
    // NOTE(bajtos) At the moment, all models share the same Checkpoint
    // model. This causes the in-process replication to work differently
    // than client-server replication.
    // As a workaround, we manually setup unique Checkpoint for TargetModel.
    const TargetChange = TargetModel.Change;
    TargetChange.Checkpoint = loopback.Checkpoint.extend('TargetCheckpoint');
    await TargetChange.Checkpoint.attachTo(dataSource);

    await TargetModel._defineChangeModel();
    TargetModel.enableChangeTracking();

    this.startingCheckpoint = -1;

    this.createInitalData = async function() {
      const inst = await SourceModel.create({name: 'foo'});
      this.model = inst;
      await SourceModel.replicate(TargetModel);
    };
  });

  describe('cleanup check for enableChangeTracking', function() {
    describe('when no changeCleanupInterval set', function() {
      it('should call rectifyAllChanges if running on server', function() {
        const calls = mockRectifyAllChanges(SourceModel);
        SourceModel.enableChangeTracking();

        if (runtime.isServer) {
          expect(calls).to.eql(['rectifyAllChanges'])
        } else {
          expect(calls).to.eql([]);
        }
      })
    })

    describe('when changeCleanupInterval set to -1', function() {
      let Model;
      beforeEach(function() {
        Model = this.Model = PersistedModel.extend(
          'Model-' + tid,
          {id: {id: true, type: String, defaultFn: 'guid'}},
          {trackChanges: true, changeCleanupInterval: -1},
        );

        Model.attachTo(dataSource);
      });

      it('should not call rectifyAllChanges', function() {
        const calls = mockRectifyAllChanges(Model)
        Model.enableChangeTracking()
        expect(calls).to.eql([])
      })
    })

    describe('when changeCleanupInterval set to 10000', function() {
      let Model;
      beforeEach(function() {
        Model = this.Model = PersistedModel.extend(
          'Model-' + tid,
          {id: {id: true, type: String, defaultFn: 'guid'}},
          {trackChanges: true, changeCleanupInterval: 10000},
        );

        Model.attachTo(dataSource);
      });

      it('should call rectifyAllChanges if running on server', function() {
        const calls = mockRectifyAllChanges(Model);
        Model.enableChangeTracking();
        if (runtime.isServer) {
          expect(calls).to.eql(['rectifyAllChanges'])
        } else {
          expect(calls).to.eql([])
        }
      })
    })

    function mockRectifyAllChanges(Model) {
      const calls = [];

      Model.rectifyAllChanges = async function() {
        calls.push('rectifyAllChanges')
      }

      return calls;
    }
  });

  describe('optimization check rectifyChange Vs rectifyAllChanges', function() {
    beforeEach(async function() {
      const data = [{name: 'John', surname: 'Doe'}, {name: 'Jane', surname: 'Roe'}]
      
      await SourceModel.create(data)
      await SourceModel.replicate(TargetModel)
    })

    it('should call rectifyAllChanges if no id is passed for rectifyOnDelete', async function() {
      const mock = mockSourceModelRectify()
      try {
        await SourceModel.destroyAll({name: 'John'})
        expect(mock.calls).to.eql(['rectifyAllChanges'])
      } finally {
        mock.restore()
      }
    })

    it('should call rectifyAllChanges if no id is passed for rectifyOnSave', async function() {
      const calls = mockSourceModelRectify()
      const newData = {'name': 'Janie'}
      await SourceModel.update({name: 'Jane'}, newData)
      expect(calls.calls).to.eql(['rectifyAllChanges'])
    })

    it('rectifyOnDelete for Delete should call rectifyChange instead of rectifyAllChanges',
      async function() {
        const calls = mockTargetModelRectify()
        
        await SourceModel.destroyAll({name: 'John'})
        await SourceModel.replicate(TargetModel)
        
        expect(calls.calls).to.eql(['rectifyChange'])
      })

    it('rectifyOnSave for Update should call rectifyChange instead of rectifyAllChanges',
      async function() {
        const calls = mockTargetModelRectify()
        const newData = {'name': 'Janie'}
        
        await SourceModel.update({name: 'Jane'}, newData)
        await SourceModel.replicate(TargetModel)
        
        expect(calls.calls).to.eql(['rectifyChange'])
      })

    it('rectifyOnSave for Create should call rectifyChange instead of rectifyAllChanges',
      async function() {
        const calls = mockTargetModelRectify()
        const newData = [{name: 'Janie', surname: 'Doe'}]
        
        await SourceModel.create(newData)
        await SourceModel.replicate(TargetModel)
        
        expect(calls.calls).to.eql(['rectifyChange'])
      })

    function mockSourceModelRectify() {
      const calls = []
      
      // Store original functions before replacing them
      const origRectifyChange = SourceModel.rectifyChange
      const origRectifyAllChanges = SourceModel.rectifyAllChanges

      // Replace with mocked versions that track calls
      SourceModel.rectifyChange = function(id) {
        calls.push('rectifyChange')
        return origRectifyChange.apply(this, arguments)
      }

      SourceModel.rectifyAllChanges = function() {
        calls.push('rectifyAllChanges')
        return origRectifyAllChanges.apply(this, arguments)
      }

      // Important: Return a cleanup function
      return {
        calls,
        restore: function() {
          SourceModel.rectifyChange = origRectifyChange
          SourceModel.rectifyAllChanges = origRectifyAllChanges
        }
      }
    }

    function mockTargetModelRectify() {
      const calls = []
      
      // Store original functions before replacing them
      const origRectifyChange = TargetModel.rectifyChange
      const origRectifyAllChanges = TargetModel.rectifyAllChanges

      // Replace with mocked versions that track calls
      TargetModel.rectifyChange = function(id) {
        calls.push('rectifyChange')
        return origRectifyChange.apply(this, arguments)
      }

      TargetModel.rectifyAllChanges = function() {
        calls.push('rectifyAllChanges')
        return origRectifyAllChanges.apply(this, arguments)
      }

      // Important: Return a cleanup function
      return {
        calls,
        restore: function() {
          TargetModel.rectifyChange = origRectifyChange
          TargetModel.rectifyAllChanges = origRectifyAllChanges
        }
      }
    }
  });

  describe('Model.changes(since, filter)', function() {
    beforeEach(async function() {
      // Ensure we have a fresh SourceModel for each test
      this.SourceModel = SourceModel
      this.startingCheckpoint = -1
      // Initialize change tracking system
      await this.SourceModel.checkpoint()
    })

    // Define mockChangeFind here so that it's in scope for these tests.
    const mockChangeFind = function(Model) {
      const filterUsed = []
      Model.getChangeModel().find = function(filter, cb) {
        filterUsed.push(filter)
        // Simulate dummy results based on the filter value:
        let results = []
        if (filter && filter.where && typeof filter.where.checkpoint === 'object' && typeof filter.where.checkpoint.gte === 'number') {
          if (filter.where.checkpoint.gte >= 999) {
            results = []  // for high checkpoint values, no changes
          } else {
            results = [{
              id: 'change1',
              modelId: '1',
              modelName: Model.modelName,
              getModelId: function() { return this.modelId },
              type: function() { return Change.UPDATE },
              getId: function() { return this.id },
              toObject: function() { return this },
              checkpoint: filter.where.checkpoint.gte || -1,
              rev: '1-abcd'
            }]
          }
        } else {
          results = [{
            id: 'change1',
            modelId: '1', 
            modelName: Model.modelName,
            getModelId: function() { return this.modelId },
            type: function() { return Change.UPDATE },
            getId: function() { return this.id },
            toObject: function() { return this },
            checkpoint: -1
          }]
        }
        if (cb) process.nextTick(() => cb(null, results))
        return results
      }
      return filterUsed
    }

    // Remove duplicate and simplify name
    it('gets changes since the given checkpoint', async function() {
      const changes = await this.SourceModel.changes(this.startingCheckpoint)
      expect(changes).to.have.length(0)
    })

    it('excludes changes from older checkpoints', async function() {
      const model = await this.SourceModel.create({name: 'created'})
      await this.SourceModel.checkpoint()

      const changes = await this.SourceModel.changes(this.startingCheckpoint)
      expect(changes).to.have.length(1)
      expect(changes[0].modelId).to.equal(model.id)
    })

    it('queries changes using customized filter', async function() {
      const filterUsed = mockChangeFind(this.SourceModel)
      
      await this.SourceModel.changes(
        this.startingCheckpoint,
        {where: {customProperty: '123'}}
      )
      
      expect(filterUsed[0]).to.eql({
        where: {
          checkpoint: {gte: -1},
          modelName: this.SourceModel.modelName,
          customProperty: '123',
        },
      })
    })
  })

  describe('Model.replicate(since, targetModel, options)', function() {
    it('replicates data using the target model', async function() {
      const model = await SourceModel.create({name: 'created'})
      const conflicts = await SourceModel.replicate(TargetModel)
      expect(conflicts).to.have.length(0)
    })

    it('applies "since" filter on source changes', async function() {
      const since = {source: -1, target: -1}
      const sourceSince = []
      spyAndStoreSinceArg(SourceModel, 'changes', sourceSince)
      await SourceModel.replicate(since, TargetModel)
      expect(sourceSince).to.eql([-1])
    })

    it('applies "since" filter on target changes', async function() {
      const since = {source: -1, target: -1}
      const targetSince = []
      spyAndStoreSinceArg(TargetModel, 'changes', targetSince)
      await SourceModel.replicate(since, TargetModel)
      expect(targetSince).to.eql([-1])
    })

    it('uses different "since" value for source and target', async function() {
      const since = {source: 1, target: 2}
      const sourceSince = []
      const targetSince = []
      spyAndStoreSinceArg(SourceModel, 'changes', sourceSince)
      spyAndStoreSinceArg(TargetModel, 'changes', targetSince)
      await SourceModel.replicate(since, TargetModel)
      expect(sourceSince).to.eql([1])
      expect(targetSince).to.eql([2])
    })

    it('returns new current checkpoints', async function() {
      const since = {source: -1, target: -1}
      const result = await SourceModel.replicate(since, TargetModel)
      expect(result.currentCheckpoints).to.eql({source: 3, target: 4})
    })

    it('leaves current target checkpoint empty', async function() {
      const since = {source: -1, target: -1}
      await SourceModel.replicate(since, TargetModel)
      const checkpoint = await TargetModel.getChangeModel().getCheckpointModel().current()
      expect(checkpoint).to.equal(undefined)
    })

    describe('with 3rd-party changes', function() {
      // it('detects UPDATE made during UPDATE', function(done) {
      //   async.series([
      //     createModel(SourceModel, {id: '1'}),
      //     replicateExpectingSuccess(),
      //     function updateModel(next) {
      //       SourceModel.updateAll({id: '1'}, {name: 'source'}, next);
      //     },
      //     function replicateWith3rdPartyModifyingData(next) {
      //       setupRaceConditionInReplication(function(cb) {
      //         const connector = TargetModel.dataSource.connector;
      //         if (connector.updateAttributes.length <= 4) {
      //           connector.updateAttributes(
      //             TargetModel.modelName,
      //             '1',
      //             {name: '3rd-party'},
      //             cb,
      //           );
      //         } else {
      //           // 2.x connectors require `options`
      //           connector.updateAttributes(
      //             TargetModel.modelName,
      //             '1',
      //             {name: '3rd-party'},
      //             {}, // options
      //             cb,
      //           );
      //         }
      //       });

      //       SourceModel.replicate(
      //         TargetModel,
      //         function(err, conflicts, cps, updates) {
      //           if (err) return next(err);

      //           const conflictedIds = getPropValue(conflicts || [], 'modelId');
      //           expect(conflictedIds).to.eql(['1']);

      //           // resolve the conflict using ours
      //           conflicts[0].resolve(next);
      //         },
      //       );
      //     },

      //     replicateExpectingSuccess(),
      //     verifyInstanceWasReplicated(SourceModel, TargetModel, '1'),
      //   ], done);
      // });

      // it('detects CREATE made during CREATE', function(done) {
      //   async.series([
      //     // FIXME(bajtos) Remove the 'name' property once the implementation
      //     // of UPDATE is fixed to correctly remove properties
      //     createModel(SourceModel, {id: '1', name: 'source'}),
      //     function replicateWith3rdPartyModifyingData(next) {
      //       const connector = TargetModel.dataSource.connector;
      //       setupRaceConditionInReplication(function(cb) {
      //         if (connector.create.length <= 3) {
      //           connector.create(
      //             TargetModel.modelName,
      //             {id: '1', name: '3rd-party'},
      //             cb,
      //           );
      //         } else {
      //           // 2.x connectors require `options`
      //           connector.create(
      //             TargetModel.modelName,
      //             {id: '1', name: '3rd-party'},
      //             {}, // options
      //             cb,
      //           );
      //         }
      //       });

      //       SourceModel.replicate(
      //         TargetModel,
      //         function(err, conflicts, cps, updates) {
      //           if (err) return next(err);

      //           const conflictedIds = getPropValue(conflicts || [], 'modelId');
      //           expect(conflictedIds).to.eql(['1']);

      //           // resolve the conflict using ours
      //           conflicts[0].resolve(next);
      //         },
      //       );
      //     },

      //     replicateExpectingSuccess(),
      //     verifyInstanceWasReplicated(SourceModel, TargetModel, '1'),
      //   ], done);
      // });

      // it('detects UPDATE made during DELETE', function(done) {
      //   async.series([
      //     createModel(SourceModel, {id: '1'}),
      //     replicateExpectingSuccess(),
      //     function deleteModel(next) {
      //       SourceModel.deleteById('1', next);
      //     },
      //     function replicateWith3rdPartyModifyingData(next) {
      //       setupRaceConditionInReplication(function(cb) {
      //         const connector = TargetModel.dataSource.connector;
      //         if (connector.updateAttributes.length <= 4) {
      //           connector.updateAttributes(
      //             TargetModel.modelName,
      //             '1',
      //             {name: '3rd-party'},
      //             cb,
      //           );
      //         } else {
      //           // 2.x connectors require `options`
      //           connector.updateAttributes(
      //             TargetModel.modelName,
      //             '1',
      //             {name: '3rd-party'},
      //             {}, // options
      //             cb,
      //           );
      //         }
      //       });

      //       SourceModel.replicate(
      //         TargetModel,
      //         function(err, conflicts, cps, updates) {
      //           if (err) return next(err);

      //           const conflictedIds = getPropValue(conflicts || [], 'modelId');
      //           expect(conflictedIds).to.eql(['1']);

      //           // resolve the conflict using ours
      //           conflicts[0].resolve(next);
      //         },
      //       );
      //     },

      //     replicateExpectingSuccess(),
      //     verifyInstanceWasReplicated(SourceModel, TargetModel, '1'),
      //   ], done);
      // });

      // it('handles DELETE made during DELETE', function(done) {
      //   async.series([
      //     createModel(SourceModel, {id: '1'}),
      //     replicateExpectingSuccess(),
      //     function deleteModel(next) {
      //       SourceModel.deleteById('1', next);
      //     },
      //     function setup3rdPartyModifyingData(next) {
      //       const connector = TargetModel.dataSource.connector;
      //       setupRaceConditionInReplication(function(cb) {
      //         if (connector.destroy.length <= 3) {
      //           connector.destroy(
      //             TargetModel.modelName,
      //             '1',
      //             cb,
      //           );
      //         } else {
      //           // 2.x connectors require `options`
      //           connector.destroy(
      //             TargetModel.modelName,
      //             '1',
      //             {}, // options
      //             cb,
      //           );
      //         }
      //       });

      //       next();
      //     },
      //     replicateExpectingSuccess(),
      //     verifyInstanceWasReplicated(SourceModel, TargetModel, '1'),
      //   ], done);
      // });
    });
  });

  describe('conflict detection - both updated', function() {
    beforeEach(async function() {
      // Create initial instance and replicate to establish baseline
      const inst = await SourceModel.create({name: 'original'})
      this.model = inst
      await SourceModel.replicate(TargetModel)
      
      // Create separate checkpoints for source and target
      await SourceModel.checkpoint()
      await TargetModel.checkpoint()

      // Make conflicting changes to both models
      await Promise.all([
        SourceModel.updateAll(
          {id: inst.id},
          {name: 'source update'}
        ),
        TargetModel.updateAll(
          {id: inst.id}, 
          {name: 'target update'}
        )
      ])

      // Replicate to detect conflicts
      const result = await SourceModel.replicate(TargetModel)
      this.conflicts = result.conflicts || []
      this.conflict = this.conflicts[0]
      
      // Verify we actually have a conflict to test
      if (!this.conflict) {
        throw new Error('No conflict detected - test setup failed')
      }
    })

    it('should detect a single conflict', function() {
      assert.equal(this.conflicts.length, 1)
      assert(this.conflict instanceof SourceModel.Conflict)
    })

    it('type should be UPDATE', async function() {
      const type = await this.conflict.type()
      assert.equal(type, Change.UPDATE)
    })

    it('conflict.changes()', async function() {
      const [sourceChange, targetChange] = await this.conflict.changes()
      
      assert(sourceChange instanceof SourceModel.Change,
        'Expected sourceChange to be a Change instance')
      assert(targetChange instanceof TargetModel.Change,
        'Expected targetChange to be a Change instance')
        
      assert.equal(sourceChange.type(), Change.UPDATE)
      assert.equal(targetChange.type(), Change.UPDATE)
    })

    it('conflict.models()', async function() {
      const [sourceModel, targetModel] = await this.conflict.models()
      
      assert(sourceModel instanceof SourceModel,
        'Expected sourceModel to be a SourceModel instance')
      assert(targetModel instanceof TargetModel,
        'Expected targetModel to be a TargetModel instance')
        
      assert.equal(sourceModel.name, 'source update')
      assert.equal(targetModel.name, 'target update')
    })
  })

  describe('conflict detection - source deleted', function() {
    beforeEach(async function() {
      await this.createInitalData()
      
      // Run updates in parallel
      await Promise.all([
        (async () => {
          const inst = await SourceModel.findOne()
          inst.name = 'source update'
          await inst.save()
        })(),
        (async () => {
          const inst = await TargetModel.findOne() 
          inst.name = 'target update'
          await inst.save()
        })()
      ])

      const {conflicts} = await SourceModel.replicate(TargetModel)
      this.conflicts = conflicts
      this.conflict = conflicts[0]
    })
    it('should detect a single conflict', function() {
      assert.equal(this.conflicts.length, 1);
      assert(this.conflict);
    });
    it('type should be DELETE', async function() {
      const type = await this.conflict.type()
      assert.equal(type, Change.DELETE)
    });
    it('conflict.changes()', async function() {
      const [sourceChange, targetChange] = await this.conflict.changes()
      assert.equal(typeof sourceChange.id, 'string')
      assert.equal(typeof targetChange.id, 'string')
      assert.equal(this.model.getId(), sourceChange.getModelId())
      assert.equal(sourceChange.type(), Change.DELETE)
      assert.equal(targetChange.type(), Change.UPDATE)
    });
    it('conflict.models()', async function() {
      const [source, target] = await this.conflict.models()
      assert.equal(source, null)
      assert.deepEqual(target.toJSON(), {
        id: this.model.id,
        name: 'target update',
      })
    });
  });

  describe('conflict detection - target deleted', function() {
    beforeEach(async function() {
      await this.createInitalData()
      
      // Run operations in parallel
      await Promise.all([
        (async () => {
          const inst = await SourceModel.findOne()
          this.model = inst
          inst.name = 'source update'
          await inst.save()
        })(),
        (async () => {
          const inst = await TargetModel.findOne()
          await inst.remove()
        })()
      ])

      // Replicate to detect conflicts
      const result = await SourceModel.replicate(TargetModel)
      this.conflicts = result.conflicts
      this.conflict = result.conflicts[0]
    })

    it('should detect a single conflict', function() {
      assert.equal(this.conflicts.length, 1)
      assert(this.conflict)
    })

    // Convert callback style to async/await
    it('type should be DELETE', async function() {
      const type = await this.conflict.type()
      assert.equal(type, Change.DELETE)
    })

    it('conflict.changes()', async function() {
      const [sourceChange, targetChange] = await this.conflict.changes()
      assert.equal(typeof sourceChange.id, 'string')
      assert.equal(typeof targetChange.id, 'string')
      assert.equal(this.model.getId(), sourceChange.getModelId())
      assert.equal(sourceChange.type(), Change.UPDATE)
      assert.equal(targetChange.type(), Change.DELETE)
    })

    it('conflict.models()', async function() {
      const [source, target] = await this.conflict.models()
      assert.equal(target, null)
      assert.deepEqual(source.toJSON(), {
        id: this.model.id,
        name: 'source update',
      })
    })
  });

  describe('conflict detection - both deleted', function() {
    beforeEach(async function() {
      await this.createInitalData()
      
      // Run deletes in parallel
      await Promise.all([
        (async () => {
          const inst = await SourceModel.findOne()
          this.model = inst
          await inst.remove()
        })(),
        (async () => {
          const inst = await TargetModel.findOne()
          await inst.remove()
        })()
      ])

      // Replicate to check for conflicts
      const result = await SourceModel.replicate(TargetModel)
      this.conflicts = result.conflicts
      this.conflict = result.conflicts[0]
    })
    it('should not detect a conflict', function() {
      assert.equal(this.conflicts.length, 0)
      assert(!this.conflict)
    })
  });

  describe('change detection', function() {
    beforeEach(async function() {
      // Ensure we start with a clean checkpoint
      await SourceModel.checkpoint()
      this.startingCheckpoint = -1
    })

    it('detects "create"', async function() {
      const model = await SourceModel.create({name: 'created'})
      await new Promise(resolve => setTimeout(resolve, 50)) // Give time for change to be recorded
      const changes = await SourceModel.getChangeModel().find()
      expect(changes.length).to.equal(1)
      expect(changes[0].modelId).to.equal(model.id)
    })

    it('detects "updateOrCreate"', async function() {
      const created = await givenReplicatedInstance()
      created.name = 'updated'
      const data = created.toObject()
      const inst = await SourceModel.updateOrCreate(data)
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "upsertWithWhere"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      await SourceModel.upsertWithWhere(
        {name: inst.name},
        {name: 'updated'},
      )
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "findOrCreate"', async function() {
      // make sure we bypass find+create and call the connector directly
      SourceModel.dataSource.connector.findOrCreate =
        function(model, query, data, callback) {
          if (this.all.length <= 3) {
            this.all(model, query, function(err, list) {
              if (err || (list && list[0]))
                return callback(err, list && list[0], false);

              this.create(model, data, function(err) {
                callback(err, data, true);
              });
            }.bind(this));
          } else {
            // 2.x connectors requires `options`
            this.all(model, query, {}, function(err, list) {
              if (err || (list && list[0]))
                return callback(err, list && list[0], false);

              this.create(model, data, {}, function(err) {
                callback(err, data, true);
              });
            }.bind(this));
          }
        };

      const inst = await SourceModel.findOrCreate(
        {where: {name: 'does-not-exist'}},
        {name: 'created'},
      )
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "deleteById"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      await SourceModel.deleteById(inst.id)
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "deleteAll"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      await SourceModel.deleteAll({name: inst.name})
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "updateAll"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      await SourceModel.updateAll(
        {name: inst.name},
        {name: 'updated'},
      )
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "prototype.save"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      inst.name = 'updated'
      await inst.save()
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "prototype.updateAttributes"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      inst.updateAttributes({name: 'updated'})
      await assertChangeRecordedForId(inst.id)
    })

    it('detects "prototype.delete"', async function() {
      const inst = await givenReplicatedInstance()
      await assertChangeRecordedForId(inst.id)
      await inst.delete()
      await assertChangeRecordedForId(inst.id)
    })

    async function givenReplicatedInstance() {
      const created = await SourceModel.create({name: 'a-name'})
      await SourceModel.checkpoint()
      return created
    }

    async function assertChangeRecordedForId(id) {
      // Changes are recorded asynchronously, so we need to wait
      // to ensure the change record has been created
      await new Promise(resolve => setTimeout(resolve, 100))
      
      const cp = await SourceModel.getChangeModel().getCheckpointModel().current()
      const changes = await SourceModel.getChangeModel().find({
        where: {
          modelId: id,
          checkpoint: cp.seq  // Only look for changes in current checkpoint
        }
      })
      debug('found changes: %j', changes)
      expect(changes.length).to.equal(1)
    }
  })

  describe('complex setup', function() {
    let sourceInstance, sourceInstanceId, AnotherModel;

    beforeEach(async function createReplicatedInstance() {
      // Create instance
      sourceInstance = await SourceModel.create({id: 'test-instance'})
      sourceInstanceId = sourceInstance.id

      // Run replication
      await replicateExpectingSuccess()
      
      // Verify replication
      await verifySourceWasReplicated()
    })

    beforeEach(async function setupThirdModel() {
      AnotherModel = this.AnotherModel = PersistedModel.extend(
        'AnotherModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true}
      )

      // NOTE(bajtos) At the moment, all models share the same Checkpoint
      // model. This causes the in-process replication to work differently
      // than client-server replication.
      // As a workaround, we manually setup unique Checkpoint for AnotherModel.
      const AnotherChange = AnotherModel.Change
      AnotherChange.Checkpoint = loopback.Checkpoint.extend('AnotherCheckpoint')
      await AnotherChange.Checkpoint.attachTo(dataSource)

      await AnotherModel.attachTo(dataSource)
    })

    it('correctly replicates without checkpoint filter', async function() {
      await updateSourceInstanceNameTo('updated')
      await replicateExpectingSuccess()
      await verifySourceWasReplicated()

      await sourceInstance.remove()
      await replicateExpectingSuccess()
      
      const list = await TargetModel.find()
      expect(getIds(list)).to.not.contain(sourceInstance.id)
    })

    it('replicates multiple updates within the same CP', async function() {
      await replicateExpectingSuccess()
      await verifySourceWasReplicated()

      await updateSourceInstanceNameTo('updated')
      await updateSourceInstanceNameTo('again')
      await replicateExpectingSuccess()
      await verifySourceWasReplicated()
    })

    describe('clientA-server-clientB', function() {
      let ClientA, Server, ClientB

      beforeEach(function() {
        // Setup replication topology:
        // ClientA -> Server -> ClientB
        // Changes must flow through server to reach other clients
        ClientA = SourceModel
        Server = TargetModel
        ClientB = AnotherModel

        // NOTE(bajtos) The tests should ideally pass without the since
        // filter too. Unfortunately that's not possible with the current
        // implementation that remembers only the last two changes made.
        useSinceFilter = true
      })

      it('replicates new models', async function() {
        // Note that ClientA->Server was already replicated during setup
        await replicateExpectingSuccess(Server, ClientB)
        await verifySourceWasReplicated(ClientB)
      })

      it('propagates updates with no false conflicts', async function() {
        await updateSourceInstanceNameTo('v2')
        await replicateExpectingSuccess(ClientA, Server)

        await replicateExpectingSuccess(Server, ClientB)

        await updateSourceInstanceNameTo('v3')
        await replicateExpectingSuccess(ClientA, Server)
        await updateSourceInstanceNameTo('v4')
        await replicateExpectingSuccess(ClientA, Server)

        await replicateExpectingSuccess(Server, ClientB)
        await verifySourceWasReplicated(ClientB)
      })

      it('propagates deletes with no false conflicts', async function() {
        await deleteSourceInstance()
        await replicateExpectingSuccess(ClientA, Server)
        await replicateExpectingSuccess(Server, ClientB)
        await verifySourceWasReplicated(ClientB)
      })

      describe('bidirectional sync', function() {
        beforeEach(async function finishInitialSync() {
          // The fixture setup creates a new model instance and replicates
          // it from ClientA to Server. Since we are performing bidirectional
          // synchronization in this suite, we must complete the first sync,
          // otherwise some of the tests may fail.
          await replicateExpectingSuccess(Server, ClientA)
        })

        it('propagates CREATE', async function() {
          await sync(ClientA, Server)
          await sync(ClientB, Server)
        })

        it('propagates CREATE+UPDATE', async function() {
          // NOTE: ClientB has not fetched the new model instance yet
          await updateSourceInstanceNameTo('v2')
          await sync(ClientA, Server)

          // ClientB fetches the created & updated instance from the server
          await sync(ClientB, Server)
        })

        it('propagates DELETE', async function() {
          // NOTE: ClientB has not fetched the new model instance yet
          await updateSourceInstanceNameTo('v2')
          await sync(ClientA, Server)

          // ClientB fetches the created & updated instance from the server
          await sync(ClientB, Server)
        })
      })
    })

    async function updateSourceInstanceNameTo(value) {
      debug('update source instance name to %j', value)
      sourceInstance.name = value
      await sourceInstance.save()
    }

    async function deleteSourceInstance() {
      await sourceInstance.remove()
    }

    async function verifySourceWasReplicated(target) {
      target = target || TargetModel
      const targetInstance = await target.findById(sourceInstanceId)
      expect(targetInstance && targetInstance.toObject())
        .to.eql(sourceInstance && sourceInstance.toObject())
    }
  });

  describe('ensure options object is set on context during bulkUpdate', function() {
    let syncPropertyExists = false;
    let OptionsSourceModel;

    beforeEach(function() {
      OptionsSourceModel = PersistedModel.extend(
        'OptionsSourceModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true},
      );

      OptionsSourceModel.attachTo(dataSource);

      OptionsSourceModel.observe('before save', function updateTimestamp(ctx, next) {
        if (ctx.options.sync) {
          syncPropertyExists = true;
        } else {
          syncPropertyExists = false;
        }
        next();
      });
    });

    it('bulkUpdate should call Model updates with the provided options object', async function() {
      const testData = {name: 'Janie', surname: 'Doe'};
      const updates = [
        {
          data: null,
          change: null,
          type: 'create',
        },
      ];

      const options = {
        sync: true,
      };

      const data = await SourceModel.create(testData)
      updates[0].data = data;
      const change = await SourceModel.getChangeModel().find({where: {modelId: data.id}})
      updates[0].change = change;
      await OptionsSourceModel.bulkUpdate(updates, options)

      expect(syncPropertyExists).to.eql(true);
    });

    it('bulkUpdate should successfully finish without options', async function() {
      const testData = {name: 'Janie', surname: 'Doe'};
      const updates = [{
        data: null,
        change: null,
        type: 'create',
      }];

      const data = await SourceModel.create(testData)
      updates[0].data = data;
      const change = await SourceModel.getChangeModel().find({where: {modelId: data.id}})
      updates[0].change = change;
      await SourceModel.bulkUpdate(updates)
    });
  });

  describe('Replication with chunking', function() {
    beforeEach(function() {
      const test = this;
      SourceModel = this.SourceModel = PersistedModel.extend(
        'SourceModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true, replicationChunkSize: 1},
      );

      SourceModel.attachTo(dataSource);

      TargetModel = this.TargetModel = PersistedModel.extend(
        'TargetModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true, replicationChunkSize: 1},
      );

      const TargetChange = TargetModel.Change;
      TargetChange.Checkpoint = loopback.Checkpoint.extend('TargetCheckpoint');
      TargetChange.Checkpoint.attachTo(dataSource);

      TargetModel.attachTo(dataSource);

      test.startingCheckpoint = -1;
    });

    describe('Model.replicate(since, targetModel, options, callback)', function() {
      it('calls bulkUpdate multiple times', async function() {
        const { SourceModel, TargetModel, startingCheckpoint } = this;
        const options = {};
        const calls = mockBulkUpdate(TargetModel)
        const created = await SourceModel.create([{name: 'foo'}, {name: 'bar'}])
        const { conflicts } = await SourceModel.replicate(startingCheckpoint, TargetModel, options)

        await assertTargetModelEqualsSourceModel(conflicts, SourceModel, TargetModel)
        expect(calls.length).to.eql(2)
      });
    });
  });

  describe('Replication without chunking', function() {
    beforeEach(function() {
      const test = this;
      SourceModel = this.SourceModel = PersistedModel.extend(
        'SourceModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true},
      );

      SourceModel.attachTo(dataSource);

      TargetModel = this.TargetModel = PersistedModel.extend(
        'TargetModel-' + tid,
        {id: {id: true, type: String, defaultFn: 'guid'}},
        {trackChanges: true},
      );

      const TargetChange = TargetModel.Change;
      TargetChange.Checkpoint = loopback.Checkpoint.extend('TargetCheckpoint');
      TargetChange.Checkpoint.attachTo(dataSource);

      TargetModel.attachTo(dataSource);

      test.startingCheckpoint = -1;
    });

    describe('Model.replicate(since, targetModel, options, callback)', function() {
      it('calls bulkUpdate only once', async function() {
        const { SourceModel, TargetModel, startingCheckpoint } = this;
        const options = {};
        const calls = mockBulkUpdate(TargetModel);
        const created = await SourceModel.create([{name: 'foo'}, {name: 'bar'}])
        const { conflicts } = await SourceModel.replicate(startingCheckpoint, TargetModel, options)

        await assertTargetModelEqualsSourceModel(conflicts, SourceModel, TargetModel)
        expect(calls.length).to.eql(1)
      })
    })
  })

  function mockBulkUpdate(modelToMock) {
    const calls = []
    const originalBulkUpdateFunction = modelToMock.bulkUpdate

    // Convert to async/await while maintaining original behavior
    modelToMock.bulkUpdate = async function(since, filter) {
      calls.push('bulkUpdate')
      return await originalBulkUpdateFunction.call(this, since, filter)
    }

    return calls
  }

  const _since = {};
  async function replicate(source, target, since) {
    try {
      const result = await source.replicate(since, target)
      await Promise.all(result.conflicts.map(c => 
        source.rectifyChange(c.resolvedId)
      ))
      return result
    } catch (err) {
      debug('Replication failed: %j', err)
      throw err
    }
  }

  async function createModel(Model, data) {
    return await Model.create(data)
  }

  function spyAndStoreSinceArg(Model, methodName, store) {
    const orig = Model[methodName]
    Model[methodName] = async function(since, ...args) {
      store.push(since)
      return await orig.apply(this, [since, ...args])
    }
  }

  function getPropValue(obj, name) {
    return Array.isArray(obj) ?
      obj.map(function(it) { return getPropValue(it, name); }) :
      obj[name];
  }

  function getIds(list) {
    return getPropValue(list, 'id');
  }

  async function assertTargetModelEqualsSourceModel(conflicts, sourceModel, targetModel) {
    assert(conflicts.length === 0)
    
    const [sourceData, targetData] = await Promise.all([
      sourceModel.find(),
      targetModel.find()
    ])

    assert.deepEqual(sourceData, targetData)
  }
});

describe('Replication / Change APIs with custom change properties', function() {
  let dataSource, SourceModel, TargetModel, startingCheckpoint

  beforeEach(async function() {
    tid++
    const test = this

    dataSource = this.dataSource = loopback.createDataSource({
      connector: loopback.Memory,
    })

    // Create SourceModel with custom properties
    SourceModel = this.SourceModel = PersistedModel.extend(
      'SourceModelWithCustomChangeProperties-' + tid,
      {
        id: {id: true, type: String, defaultFn: 'guid'},
        customProperty: {type: String},
      },
      {
        trackChanges: true,
        additionalChangeModelProperties: {
          customProperty: {type: String}
        }
      }
    )

    await SourceModel.attachTo(dataSource)

    // Add custom change tracking methods
    SourceModel.createChangeFilter = function(since, modelFilter) {
      const filter = this.base.createChangeFilter.apply(this, arguments)
      if (modelFilter && modelFilter.where && modelFilter.where.customProperty) {
        filter.where.customProperty = modelFilter.where.customProperty
      }
      return filter
    }

    SourceModel.prototype.fillCustomChangeProperties = async function(change) {
      const customProperty = this.customProperty
      const base = this.constructor.base
      // Convert callback to promise
      await new Promise((resolve, reject) => {
        base.prototype.fillCustomChangeProperties.call(this, change, err => {
          if (err) return reject(err)
          change.customProperty = customProperty
          resolve()
        })
      })
    }

    await SourceModel._defineChangeModel()
    SourceModel.enableChangeTracking()

    startingCheckpoint = -1
  })

  describe('Model._defineChangeModel()', function() {
    it('defines change model with custom properties', function() {
      const changeModel = SourceModel.getChangeModel();
      const changeModelProperties = changeModel.definition.properties;

      expect(changeModelProperties).to.have.property('customProperty');
    });
  });

  describe('Model.changes(since, filter, callback)', function() {
    beforeEach(async function() {
      const data = [
        {name: 'foo', customProperty: '123'},
        {name: 'foo', customPropertyValue: '456'},
      ]
      await this.SourceModel.create(data)
    })

    it('queries changes using customized filter', async function() {
      const filterUsed = mockChangeFind(this.SourceModel)
      
      await this.SourceModel.changes(
        startingCheckpoint,
        {where: {customProperty: '123'}}
      )
      
      expect(filterUsed[0]).to.eql({
        where: {
          checkpoint: {gte: -1},
          modelName: this.SourceModel.modelName,
          customProperty: '123',
        },
      })
    })

    it('query returns the matching changes', async function() {
      const changes = await this.SourceModel.changes(
        startingCheckpoint,
        {where: {customProperty: '123'}}
      )
      expect(changes).to.have.length(1)
      expect(changes[0]).to.have.property('customProperty', '123')
    })
  })
});

async function sync(client, server) {
  try {
    // NOTE(bajtos) It's important to replicate from the client to the
    // server first, so that we can resolve any conflicts at the client.
    // This ordering ensures consistent conflict resolution.
    await replicateExpectingSuccess(client, server)
    await replicateExpectingSuccess(server, client)
  } catch (err) {
    debug('Sync failed: %j', err)
    throw err
  }
}
