// Copyright IBM Corp. 2025. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

// Canonical contract test for tenant-aware Model dispatch.
//
// Pins the contract that CRM services depend on:
//   Model.getDataSource() override reading an external context
//     -> app.connectionManager.getExistingConnection(tenant)
//       -> distinct pool DataSource per tenant
//
// Uses fixture templates (test/fixtures/multitenant/) that mirror the
// production mixin + ConnectionManager + multitenant-context surfaces.
// No dependency on @crm/loopback, @perkd/multitenant-context, or MongoDB.
//
// Related contracts pinned elsewhere:
//   - Property accessor (model.dataSource reads call getDataSource on every
//     access) — loopback-datasource-juggler/test/multitenant-datasource-accessor.test.js
//   - DAO-level resolution (every DAO op consults Model.getDataSource) — same file
//   - ReconnectingProxy + stillConnecting/ready queue+replay — same file
//   - N-DataSource isolation at the connector layer —
//     loopback-connector-mongodb/test/multitenant.test.js

const assert = require('node:assert');
const loopback = require('../');
const describe = require('./util/describe');
const it = require('./util/it');
const {Context} = require('./fixtures/multitenant/fake-context');
const {FakeConnectionManager} = require('./fixtures/multitenant/fake-connection-manager');
const applyDispatchMixin = require('./fixtures/multitenant/dispatch-mixin');

describe('Multitenant dispatch (contract)', function() {
  let app, TenantModel, originalDataSource, pools;

  beforeEach(async function() {
    pools = new Map();

    app = loopback();
    originalDataSource = app.dataSource('trap', {connector: 'memory'});

    app.connectionManager = new FakeConnectionManager({
      connectionFactory: async tenant => {
        const pool = app.registry.createDataSource({
          connector: 'memory',
          name: tenant,
          tenant,
        });
        pools.set(tenant, pool);
        if (!pool.connected) {
          await new Promise(resolve => pool.once('connected', resolve));
        }
        return pool;
      },
    });

    TenantModel = originalDataSource.define('TenantItem', {name: String});
    TenantModel.app = app;
    applyDispatchMixin(TenantModel, {Context, originalDataSource});
  });

  afterEach(async function() {
    if (app && app.connectionManager) await app.connectionManager.shutdown();
    if (originalDataSource && typeof originalDataSource.disconnect === 'function') {
      await originalDataSource.disconnect();
    }
  });

  it('resolves two concurrent tenants to distinct pools', async function() {
    const resolveFor = tenant => Context.runAsTenant(tenant, async () => {
      await app.connectionManager.ensureConnection(tenant);
      return TenantModel.getDataSource();
    });

    const [dsA, dsB] = await Promise.all([
      resolveFor('tenant-a'),
      resolveFor('tenant-b'),
    ]);

    assert.ok(dsA, 'tenant-a must resolve to a DataSource');
    assert.ok(dsB, 'tenant-b must resolve to a DataSource');
    assert.notStrictEqual(dsA, dsB, 'distinct tenants must resolve to distinct pools');
    assert.strictEqual(dsA, pools.get('tenant-a'));
    assert.strictEqual(dsB, pools.get('tenant-b'));
  });

  it('reads Context.tenant on every dispatch', async function() {
    await app.connectionManager.ensureConnection('tenant-a');
    await app.connectionManager.ensureConnection('tenant-b');

    const dsA1 = await Context.runAsTenant('tenant-a', () => TenantModel.getDataSource());
    const dsB  = await Context.runAsTenant('tenant-b', () => TenantModel.getDataSource());
    const dsA2 = await Context.runAsTenant('tenant-a', () => TenantModel.getDataSource());

    assert.strictEqual(dsA1, pools.get('tenant-a'));
    assert.strictEqual(dsB,  pools.get('tenant-b'));
    assert.strictEqual(dsA2, pools.get('tenant-a'));
    assert.notStrictEqual(dsA1, dsB);
  });

  it('falls back to the original datasource when no tenant is set', function() {
    const ds = TenantModel.getDataSource();
    assert.strictEqual(ds, originalDataSource);
  });

  it('falls back to the original datasource for the service tenant', async function() {
    const ds = await Context.runAsTenant('service', () => TenantModel.getDataSource());
    assert.strictEqual(ds, originalDataSource);
  });
});
