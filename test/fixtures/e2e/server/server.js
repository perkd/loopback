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
TestModel.attachTo(memory);

// Register base model
app.model(TestModel);

// Create RemoteTestModel with change tracking
const RemoteTestModel = TestModel.extend('RemoteTestModel', {}, {
  trackChanges: true,
  onChange: true
});

// Setup RemoteTestModel
RemoteTestModel.attachTo(memory);

// Setup change tracking
const RemoteChangeModel = RemoteTestModel.Change;
RemoteChangeModel.attachTo(memory);
RemoteTestModel.enableChangeTracking();

// Register models
app.model(RemoteTestModel);
app.model(RemoteChangeModel);

// Configure middleware
app.middleware('initial', bodyParser.urlencoded({ extended: true }));
app.middleware('initial', bodyParser.json());

// Configure REST API
app.use('/api', loopback.rest());

// Configure error handling
app.middleware('final', errorHandler());

// Basic remoting setup
app.set('remoting', {
  rest: { 
    handleErrors: false,
    // Prevent retry storms
    maxRetries: 0,
    retryTimeout: 0
  },
  json: { strict: false },
  errorHandler: { debug: true, log: true }
});

// Debug logging with rate limiting
let requestCount = 0;
const REQUEST_LIMIT = 10; // Only log first 10 requests
app.use(function(req, res, next) {
  requestCount++;
  if (requestCount <= REQUEST_LIMIT) {
    console.log('Request:', req.method, req.url);
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
});

module.exports = app;
