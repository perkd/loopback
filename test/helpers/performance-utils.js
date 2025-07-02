// Copyright IBM Corp. 2024. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

/**
 * Performance measurement utilities for LoopBack middleware testing
 */

/**
 * Measure execution time of a function in milliseconds
 * @param {Function} fn Function to measure
 * @returns {number} Execution time in milliseconds
 */
exports.measureExecutionTime = function(fn) {
  const start = process.hrtime.bigint();
  fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // Convert to milliseconds
};

/**
 * Measure async execution time of a function in milliseconds
 * @param {Function} fn Async function to measure
 * @returns {Promise<number>} Execution time in milliseconds
 */
exports.measureAsyncExecutionTime = async function(fn) {
  const start = process.hrtime.bigint();
  await fn();
  const end = process.hrtime.bigint();
  return Number(end - start) / 1000000; // Convert to milliseconds
};

/**
 * Create test middleware handlers with unique identifiers
 * @param {number} count Number of middleware to create
 * @param {string} phase Phase name (default: 'routes')
 * @returns {Array} Array of middleware objects with handler and phase
 */
exports.createTestMiddleware = function(count, phase = 'routes') {
  const middleware = [];
  for (let i = 0; i < count; i++) {
    const handler = function(req, res, next) { next(); };
    handler._testId = i;
    middleware.push({handler, phase});
  }
  return middleware;
};

/**
 * Create named middleware handlers for testing
 * @param {string} name Name for the middleware
 * @returns {Function} Middleware handler function
 */
exports.createNamedMiddleware = function(name) {
  const handler = function(req, res, next) {
    if (handler._steps) {
      handler._steps.push(name);
    }
    next();
  };
  handler._name = name;
  return handler;
};

/**
 * Get memory usage snapshot
 * @returns {Object} Memory usage information
 */
exports.getMemoryUsage = function() {
  return process.memoryUsage();
};

/**
 * Calculate memory difference between two snapshots
 * @param {Object} before Memory snapshot before operation
 * @param {Object} after Memory snapshot after operation
 * @returns {Object} Memory difference in bytes
 */
exports.calculateMemoryDifference = function(before, after) {
  return {
    rss: after.rss - before.rss,
    heapUsed: after.heapUsed - before.heapUsed,
    heapTotal: after.heapTotal - before.heapTotal,
    external: after.external - before.external,
    arrayBuffers: after.arrayBuffers - before.arrayBuffers,
  };
};

/**
 * Force garbage collection if available
 */
exports.forceGarbageCollection = function() {
  if (global.gc) {
    global.gc();
  }
};

/**
 * Create a performance benchmark runner
 * @param {string} name Benchmark name
 * @param {Function} setup Setup function
 * @param {Function} operation Operation to benchmark
 * @param {Function} teardown Teardown function
 * @returns {Object} Benchmark runner
 */
exports.createBenchmark = function(name, setup, operation, teardown) {
  return {
    name,
    async run(iterations = 1) {
      const results = [];
      
      for (let i = 0; i < iterations; i++) {
        if (setup) await setup();
        
        const startTime = process.hrtime.bigint();
        const startMemory = exports.getMemoryUsage();
        
        await operation();
        
        const endTime = process.hrtime.bigint();
        const endMemory = exports.getMemoryUsage();
        
        const duration = Number(endTime - startTime) / 1000000; // ms
        const memoryDiff = exports.calculateMemoryDifference(startMemory, endMemory);
        
        results.push({
          iteration: i + 1,
          duration,
          memoryDiff,
        });
        
        if (teardown) await teardown();
        
        // Force GC between iterations if available
        exports.forceGarbageCollection();
      }
      
      return {
        name,
        iterations,
        results,
        averageDuration: results.reduce((sum, r) => sum + r.duration, 0) / results.length,
        maxDuration: Math.max(...results.map(r => r.duration)),
        minDuration: Math.min(...results.map(r => r.duration)),
        averageMemoryIncrease: results.reduce((sum, r) => sum + r.memoryDiff.heapUsed, 0) / results.length,
      };
    },
  };
};

/**
 * Validate performance thresholds
 * @param {Object} results Benchmark results
 * @param {Object} thresholds Performance thresholds
 * @returns {Object} Validation results
 */
exports.validatePerformanceThresholds = function(results, thresholds) {
  const validation = {
    passed: true,
    failures: [],
  };
  
  if (thresholds.maxDuration && results.maxDuration > thresholds.maxDuration) {
    validation.passed = false;
    validation.failures.push({
      metric: 'maxDuration',
      actual: results.maxDuration,
      threshold: thresholds.maxDuration,
      message: `Maximum duration ${results.maxDuration.toFixed(2)}ms exceeds threshold ${thresholds.maxDuration}ms`,
    });
  }
  
  if (thresholds.averageDuration && results.averageDuration > thresholds.averageDuration) {
    validation.passed = false;
    validation.failures.push({
      metric: 'averageDuration',
      actual: results.averageDuration,
      threshold: thresholds.averageDuration,
      message: `Average duration ${results.averageDuration.toFixed(2)}ms exceeds threshold ${thresholds.averageDuration}ms`,
    });
  }
  
  if (thresholds.maxMemoryIncrease && results.averageMemoryIncrease > thresholds.maxMemoryIncrease) {
    validation.passed = false;
    validation.failures.push({
      metric: 'maxMemoryIncrease',
      actual: results.averageMemoryIncrease,
      threshold: thresholds.maxMemoryIncrease,
      message: `Average memory increase ${(results.averageMemoryIncrease / 1024 / 1024).toFixed(2)}MB exceeds threshold ${(thresholds.maxMemoryIncrease / 1024 / 1024).toFixed(2)}MB`,
    });
  }
  
  return validation;
};

/**
 * Create a concurrent operation tester
 * @param {number} concurrency Number of concurrent operations
 * @param {Function} operation Operation to run concurrently
 * @returns {Promise<Array>} Results from all operations
 */
exports.runConcurrentOperations = async function(concurrency, operation) {
  const promises = [];
  const results = [];
  
  for (let i = 0; i < concurrency; i++) {
    promises.push(
      operation(i).then(result => {
        results[i] = {success: true, result};
      }).catch(error => {
        results[i] = {success: false, error};
      })
    );
  }
  
  await Promise.all(promises);
  return results;
};

/**
 * Wait for a specified amount of time
 * @param {number} ms Milliseconds to wait
 * @returns {Promise} Promise that resolves after the specified time
 */
exports.wait = function(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
};
