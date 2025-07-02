// Copyright IBM Corp. 2024. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const expect = require('chai').expect;
const loopback = require('../');
const performanceUtils = require('./helpers/performance-utils');

describe('Middleware Performance Validation', function() {
  let app;

  beforeEach(function() {
    app = loopback();
  });

  describe('Sorting Algorithm Performance', function() {
    it('sorts 100 middleware in under 100ms', function() {
      this.timeout(5000);

      const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];
      const middlewareCount = 100;

      // Add middleware across different phases
      for (let i = 0; i < middlewareCount; i++) {
        const phase = phases[i % phases.length];
        app.middleware(phase, function(req, res, next) { next(); });
      }

      // Measure sorting performance
      const duration = performanceUtils.measureExecutionTime(() => {
        app._sortLayersByPhase();
      });

      console.log(`Sorted ${middlewareCount} middleware in ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(100);
    });

    it('sorts 500 middleware efficiently', function() {
      this.timeout(10000);

      const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];
      const middlewareCount = 500;

      // Add middleware
      for (let i = 0; i < middlewareCount; i++) {
        const phase = phases[i % phases.length];
        app.middleware(phase, function(req, res, next) { next(); });
      }

      // Measure sorting performance
      const duration = performanceUtils.measureExecutionTime(() => {
        app._sortLayersByPhase();
      });

      console.log(`Sorted ${middlewareCount} middleware in ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(500);
    });

    it('maintains stable sort order with identical phases', function() {
      const middlewareCount = 50;
      const handlers = [];

      // Add middleware to the same phase with identifiers
      for (let i = 0; i < middlewareCount; i++) {
        const handler = function(req, res, next) { next(); };
        handler._testId = i;
        handlers.push(handler);
        app.middleware('routes', handler);
      }

      // Trigger sorting multiple times
      app._sortLayersByPhase();
      app._sortLayersByPhase();
      app._sortLayersByPhase();

      // Verify order is preserved after sorting
      const router = app._router || app.router;
      const routesLayers = router.stack.filter(l => l.phase === 'routes');

      expect(routesLayers).to.have.length(middlewareCount);
      routesLayers.forEach((layer, index) => {
        expect(layer.handle._testId).to.equal(index);
      });
    });

    it('handles complex phase ordering efficiently', function() {
      this.timeout(5000);

      // Define custom phases first
      app.defineMiddlewarePhases(['custom1', 'custom2', 'custom3', 'custom4']);

      const customPhases = [
        'initial', 'custom1:before', 'custom1', 'custom1:after',
        'session', 'custom2:before', 'custom2', 'custom2:after',
        'auth', 'custom3:before', 'custom3', 'custom3:after',
        'parse', 'routes:before', 'routes', 'routes:after',
        'files', 'custom4:before', 'custom4', 'custom4:after',
        'final'
      ];

      // Add middleware to all phases
      customPhases.forEach(phase => {
        for (let i = 0; i < 10; i++) {
          app.middleware(phase, function(req, res, next) { next(); });
        }
      });

      const totalMiddleware = customPhases.length * 10;

      // Measure sorting performance
      const duration = performanceUtils.measureExecutionTime(() => {
        app._sortLayersByPhase();
      });

      console.log(`Sorted ${totalMiddleware} middleware across ${customPhases.length} phases in ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(200);
    });
  });

  describe('Memory Usage Validation', function() {
    it('does not leak memory with many middleware additions', function() {
      this.timeout(10000);

      // Force initial garbage collection to get a clean baseline
      performanceUtils.forceGarbageCollection();
      performanceUtils.forceGarbageCollection(); // Call twice to be sure

      const initialMemory = performanceUtils.getMemoryUsage();
      const cycles = 10;
      const middlewarePerCycle = 100;

      // Add and trigger sorting multiple times
      for (let cycle = 0; cycle < cycles; cycle++) {
        for (let i = 0; i < middlewarePerCycle; i++) {
          app.middleware('routes', function(req, res, next) { next(); });
        }

        // Trigger sorting
        app._sortLayersByPhase();

        // Force garbage collection every few cycles
        if (cycle % 3 === 0) {
          performanceUtils.forceGarbageCollection();
        }
      }

      // Final cleanup
      performanceUtils.forceGarbageCollection();
      performanceUtils.forceGarbageCollection();

      const finalMemory = performanceUtils.getMemoryUsage();
      const memoryDiff = performanceUtils.calculateMemoryDifference(initialMemory, finalMemory);

      console.log(`Memory increase after ${cycles * middlewarePerCycle} middleware: ${(memoryDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Memory increase should be reasonable (less than 15MB to account for Node.js variations)
      // This is still a good threshold to detect significant memory leaks
      expect(memoryDiff.heapUsed).to.be.below(15 * 1024 * 1024);
    });

    it('maintains consistent memory usage during repeated sorting', function() {
      this.timeout(5000);

      // Add a fixed set of middleware
      for (let i = 0; i < 200; i++) {
        app.middleware('routes', function(req, res, next) { next(); });
      }

      // Measure memory before repeated sorting
      performanceUtils.forceGarbageCollection();
      const beforeMemory = performanceUtils.getMemoryUsage();

      // Perform many sorting operations
      for (let i = 0; i < 100; i++) {
        app._sortLayersByPhase();
      }

      // Measure memory after repeated sorting
      performanceUtils.forceGarbageCollection();
      const afterMemory = performanceUtils.getMemoryUsage();

      const memoryDiff = performanceUtils.calculateMemoryDifference(beforeMemory, afterMemory);

      console.log(`Memory increase after 100 sort operations: ${(memoryDiff.heapUsed / 1024 / 1024).toFixed(2)}MB`);

      // Repeated sorting should not significantly increase memory usage
      expect(memoryDiff.heapUsed).to.be.below(1024 * 1024); // Less than 1MB
    });
  });

  describe('Scalability Testing', function() {
    it('handles large numbers of middleware phases', function() {
      this.timeout(10000);

      // Define many custom phases
      const customPhases = [];
      for (let i = 0; i < 50; i++) {
        customPhases.push(`custom${i}`);
      }

      // Add custom phases
      app.defineMiddlewarePhases(customPhases);

      // Add middleware to each phase
      const allPhases = app._requestHandlingPhases;
      allPhases.forEach(phase => {
        for (let i = 0; i < 5; i++) {
          app.middleware(phase, function(req, res, next) { next(); });
        }
      });

      const totalMiddleware = allPhases.length * 5;

      // Measure sorting performance
      const duration = performanceUtils.measureExecutionTime(() => {
        app._sortLayersByPhase();
      });

      console.log(`Sorted ${totalMiddleware} middleware across ${allPhases.length} phases in ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(1000); // Should complete within 1 second
    });

    it('maintains performance with mixed middleware types', function() {
      this.timeout(5000);

      const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];

      // Add regular middleware
      for (let i = 0; i < 100; i++) {
        const phase = phases[i % phases.length];
        app.middleware(phase, function(req, res, next) { next(); });
      }

      // Add scoped middleware
      for (let i = 0; i < 50; i++) {
        const phase = phases[i % phases.length];
        app.middleware(phase, '/api', function(req, res, next) { next(); });
      }

      // Add error handling middleware
      for (let i = 0; i < 25; i++) {
        const phase = phases[i % phases.length];
        app.middleware(phase, function(err, req, res, next) { next(err); });
      }

      const totalMiddleware = 175;

      // Measure sorting performance
      const duration = performanceUtils.measureExecutionTime(() => {
        app._sortLayersByPhase();
      });

      console.log(`Sorted ${totalMiddleware} mixed middleware in ${duration.toFixed(2)}ms`);
      expect(duration).to.be.below(200);
    });
  });

  describe('Performance Regression Detection', function() {
    it('establishes baseline performance metrics', function() {
      this.timeout(5000);

      const testCases = [
        {name: '50 middleware', count: 50, threshold: 50},
        {name: '100 middleware', count: 100, threshold: 100},
        {name: '200 middleware', count: 200, threshold: 200},
      ];

      testCases.forEach(testCase => {
        const app = loopback();
        const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];

        // Add middleware
        for (let i = 0; i < testCase.count; i++) {
          const phase = phases[i % phases.length];
          app.middleware(phase, function(req, res, next) { next(); });
        }

        // Measure performance
        const duration = performanceUtils.measureExecutionTime(() => {
          app._sortLayersByPhase();
        });

        console.log(`${testCase.name}: ${duration.toFixed(2)}ms`);
        expect(duration).to.be.below(testCase.threshold);
      });
    });

    it('validates performance consistency across multiple runs', function() {
      this.timeout(10000);

      const middlewareCount = 100;
      const runs = 10;
      const durations = [];

      for (let run = 0; run < runs; run++) {
        const app = loopback();
        const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];

        // Add middleware
        for (let i = 0; i < middlewareCount; i++) {
          const phase = phases[i % phases.length];
          app.middleware(phase, function(req, res, next) { next(); });
        }

        // Measure performance
        const duration = performanceUtils.measureExecutionTime(() => {
          app._sortLayersByPhase();
        });

        durations.push(duration);
      }

      const avgDuration = durations.reduce((sum, d) => sum + d, 0) / durations.length;
      const maxDuration = Math.max(...durations);
      const minDuration = Math.min(...durations);
      const variance = durations.reduce((sum, d) => sum + Math.pow(d - avgDuration, 2), 0) / durations.length;
      const stdDev = Math.sqrt(variance);

      console.log(`Performance over ${runs} runs:`);
      console.log(`  Average: ${avgDuration.toFixed(2)}ms`);
      console.log(`  Min: ${minDuration.toFixed(2)}ms`);
      console.log(`  Max: ${maxDuration.toFixed(2)}ms`);
      console.log(`  Std Dev: ${stdDev.toFixed(2)}ms`);

      // Performance should be consistent (low standard deviation)
      expect(stdDev).to.be.below(avgDuration * 0.5); // Std dev should be less than 50% of average
      expect(maxDuration).to.be.below(100); // No run should exceed 100ms
    });
  });
});
