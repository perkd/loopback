// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

/*!
 * Module Dependencies.
 */

'use strict';
const assert = require('node:assert')
const path = require('node:path')
const crypto = require('node:crypto')
const qs = require('querystring')
const isEmail = require('isemail')
const debug = require('debug')('loopback:user')
const g = require('../../lib/globalize');
const loopback = require('../../lib/loopback');

const SALT_WORK_FACTOR = 10;
// bcrypt's max length is 72 bytes;
// See https://github.com/kelektiv/node.bcrypt.js/blob/45f498ef6dc6e8234e58e07834ce06a50ff16352/src/node_blf.h#L59
const MAX_PASSWORD_LENGTH = 72;
let bcrypt;
try {
  // Try the native module first
  bcrypt = require('bcrypt');
  // Browserify returns an empty object
  if (bcrypt && typeof bcrypt.compare !== 'function') {
    bcrypt = require('bcryptjs');
  }
} catch (err) {
  // Fall back to pure JS impl
  bcrypt = require('bcryptjs');
}

const DEFAULT_TTL = 1209600; // 2 weeks in seconds
const DEFAULT_RESET_PW_TTL = 15 * 60; // 15 mins in seconds
const DEFAULT_MAX_TTL = 31556926; // 1 year in seconds

/**
 * Built-in User model.
 * Extends LoopBack [PersistedModel](#persistedmodel-new-persistedmodel).
 *
 * Default `User` ACLs.
 *
 * - DENY EVERYONE `*`
 * - ALLOW EVERYONE `create`
 * - ALLOW OWNER `deleteById`
 * - ALLOW EVERYONE `login`
 * - ALLOW EVERYONE `logout`
 * - ALLOW OWNER `findById`
 * - ALLOW OWNER `updateAttributes`
 *
 * @property {String} username Must be unique.
 * @property {String} password Hidden from remote clients.
 * @property {String} email Must be valid email.
 * @property {Boolean} emailVerified Set when a user's email has been verified via `confirm()`.
 * @property {String} verificationToken Set when `verify()` is called.
 * @property {String} realm The namespace the user belongs to. See [Partitioning users with realms](http://loopback.io/doc/en/lb2/Partitioning-users-with-realms.html) for details.
 * @property {Object} settings Extends the `Model.settings` object.
 * @property {Boolean} settings.emailVerificationRequired Require the email verification
 * process before allowing a login.
 * @property {Number} settings.ttl Default time to live (in seconds) for the `AccessToken` created by `User.login() / user.createAccessToken()`.
 * Default is `1209600` (2 weeks)
 * @property {Number} settings.maxTTL The max value a user can request a token to be alive / valid for.
 * Default is `31556926` (1 year)
 * @property {Boolean} settings.realmRequired Require a realm when logging in a user.
 * @property {String} settings.realmDelimiter When set a realm is required.
 * @property {Number} settings.resetPasswordTokenTTL Time to live for password reset `AccessToken`. Default is `900` (15 minutes).
 * @property {Number} settings.saltWorkFactor The `bcrypt` salt work factor. Default is `10`.
 * @property {Boolean} settings.caseSensitiveEmail Enable case sensitive email.
 *
 * @class User
 * @inherits {PersistedModel}
 */

