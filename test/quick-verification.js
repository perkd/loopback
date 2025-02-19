const assert = require('assert');
const utils = require('../lib/utils');

// Verify promise callback factory
const cb = utils.createPromiseCallback();
assert(cb.promise instanceof Promise, 'Should create promise');

// Verify constructor context
function CustomPromise() {}
const ctxCb = utils.createPromiseCallback.call(CustomPromise);
assert(ctxCb.promise instanceof CustomPromise, 'Should use context constructor'); 