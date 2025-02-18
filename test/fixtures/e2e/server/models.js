// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../../../index');
const PersistedModel = loopback.PersistedModel;

exports.TestModel = PersistedModel.extend('TestModel', {
  id: {type: String, id: true, defaultFn: 'uuid'},
  foo: String
}, {
  trackChanges: true,
  plural: 'TestModels'
});
