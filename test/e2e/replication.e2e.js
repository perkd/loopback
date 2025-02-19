// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const loopback = require('../../');
const models = require('../fixtures/e2e/server/models');
const TestModel = models.TestModel;
const LocalTestModel = TestModel.extend('LocalTestModel', {}, {
  trackChanges: true,
});
const assert = require('assert');

describe('Replication', function () {
  let server, app;

  before(async function () {
    // Server setup
    app = loopback();
    const serverMemory = app.dataSource('memory', { connector: 'memory' });
    
    // Server model
    const ServerTestModel = app.registry.createModel('TestModel');
    app.model(ServerTestModel, { dataSource: serverMemory, public: true });
    
    // Change tracking setup
    const Change = loopback.Change;
    const changeDs = app.dataSource('changeMemory', { connector: 'memory' });
    Change.attachTo(ServerTestModel, {
      dataSource: changeDs,
      public: true 
    });
    ServerTestModel.enableRemoteReplication();

    // Start server
    app.use(loopback.rest());
    server = app.listen(3000);

    // Client setup
    const clientDs = loopback.createDataSource({
      url: 'http://localhost:3000/api',
      connector: 'remote'
    });
    TestModel.attachTo(clientDs);

    // Local model
    LocalTestModel.attachTo(loopback.memory());

    // Add required middleware
    app.middleware('initial', require('body-parser').json())
    app.middleware('initial', require('body-parser').urlencoded({ extended: true }))
    app.middleware('final', require('strong-error-handler')({
      debug: true,
      log: true
    }))
  });

  after(function (done) {
    if (server) server.close(done);
    else done();
  });

  it('should replicate local data to the remote', function (done) {
    const RANDOM = Math.random();

    LocalTestModel.create({
      n: RANDOM,
    }, function (err, created) {
      if (err) return done(err);

      LocalTestModel.replicate(0, TestModel, function (err) {
        if (err) return done(err);

        TestModel.findOne({ n: RANDOM }, function (err, found) {
          if (err) return done(err);
          assert.equal(created.id, found.id);
          done();
        });
      });
    });
  });
});
