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

// Setup datasource and models
const memory = loopback.memory();

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
  id: {type: String, id: true, defaultFn: 'uuid', generated: true, required: true}
}, {
  trackChanges: true,
  onChange: true,
  public: true,
  forceId: false
});

// Setup RemoteTestModel
RemoteTestModel.attachTo(memory);
RemoteTestModel.setup();

// Setup change tracking
const RemoteChangeModel = RemoteTestModel.Change;
RemoteChangeModel.attachTo(memory);
RemoteTestModel.enableChangeTracking();

// Register models
app.model(RemoteTestModel, {
  dataSource: memory,
  public: true
});
app.model(RemoteChangeModel, {
  dataSource: memory,
  public: false
});

// Configure middleware
app.middleware('initial', bodyParser.urlencoded({ extended: true }));
app.middleware('initial', bodyParser.json());

// Configure REST API
app.use('/api', loopback.rest());

// Configure error handling with more verbose options
app.middleware('final', errorHandler({
  debug: true,
  log: true,
  safeFields: ['errorCode', 'statusCode', 'requestUrl', 'status', 'message', 'name', 'stack']
}));

// Basic remoting setup
app.set('remoting', {
  rest: { 
    handleErrors: false,
    // Prevent retry storms
    maxRetries: 0,
    retryTimeout: 0,
    supportedTypes: ['json', 'application/json'],
    normalizeHttpPath: false,
    xml: false
  },
  json: { strict: false },
  urlencoded: { extended: true },
  errorHandler: { 
    debug: true, 
    log: true 
  }
});

// Debug logging with rate limiting
let requestCount = 0;
const REQUEST_LIMIT = 10; // Only log first 10 requests
app.use(function(req, res, next) {
  requestCount++;
  if (requestCount <= REQUEST_LIMIT) {
    console.log('Request:', req.method, req.url);
    console.log('Available models:', Object.keys(app.models));
    console.log('Available routes:', app._router.stack
      .filter(r => r.route)
      .map(r => ({path: r.route.path, methods: Object.keys(r.route.methods)})));
    if (req.body) {
      console.log('Request body:', req.body);
    }
  }
  next();
});

// Boot synchronously
boot(app, __dirname);

// Log when app is booted
app.on('booted', function() {
  console.log('App booted successfully');
  console.log('Registered models:', Object.keys(app.models));
  console.log('Model configs:', app.models().map(m => ({
    name: m.modelName,
    public: m.settings.public,
    base: m.base && m.base.modelName,
    dataSource: m.dataSource && m.dataSource.name
  })));
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
