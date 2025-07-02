// Copyright IBM Corp. 2024. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';

const expect = require('chai').expect;
const loopback = require('../');
const http = require('http');

// Import the executeMiddlewareHandlers function from app.test.js
function executeMiddlewareHandlers(app, urlPath, done) {
  // if urlPath is a function or undefined, then it's actually the callback and use default urlPath
  if (typeof urlPath === 'function' || urlPath === undefined) {
    done = urlPath;
    urlPath = '/test/url';
  }

  let handlerError = undefined;

  const server = http.createServer(function(req, res) {
    app.handle(req, res, function(err) {
      if (err) {
        handlerError = err;
        res.statusCode = err.status || err.statusCode || 500;
        res.end(err.stack || err);
      } else {
        res.statusCode = 204;
        res.end();
      }
    });
  });

  server.listen(0, function() {
    const request = http.request({
      host: 'localhost',
      port: server.address().port,
      path: urlPath,
      method: 'GET',
    });

    request.on('response', function(res) {
      server.close();
      if (done) {
        done(handlerError);
      }
    });

    request.on('error', function(err) {
      server.close();
      if (done) {
        done(err);
      }
    });

    request.end();
  });

  // Return a promise if no callback provided
  if (!done) {
    return new Promise((resolve, reject) => {
      server.listen(0, function() {
        const request = http.request({
          host: 'localhost',
          port: server.address().port,
          path: urlPath,
          method: 'GET',
        });

        request.on('response', function(res) {
          server.close();
          if (handlerError) {
            reject(handlerError);
          } else {
            resolve();
          }
        });

        request.on('error', function(err) {
          server.close();
          reject(err);
        });

        request.end();
      });
    });
  }
}

