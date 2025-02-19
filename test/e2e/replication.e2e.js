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
  onChange: true,
  forceId: false
});

describe('Replication', function() {
  this.timeout(30000);  // Increase timeout further for server startup
  let server, app, ds, RemoteTestModel;

  beforeEach(async function() {
    // Start the test server
    app = require('../fixtures/e2e/server/server');
    RemoteTestModel = app.models.RemoteTestModel;

    try {
      // Start server with dynamic port
      const port = await app.getPort();
      server = await app.startServer(port);
      console.log('Test server started on port', port);

      // Setup the remote connector with proper URL
      ds = loopback.createDataSource({
        url: 'http://127.0.0.1:' + port + '/api',
        connector: loopback.Remote,
        options: {
          strictSSL: false,
          timeout: 10000,
          retry: {
            max: 3,
            interval: 1000
          }
        }
      });

      // Setup local model
      const memory = loopback.memory();
      LocalTestModel.attachTo(memory);
      LocalTestModel.setup();

      // Setup change tracking for LocalTestModel
      const LocalChangeModel = LocalTestModel.Change;
      LocalChangeModel.attachTo(memory);
      LocalTestModel.enableChangeTracking();

      // Setup RemoteTestModel for replication
      RemoteTestModel.attachTo(ds);
      
      // Single declaration point for RemoteChange
      const RemoteChange = RemoteTestModel.Change
      RemoteChange.attachTo(ds)
      RemoteTestModel.enableChangeTracking()

      // Log model setup
      console.log('LocalTestModel setup:', {
        name: LocalTestModel.modelName,
        dataSource: LocalTestModel.dataSource.name,
        trackChanges: LocalTestModel.settings.trackChanges,
        onChange: LocalTestModel.settings.onChange,
        change: LocalTestModel.Change ? {
          name: LocalTestModel.Change.modelName,
          settings: LocalTestModel.Change.settings
        } : null
      });
      
      console.log('RemoteTestModel setup:', {
        name: RemoteTestModel.modelName,
        dataSource: RemoteTestModel.dataSource.name,
        trackChanges: RemoteTestModel.settings.trackChanges,
        onChange: RemoteTestModel.settings.onChange,
        change: RemoteTestModel.Change ? {
          name: RemoteTestModel.Change.modelName,
          settings: RemoteTestModel.Change.settings
        } : null
      });
      
      // Verify Change models are properly set up
      if (!LocalTestModel.Change || !RemoteTestModel.Change) {
        throw new Error('Change models not properly set up');
      }
      
      // Ensure remote model is properly configured
      RemoteTestModel.attachTo(ds)
      RemoteTestModel.setup()

      // Add short delay after server start
      await new Promise(resolve => setTimeout(resolve, 1500))
      
      // Verify remote model endpoints
      const routes = app._router.stack
        .filter(r => r.route)
        .map(r => r.route.path)
      console.log('Verified routes:', routes)
      assert(
        routes.includes('/api/RemoteTestModel-changes'),
        'Change model endpoint missing'
      )
      
      // Verify endpoint actually works
      const changeDs = app.models['RemoteTestModel-change'].dataSource
      await new Promise((resolve, reject) => {
        changeDs.ping(err => err ? reject(err) : resolve())
      })
      const changes = await app.models['RemoteTestModel-change'].find()
      assert(Array.isArray(changes), 'Change model API not functional')
      
      // Increase delay for server initialization
      await new Promise(resolve => setTimeout(resolve, 2000))
      
      console.log('Models setup complete');

      // In beforeEach hook after server start
      console.log('Available models:', Object.keys(app.models));
      assert(
        app.models['RemoteTestModel-change'],
        'Change model not registered properly'
      )

      // After model setup verification
      const changeModel = app.models['RemoteTestModel-change']
      assert(changeModel, 'Change model missing')
      assert(
        typeof changeModel.find === 'function',
        'Change model find method not exposed'
      )
    } catch (err) {
      console.error('Setup error:', err);
      throw err;
    }
  });

  afterEach(async function() {
    try {
      // Disconnect datasource first
      if (ds) {
        console.log('Disconnecting datasource...');
        await new Promise((resolve, reject) => {
          ds.disconnect((err) => {
            if (err) {
              console.error('Datasource disconnect error:', err);
              reject(err);
              return;
            }
            console.log('Datasource disconnected');
            resolve();
          });
        });
      }
      
      // Then close server
      if (server) {
        console.log('Closing server...');
        await new Promise((resolve, reject) => {
          server.close((err) => {
            if (err) {
              console.error('Server close error:', err);
              reject(err);
              return;
            }
            console.log('Server closed');
            resolve();
          });
        });
      }
      
      console.log('Cleanup completed');
    } catch (err) {
      console.error('Cleanup error:', err);
      throw err;
    }
  });

  it('should replicate local data to the remote', async function() {
    const RANDOM = Math.random();
    console.log('Creating local model instance with n:', RANDOM);

    try {
      // Create local instance
      const created = await LocalTestModel.create({
        n: RANDOM,
        foo: 'bar'
      });
      console.log('Created local instance:', created.toJSON());
      
      // Wait for server to be ready
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      console.log('Starting replication...');
      console.log('Local model:', LocalTestModel.modelName);
      console.log('Remote model:', RemoteTestModel.modelName);
      
      // Use proper replication API with better error handling
      const replicationResult = await new Promise((resolve, reject) => {
        LocalTestModel.replicate(RemoteTestModel, {
          since: 0,
          targetModel: RemoteTestModel,
          targetDataSource: ds,
          debug: true,
          checkpoints: true,
          conflict: {
            resolution: 'update'
          }
        }, (err, conflicts, cps) => {
          if (err) reject(err);
          else resolve({ conflicts, cps });
        });
      });

      console.log('Replication completed');
      if (replicationResult.conflicts) {
        console.log('Conflicts:', replicationResult.conflicts);
      }
      if (replicationResult.cps) {
        console.log('Checkpoints:', replicationResult.cps);
      }
      
      // Wait for replication to complete
      await new Promise(resolve => setTimeout(resolve, 1000));
      
      // Then check if it exists
      const found = await RemoteTestModel.findOne({ where: { n: RANDOM } });
      console.log('Found remote instance:', found);
      assert(found, 'Remote instance should exist');
      assert.equal(found.n, RANDOM);
      assert.equal(found.foo, 'bar');
    } catch (err) {
      console.error('Test error:', err);
      throw err;
    }
  });
});
