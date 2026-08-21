// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Minimal AsyncLocalStorage-backed tenant context.
// Mirrors the surface of @perkd/multitenant-context used by the dispatch
// path: `Context.tenant` and `Context.runAsTenant(tenant, fn)`. Kept as a
// fixture so loopback's test suite has no dependency on the real package.

const {AsyncLocalStorage} = require('node:async_hooks');

const storage = new AsyncLocalStorage();

const Context = {
  get tenant() {
    const store = storage.getStore();
    return store ? store.tenant : null;
  },
  runAsTenant(tenant, fn) {
    return storage.run({tenant}, fn);
  },
};

module.exports = {Context};