module.exports = function(User) {
  /**
   * Create access token for the logged in user. This method can be overridden to
   * customize how access tokens are generated
   *
   * Supported flavours:
   *
   * ```js
   * await createAccessToken(ttl)
   * await createAccessToken(ttl, options)
   * await createAccessToken(options)
   * await createAccessToken(data, options)
   * ```
   *
   * @options {Number|Object} [ttl|data] Either the requested ttl,
   * or an object with token properties to set (see below).
   * @property {Number} [ttl] The requested ttl
   * @property {String[]} [scopes] The access scopes granted to the token.
   * @param {Object} [options] Additional options including remoting context
   * @returns {Promise<AccessToken>} A promise that resolves to the generated access token
   *
   */
  User.prototype.createAccessToken = async function(ttl, options) {
    let tokenData

    if (typeof ttl !== 'object') {
      tokenData = {ttl}
    } else if (options) {
      tokenData = ttl
    } else {
      tokenData = {}
      options = ttl
    }

    const userSettings = this.constructor.settings
    tokenData.ttl = Math.min(tokenData.ttl || userSettings.ttl, userSettings.maxTTL)
    return this.accessTokens.create(tokenData, options)
  }

  function splitPrincipal(name, realmDelimiter) {
    const parts = [null, name];
    if (!realmDelimiter) {
      return parts;
    }
    const index = name.indexOf(realmDelimiter);
    if (index !== -1) {
      parts[0] = name.substring(0, index);
      parts[1] = name.substring(index + realmDelimiter.length);
    }
    return parts;
  }

  /**
   * Normalize the credentials
   * @param {Object} credentials The credential object
   * @param {Boolean} realmRequired
   * @param {String} realmDelimiter The realm delimiter, if not set, no realm is needed
   * @returns {Object} The normalized credential object
   */
  User.normalizeCredentials = function(credentials, realmRequired, realmDelimiter) {
    const query = {};
    credentials = credentials || {};
    if (!realmRequired) {
      if (credentials.email) {
        query.email = credentials.email;
      } else if (credentials.username) {
        query.username = credentials.username;
      }
    } else {
      if (credentials.realm) {
        query.realm = credentials.realm;
      }
      let parts;
      if (credentials.email) {
        parts = splitPrincipal(credentials.email, realmDelimiter);
        query.email = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      } else if (credentials.username) {
        parts = splitPrincipal(credentials.username, realmDelimiter);
        query.username = parts[1];
        if (parts[0]) {
          query.realm = parts[0];
        }
      }
    }
    return query;
  };

  /**
   * Login a user by with the given `credentials`.
   *
   * ```js
   *    const token = await User.login({username: 'foo', password: 'bar'})
   *    console.log(token.id)
   * ```
   *
   * If the `emailVerificationRequired` flag is set for the inherited user model
   * and the email has not yet been verified then the method will return a 401
   * error that will contain the user's id. This id can be used to call the
   * `api/verify` remote method to generate a new email verification token and
   * send back the related email to the user.
   *
   * @param {Object} credentials username/password or email/password
   * @param {String[]|String} [include] Optionally set it to "user" to include
   * the user info
   * @returns {Promise<AccessToken>} A promise that resolves to the access token if login is successful
   */
  User.login = async function(credentials, include) {
    const self = this

    include = (include || '')
    if (Array.isArray(include)) {
      include = include.map(function(val) {
        return val.toLowerCase()
      })
    } else {
      include = include.toLowerCase()
    }

    let realmDelimiter
    // Check if realm is required
    const realmRequired = !!(self.settings.realmRequired ||
      self.settings.realmDelimiter)
    if (realmRequired) {
      realmDelimiter = self.settings.realmDelimiter
    }
    const query = self.normalizeCredentials(credentials, realmRequired,
      realmDelimiter)

    if (realmRequired) {
      if (!query.realm) {
        const err1 = new Error(g.f('{{realm}} is required'))
        err1.statusCode = 400
        err1.code = 'REALM_REQUIRED'
        throw err1
      } else if (typeof query.realm !== 'string') {
        const err5 = new Error(g.f('Invalid realm'))
        err5.statusCode = 400
        err5.code = 'INVALID_REALM'
        throw err5
      }
    }
    if (!query.email && !query.username) {
      const err2 = new Error(g.f('{{username}} or {{email}} is required'))
      err2.statusCode = 400
      err2.code = 'USERNAME_EMAIL_REQUIRED'
      throw err2
    }
    if (query.username && typeof query.username !== 'string') {
      const err3 = new Error(g.f('Invalid username'))
      err3.statusCode = 400
      err3.code = 'INVALID_USERNAME'
      throw err3
    } else if (query.email && typeof query.email !== 'string') {
      const err4 = new Error(g.f('Invalid email'))
      err4.statusCode = 400
      err4.code = 'INVALID_EMAIL'
      throw err4
    }

    const defaultError = new Error(g.f('login failed'))
    defaultError.statusCode = 401
    defaultError.code = 'LOGIN_FAILED'

    try {
      const user = await self.findOne({where: query})
      
      if (!user) {
        debug('No matching record is found for user %s', query.email || query.username)
        throw defaultError
      }
      
      const isMatch = await user.hasPassword(credentials.password)
      
      if (!isMatch) {
        debug('The password is invalid for user %s', query.email || query.username)
        throw defaultError
      }
      
      if (self.settings.emailVerificationRequired && !user.emailVerified) {
        // Fail to log in if email verification is not done yet
        debug('User email has not been verified')
        const err = new Error(g.f('login failed as the email has not been verified'))
        err.statusCode = 401
        err.code = 'LOGIN_FAILED_EMAIL_NOT_VERIFIED'
        err.details = {
          userId: user.id,
        }
        throw err
      }
      
      // Create the access token
      let token
      if (user.createAccessToken.length === 1) {
        token = await user.createAccessToken(credentials.ttl)
      } else {
        token = await user.createAccessToken(credentials.ttl, credentials)
      }
      
      // Include user info if requested
      if (Array.isArray(include) ? include.indexOf('user') !== -1 : include === 'user') {
        // NOTE(bajtos) We can't set token.user here:
        //  1. token.user already exists, it's a function injected by
        //     "AccessToken belongsTo User" relation
        //  2. ModelBaseClass.toJSON() ignores own properties, thus
        //     the value won't be included in the HTTP response
        // See also loopback#161 and loopback#162
        token.__data.user = user
      }
      
      return token
    } catch (err) {
      debug('An error occurred during login: %j', err)
      throw err
    }
  }

  /**
   * Logout a user with the given accessToken id.
   *
   * @param {String} accessTokenID
   * @returns {Promise<Object>} A promise that resolves when the user is successfully logged out
   */
  User.logout = async function(tokenId) {
    if (!tokenId) {
      const err = new Error(g.f('{{accessToken}} is required to logout'))
      err.statusCode = 401
      throw err
    }

    try {
      const info = await this.relations.accessTokens.modelTo.destroyById(tokenId)
      
      if ('count' in info && info.count === 0) {
        const err = new Error(g.f('Could not find {{accessToken}}'))
        err.statusCode = 401
        throw err
      }
      
      return info
    } catch (err) {
      throw err
    }
  }

  User.observe('before delete', async function(ctx) {
    // Do nothing when the access control was disabled for this user model.
    if (!ctx.Model.relations.accessTokens) return

    const AccessToken = ctx.Model.relations.accessTokens.modelTo
    const pkName = ctx.Model.definition.idName() || 'id'
    
    const list = await ctx.Model.find({where: ctx.where, fields: [pkName]})
    
    const ids = list.map(function(u) { return u[pkName] })
    ctx.where = {}
    ctx.where[pkName] = {inq: ids}

    await AccessToken.destroyAll({userId: {inq: ids}})
  })

  /**
   * Compare the given `password` with the users hashed password.
   *
   * @param {String} password The plain text password
   * @returns {Promise<Boolean>} Returns true if the given `password` matches record
   */
  User.prototype.hasPassword = async function(plain) {
    if (this.password && plain) {
      return await bcrypt.compare(plain, this.password)
    } else {
      return false
    }
  }

  /**
   * Change this user's password.
   *
   * @param {*} userId Id of the user changing the password
   * @param {string} oldPassword Current password, required to verify user identity
   * @param {string} newPassword The new password to use
   * @param {object} [options] Additional options
   * @returns {Promise<Object>} The updated user instance
   */
  User.changePassword = async function(userId, oldPassword, newPassword, options) {
    // Use the instance method on the appropriate (sub)class
    const inst = await this.findById(userId, options)
    
    if (!inst) {
      const err = new Error(`User ${userId} not found`)
      Object.assign(err, {code: 'USER_NOT_FOUND', statusCode: 401})
      throw err
    }
    
    return await inst.changePassword(oldPassword, newPassword, options)
  }

  /**
   * Change this user's password (prototype/instance version).
   *
   * @param {string} oldPassword Current password, required to verify user identity
   * @param {string} newPassword The new password to use
   * @param {object} [options] Additional options
   * @returns {Promise<Object>} The updated user instance
   */
  User.prototype.changePassword = async function(oldPassword, newPassword, options) {
    const isMatch = await this.hasPassword(oldPassword)
    
    if (!isMatch) {
      const err = new Error('Invalid current password')
      Object.assign(err, {code: 'INVALID_PASSWORD', statusCode: 400})
      throw err
    }
    
    return await this.setPassword(newPassword, options)
  }

  /**
   * Set this user's password after a password-reset request was made.
   *
   * @param {*} userId Id of the user changing the password
   * @param {string} newPassword The new password to use
   * @param {Object} [options] Additional options including remoting context
   * @returns {Promise<Object>} The updated user instance
   */
  User.setPassword = async function(userId, newPassword, options) {
    assert(userId != null && userId !== '', 'userId is a required argument')
    assert(!!newPassword, 'newPassword is a required argument')

    // Ensure options is always an object
    options = Object.assign({}, options)

    // Validate token scope first. When the settings flag is enabled and an
    // access token is provided, the token must have the 'reset-password' scope.
    const tokenId = options && options.accessToken && options.accessToken.id
    if (this.settings.restrictResetPasswordTokenScope && tokenId) {
      const token = options.accessToken
      if (!token.scopes || token.scopes.indexOf('reset-password') === -1) {
        const err = new Error('Invalid token scope')
        err.statusCode = 403
        err.code = 'INVALID_TOKEN_SCOPE'
        throw err
      }
    }

    // Validate the password
    this.validatePassword(newPassword)

    // Find the user and set the password
    const inst = await this.findById(userId, options)
    if (!inst) {
      const err = new Error(`User ${userId} not found`)
      Object.assign(err, {code: 'USER_NOT_FOUND', statusCode: 401})
      throw err
    }
    
    return await inst.setPassword(newPassword, options)
  }

  /**
   * Returns default verification options to use when calling User.prototype.verify()
   * from remote method /user/:id/verify.
   *
   * NOTE: the User.getVerifyOptions() method can also be used to ease the
   * building of identity verification options.
   *
   * ```js
   * var verifyOptions = MyUser.getVerifyOptions();
   * user.verify(verifyOptions);
   * ```
   *
   * This is the full list of possible params, with example values
   *
   * ```js
   * {
   *   type: 'email',
   *   mailer: {
   *     send(verifyOptions, options, cb) {
   *       // send the email
   *       cb(err, result);
   *     }
   *   },
   *   to: 'test@email.com',
   *   from: 'noreply@email.com'
   *   subject: 'verification email subject',
   *   text: 'Please verify your email by opening this link in a web browser',
   *   headers: {'Mime-Version': '1.0'},
   *   template: 'path/to/template.ejs',
   *   templateFn: function(verifyOptions, options, cb) {
   *     cb(null, 'some body template');
   *   }
   *   redirect: '/',
   *   verifyHref: 'http://localhost:3000/api/user/confirm',
   *   host: 'localhost'
   *   protocol: 'http'
   *   port: 3000,
   *   restApiRoot= '/api',
   *   generateVerificationToken: function (user, options, cb) {
   *     cb(null, 'random-token');
   *   }
   * }
   * ```
   *
   * NOTE: param `to` internally defaults to user's email but can be overriden for
   * test purposes or advanced customization.
   *
   * Static default params can be modified in your custom user model json definition
   * using `settings.verifyOptions`. Any default param can be programmatically modified
   * like follows:
   *
   * ```js
   * customUserModel.getVerifyOptions = function() {
   *   const base = MyUser.base.getVerifyOptions();
   *   return Object.assign({}, base, {
   *     // custom values
   *   });
   * }
   * ```
   *
   * Usually you should only require to modify a subset of these params
   * See `User.verify()` and `User.prototype.verify()` doc for params reference
   * and their default values.
   */

  User.getVerifyOptions = function() {
    const defaultOptions = {
      type: 'email',
      from: 'noreply@example.com',
    };
    return Object.assign({}, this.settings.verifyOptions || defaultOptions);
  };

  /**
   * Verify a user's identity by sending them a confirmation message.
   * NOTE: Currently only email verification is supported
   *
   * ```js
   * const verifyOptions = {
   *   type: 'email',
   *   from: 'noreply@example.com'
   *   template: 'verify.ejs',
   *   redirect: '/'
   * }
   *
   * await user.verify(verifyOptions)
   * ```
   *
   * NOTE: the User.getVerifyOptions() method can also be used to ease the
   * building of identity verification options.
   *
   * ```js
   * const verifyOptions = MyUser.getVerifyOptions()
   * await user.verify(verifyOptions)
   * ```
   *
   * @options {Object} verifyOptions
   * @property {String} type Must be `'email'` in the current implementation
   * @property {Function} mailer A mailer function with a static `.send() method
   * @property {String} to Email address to which verification email is sent
   * @property {String} from Sender email address
   * @property {String} subject Subject line text
   * @property {String} text Text of email
   * @property {Object} headers Email headers
   * @property {String} template Relative path of template
   * @property {Function} templateFn A function generating the email HTML body
   * @property {String} redirect Page to which user will be redirected
   * @property {String} verifyHref The link to include in the user's verify message
   * @property {String} host The API host
   * @property {String} protocol The API protocol
   * @property {Number} port The API port
   * @property {String} restApiRoot The API root path
   * @property {Function} generateVerificationToken A function to generate the verification token
   * @param {Object} options Remote context options
   * @returns {Promise<Object>} Contains email, token, uid
   */
  User.prototype.verify = async function(verifyOptions, options) {
    const user = this
    const userModel = this.constructor
    const registry = userModel.registry
    verifyOptions = Object.assign({}, verifyOptions)
    
    // Set a default template generation function if none provided
    verifyOptions.templateFn = verifyOptions.templateFn || createVerificationEmailBody

    // Set a default token generation function if none provided
    verifyOptions.generateVerificationToken = verifyOptions.generateVerificationToken ||
      User.generateVerificationToken

    // Set a default mailer function if none provided
    verifyOptions.mailer = verifyOptions.mailer || userModel.email ||
      registry.getModelByType(loopback.Email)

    const pkName = userModel.definition.idName() || 'id'
    verifyOptions.redirect = verifyOptions.redirect || '/'
    const defaultTemplate = path.join(__dirname, '..', '..', 'templates', 'verify.ejs')
    verifyOptions.template = path.resolve(verifyOptions.template || defaultTemplate)
    verifyOptions.user = user
    verifyOptions.protocol = verifyOptions.protocol || 'http'

    const app = userModel.app
    verifyOptions.host = verifyOptions.host || (app && app.get('host')) || 'localhost'
    verifyOptions.port = verifyOptions.port || (app && app.get('port')) || 3000
    verifyOptions.restApiRoot = verifyOptions.restApiRoot || (app && app.get('restApiRoot')) || '/api'

    const displayPort = (
      (verifyOptions.protocol === 'http' && verifyOptions.port == '80') ||
      (verifyOptions.protocol === 'https' && verifyOptions.port == '443')
    ) ? '' : ':' + verifyOptions.port

    if (!verifyOptions.verifyHref) {
      const confirmMethod = userModel.sharedClass.findMethodByName('confirm')
      if (!confirmMethod) {
        throw new Error(
          'Cannot build user verification URL, ' +
          'the default confirm method is not public. ' +
          'Please provide the URL in verifyOptions.verifyHref.'
        )
      }

      const urlPath = joinUrlPath(
        verifyOptions.restApiRoot,
        userModel.http.path,
        confirmMethod.http.path
      )

      verifyOptions.verifyHref =
        verifyOptions.protocol +
        '://' +
        verifyOptions.host +
        displayPort +
        urlPath +
        '?' + qs.stringify({
          uid: '' + verifyOptions.user[pkName],
          redirect: verifyOptions.redirect,
        })
    }

    verifyOptions.to = verifyOptions.to || user.email
    verifyOptions.subject = verifyOptions.subject || g.f('Thanks for Registering')
    verifyOptions.headers = verifyOptions.headers || {}

    // assert the verifyOptions params that might have been badly defined
    assertVerifyOptions(verifyOptions)

    // Generate verification token
    const token = await verifyOptions.generateVerificationToken(user, options)
    
    // Add the token to the user and save
    user.verificationToken = token
    await user.save(options)
    
    // Send verification email
    verifyOptions.verifyHref +=
      verifyOptions.verifyHref.indexOf('?') === -1 ? '?' : '&'
    verifyOptions.verifyHref += 'token=' + user.verificationToken

    verifyOptions.verificationToken = user.verificationToken
    verifyOptions.text = verifyOptions.text || g.f('Please verify your email by opening ' +
      'this link in a web browser:\n\t%s', verifyOptions.verifyHref)
    verifyOptions.text = verifyOptions.text.replace(/\{href\}/g, verifyOptions.verifyHref)

    // Generate email HTML content
    const { templateFn } = verifyOptions
    verifyOptions.html = await templateFn(verifyOptions, options)

    // Remove verifyOptions.template to prevent rejection by certain
    // nodemailer transport plugins.
    delete verifyOptions.template

    // Send the email
    const { mailer } = verifyOptions
    const email = await mailer.send(verifyOptions, options)

    return {
      email, 
      token: user.verificationToken, 
      uid: user[pkName]
    }
  }

  async function createVerificationEmailBody(verifyOptions, options) {
    const text = verifyOptions.text || 'Please verify your email by opening this link in a web browser:'
    const verifyHref = verifyOptions.verifyHref || 
      `${verifyOptions.protocol}://${verifyOptions.host}:${verifyOptions.port}${verifyOptions.restApiRoot}/confirm`

    const html = `
      <h1>Email Verification</h1>
      <p>${text}</p>
      <a href="${verifyHref}?token=${verifyOptions.verificationToken}&uid=${verifyOptions.user.id}">
        Verify your email
      </a>
    `

    return html
  }

  /**
   * A default verification token generator which accepts the user the token is
   * being generated for. This one uses the crypto library and 64 random bytes
   * (converted to hex) for the token. When used in combination with the
   * user.verify() method this function will be called with the `user` object
   * as it's context (`this`).
   *
   * @param {object} user The User this token is being generated for
   * @param {object} options Remote context options
   * @returns {Promise<string>} The generated token
   */
  User.generateVerificationToken = async function(user, options) {
    return new Promise((resolve, reject) => {
      crypto.randomBytes(64, (err, buf) => {
        if (err) return reject(err)
        resolve(buf.toString('hex'))
      })
    })
  }

  /**
   * Confirm the user's identity.
   *
   * @param {Any} userId
   * @param {String} token The validation token
   * @param {String} redirect URL to redirect the user to once confirmed
   * @returns {Promise<Object>} Returns the user object if redirect is true
   */
  User.confirm = async function(userId, token, redirect) {
    const user = await this.findById(userId)
    
    if (!user) {
      const err = new Error(g.f('User not found: %s', userId))
      err.statusCode = 404
      err.code = 'USER_NOT_FOUND'
      throw err
    }

    if (user.verificationToken !== token) {
      const err = new Error(g.f('Invalid token: %s', token))
      err.statusCode = 400
      err.code = 'INVALID_TOKEN'
      throw err
    }

    const updatedUser = await user.updateAttributes({
      verificationToken: null,
      emailVerified: true
    })

    // Match the original behavior - only return user for redirect case
    if (redirect) {
      return { user: updatedUser }
    }
    return undefined
  }

  /**
   * Create a short lived access token for temporary login. Allows users
   * to change passwords if forgotten.
   *
   * @param {Object} options
   * @param {String} options.email The user's email address
   * @param {String} [options.realm] The user's realm (optional)
   * @returns {Promise<Object>} Access token object
   */
  User.resetPassword = async function(options) {
    const UserModel = this
    const ttl = UserModel.settings.resetPasswordTokenTTL || DEFAULT_RESET_PW_TTL
    options = options || {}
    
    if (typeof options.email !== 'string') {
      const err = new Error(g.f('Email is required'))
      err.statusCode = 400
      err.code = 'EMAIL_REQUIRED'
      throw err
    }

    if (options.password) {
      UserModel.validatePassword(options.password)
    }
    
    const where = {
      email: options.email,
    }
    if (options.realm) {
      where.realm = options.realm
    }
    
    const user = await UserModel.findOne({where: where})
    
    if (!user) {
      const err = new Error(g.f('Email not found'))
      err.statusCode = 404
      err.code = 'EMAIL_NOT_FOUND'
      throw err
    }
    
    // create a short lived access token for temp login to change password
    // TODO(ritch) - eventually this should only allow password change
    if (UserModel.settings.emailVerificationRequired && !user.emailVerified) {
      const err = new Error(g.f('Email has not been verified'))
      err.statusCode = 401
      err.code = 'RESET_FAILED_EMAIL_NOT_VERIFIED'
      throw err
    }

    let accessToken
    if (UserModel.settings.restrictResetPasswordTokenScope) {
      const tokenData = {
        ttl: ttl,
        scopes: ['reset-password'],
      }
      accessToken = await user.createAccessToken(tokenData, options)
    } else {
      // Backward compatibility: createAccessToken with only ttl
      accessToken = await user.createAccessToken(ttl)
    }

    UserModel.emit('resetPasswordRequest', {
      email: options.email,
      accessToken: accessToken,
      user: user,
      options: options,
    })

    return accessToken
  }

  /*!
   * Hash the plain password
   */
  User.hashPassword = function(plain) {
    this.validatePassword(plain);
    const salt = bcrypt.genSaltSync(this.settings.saltWorkFactor || SALT_WORK_FACTOR);
    return bcrypt.hashSync(plain, salt);
  };

  User.validatePassword = function(plain) {
    if (!plain || typeof plain !== 'string') {
      const err = new Error('Invalid password')
      err.code = 'INVALID_PASSWORD'
      err.statusCode = 422
      throw err
    }
    
    if (plain === '') {
      const err = new Error('Invalid password')
      err.code = 'INVALID_PASSWORD'
      err.statusCode = 422
      throw err
    }

    if (plain.length > MAX_PASSWORD_LENGTH) {
      const err = new Error('password entered was too long')
      err.code = 'PASSWORD_TOO_LONG'
      err.statusCode = 422
      throw err
    }

    return true
  };

  /**
   * Invalidate access tokens for users matching the given ID array
   * 
   * @param {Array} userIds Array of user IDs
   * @param {Object} options Additional options
   * @returns {Promise<Object>} Result of token deletion
   */
  User._invalidateAccessTokensOfUsers = async function(userIds, options) {
    options = options || {}

    if (!Array.isArray(userIds) || !userIds.length)
      return Promise.resolve()

    const accessTokenRelation = this.relations.accessTokens
    if (!accessTokenRelation)
      return Promise.resolve()

    const AccessToken = accessTokenRelation.modelTo
    const query = {userId: {inq: userIds}}
    const tokenPK = AccessToken.definition.idName() || 'id'
    
    if (options.accessToken && tokenPK in options.accessToken) {
      query[tokenPK] = {neq: options.accessToken[tokenPK]}
    }
    
    // add principalType in AccessToken.query if using polymorphic relations
    // between AccessToken and User
    const relatedUser = AccessToken.relations.user
    const isRelationPolymorphic = relatedUser && relatedUser.polymorphic &&
      !relatedUser.modelTo
      
    if (isRelationPolymorphic) {
      query.principalType = this.modelName
    }
    
    return await AccessToken.deleteAll(query, options)
  }

  /*!
   * Setup an extended user model.
   */

  User.setup = function() {
    // We need to call the base class's setup method
    User.base.setup.call(this);
    const UserModel = this;

    // max ttl
    this.settings.maxTTL = this.settings.maxTTL || DEFAULT_MAX_TTL;
    this.settings.ttl = this.settings.ttl || DEFAULT_TTL;

    UserModel.setter.email = function(value) {
      if (!UserModel.settings.caseSensitiveEmail && typeof value === 'string') {
        this.$email = value.toLowerCase();
      } else {
        this.$email = value;
      }
    };

    UserModel.setter.password = function(plain) {
      if (typeof plain !== 'string') {
        return;
      }
      if ((plain.indexOf('$2a$') === 0 || plain.indexOf('$2b$') === 0) && plain.length === 60) {
        // The password is already hashed. It can be the case
        // when the instance is loaded from DB
        this.$password = plain;
      } else {
        this.$password = this.constructor.hashPassword(plain);
      }
    };

    // Make sure emailVerified is not set by creation
    UserModel.beforeRemote('create', function(ctx, user, next) {
      const body = ctx.req.body;
      if (body && body.emailVerified) {
        body.emailVerified = false;
      }
      next();
    });

    UserModel.remoteMethod(
      'login',
      {
        description: 'Login a user with username/email and password.',
        accepts: [
          {arg: 'credentials', type: 'object', required: true, http: {source: 'body'}},
          {arg: 'include', type: ['string'], http: {source: 'query'},
            description: 'Related objects to include in the response. ' +
            'See the description of return value for more details.'},
        ],
        returns: {
          arg: 'accessToken', type: 'object', root: true,
          description:
            g.f('The response body contains properties of the {{AccessToken}} created on login.\n' +
            'Depending on the value of `include` parameter, the body may contain ' +
            'additional properties:\n\n' +
            '  - `user` - `U+007BUserU+007D` - Data of the currently logged in user. ' +
            '{{(`include=user`)}}\n\n'),
        },
        http: {verb: 'post'},
      },
    );

    UserModel.remoteMethod(
      'logout',
      {
        description: 'Logout a user with access token.',
        accepts: [
          {arg: 'access_token', type: 'string', http: function(ctx) {
            const req = ctx && ctx.req;
            const accessToken = req && req.accessToken;
            const tokenID = accessToken ? accessToken.id : undefined;

            return tokenID;
          }, description: 'Do not supply this argument, it is automatically extracted ' +
            'from request headers.',
          },
        ],
        http: {verb: 'all'},
      },
    );

    UserModel.remoteMethod(
      'prototype.verify',
      {
        description: 'Trigger user\'s identity verification with configured verifyOptions',
        accepts: [
          {arg: 'verifyOptions', type: 'object', http: ctx => this.getVerifyOptions()},
          {arg: 'options', type: 'object', http: 'optionsFromRequest'},
        ],
        http: {verb: 'post'},
      },
    );

    UserModel.remoteMethod(
      'confirm',
      {
        description: 'Confirm a user registration with identity verification token.',
        accepts: [
          {arg: 'uid', type: 'string', required: true},
          {arg: 'token', type: 'string', required: true},
          {arg: 'redirect', type: 'string'},
        ],
        http: {verb: 'get', path: '/confirm'},
      },
    );

    UserModel.remoteMethod(
      'resetPassword',
      {
        description: 'Reset password for a user with email.',
        accepts: [
          {arg: 'options', type: 'object', required: true, http: {source: 'body'}},
        ],
        http: {verb: 'post', path: '/reset'},
      },
    );

    UserModel.remoteMethod(
      'changePassword',
      {
        description: 'Change a user\'s password.',
        accepts: [
          {arg: 'id', type: 'any', http: getUserIdFromRequestContext},
          {arg: 'oldPassword', type: 'string', required: true, http: {source: 'form'}},
          {arg: 'newPassword', type: 'string', required: true, http: {source: 'form'}},
          {arg: 'options', type: 'object', http: 'optionsFromRequest'},
        ],
        http: {verb: 'POST', path: '/change-password'},
      },
    );

    const setPasswordScopes = UserModel.settings.restrictResetPasswordTokenScope ?
      ['reset-password'] : undefined;

    UserModel.remoteMethod(
      'setPassword',
      {
        description: 'Reset user\'s password via a password-reset token.',
        accepts: [
          {arg: 'id', type: 'any', http: getUserIdFromRequestContext},
          {arg: 'newPassword', type: 'string', required: true, http: {source: 'form'}},
          {arg: 'options', type: 'object', http: 'optionsFromRequest'},
        ],
        accessScopes: setPasswordScopes,
        http: {verb: 'POST', path: '/reset-password'},
      },
    );

    function getUserIdFromRequestContext(ctx) {
      const token = ctx.req.accessToken;
      if (!token) return;

      const hasPrincipalType = 'principalType' in token;
      if (hasPrincipalType && token.principalType !== UserModel.modelName) {
        // We have multiple user models related to the same access token model
        // and the token used to authorize reset-password request was created
        // for a different user model.
        const err = new Error(g.f('Access Denied'));
        err.statusCode = 403;
        throw err;
      }

      return token.userId;
    }

    UserModel.afterRemote('confirm', function(ctx, inst, next) {
      if (ctx.args.redirect !== undefined) {
        if (!ctx.res) {
          return next(new Error(g.f('The transport does not support HTTP redirects.')));
        }
        ctx.res.location(ctx.args.redirect);
        ctx.res.status(302);
      }
      next();
    });

    // default models
    assert(loopback.Email, 'Email model must be defined before User model');
    UserModel.email = loopback.Email;

    assert(loopback.AccessToken, 'AccessToken model must be defined before User model');
    UserModel.accessToken = loopback.AccessToken;

    UserModel.validate('email', emailValidator, {
      message: g.f('Must provide a valid email'),
    });

    // Realm users validation
    if (UserModel.settings.realmRequired && UserModel.settings.realmDelimiter) {
      UserModel.validatesUniquenessOf('email', {
        message: 'Email already exists',
        scopedTo: ['realm'],
      });
      UserModel.validatesUniquenessOf('username', {
        message: 'User already exists',
        scopedTo: ['realm'],
      });
    } else {
      // Regular(Non-realm) users validation
      UserModel.validatesUniquenessOf('email', {message: 'Email already exists'});
      UserModel.validatesUniquenessOf('username', {message: 'User already exists'});
    }

    return UserModel;
  };

  /*!
   * Setup the base user.
   */

  User.setup();

  // --- OPERATION HOOKS ---
  //
  // Important: Operation hooks are inherited by subclassed models,
  // therefore they must be registered outside of setup() function

  // Access token to normalize email credentials
  User.observe('access', async function normalizeEmailCase(ctx) {
    if (!ctx.Model.settings.caseSensitiveEmail && ctx.query.where &&
        ctx.query.where.email && typeof(ctx.query.where.email) === 'string') {
      ctx.query.where.email = ctx.query.where.email.toLowerCase()
    }
  })

  User.observe('before save', async function rejectInsecurePasswordChange(ctx) {
    const UserModel = ctx.Model
    if (!UserModel.settings.rejectPasswordChangesViaPatchOrReplace) {
      // In legacy password flow, any DAO method can change the password
      return
    }

    if (ctx.isNewInstance) {
      // The password can be always set when creating a new User instance
      return
    }
    const data = ctx.data || ctx.instance
    const isPasswordChange = data && 'password' in data

    // This is the option set by `setPassword()` API
    // when calling `this.patchAttritubes()` to change user's password
    if (ctx.options.setPassword) {
      // Verify that only the password is changed and nothing more or less.
      if (Object.keys(data).length > 1 || !isPasswordChange) {
        // This is a programmer's error, use the default status code 500
        throw new Error(
          'Invalid use of "options.setPassword". Only "password" can be ' +
          'changed when using this option.'
        )
      }

      return
    }

    if (!isPasswordChange) {
      return
    }

    const err = new Error(
      'Changing user password via patch/replace API is not allowed. ' +
      'Use changePassword() or setPassword() instead.'
    )
    err.statusCode = 401
    err.code = 'PASSWORD_CHANGE_NOT_ALLOWED'
    throw err
  })

  User.observe('before save', async function prepareForTokenInvalidation(ctx) {
    if (ctx.isNewInstance) return
    if (!ctx.where && !ctx.instance) return

    const pkName = ctx.Model.definition.idName() || 'id'
    let where = ctx.where
    if (!where) {
      where = {}
      where[pkName] = ctx.instance[pkName]
    }

    const userInstances = await ctx.Model.find({where: where}, ctx.options)
    
    ctx.hookState.originalUserData = userInstances.map(function(u) {
      const user = {}
      user[pkName] = u[pkName]
      user.email = u.email
      user.password = u.password
      return user
    })
    
    let emailChanged
    if (ctx.instance) {
      // Check if map does not return an empty array
      // Fix server crashes when try to PUT a non existent id
      if (ctx.hookState.originalUserData.length > 0) {
        emailChanged = ctx.instance.email !== ctx.hookState.originalUserData[0].email
      } else {
        emailChanged = true
      }

      if (emailChanged && ctx.Model.settings.emailVerificationRequired) {
        ctx.instance.emailVerified = false
      }
    } else if (ctx.data.email) {
      emailChanged = ctx.hookState.originalUserData.some(function(data) {
        return data.email != ctx.data.email
      })
      if (emailChanged && ctx.Model.settings.emailVerificationRequired) {
        ctx.data.emailVerified = false
      }
    }
  })

  User.observe('after save', async function invalidateOtherTokens(ctx) {
    if (!ctx.instance && !ctx.data) return
    if (!ctx.hookState.originalUserData) return

    const pkName = ctx.Model.definition.idName() || 'id'
    const newEmail = (ctx.instance || ctx.data).email
    const newPassword = (ctx.instance || ctx.data).password

    if (!newEmail && !newPassword) return

    if (ctx.options.preserveAccessTokens) return

    const userIdsToExpire = ctx.hookState.originalUserData.filter(function(u) {
      return (newEmail && u.email !== newEmail) ||
        (newPassword && u.password !== newPassword)
    }).map(function(u) {
      return u[pkName]
    })
    
    await ctx.Model._invalidateAccessTokensOfUsers(userIdsToExpire, ctx.options)
  })

  /**
   * Set this user's password. The callers of this method
   * must ensure the client making the request is authorized
   * to change the password, typically by providing the correct
   * current password or a password-reset token.
   *
   * @param {string} newPassword The new password to use
   * @param {Object} [options] Additional options including remoting context
   * @returns {Promise<Object>} The updated user instance
   */
  User.prototype.setPassword = async function(newPassword, options) {
    assert(!!newPassword, 'newPassword is a required argument')

    // Validate the password
    this.constructor.validatePassword(newPassword)

    options = Object.assign({}, options)
    options.setPassword = true

    const delta = {password: newPassword}
    return await this.patchAttributes(delta, options)
  }
};

