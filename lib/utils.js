// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

exports.uploadInChunks = uploadInChunks;
exports.downloadInChunks = downloadInChunks;
exports.concatResults = concatResults;

/**
 * Divide an async call with a large array into multiple calls using smaller chunks
 * @param {Array} largeArray - the large array to be chunked
 * @param {Number} chunkSize - size of each chunk
 * @param {Function} processFunction - async function to be called for each chunk
 * @returns {Promise} - resolves to the concatenated results
 */
async function uploadInChunks(largeArray, chunkSize, processFunction) {
  if (!chunkSize || chunkSize < 1 || largeArray.length <= chunkSize) {
    return processFunction(largeArray)
  }
  else {
    const copyOfLargeArray = largeArray.slice(0);
    const chunkArrays = [];
    while (copyOfLargeArray.length > 0) {
      chunkArrays.push(copyOfLargeArray.splice(0, chunkSize));
    }

    let previousResults = undefined
    const aggregatedConflicts = []

    for (const chunkArray of chunkArrays) {
      try {
        const results = await processFunction(chunkArray)

        if (previousResults === undefined || previousResults === null) {
          previousResults = results;
        }
        else if (results) {
          previousResults = concatResults(previousResults, results);
        }
      }
      catch (error) {
        if (error.statusCode === 409) {
          // Extract conflicts, handling both possible locations
          const conflicts = error.details?.conflicts || []
          aggregatedConflicts.push(...conflicts)
          continue // Continue processing remaining chunks
        }
        // Re-throw non-conflict errors
        throw error
      }
    }

    // If we collected any conflicts, throw aggregated conflict error
    if (aggregatedConflicts.length > 0) {
      const error = new Error('Conflicts detected during upload')
      error.statusCode = 409
      error.details = { conflicts: aggregatedConflicts }
      throw error
    }

    return previousResults
  }
}

/**
 * Page async download calls
 * @param {Object} filter - filter object used for the async call
 * @param {Number} chunkSize - size of each chunk
 * @param {Function} processFunction - async function to be called for each page
 * @returns {Promise} - resolves with the concatenated results
 */
async function downloadInChunks(filter, chunkSize, processFunction) {
  let results = [];
  filter = filter ? JSON.parse(JSON.stringify(filter)) : {};

  if (!chunkSize || chunkSize < 1) {
    return processFunction(filter)
  }
  else {
    filter.skip = 0
    filter.limit = chunkSize

    while (true) {
      let pagedResults = await processFunction(JSON.parse(JSON.stringify(filter)))
      results = concatResults(results, pagedResults);
      if (pagedResults.length >= chunkSize) {
        filter.skip += pagedResults.length;
      } else {
        break;
      }
    }
    return results;
  }
}

/**
 * Concat current results into previous results
 * Assumes that the previous and current results are homogeneous
 * @param {Object|Array} previousResults
 * @param {Object|Array} currentResults
 * @returns {Object|Array} - the concatenated results
 */
function concatResults(previousResults, currentResults) {
  if (Array.isArray(currentResults)) {
    // If both are arrays, flatten while concatenating
    if (Array.isArray(previousResults)) {
      return previousResults.concat(...currentResults)
    }
    // If only currentResults is an array, just return it
    return currentResults
  }
  else if (typeof currentResults === 'object') {
    Object.keys(currentResults).forEach(function(key) {
      previousResults[key] = concatResults(previousResults[key], currentResults[key])
    })
  }
  else {
    previousResults = currentResults
  }
  return previousResults
}
