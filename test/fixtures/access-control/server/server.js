// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../../..');
const boot = require('loopback-boot');
const app = module.exports = loopback({
  localRegistry: true,
  loadBuiltinModels: true,
});
const errorHandler = require('strong-error-handler');

boot(app, __dirname);

// Enable authentication before setting up REST middleware
// This ensures that app.isAuthEnabled is true when REST middleware
// is initialized, allowing it to automatically include token middleware
app.enableAuth();

const apiPath = '/api';
// Note: Token middleware is automatically added by REST middleware when auth is enabled
app.use(apiPath, loopback.rest());

app.use(loopback.urlNotFound());
app.use(errorHandler());