describe('Express Compatibility Validation', function() {
  let app;

  beforeEach(function() {
    app = loopback();
  });

  describe('Router Structure Validation', function() {
    it('validates router.stack structure remains compatible', function() {
      app.middleware('initial', function(req, res, next) { next(); });

      const router = app._router || app.router;
      expect(router).to.exist;
      expect(router.stack).to.be.an('array');
      expect(router.stack).to.have.length.greaterThan(0);

      router.stack.forEach((layer, index) => {
        expect(layer, `Layer ${index}`).to.have.property('handle');
        expect(layer.handle, `Layer ${index} handle`).to.be.a('function');
        // Express 5 uses 'regexp' property, Express 4 might use different structure
        expect(layer, `Layer ${index}`).to.satisfy(l =>
          l.hasOwnProperty('regexp') || l.hasOwnProperty('regex') || l.hasOwnProperty('route')
        );
      });
    });

    it('validates custom phase properties are preserved', function() {
      const testHandler = function(req, res, next) { next(); };
      app.middleware('session', testHandler);

      const router = app._router || app.router;
      const layer = router.stack.find(l => l.handle === testHandler);

      expect(layer).to.exist;
      expect(layer).to.have.property('phase');
      expect(layer.phase).to.equal('session');
    });

    it('validates middleware layer properties structure', function() {
      app.middleware('auth', function namedHandler(req, res, next) { next(); });

      const router = app._router || app.router;
      const authLayers = router.stack.filter(l => l.phase === 'auth');

      expect(authLayers).to.have.length(1);
      const layer = authLayers[0];

      // Validate essential layer properties
      expect(layer).to.have.property('handle');
      expect(layer).to.satisfy(l =>
        l.hasOwnProperty('regexp') || l.hasOwnProperty('regex') || l.hasOwnProperty('route')
      );
      expect(layer).to.have.property('phase');
      expect(layer.handle).to.be.a('function');
      expect(layer.phase).to.equal('auth');
    });

    it('validates router stack maintains order after sorting', function() {
      const phases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];
      const handlers = [];

      phases.forEach((phase, index) => {
        const handler = function(req, res, next) { next(); };
        handler._phaseIndex = index;
        handlers.push(handler);
        app.middleware(phase, handler);
      });

      // Trigger sorting
      app._sortLayersByPhase();

      const router = app._router || app.router;
      const phaseLayers = router.stack.filter(l => l.phase && typeof l.phase === 'string');

      // Verify phases are in correct order
      let lastPhaseIndex = -1;
      phaseLayers.forEach(layer => {
        const currentPhaseIndex = phases.indexOf(layer.phase);
        expect(currentPhaseIndex).to.be.greaterThan(lastPhaseIndex);
        lastPhaseIndex = currentPhaseIndex;
      });
    });
  });

  describe('Express API Compatibility', function() {
    it('validates required Express static methods exist', function() {
      const express = require('express');

      const requiredMethods = ['static', 'json', 'urlencoded', 'Router'];
      requiredMethods.forEach(method => {
        expect(express[method], `express.${method}`).to.be.a('function');
      });
    });

    it('validates Express application methods exist', function() {
      const express = require('express');
      const expressApp = express();

      const requiredMethods = ['use', 'get', 'post', 'put', 'delete', 'listen', 'set'];
      requiredMethods.forEach(method => {
        expect(expressApp[method], `app.${method}`).to.be.a('function');
      });
    });

    it('validates request object methods are available', function(done) {
      app.middleware('initial', function(req, res, next) {
        try {
          const requiredMethods = ['param', 'get', 'accepts', 'is'];
          requiredMethods.forEach(method => {
            expect(req[method], `req.${method}`).to.be.a('function');
          });

          const requiredProperties = ['headers', 'url', 'method'];
          requiredProperties.forEach(prop => {
            expect(req).to.have.property(prop);
          });

          next();
          done();
        } catch (err) {
          done(err);
        }
      });

      executeMiddlewareHandlers(app);
    });

    it('validates response object methods are available', function(done) {
      app.middleware('initial', function(req, res, next) {
        try {
          const requiredMethods = ['send', 'json', 'status', 'set', 'get', 'cookie', 'redirect'];
          requiredMethods.forEach(method => {
            expect(res[method], `res.${method}`).to.be.a('function');
          });

          const requiredProperties = ['statusCode', 'headersSent'];
          requiredProperties.forEach(prop => {
            expect(res).to.have.property(prop);
          });

          next();
          done();
        } catch (err) {
          done(err);
        }
      });

      executeMiddlewareHandlers(app);
    });

    it('validates Express Router functionality', function() {
      const express = require('express');
      const router = express.Router();

      expect(router).to.be.a('function');
      expect(router.use).to.be.a('function');
      expect(router.get).to.be.a('function');
      expect(router.post).to.be.a('function');
      expect(router.route).to.be.a('function');

      // Test router can be used as middleware
      expect(() => {
        app.use('/api', router);
      }).to.not.throw();
    });
  });

  describe('LoopBack-Express Integration', function() {
    it('validates LoopBack inherits from Express', function() {
      const express = require('express');

      // LoopBack should inherit Express properties
      for (const prop in express) {
        if (typeof express[prop] === 'function') {
          expect(loopback).to.have.property(prop);
          expect(loopback[prop]).to.equal(express[prop]);
        }
      }
    });

    it('validates LoopBack app has Express app properties', function() {
      const express = require('express');
      const expressApp = express();

      // Core Express methods should be available on LoopBack app
      const coreMethods = ['use', 'get', 'post', 'put', 'delete', 'listen', 'set', 'enable', 'disable'];
      coreMethods.forEach(method => {
        expect(app[method], `app.${method}`).to.be.a('function');
        expect(typeof app[method]).to.equal(typeof expressApp[method]);
      });
    });

    it('validates middleware execution context compatibility', function(done) {
      let middlewareExecuted = false;

      app.middleware('initial', function(req, res, next) {
        try {
          // Validate basic middleware execution
          expect(req).to.be.an('object');
          expect(res).to.be.an('object');
          expect(next).to.be.a('function');

          // Validate that req and res have basic Express properties
          expect(req).to.have.property('method');
          expect(req).to.have.property('url');
          expect(res).to.have.property('statusCode');

          middlewareExecuted = true;
          next();
          done();
        } catch (err) {
          done(err);
        }
      });

      executeMiddlewareHandlers(app);
    });
  });

  describe('Future Compatibility Safeguards', function() {
    it('validates critical Express version assumptions', function() {
      const express = require('express');
      const pkg = require('express/package.json');

      // Ensure we're testing against a supported Express version (4.x or 5.x)
      expect(pkg.version).to.match(/^[45]\./);

      // Validate critical static methods that LoopBack depends on
      expect(express.static).to.be.a('function');
      expect(express.Router).to.be.a('function');
      expect(express.json).to.be.a('function');
      expect(express.urlencoded).to.be.a('function');
    });

    it('validates router internal structure assumptions', function() {
      app.middleware('routes', function(req, res, next) { next(); });

      const router = app._router || app.router;
      expect(router).to.exist;
      expect(router.stack).to.be.an('array');

      // Validate that layers have the structure we expect
      const routesLayers = router.stack.filter(l => l.phase === 'routes');
      expect(routesLayers).to.have.length(1);

      const layer = routesLayers[0];
      expect(layer).to.have.property('handle');
      expect(layer).to.satisfy(l =>
        l.hasOwnProperty('regexp') || l.hasOwnProperty('regex') || l.hasOwnProperty('route')
      );
      expect(layer.handle).to.be.a('function');
    });

    it('validates middleware phase system integrity', function() {
      const expectedPhases = ['initial', 'session', 'auth', 'parse', 'routes', 'files', 'final'];

      // Initialize the router to ensure phases are set up
      app.lazyrouter();
      expect(app._requestHandlingPhases).to.deep.equal(expectedPhases);

      // Validate phase ordering system
      expectedPhases.forEach(phase => {
        expect(() => {
          app.middleware(phase, function(req, res, next) { next(); });
        }).to.not.throw();
      });

      // Validate before/after phase modifiers work
      expect(() => {
        app.middleware('routes:before', function(req, res, next) { next(); });
        app.middleware('routes:after', function(req, res, next) { next(); });
      }).to.not.throw();
    });
  });
});
