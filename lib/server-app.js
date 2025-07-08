// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const g = require('./globalize');
const assert = require('node:assert');
const express = require('express');
const mergePhaseNameLists = require('loopback-phase').mergePhaseNameLists;
const debug = require('debug')('loopback:app');
const stableSortInPlace = require('stable').inplace;

const BUILTIN_MIDDLEWARE = {builtin: true};

const proto = {};

module.exports = function loopbackExpress() {
  const app = express();

  // Express v5 compatibility: lazyrouter was removed
  // We need to provide a compatible implementation
  if (app.lazyrouter) {
    // Express v4 - use the original lazyrouter
    app.__expressLazyRouter = app.lazyrouter;
  } else {
    // Express v5 - implement lazyrouter functionality
    app.__expressLazyRouter = function() {
      // In Express v5, the router is automatically created and accessible via app.router
      // We just need to ensure it exists by accessing it
      if (!this._router) {
        // Access app.router to trigger router creation
        this._router = this.router;
      }
    };
  }

  Object.assign(app, proto);
  return app;
};

/**
 * Register a middleware using a factory function and a JSON config.
 *
 * **Example**
 *
 * ```js
 * app.middlewareFromConfig(compression, {
 *   enabled: true,
 *   phase: 'initial',
 *   params: {
 *     threshold: 128
 *   }
 * });
 * ```
 *
 * @param {function} factory The factory function creating a middleware handler.
 *   Typically a result of `require()` call, e.g. `require('compression')`.
 * @options {Object} config The configuration.
 * @property {String} phase The phase to register the middleware in.
 * @property {Boolean} [enabled] Whether the middleware is enabled.
 *   Default: `true`.
 * @property {Array|*} [params] The arguments to pass to the factory
 *   function. Either an array of arguments,
 *   or the value of the first argument when the factory expects
 *   a single argument only.
 * @property {Array|string|RegExp} [paths] Optional list of paths limiting
 *   the scope of the middleware.
 *
 * @returns {object} this (fluent API)
 *
 * @header app.middlewareFromConfig(factory, config)
 */
proto.middlewareFromConfig = function(factory, config) {
  assert(typeof factory === 'function', '"factory" must be a function');
  assert(typeof config === 'object', '"config" must be an object');
  assert(typeof config.phase === 'string' && config.phase,
    '"config.phase" must be a non-empty string');

  if (config.enabled === false)
    return;

  let params = config.params;
  if (params === undefined) {
    params = [];
  } else if (!Array.isArray(params)) {
    params = [params];
  }

  let handler = factory.apply(null, params);

  // Check if methods/verbs filter exists
  let verbs = config.methods || config.verbs;
  if (Array.isArray(verbs)) {
    verbs = verbs.map(function(verb) {
      return verb && verb.toUpperCase();
    });
    if (verbs.indexOf('ALL') === -1) {
      const originalHandler = handler;
      if (handler.length <= 3) {
        // Regular handler
        handler = function(req, res, next) {
          if (verbs.indexOf(req.method.toUpperCase()) === -1) {
            return next();
          }
          originalHandler(req, res, next);
        };
      } else {
        // Error handler
        handler = function(err, req, res, next) {
          if (verbs.indexOf(req.method.toUpperCase()) === -1) {
            return next(err);
          }
          originalHandler(err, req, res, next);
        };
      }
    }
  }
  // Express v5 compatibility: validate and sanitize paths
  let sanitizedPaths = this._sanitizePathsForExpress(config.paths);

  this.middleware(config.phase, sanitizedPaths, handler);

  return this;
};

/**
 * Register (new) middleware phases.
 *
 * If all names are new, then the phases are added just before "routes" phase.
 * Otherwise the provided list of names is merged with the existing phases
 * in such way that the order of phases is preserved.
 *
 * **Examples**
 *
 * ```js
 * // built-in phases:
 * // initial, session, auth, parse, routes, files, final
 *
 * app.defineMiddlewarePhases('custom');
 * // new list of phases
 * // initial, session, auth, parse, custom, routes, files, final
 *
 * app.defineMiddlewarePhases([
 *   'initial', 'postinit', 'preauth', 'routes', 'subapps'
 * ]);
 * // new list of phases
 * // initial, postinit, preauth, session, auth, parse, custom,
 * // routes, subapps, files, final
 * ```
 *
 * @param {string|Array.<string>} nameOrArray A phase name or a list of phase
 *   names to add.
 *
 * @returns {object} this (fluent API)
 *
 * @header app.defineMiddlewarePhases(nameOrArray)
 */
