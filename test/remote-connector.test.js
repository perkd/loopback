// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const loopback = require('../');
const defineModelTestsWithDataSource = require('./util/model-tests');

describe('RemoteConnector', function() {

  let remoteApp, remote;

  defineModelTestsWithDataSource({
    beforeEach: function(done) {
      const test = this;
      remoteApp = loopback();
      remoteApp.set('remoting', {
        errorHandler: {debug: true, log: false},
        types: {warnWhenOverridingType: false},
      });
      remoteApp.use(loopback.rest());
      remoteApp.listen(0, function() {
        test.dataSource = loopback.createDataSource({
          host: 'localhost',
          port: remoteApp.get('port'),
          connector: loopback.Remote,
        });

        done();
      });
    },

    // We are defining the model attached to the remote connector datasource,
    // therefore change tracking must be disabled, only the remote API for
    // replication should be present
    trackChanges: false,
    enableRemoteReplication: true,

    onDefine: function(Model) {
      const ServerModel = Model.extend('Server' + Model.modelName, {}, {
        plural: Model.pluralModelName,
        // This is the model running on the server & attached to a real
        // datasource, that's the place where to keep track of changes
        trackChanges: true,
      });
      ServerModel.attachTo(loopback.createDataSource({
        connector: loopback.Memory,
      }));
      remoteApp.model(ServerModel);
    },
  });

  beforeEach(function(done) {
    const test = this;
    remoteApp = this.remoteApp = loopback();
    remoteApp.set('remoting', {
      types: {warnWhenOverridingType: false},
    });
    remoteApp.use(loopback.rest());
    const ServerModel = this.ServerModel = loopback.PersistedModel.extend('TestModel');

    remoteApp.model(ServerModel);

    remoteApp.listen(0, function() {
      test.remote = loopback.createDataSource({
        host: 'localhost',
        port: remoteApp.get('port'),
        connector: loopback.Remote,
      });

      done();
    });
  });

  it('should support the save method', async function() {
    let calledServerCreate = false
    const RemoteModel = loopback.PersistedModel.extend('TestModel')
    RemoteModel.attachTo(this.remote)

    const ServerModel = this.ServerModel;

    ServerModel.create = async function(data, options) {
      calledServerCreate = true
      data.id = 1
      return data
    }

    ServerModel.setupRemoting()

    const m = new RemoteModel({foo: 'bar'})
    const inst = await m.save()

    assert(inst instanceof RemoteModel)
    assert(calledServerCreate)
  })
})
