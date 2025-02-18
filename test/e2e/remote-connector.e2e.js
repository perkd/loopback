// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const loopback = require('../..');
const models = require('../fixtures/e2e/server/models');
let TestModel = models.TestModel;
const assert = require('assert');

let LocalTestModel = TestModel.extend('LocalTestModel');
let RemoteTestModel = TestModel.extend('RemoteTestModel');
let app, memory, server, port;

describe('RemoteConnector', function() {
  this.timeout(30000);  // Increase timeout further for server startup

  beforeEach(async function() {
    app = loopback();
    app.dataSource('memory', { connector: 'memory' });

    // Add getPort function
    app.getPort = async function() {
      const server = require('http').createServer();
      return new Promise((resolve, reject) => {
        server.listen(0, () => {
          const port = server.address().port;
          server.close(() => resolve(port));
        });
      });
    };

    memory = app.dataSources.memory;
    TestModel = app.registry.createModel('TestModel');
    app.model(TestModel, { dataSource: 'memory' });

    const port = await app.getPort();
    app.set('port', port);

    // Create HTTP server
    server = require('http').createServer(app);
    await new Promise((resolve, reject) => {
      server.listen(port, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });

    const remoteDs = loopback.createDataSource({
      url: 'http://localhost:' + port + '/api',
      connector: 'remote'
    });

    RemoteTestModel = app.registry.createModel('RemoteTestModel');
    RemoteTestModel.attachTo(remoteDs);

    // Create base model
    LocalTestModel = TestModel.extend('LocalTestModel');
    LocalTestModel.attachTo(loopback.memory());
    app.model(LocalTestModel, {
      dataSource: loopback.memory(),
      public: true
    });

    // Create remote model
    RemoteTestModel = TestModel.extend('RemoteTestModel');
    RemoteTestModel.attachTo(loopback.memory());
    app.model(RemoteTestModel, {
      dataSource: loopback.memory(),
      public: true
    });

    // Configure middleware
    app.middleware('initial', require('body-parser').urlencoded({extended: true}));
    app.middleware('initial', require('body-parser').json());
    app.use('/api', loopback.rest());
    app.middleware('final', require('strong-error-handler')({
      debug: true,
      log: true
    }));

    // Give server time to fully initialize
    await new Promise(resolve => setTimeout(resolve, 1000));
  });

  afterEach(async function() {
    if (server) {
      await new Promise((resolve) => server.close(resolve))
    }
  });

  it('should be able to call create', function(done) {
    console.log('Starting create test...');
    RemoteTestModel.create({
      foo: 'bar'
    }, function(err, inst) {
      if (err) {
        console.error('Create test error:', err);
        return done(err);
      }
      try {
        assert(inst.id);
        console.log('Create test passed');
        done();
      } catch (e) {
        console.error('Create test assertion error:', e);
        done(e);
      }
    });
  });

  it('should be able to call save', function(done) {
    const m = new RemoteTestModel({
      foo: 'bar'
    });
    m.save(function(err, data) {
      if (err) return done(err);
      try {
        assert(data.foo === 'bar');
        done();
      } catch (e) {
        done(e);
      }
    });
  });
});
