// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module dependencies.
 */

'use strict';
const assert = require('node:assert')
const g = require('../../lib/globalize')
const debug = require('debug')('loopback:middleware:token')

/*!
 * Export the middleware.
 */

module.exports = token;

/*
 * Rewrite the url to replace current user literal with the logged in user id
 */
async function rewriteUserLiteral(req, currentUserLiteral) {
  if (!currentUserLiteral) return

  const literalRegExp = new RegExp('/' + currentUserLiteral + '(/|$|\\?)', 'g');

  if (req.accessToken?.userId) {
    // Replace /me/ with /current-user-id/
    const urlBeforeRewrite = req.url;
    req.url = req.url.replace(literalRegExp,
      '/' + req.accessToken.userId + '$1');

    if (req.url !== urlBeforeRewrite) {
      debug('req.url has been rewritten from %s to %s', urlBeforeRewrite, req.url)
    }
  }
  else if (!req.accessToken && literalRegExp.test(req.url)) {
    debug(
      'URL %s matches current-user literal %s,' +
        ' but no (valid) access token was provided.',
      req.url, currentUserLiteral,
    );

    const error = new Error(g.f('Authorization Required'));
    error.status = error.statusCode = 401;
    error.code = 'AUTHORIZATION_REQUIRED';
    throw error;
  }
}

function escapeRegExp(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Check for an access token in cookies, headers, and query string parameters.
 * This function always checks for the following:
 *
 * - `access_token` (params only)
 * - `X-Access-Token` (headers only)
 * - `authorization` (headers and cookies)
 *
 * It checks for these values in cookies, headers, and query string parameters _in addition_ to the items
 * specified in the options parameter.
 *
 * **NOTE:** This function only checks for [signed cookies](http://expressjs.com/api.html#req.signedCookies).
 *
 * The following example illustrates how to check for an `accessToken` in a custom cookie, query string parameter
 * and header called `foo-auth`.
 *
 * ```js
 * app.use(loopback.token({
 *   cookies: ['foo-auth'],
 *   headers: ['foo-auth', 'X-Foo-Auth'],
 *   params: ['foo-auth', 'foo_auth']
 * }));
 * ```
 *
 * @options {Object} [options] Each option array is used to add additional keys to find an `accessToken` for a `request`.
 * @property {Array} [cookies] Array of cookie names.
 * @property {Array} [headers] Array of header names.
 * @property {Array} [params] Array of param names.
 * @property {Boolean} [searchDefaultTokenKeys] Use the default search locations for Token in request
 * @property {Boolean} [enableDoublecheck] Execute middleware although an instance mounted earlier in the chain didn't find a token
 * @property {Boolean} [overwriteExistingToken] only has effect in combination with `enableDoublecheck`. If truthy, will allow to overwrite an existing accessToken.
 * @property {Function|String} [model] AccessToken model name or class to use.
 * @property {String} [currentUserLiteral] String literal for the current user.
 * @property {Boolean} [bearerTokenBase64Encoded] Defaults to `true`. For `Bearer` token based `Authorization` headers,
 * decode the value from `Base64`. If set to `false`, the decoding will be skipped and the token id will be the raw value
 * parsed from the header.
 * @header loopback.token([options])
 */

function token(options) {
  options = options || {};
  let TokenModel;

  let currentUserLiteral = options.currentUserLiteral;
  if (currentUserLiteral && (typeof currentUserLiteral !== 'string')) {
    debug('Set currentUserLiteral to \'me\' as the value is not a string.');
    currentUserLiteral = 'me';
  }
  if (typeof currentUserLiteral === 'string') {
    currentUserLiteral = escapeRegExp(currentUserLiteral);
  }

  if (options.bearerTokenBase64Encoded === undefined) {
    options.bearerTokenBase64Encoded = true;
  }
  const enableDoublecheck = !!options.enableDoublecheck;
  const overwriteExistingToken = !!options.overwriteExistingToken;

  return function(req, res, next) {
    const app = req.app;
    const registry = app.registry;
    if (!TokenModel) {
      TokenModel = registry.getModel(options.model || 'AccessToken');
    }

    assert(typeof TokenModel === 'function',
      'loopback.token() middleware requires a AccessToken model');

    if (req.accessToken !== undefined) {
      if (!enableDoublecheck) {
        return rewriteUserLiteral(req, currentUserLiteral)
          .then(() => next())
          .catch(next)
      }
      if (req.accessToken && req.accessToken.id && !overwriteExistingToken) {
        return rewriteUserLiteral(req, currentUserLiteral)
          .then(() => next())
          .catch(next)
      }
      // continue normal operation (as if req.accessToken was undefined)
    }

    TokenModel.findForRequest(req, options).then(token => {
      req.accessToken = token || null

      const ctx = req.loopbackContext
      if (ctx && ctx.active) {
        ctx.set('accessToken', token)
      }

      rewriteUserLiteral(req, currentUserLiteral)
        .then(() => next())
        .catch(next)
    })
    .catch(next)
  }
}
