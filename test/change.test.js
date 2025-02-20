// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('assert');
const expect = require('./helpers/expect');
const loopback = require('../');

describe('Change', function() {
  let Change, TestModel, memory;

  beforeEach(async function() {
    memory = loopback.createDataSource({
      connector: loopback.Memory,
    });

    // Initialize base models first
    await loopback.Change.attachTo(memory);
    await loopback.Checkpoint.extend('TestCheckpoint').attachTo(memory);

    // Create model with proper initialization
    TestModel = loopback.PersistedModel.extend(
      'ChangeTestModel',
      {
        id: { id: true, type: 'string', defaultFn: 'guid' }
      },
      { trackChanges: true }
    );
    await TestModel.attachTo(memory);
    
    // Initialize change tracking AFTER attachment
    await TestModel._defineChangeModel();
    await memory.automigrate();
    
    Change = TestModel.getChangeModel();
  });

  beforeEach(async function() {
    this.data = { foo: 'bar' };
    const model = await TestModel.create(this.data)
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
    let change;
    beforeEach(async function() {
      // findOrCreateChange returns a promise only
      change = await Change.findOrCreateChange({ modelName: this.modelName, modelId: this.modelId });
    });

    it('should create a new change with the correct revision', async function() {
      const updatedChange = await change.rectify();
      assert.equal(updatedChange.rev, this.revisionForModel);
    });

    it('should merge updates within the same checkpoint', async function() {
      const originalRev = this.revisionForModel;
      let cp;

      // First rectify
      await change.rectify();

      // Create a checkpoint to obtain a new checkpoint value
      cp = (await TestModel.checkpoint()).seq;

      // Update the underlying model and rectify sequentially
      this.model.name = this.model.name + ' updated';
      this.model = await this.model.save();
      this.revisionForModel = Change.revisionForInst(this.model);
      await change.rectify();

      this.model.name = this.model.name + ' updated again';
      this.model = await this.model.save();
      this.revisionForModel = Change.revisionForInst(this.model);
      await change.rectify();

      // At this point, the change should have merged the updates
      assert.equal(change.checkpoint, cp);
      assert.equal(change.type(), 'update');
      assert.equal(change.prev, originalRev);
      assert.equal(change.rev, this.revisionForModel);
    });

    it('should not change checkpoint when rev is the same', async function() {
      const originalCheckpoint = change.checkpoint;
      const originalRev = change.rev;
      // Trigger a new checkpoint (if required)
      await TestModel.checkpoint();
      const updatedChange = await change.rectify();
      assert.equal(updatedChange.rev, originalRev);
      assert.equal(updatedChange.checkpoint, originalCheckpoint);
    });
  });

  describe('change.currentRevision', function() {
    it('should get the correct revision', async function() {
      const changeInst = new Change({
        modelName: this.modelName,
        modelId: this.modelId,
      });
      const rev = await changeInst.currentRevision();
      assert.equal(rev, this.revisionForModel);
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
    Checkpoint.attachTo(memory)

    TestModel = loopback.PersistedModel.extend(
      'ChangeTestModelWithTenant',
      {
        id: { id: true, type: 'string', defaultFn: 'guid' },
        tenantId: 'string'
      },
      {
        trackChanges: true,
        additionalChangeModelProperties: { tenantId: 'string' }
      }
    )
    TestModel.attachTo(memory)
    
    // Initialize change model before use
    await TestModel._defineChangeModel()
    await memory.automigrate(['Change', 'TestCheckpoint'])
    Change = TestModel.getChangeModel()
  })

  describe('change.rectify', function() {
    const TENANT_ID = '123';
    let change;
    beforeEach(async function() {
      const data = { foo: 'bar', tenantId: TENANT_ID };
      const model = await TestModel.create(data);
      change = await Change.findOrCreateChange(TestModel.modelName, model.id);
    });

    it('stores the custom property in the Change instance', async function() {
      const ch = await change.rectify();
      expect(ch.toObject()).to.have.property('tenantId', TENANT_ID);
    });
  });
});

describe('conflict detection - target deleted', function() {
  beforeEach(async function() {
    const SourceModel = this.SourceModel
    const TargetModel = this.TargetModel
    const test = this

    await test.createInitalData()

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
