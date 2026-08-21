// Copyright IBM Corp. 2016,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const { uploadInChunks, downloadInChunks, concatResults } = require('../lib/utils');
const assert = require('node:assert')

describe('Utils', function() {
  describe('uploadInChunks', function() {
    it('calls process function for each chunk', async function() {
      const largeArray = ['item1', 'item2', 'item3']
      const processFunction = async (array) => {
        calls.push(array)
      }
      const calls = []
      
      await uploadInChunks(largeArray, 1, processFunction)
      assert.deepEqual(calls, [['item1'], ['item2'], ['item3']])
    })

    it('calls process function only once when array is smaller than chunk size', async function() {
      const largeArray = ['item1', 'item2']
      const processFunction = async (array) => {
        calls.push(array)
      }
      const calls = []

      await uploadInChunks(largeArray, 3, processFunction)
      assert.deepEqual(calls, [['item1', 'item2']])
    })

    it('concats results from each call to the process function', async function() {
      const largeArray = ['item1', 'item2', 'item3', 'item4']
      const processFunction = async (array) => array

      const results = await uploadInChunks(largeArray, 2, processFunction)
      assert.deepEqual(results, ['item1', 'item2', 'item3', 'item4'])
    })
  })

  describe('downloadInChunks', function() {
    let largeArray, calls, chunkSize, skip;

    beforeEach(function() {
      largeArray = ['item1', 'item2', 'item3'];
      calls = [];
      chunkSize = 2;
      skip = 0;
    })

    async function processFunction(filter) {
      calls.push(Object.assign({}, filter));
      const results = [];

      for (let i = 0; i < chunkSize; i++) {
        if (largeArray[skip + i]) {
          results.push(largeArray[skip + i]);
        }
      }

      skip += chunkSize
      return results
    }

    it('calls process function with the correct filter', async function() {
      const expectedFilters = [{skip: 0, limit: chunkSize}, {skip: chunkSize, limit: chunkSize}]

      await downloadInChunks({}, chunkSize, processFunction)
      assert.deepEqual(calls, expectedFilters)
    });

    it('concats the results of all calls of the process function', async function() {
      const results = await downloadInChunks({}, chunkSize, processFunction)
      assert.deepEqual(results, largeArray)
    })
  })

  describe('concatResults', function() {
    it('concats regular arrays', function() {
      const array1 = ['item1', 'item2']
      const array2 = ['item3', 'item4']

      const results = concatResults(array1, array2)
      assert.deepEqual(results, ['item1', 'item2', 'item3', 'item4'])
    })

    it('concats objects containing arrays', function() {
      const object1 = {deltas: [{change: 'change 1'}], conflict: []};
      const object2 = {deltas: [{change: 'change 2'}], conflict: [{conflict: 'conflict 1'}]};
      const expectedResults = {
        deltas: [{change: 'change 1'}, {change: 'change 2'}],
        conflict: [{conflict: 'conflict 1'}],
      };

      const results = concatResults(object1, object2)
      assert.deepEqual(results, expectedResults)
    })
  })
})
