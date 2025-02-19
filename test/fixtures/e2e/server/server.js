// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../../../');
const boot = require('loopback-boot');
const bodyParser = require('body-parser');
const errorHandler = require('strong-error-handler');
const app = loopback({localRegistry: true});
const models = require('./models');
const TestModel = models.TestModel;

// Register and setup memory datasource
app.dataSource('memory', { connector: 'memory' });
const memory = app.datasources.memory;

// Create base TestModel
TestModel.attachTo(memory);
TestModel.setup();

// Register base model
app.model(TestModel, {
  dataSource: memory,
  public: true
});

// Create RemoteTestModel with change tracking
const RemoteTestModel = TestModel.extend('RemoteTestModel', {
  id: {type: String, id: true, defaultFn: 'uuid'}
}, {
  trackChanges: true,
  onChange: true,
  public: true,
  relations: {
    changes: {
      type: 'hasMany',
      model: 'RemoteTestModel-change',
      foreignKey: 'modelId'
    }
  }
});

// Setup RemoteTestModel
RemoteTestModel.attachTo(memory);
RemoteTestModel.setup();

// Configure change tracking BEFORE model registration
RemoteTestModel.enableChangeTracking();

// Register model AFTER enabling change tracking
app.model(RemoteTestModel, {
  dataSource: 'memory',
  public: true
});

// Get the auto-generated Change model
const ChangeModel = RemoteTestModel.Change;

// Explicitly make Change model public
ChangeModel.settings.public = true;
ChangeModel.attachTo(memory);

// Ensure proper inheritance
ChangeModel.settings.base = 'PersistedModel';

// Configure full remote method definition
ChangeModel.remoteMethod('find', {
  isStatic: true,
  http: {path: '/', verb: 'get'},
  returns: {arg: 'data', type: 'array', root: true}
});

console.log('Change model settings:', {
  name: ChangeModel.modelName,
  dataSource: ChangeModel.dataSource.name,
  public: ChangeModel.settings.public,
  baseModel: ChangeModel.base.modelName
});

// Register Change model explicitly
app.model(ChangeModel, {
  dataSource: 'memory',
  public: true
});

// Enable required remote methods
ChangeModel.remoteMethod('find', {isStatic: true});
ChangeModel.remoteMethod('createChangeStream', {isStatic: true});

// Log registered models and their endpoints
console.log('Registered models:', Object.keys(app.models));
console.log('Model configs:', app.models().map(m => ({
  name: m.modelName,
  public: m.settings.public,
  plural: m.settings.plural || m.pluralModelName,
  base: m.base && m.base.modelName,
  dataSource: m.dataSource && m.dataSource.name,
  trackChanges: m.settings.trackChanges,
  onChange: m.settings.onChange
})));

// Configure middleware
app.middleware('initial', bodyParser.urlencoded({ extended: true }));
app.middleware('initial', bodyParser.json());

// Boot synchronously
boot(app, __dirname);

// Start server when app is booted
app.on('booted', function() {
  console.log('App booted successfully');
  console.log('Registered models:', Object.keys(app.models));
  console.log('Model configs:', app.models().map(m => ({
    name: m.modelName,
    public: m.settings.public,
    base: m.base && m.base.modelName,
    dataSource: m.dataSource && m.dataSource.name,
    trackChanges: m.settings.trackChanges,
    onChange: m.settings.onChange,
    relations: m.relations
  })));

  // Mount REST API at root instead of /api
  app.use('/api', loopback.rest());

  // Add error handling middleware with better error details
  app.use(function(err, req, res, next) {
    console.log('Request URL:', req.url);
    console.log('Request Method:', req.method);
    console.log('Available models:', Object.keys(app.models));
    console.log('Available routes:', app._router.stack
      .filter(r => r.route)
      .map(r => ({path: r.route.path, methods: Object.keys(r.route.methods)})));
    
    console.error('API Error:', err);
    if (err.statusCode) {
      res.status(err.statusCode).json({
        error: err.message,
        details: err.details || err.stack,
        url: req.url,
        method: req.method
      });
    } else {
      res.status(500).json({
        error: err.message || 'Internal Server Error',
        details: err.stack,
        url: req.url,
        method: req.method
      });
    }
  });

  // Configure error handling with more verbose options
  app.middleware('final', errorHandler({
    debug: true,
    log: true,
    safeFields: ['errorCode', 'statusCode', 'requestUrl', 'status', 'message', 'name', 'stack']
  }));
});

// Export app and a function to get a free port
module.exports = app;
app.getPort = function() {
  return new Promise((resolve, reject) => {
    const server = require('net').createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
};

// Export a function to start the server
app.startServer = async function(port) {
  try {
    if (!port) {
      port = await app.getPort();
    }
    return new Promise((resolve, reject) => {
      const server = app.listen(port, () => {
        console.log('Server started on port', port);
        resolve(server);
      });
      server.on('error', reject);
    });
  } catch (err) {
    console.error('Failed to start server:', err);
    throw err;
  }
};

TestModel.setup = function() {
  TestModel.enableChangeTracking({
    trackChanges: true,
    onChange: true
  })
}
