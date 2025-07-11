// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const expect = require('./helpers/expect');
const loopback = require('../');

describe('Change', function() {
  let Change, TestModel, memory;

  beforeEach(async function() {
    memory = loopback.createDataSource({
      connector: loopback.Memory,
    });

    // Attach base Change model and Checkpoint model first
    await loopback.Change.attachTo(memory);
    const CheckpointModel = loopback.Checkpoint.extend('TestCheckpoint');
    await CheckpointModel.attachTo(memory);

    // Create and register the model first
    TestModel = loopback.registry.createModel(
      'ChangeTestModel',
      { id: { type: 'string', id: true } },
      { trackChanges: true }
    );
    // Then attach to datasource
    TestModel.attachTo(memory);

    // Ensure the checkpoint associated with the Change model is attached
    const changeModel = TestModel.getChangeModel();
    const checkpointModel = changeModel.getCheckpointModel();
    if (!checkpointModel.dataSource) {
      await checkpointModel.attachTo(memory);
    }

    // Migrate all models (once all are attached)
    await memory.automigrate();

    // Set reference to Change model for later use
    this.modelName = TestModel.modelName;
    Change = TestModel.getChangeModel();

    // Create an instance as needed for later tests
    const model = await TestModel.create({ foo: 'bar' });
    this.model = model;
    this.modelId = model.id;
    this.revisionForModel = Change.revisionForInst(model);
  });

  describe('Change.getCheckpointModel()', function() {
    beforeEach(async function() {
      const ds = loopback.createDataSource({
        connector: loopback.Memory,
      });
      // Create models first
      this.Model = loopback.PersistedModel.extend('ChangeTest', {}, { trackChanges: true });
      this.ChildModel = this.Model.extend('ChangeTestChild');
      
      // Attach to datasource
      await this.Model.attachTo(ds);
      await this.ChildModel.attachTo(ds);
      
      // Automigrate after attaching
      await ds.automigrate(['ChangeTest', 'ChangeTestChild']);
      
      // Define change models before accessing them
      await this.Model._defineChangeModel();
      await this.ChildModel._defineChangeModel();
      await ds.automigrate();
    });

    it("Shouldn't create two models if called twice", async function() {
      const Model = this.Model;
      const ChangeModel1 = await Model.getChangeModel();
      const ChangeModel2 = await Model.getChangeModel();
      assert.equal(ChangeModel1, ChangeModel2);
    });
  });

  describe('change.id', function() {
    it('should be a hash of the modelName and modelId', function() {
      const change = new Change({
        rev: 'abc',
        modelName: 'foo',
        modelId: 'bar',
      });
      const hash = Change.hash([change.modelName, change.modelId].join('-'));
      assert.equal(change.id, hash);
    });
  });

  describe('Change.rectifyModelChanges', function() {
    describe('using an existing untracked model', function() {
      beforeEach(async function() {
        await Change.rectifyModelChanges(this.modelName, [this.modelId]);
      });

      it('should create an entry', async function() {
        const trackedChanges = await Change.find();
        assert.equal(trackedChanges[0].modelId, this.modelId.toString());
      });

      it('should only create one change', async function() {
        const count = await Change.count();
        assert.equal(count, 1);
      });
    });
  });

  describe('change.rectify', function() {
    let change

    beforeEach(async function() {
      const { modelName, modelId } = this
      change = await Change.findOrCreateChange(modelName, modelId)
      // Ensure the change has a revision value as per original implementation
      if (!change.rev) {
        change.rev = Change.revisionForInst(this.model)
        await change.save()
      }
    })

    it('should create a new change with the correct revision', async function() {
      const updatedChange = await change.rectify()
      assert.equal(updatedChange.rev, this.revisionForModel)
    })

    it('should merge updates within the same checkpoint', async function() {
      const originalRev = this.revisionForModel

      // First rectify
      await change.rectify()

      // Create a checkpoint to obtain a new checkpoint value
      const cp = (await TestModel.checkpoint()).seq

      // Update the underlying model and rectify sequentially
      this.model.name = this.model.name + ' updated'
      this.model = await this.model.save()
      this.revisionForModel = Change.revisionForInst(this.model)
      await change.rectify()

      this.model.name = this.model.name + ' updated again'
      this.model = await this.model.save()
      this.revisionForModel = Change.revisionForInst(this.model)
      await change.rectify()

      // At this point, the change should have merged the updates
      assert.equal(change.checkpoint, cp)
      assert.equal(change.type(), 'update')
      assert.equal(change.prev, originalRev)
    })

    it('should not change checkpoint when rev is the same', async function() {
      // First get the model instance and compute its revision
      const inst = await TestModel.findById(this.modelId)
      const computedRev = Change.revisionForInst(inst)
      
      // Set up change with computed revision
      change.rev = computedRev
      change.checkpoint = 1
      
      // Trigger checkpoint but don't modify model
      await TestModel.checkpoint()
      
      // Now rectify - should preserve state
      const updatedChange = await change.rectify()
      assert.equal(updatedChange.rev, computedRev)
      assert.equal(updatedChange.checkpoint, 1)
    });
  });

  describe('change.currentRevision', function() {
    it('should get the correct revision', async function() {
      const { modelName, modelId } = this
      const changeInst = new Change({ modelName, modelId })
      const rev = await changeInst.currentRevision()

      assert.equal(rev, this.revisionForModel)
    });
  });
});

describe('Change with custom properties', function() {
  let Change, TestModel

  beforeEach(async function() {
    const memory = loopback.createDataSource({
      connector: loopback.Memory,
    })
    
    await loopback.Change.attachTo(memory)
    const Checkpoint = loopback.Checkpoint.extend('TestCheckpoint')
    await Checkpoint.attachTo(memory)

    TestModel = loopback.registry.createModel(
      'ChangeTestModelWithTenant',
      {
        id: { type: 'string', id: true },
        tenantId: 'string'
      },
      {
        trackChanges: true,
        additionalChangeModelProperties: { tenantId: 'string' }
      }
    )
    await TestModel.attachTo(memory)
    
    // Initialize change model before use
    await TestModel._defineChangeModel()
    await memory.automigrate()

    TestModel.prototype.fillCustomChangeProperties = async function (change) {
      const { tenantId } = this

      if (tenantId) {
        change.tenantId = tenantId
      } else {
        change.tenantId = null
      }
    }
    Change = TestModel.getChangeModel()
  })

  describe('change.rectify', function() {
    const TENANT_ID = '123'
    let change

    beforeEach(async function() {
      const data = { foo: 'bar', tenantId: TENANT_ID }
      const model = await TestModel.create(data)
      change = await Change.findOrCreateChange(TestModel.modelName, model.id)
    })

    it('stores the custom property in the Change instance', async function() {
      const ch = await change.rectify()
      expect(ch.toObject()).to.have.property('tenantId', TENANT_ID)
    })
  })
})

describe('conflict detection - target deleted', function() {
  beforeEach(async function() {
    const SourceModel = this.SourceModel
    const TargetModel = this.TargetModel
    const test = this

    await test.createInitialData()

    await Promise.all([
      (async () => {
        const inst = await SourceModel.findOne()
        test.model = inst
        inst.name = 'source update'
        await inst.save()
      })(),
      (async () => {
        const inst = await TargetModel.findOne()
        await inst.remove()
      })()
    ])

    const { conflicts } = await SourceModel.replicate(TargetModel)
    test.conflicts = conflicts
    test.conflict = conflicts[0]
  })

  // Update the test cases similarly
})
