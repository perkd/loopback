// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const utils = require('../../lib/utils');

/*!
 * Application management functions
 */

const crypto = require('crypto');

function generateKey(hmacKey, algorithm, encoding) {
  hmacKey = hmacKey || 'loopback';
  algorithm = algorithm || 'sha1';
  encoding = encoding || 'hex';
  const hmac = crypto.createHmac(algorithm, hmacKey);
  const buf = crypto.randomBytes(32);
  hmac.update(buf);
  const key = hmac.digest(encoding);
  return key;
}

/**
 * Manage client applications and organize their users.
 *
 * @property {String} id  Generated ID.
 * @property {String} name Name; required.
 * @property {String} description Text description
 * @property {String} icon String Icon image URL.
 * @property {String} owner User ID of the developer who registers the application.
 * @property {String} email E-mail address
 * @property {Boolean} emailVerified Whether the e-mail is verified.
 * @property {String} url OAuth 2.0  application URL.
 * @property {String}[] callbackUrls The OAuth 2.0 code/token callback URL.
 * @property {String} status Status of the application; Either `production`, `sandbox` (default), or `disabled`.
 * @property {Date} created Date Application object was created.  Default: current date.
 * @property {Date} modified Date Application object was modified.  Default: current date.
 *
 * @property {Object} pushSettings.apns APNS configuration, see the options
 *   below and also
 *   https://github.com/argon/node-apn/blob/master/doc/apn.markdown
 * @property {Boolean} pushSettings.apns.production Whether to use production Apple Push Notification Service (APNS) servers to send push notifications.
 * If true, uses `gateway.push.apple.com:2195` and `feedback.push.apple.com:2196`.
 * If false, uses `gateway.sandbox.push.apple.com:2195` and `feedback.sandbox.push.apple.com:2196`
 * @property {String} pushSettings.apns.certData The certificate data loaded from the cert.pem file (APNS).
 * @property {String} pushSettings.apns.keyData The key data loaded from the key.pem file (APNS).
 * @property {String} pushSettings.apns.pushOptions.gateway (APNS).
 * @property {Number} pushSettings.apns.pushOptions.port (APNS).
 * @property {String} pushSettings.apns.feedbackOptions.gateway  (APNS).
 * @property {Number} pushSettings.apns.feedbackOptions.port (APNS).
 * @property {Boolean} pushSettings.apns.feedbackOptions.batchFeedback (APNS).
 * @property {Number} pushSettings.apns.feedbackOptions.interval (APNS).
 * @property {String} pushSettings.gcm.serverApiKey: Google Cloud Messaging API key.
 *
 * @property {Boolean} authenticationEnabled
 * @property {Boolean} anonymousAllowed
 * @property {Array} authenticationSchemes List of authentication schemes
 *  (see below).
 * @property {String} authenticationSchemes.scheme Scheme name.
 *   Supported values: `local`, `facebook`, `google`,
 *   `twitter`, `linkedin`, `github`.
 * @property {Object} authenticationSchemes.credential
 *   Scheme-specific credentials.
 *
 * @class Application
 * @inherits {PersistedModel}
 */

module.exports = function(Application) {
  /*!
   * A hook to generate keys before creation
   * @param next
   */
  Application.observe('before save', function(ctx, next) {
    if (!ctx.instance) {
      // Partial update - don't generate new keys
      // NOTE(bajtos) This also means that an atomic updateOrCreate
      // will not generate keys when a new record is creatd
      return next();
    }

    const app = ctx.instance;
    app.created = app.modified = new Date();
    if (!app.id) {
      app.id = generateKey('id', 'md5');
    }
    app.clientKey = generateKey('client');
    app.javaScriptKey = generateKey('javaScript');
    app.restApiKey = generateKey('restApi');
    app.windowsKey = generateKey('windows');
    app.masterKey = generateKey('master');
    next();
  });

  /**
   * Register a new application
   * @param {String} owner Owner's user ID.
   * @param {String} name  Name of the application
   * @param {Object} options  Other options
   * @callback {Function} callback  Callback function
   * @param {Error} err
   * @promise
   */
  Application.register = function(owner, name, options, callback) {
    // Compute props immediately so it is available in both promise and callback branches
    const props = { owner: owner, name: name }
    for (const p in options) {
      if (!(p in props)) {
        props[p] = options[p]
      }
    }
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.create(props, (err, result) => err ? reject(err) : resolve(result))
      })
    }
    this.create(props, callback)
  };

  /**
   * Reset keys for the application instance
   * @callback {Function} callback
   * @param {Error} err
   */
  Application.prototype.resetKeys = function(cb) {
    if (!cb) {
      return new Promise((resolve, reject) => {
        this.save((err, result) => err ? reject(err) : resolve(result))
      })
    }
    this.clientKey = generateKey('client');
    this.javaScriptKey = generateKey('javaScript');
    this.restApiKey = generateKey('restApi');
    this.windowsKey = generateKey('windows');
    this.masterKey = generateKey('master');
    this.modified = new Date();
    this.save(cb);
  };

  /**
   * Reset keys for a given application by the appId
   * @param {Any} appId
   * @callback {Function} callback
   * @param {Error} err
   * @promise
   */
  Application.resetKeys = function(appId, cb) {
    if (!cb) {
      return new Promise((resolve, reject) => {
        this.findById(appId, (err, app) => {
          if (err) return reject(err);
          app.resetKeys((err, result) => err ? reject(err) : resolve(result))
        })
      })
    }
    this.findById(appId, function(err, app) {
      if (err) {
        if (cb) cb(err, app);
        return;
      }
      app.resetKeys(cb);
    });
  };

  /**
   * Authenticate the application id and key.
   *
   * @param {Any} appId
   * @param {String} key
   * @callback {Function} callback
   * @param {Error} err
   * @param {String} matched The matching key; one of:
   * - clientKey
   * - javaScriptKey
   * - restApiKey
   * - windowsKey
   * - masterKey
   */
  Application.authenticate = function(appId, key, cb) {
    if (!cb) {
      return new Promise((resolve, reject) => {
        this.findById(appId, (err, app) => {
          if (err) return reject(err);
          let result = null;
          const keyNames = ['clientKey', 'javaScriptKey', 'restApiKey', 'windowsKey', 'masterKey'];
          for (let i = 0; i < keyNames.length; i++) {
            if (app[keyNames[i]] === key) {
              result = {
                application: app,
                keyType: keyNames[i],
              };
              break;
            }
          }
          resolve(result)
        })
      })
    }
    this.findById(appId, function(err, app) {
      if (err || !app) {
        cb(err, null);
        return;
      }
      let result = null;
      const keyNames = ['clientKey', 'javaScriptKey', 'restApiKey', 'windowsKey', 'masterKey'];
      for (let i = 0; i < keyNames.length; i++) {
        if (app[keyNames[i]] === key) {
          result = {
            application: app,
            keyType: keyNames[i],
          };
          break;
        }
      }
      cb(null, result);
    });
  };

  Application.prototype.getPrincipals = function(userId, roleName, callback) {
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.getPrincipals(userId, roleName, (err, result) => err ? reject(err) : resolve(result))
      })
    }

    // ... existing logic ...
  };
};
