const assert = require('assert');
const utils = require('../lib/utils');

// Verify native promise usage only
const cb = utils.createPromiseCallback();
assert(cb.promise instanceof Promise, 'Should create native promise'); 