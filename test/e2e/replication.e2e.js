// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../');
const models = require('../fixtures/e2e/server/models');
const TestModel = models.TestModel;
const LocalTestModel = TestModel.extend('LocalTestModel', {}, {
  trackChanges: true,
});
const assert = require('assert');

describe('Replication', function () {
  before(function () {
    // setup the remote connector
    const ds = loopback.createDataSource({
      url: 'http://127.0.0.1:3000/api',
      connector: loopback.Remote,
    });
    TestModel.attachTo(ds);
    const memory = loopback.memory();
    LocalTestModel.attachTo(memory);
  });

  it('should replicate local data to the remote', async function () {
    const RANDOM = Math.random(),
      local = await LocalTestModel.create({ n: RANDOM }),
      res = await LocalTestModel.replicate(TestModel, 0),
      found = await TestModel.findOne({ n: RANDOM })

    assert.equal(local.id, found.id)
    assert.equal(res.length, 1)
    assert.equal(res[0].id, local.id)
  })
})
