// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('path');
const loopback = require('../../');
const models = require('../fixtures/e2e/server/models');
const TestModel = models.TestModel;
const assert = require('assert');
let RemoteTestModel;

describe('RemoteConnector', function() {
  this.timeout(30000)  // Increase timeout further for server startup
  let server, app, ds

  beforeEach(function(done) {
    app = require('../fixtures/e2e/server/server')
    
    // Start server first
    server = app.listen(3000, function() {
      console.log('Test server listening on port 3000')
      
      // Create datasource after server is up
      ds = loopback.createDataSource({
        url: 'http://127.0.0.1:3000/api',
        connector: loopback.Remote,
        options: {
          strictSSL: false,
          timeout: 5000
        }
      })

      // Create a new model instance for the client
      RemoteTestModel = loopback.createModel(TestModel.definition)
      RemoteTestModel.attachTo(ds)
      
      // Give server time to fully initialize
      setTimeout(done, 1000)
    })
  })

  afterEach(function(done) {
    const cleanup = []
    
    if (ds) {
      cleanup.push(new Promise(resolve => {
        console.log('Disconnecting datasource...')
        ds.disconnect(resolve)
      }))
    }
    
    if (server) {
      cleanup.push(new Promise(resolve => {
        console.log('Closing server...')
        server.close(resolve)
      }))
    }
    
    Promise.all(cleanup)
      .then(() => {
        console.log('Cleanup completed')
        done()
      })
      .catch(err => {
        console.error('Cleanup error:', err)
        done(err)
      })
  })

  it('should be able to call create', function(done) {
    console.log('Starting create test...')
    RemoteTestModel.create({
      foo: 'bar'
    }, function(err, inst) {
      if (err) {
        console.error('Create test error:', err)
        return done(err)
      }
      try {
        assert(inst.id)
        console.log('Create test passed')
        done()
      } catch (e) {
        console.error('Create test assertion error:', e)
        done(e)
      }
    })
  })

  it('should be able to call save', function(done) {
    const m = new RemoteTestModel({
      foo: 'bar'
    })
    m.save(function(err, data) {
      if (err) return done(err)
      try {
        assert(data.foo === 'bar')
        done()
      } catch (e) {
        done(e)
      }
    })
  })
})