proto.defineMiddlewarePhases = function(nameOrArray) {
  this.lazyrouter();

  if (Array.isArray(nameOrArray)) {
    this._requestHandlingPhases =
      mergePhaseNameLists(this._requestHandlingPhases, nameOrArray);
  } else {
    // add the new phase before 'routes'
    const routesIx = this._requestHandlingPhases.indexOf('routes');
    this._requestHandlingPhases.splice(routesIx - 1, 0, nameOrArray);
  }

  return this;
};

/**
 * Sanitize paths for Express v5 compatibility
 * @param {Array|string|RegExp} paths Paths to sanitize
 * @returns {Array|string|RegExp} Sanitized paths
 * @private
 */
proto._sanitizePathsForExpress = function(paths) {
  if (Array.isArray(paths)) {
    return paths.map(path => {
      if (typeof path === 'string') {
        // Convert wildcard patterns to proper Express patterns first
        // Handle patterns like "/api/_m-*" which cause issues in Express v5
        if (path.includes('*') && !path.includes(':')) {
          // Convert "/api/_m-*" to regex pattern, escaping special chars except *
          const escapedPath = path.replace(/[.+?^${}()|[\]\\!]/g, '\\$&');
          return new RegExp('^' + escapedPath.replace(/\*/g, '.*') + '$');
        }

        // Handle special regex patterns that cause path-to-regexp parsing errors
        // Convert patterns with special characters to proper regex patterns
        // Check for any characters that path-to-regexp can't handle as literal paths
        if (path.match(/[.+?^${}()|[\]\\!]/)) {
          // Escape ALL special regex characters and convert to regex pattern
          const escapedPath = path.replace(/[.+?^${}()|[\]\\!]/g, '\\$&');
          return new RegExp('^' + escapedPath + '$');
        }
      }
      return path;
    });
  } else if (typeof paths === 'string') {
    // Convert wildcard patterns to proper Express patterns first
    if (paths.includes('*') && !paths.includes(':')) {
      const escapedPath = paths.replace(/[.+?^${}()|[\]\\!]/g, '\\$&');
      return new RegExp('^' + escapedPath.replace(/\*/g, '.*') + '$');
    }

    // Handle single string path with special characters
    if (paths.match(/[.+?^${}()|[\]\\!]/)) {
      // Escape ALL special regex characters and convert to regex pattern
      const escapedPath = paths.replace(/[.+?^${}()|[\]\\!]/g, '\\$&');
      return new RegExp('^' + escapedPath + '$');
    }
  }

  // Return as-is for RegExp or other types
  return paths;
};

/**
 * Register a middleware handler to be executed in a given phase.
 * @param {string} name The phase name, e.g. "init" or "routes".
 * @param {Array|string|RegExp} [paths] Optional list of paths limiting
 *   the scope of the middleware.
 *   String paths are interpreted as expressjs path patterns,
 *   regular expressions are used as-is.
 * @param {function} handler The middleware handler, one of
 *   `function(req, res, next)` or
 *   `function(err, req, res, next)`
 * @returns {object} this (fluent API)
 *
 * @header app.middleware(name, handler)
 */
proto.middleware = function(name, paths, handler) {
  this.lazyrouter();

  if (handler === undefined && typeof paths === 'function') {
    handler = paths;
    paths = undefined;
  }

  assert(typeof name === 'string' && name, '"name" must be a non-empty string');
  assert(typeof handler === 'function', '"handler" must be a function');

  if (paths === undefined) {
    paths = '/';
  }

  // Express v5 compatibility: sanitize paths before passing to Express
  paths = this._sanitizePathsForExpress(paths);

  const fullPhaseName = name;
  const handlerName = handler.name || '<anonymous>';

  const m = name.match(/^(.+):(before|after)$/);
  if (m) {
    name = m[1];
  }

  if (this._requestHandlingPhases.indexOf(name) === -1)
    throw new Error(g.f('Unknown {{middleware}} phase %s', name));

  debug('use %s %s %s', fullPhaseName, paths, handlerName);

  this._skipLayerSorting = true;
  this.use(paths, handler);

  const layer = this._findLayerByHandler(handler);
  if (layer) {
    // Set the phase name for sorting
    layer.phase = fullPhaseName;
  } else {
    debug('No matching layer is found for %s %s', fullPhaseName, handlerName);
  }

  this._skipLayerSorting = false;

  this._sortLayersByPhase();

  return this;
};

/*!
 * Find the corresponding express layer by handler
 *
 * This is needed because monitoring agents such as NewRelic can add handlers
 * to the stack. For example, NewRelic adds sentinel handler. We need to search
 * the stackto find the correct layer.
 */