function emailValidator(err) {
  const value = this.email
  if (value == null)
    return
  if (typeof value !== 'string')
    return err('string')
  if (value === '') return
  if (!isEmail.validate(value))
    return err('email')
}

function joinUrlPath(args) {
  let result = arguments[0];
  for (let ix = 1; ix < arguments.length; ix++) {
    const next = arguments[ix];
    result += result[result.length - 1] === '/' && next[0] === '/' ?
      next.slice(1) : next;
  }
  return result;
}

function assertVerifyOptions(verifyOptions) {
  assert(verifyOptions.type, 'You must supply a verification type (verifyOptions.type)')
  assert(verifyOptions.type === 'email', 'Unsupported verification type')
  assert(verifyOptions.to, 'Must include verifyOptions.to when calling user.verify() ' +
    'or the user must have an email property')
  assert(verifyOptions.from, 'Must include verifyOptions.from when calling user.verify()')
  assert(typeof verifyOptions.templateFn === 'function',
    'templateFn must be a function')
  assert(typeof verifyOptions.generateVerificationToken === 'function',
    'generateVerificationToken must be a function')
  assert(verifyOptions.mailer, 'A mailer function must be provided')
  assert(typeof verifyOptions.mailer.send === 'function', 'mailer.send must be a function ')
}

