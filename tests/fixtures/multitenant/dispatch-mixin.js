// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Template mirroring the dispatch surface of the production CRM mixin at
// submodule-common/server/lib/common/mixins/Multitenant.js (around line 749).
//
// Reduced to the contract this test pins: Model.getDataSource() reads the
// current tenant from an external Context and resolves to a pool returned by
// app.connectionManager.getExistingConnection(tenant). The production mixin
// adds transaction observers, EventBus wiring, periodic cleanup, and
// auto-init of the connection manager on first 'attached' event — none of
// which are part of the dispatch contract under test.
//
// If you change this fixture, mirror the upstream — and vice versa.

module.exports = function applyDispatchMixin(Model, {Context, originalDataSource}) {
  Model.getDataSource = function() {
    const {app} = Model;
    const {connectionManager} = app;
    const tenant = Context.tenant;

    if (!tenant || tenant === 'trap' || tenant === 'service') {
      return originalDataSource;
    }
    if (!connectionManager) {
      throw new Error('Connection manager not initialized');
    }
    const pool = connectionManager.getExistingConnection(tenant);
    if (pool) return pool;

    // Production returns a ReconnectingProxy here that triggers
    // ensureConnection in the background and lets stillConnecting/ready
    // queue the DAO call. The proxy contract is pinned separately in
    // loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js
    // (ReconnectingProxy contract). For this test the eager-warmup path is
    // used: callers ensureConnection() before resolving.
    return originalDataSource;
  };
};