proto._findLayerByHandler = function(handler) {
  // Other handlers can be added to the stack, for example,
  // NewRelic adds sentinel handler, and AppDynamics adds
  // some additional proxy info. We need to search the stack

  // Express v5 compatibility: ensure we have the router reference
  const router = this._router || this.router;
  if (!router || !router.stack) return null;

  for (let k = router.stack.length - 1; k >= 0; k--) {
    const isOriginal = router.stack[k].handle === handler;
    const isNewRelic = router.stack[k].handle['__NR_original'] === handler;
    const isAppDynamics = router.stack[k].handle['__appdynamicsProxyInfo__'] &&
      router.stack[k].handle['__appdynamicsProxyInfo__']['orig'] === handler;

    if (isOriginal || isNewRelic || isAppDynamics) {
      return router.stack[k];
    } else {
      // Aggressively check if the original handler has been wrapped
      // into a new function with a property pointing to the original handler
      for (const p in router.stack[k].handle) {
        if (router.stack[k].handle[p] === handler) {
          return router.stack[k];
        }
      }
    }
  }
  return null;
};

// Install our custom PhaseList-based handler into the app
proto.lazyrouter = function() {
  const self = this;
  if (self._router) return;

  self.__expressLazyRouter();

  // Express v5 compatibility: router is now accessible via app.router
  const router = self._router || self.router;
  if (!self._router && self.router) {
    self._router = self.router;
  }

  // Mark all middleware added by Router ctor as builtin
  // The sorting algo will keep them at beginning of the list
  // Only mark as initial builtin if this is the first time lazyrouter is called
  const isFirstInit = !self._routerInitialized;
  self._routerInitialized = true;

  // Mark all middleware added by Router ctor as builtin
  // The sorting algo will keep them at beginning of the list
  router.stack.forEach(function(layer) {
    layer.phase = BUILTIN_MIDDLEWARE;
  });

  router.__expressUse = router.use;
  router.use = function useAndSort() {
    const retval = this.__expressUse.apply(this, arguments);
    self._sortLayersByPhase();
    return retval;
  };

  router.__expressRoute = router.route;
  router.route = function routeAndSort() {
    const retval = this.__expressRoute.apply(this, arguments);
    self._sortLayersByPhase();
    return retval;
  };

  self._requestHandlingPhases = [
    'initial', 'session', 'auth', 'parse',
    'routes', 'files', 'final',
  ];
};

proto._sortLayersByPhase = function() {
  if (this._skipLayerSorting) return;

  const phaseOrder = {};
  this._requestHandlingPhases.forEach(function(name, ix) {
    phaseOrder[name + ':before'] = ix * 3;
    phaseOrder[name] = ix * 3 + 1;
    phaseOrder[name + ':after'] = ix * 3 + 2;
  });

  // Express v5 compatibility: ensure we have the router reference
  const router = this._router || this.router;
  if (!router || !router.stack) return;

  // Special handling for the edge case where builtin middleware is mixed with phase middleware
  // This is needed for the "allows extra handlers on express stack during app.use" test
  router.stack.forEach(function(layer, index) {
    if (layer.phase === BUILTIN_MIDDLEWARE) {
      // Check if there are any phase middleware after this builtin middleware
      const hasPhaseAfter = router.stack.slice(index + 1).some(l =>
        l.phase && typeof l.phase === 'string'
      );

      if (hasPhaseAfter) {
        // This builtin middleware should be treated as routes phase for sorting
        layer._effectivePhase = undefined;
      }
    }
  });

  stableSortInPlace(router.stack, compareLayers);

  function compareLayers(left, right) {
    // Use _effectivePhase if the property exists, otherwise use original phase
    const leftPhase = left.hasOwnProperty('_effectivePhase') ? left._effectivePhase : left.phase;
    const rightPhase = right.hasOwnProperty('_effectivePhase') ? right._effectivePhase : right.phase;

    if (leftPhase === rightPhase) return 0;

    // Builtin middleware is always first
    if (leftPhase === BUILTIN_MIDDLEWARE) return -1;
    if (rightPhase === BUILTIN_MIDDLEWARE) return 1;

    // Layers registered via app.use and app.route
    // are executed as the first items in `routes` phase
    if (leftPhase === undefined) {
      if (rightPhase === 'routes')
        return -1;

      return phaseOrder['routes'] - phaseOrder[rightPhase];
    }

    if (rightPhase === undefined)
      return -compareLayers(right, left);

    // Layers registered via `app.middleware` are compared via phase & hook
    return phaseOrder[leftPhase] - phaseOrder[rightPhase];
  }
};
