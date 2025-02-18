// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const assert = require('assert');
const loopback = require('../../');
const models = require('../fixtures/e2e/server/models');
const TestModel = models.TestModel;

// Create local model with change tracking
const LocalTestModel = TestModel.extend('LocalTestModel', {}, {
  trackChanges: true,
  onChange: true
});

describe('Replication', function() {
  this.timeout(30000);  // Increase timeout further for server startup
  let server, app, ds, RemoteTestModel;

  beforeEach(function(done) {
    // Start the test server
    app = require('../fixtures/e2e/server/server');
    RemoteTestModel = app.models.RemoteTestModel;
    
    server = app.listen(3000, function() {
      console.log('Test server listening on port 3000');
      
      // setup the remote connector without retries
      ds = loopback.createDataSource({
        url: 'http://127.0.0.1:3000/api',
        connector: loopback.Remote,
        options: {
          strictSSL: false,
          timeout: 5000
        }
      });

      // Setup local model
      const memory = loopback.memory();
      LocalTestModel.attachTo(memory);

      // Setup change tracking for LocalTestModel
      const LocalChangeModel = LocalTestModel.Change;
      LocalChangeModel.attachTo(memory);
      LocalTestModel.enableChangeTracking();
      
      // Give server time to fully initialize
      setTimeout(done, 1000);
    });
  });

  afterEach(function(done) {
    const cleanup = [];
    
    if (ds) {
      cleanup.push(new Promise(resolve => {
        console.log('Disconnecting datasource...');
        ds.disconnect(resolve);
      }));
    }
    
    if (server) {
      cleanup.push(new Promise(resolve => {
        console.log('Closing server...');
        server.close(resolve);
      }));
    }
    
    Promise.all(cleanup)
      .then(() => {
        console.log('Cleanup completed');
        done();
      })
      .catch(err => {
        console.error('Cleanup error:', err);
        done(err);
      });
  });

  it('should replicate local data to the remote', function(done) {
    const RANDOM = Math.random();

    LocalTestModel.create({
      n: RANDOM,
      foo: 'bar'
    }, function(err, created) {
      if (err) return done(err);
      
      // Wait a bit before replicating to ensure server is ready
      setTimeout(function() {
        LocalTestModel.replicate(0, RemoteTestModel, function(err) {
          if (err) return done(err);

          RemoteTestModel.findOne({where: {n: RANDOM}}, function(err, found) {
            if (err) return done(err);
            try {
              assert.equal(created.id, found.id);
              done();
            } catch (e) {
              done(e);
            }
          });
        });
      }, 1000);
    });
  });
});
