// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../lib/loopback');
const debug = require('debug')('loopback:security:role');
const assert = require('assert');
const async = require('async');
const utils = require('../../lib/utils');
const ctx = require('../../lib/access-context');
const AccessContext = ctx.AccessContext;
const Principal = ctx.Principal;
const RoleMapping = loopback.RoleMapping;

assert(RoleMapping, 'RoleMapping model must be defined before Role model');

/**
 * The Role model
 * @class Role
 * @header Role object
 */
module.exports = function(Role) {
  Role.resolveRelatedModels = function() {
    if (!this.roleMappingModel) {
      const reg = this.registry;
      this.roleMappingModel = reg.getModelByType('RoleMapping');
      this.userModel = reg.getModelByType('User');
      this.applicationModel = reg.getModelByType('Application');
    }
  };

  // Set up the connection to users/applications/roles once the model
  Role.once('dataSourceAttached', function(roleModel) {
    ['users', 'applications', 'roles'].forEach(function(rel) {
      /**
       * Fetch all users/applications/roles assigned to this role
       * Dual API: returns a native Promise if no callback is provided
       */
      Role.prototype[rel] = function(query, callback) {
        if (!callback) {
          if (typeof query === 'function') {
            callback = query;
            query = {};
          } else {
            return new Promise((resolve, reject) => {
              this[rel](query, (err, result) => err ? reject(err) : resolve(result));
            });
          }
        }
        query = query || {};
        query.where = query.where || {};

        roleModel.resolveRelatedModels();
        const relsToModels = {
          users: roleModel.userModel,
          applications: roleModel.applicationModel,
          roles: roleModel,
        };

        const ACL = loopback.ACL;
        const relsToTypes = {
          users: ACL.USER,
          applications: ACL.APP,
          roles: ACL.ROLE,
        };

        let principalModel = relsToModels[rel];
        let principalType = relsToTypes[rel];

        // redefine user model and user type if custom
        const isCustomUserPrincipalType = rel === 'users' &&
          query.where.principalType &&
          query.where.principalType !== RoleMapping.USER;

        if (isCustomUserPrincipalType) {
          const registry = this.constructor.registry;
          principalModel = registry.findModel(query.where.principalType);
          principalType = query.where.principalType;
        }
        // remove principalType from query
        delete query.where.principalType;

        if (principalModel) {
          listByPrincipalType(this, principalModel, principalType, query, callback);
        } else {
          process.nextTick(function() {
            callback(null, []);
          });
        }
      };
    });

    /**
     * Fetch all models assigned to this role
     * @private
     * @param {object} Context role context
     * @param {*} model model type to fetch
     * @param {String} [principalType] principalType used in the rolemapping for model
     * @param {object} [query] query object passed to model find call
     * @param  {Function} [callback] callback function called with `(err, models)` arguments.
     */
    function listByPrincipalType(context, model, principalType, query, callback) {
      if (callback === undefined && typeof query === 'function') {
        callback = query;
        query = {};
      }
      query = query || {};

      roleModel.roleMappingModel.find({
        where: {roleId: context.id, principalType: principalType},
      }, function(err, mappings) {
        if (err) {
          return callback(err);
        }
        const ids = mappings.map(function(m) {
          return m.principalId;
        });
        query.where = query.where || {};
        query.where.id = {inq: ids};
        model.find(query, function(err, models) {
          callback(err, models);
        });
      });
    }
  });

  // Special roles
  Role.OWNER = '$owner'; // owner of the object
  Role.RELATED = '$related'; // any User with a relationship to the object
  Role.AUTHENTICATED = '$authenticated'; // authenticated user
  Role.UNAUTHENTICATED = '$unauthenticated'; // unauthenticated user
  Role.EVERYONE = '$everyone'; // everyone

  /**
   * Add custom handler for roles.
   * @param {String} role Name of role.
   * @param {Function} resolver Function that determines
   * if a principal is in the specified role.
   * Should provide a callback or return a promise.
   */
  Role.registerResolver = function(role, resolver) {
    if (!Role.resolvers) {
      Role.resolvers = {};
    }
    Role.resolvers[role] = resolver;
  };

  Role.registerResolver(Role.OWNER, function(role, context, callback) {
    try {
      if (!context || !context.model || !context.modelId) {
        process.nextTick(function() {
          if (callback) callback(null, false)
        })
        return
      }
      const modelClass = context.model
      const modelId = context.modelId
      let user = null
      if (typeof context.getUser === 'function') {
        user = context.getUser()
      } else {
        // Handle the case where context is a plain object
        user = {
          id: context.principalId,
          principalType: context.principalType
        }
      }
      const userId = user?.id
      const principalType = user?.principalType
      const opts = {accessToken: context.accessToken}
      return Role.isOwner(modelClass, modelId, userId, principalType, opts, callback)
    } catch (e) {
      debug('Error in Role.registerResolver(OWNER): %s', e.message)
      process.nextTick(function() {
        if (callback) callback(null, false)
      })
    }
  });

  function isUserClass(modelClass) {
    if (!modelClass) return false;
    const User = modelClass.modelBuilder.models.User;
    if (!User) return false;
    return modelClass == User || modelClass.prototype instanceof User;
  }

  /*!
   * Check if two user IDs matches
   * @param {*} id1
   * @param {*} id2
   * @returns {boolean}
   */
  function matches(id1, id2) {
    try {
      if (id1 === undefined || id1 === null || id1 === '' ||
          id2 === undefined || id2 === null || id2 === '') {
        return false
      }
      return id1 === id2 || id1.toString() === id2.toString()
    } catch (e) {
      debug('Error in matches: %s', e.message)
      return false
    }
  }

  /**
   * Check if a given user ID is the owner the model instance.
   * @param {Function} modelClass The model class
   * @param {*} modelId The model ID
   * @param {*} userId The user ID
   * @param {String} principalType The user principalType (optional)
   * @options {Object} options
   * @property {accessToken} The access token used to authorize the current user.
   * @callback {Function} [callback] The callback function
   * @param {String|Error} err The error string or object
   * @param {Boolean} isOwner True if the user is an owner.
   * @promise
   */
  Role.isOwner = function isOwner(modelClass, modelId, userId, principalType, options, callback) {
    const _this = this;

    if (!callback && typeof options === 'function') {
      callback = options;
      options = {};
    } else if (!callback && typeof principalType === 'function') {
      callback = principalType;
      principalType = undefined;
      options = {};
    }
    principalType = principalType || Principal.USER;

    assert(modelClass, 'Model class is required');
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.isOwner(modelClass, modelId, userId, principalType, options, (err, result) => {
          if (err) return reject(err);
          resolve(result);
        });
      });
    }

    debug('isOwner(): %s %s userId: %s principalType: %s',
      modelClass && modelClass.modelName, modelId, userId, principalType);

    if (!userId) {
      debug('isOwner(): no user id was set, returning false');
      process.nextTick(() => callback(null, false));
      return;
    }

    const isMultipleUsers = _isMultipleUsers();
    const isPrincipalTypeValid =
      (!isMultipleUsers && principalType === Principal.USER) ||
      (isMultipleUsers && principalType !== Principal.USER);

    debug('isOwner(): isMultipleUsers?', isMultipleUsers,
      'isPrincipalTypeValid?', isPrincipalTypeValid);

    if (!isPrincipalTypeValid) {
      process.nextTick(() => callback(null, false));
      return;
    }

    if (isUserClass(modelClass)) {
      const userModelName = modelClass.modelName;
      if (principalType === Principal.USER || principalType === userModelName) {
        process.nextTick(() => callback(null, matches(modelId, userId)));
        return;
      }
    }

    modelClass.findById(modelId, options, function(err, inst) {
      if (err || !inst) {
        debug('Model not found for id %j', modelId);
        return callback(err, false);
      }
      debug('Model found: %j', inst);

      const ownerRelations = modelClass.settings.ownerRelations;
      if (!ownerRelations) {
        return legacyOwnershipCheck(inst);
      } else {
        return checkOwnership(inst);
      }
    });

    function legacyOwnershipCheck(inst) {
      const ownerId = inst.userId || inst.owner;
      if (principalType === Principal.USER && ownerId && typeof ownerId !== 'function') {
        return callback(null, matches(ownerId, userId));
      }

      for (const r in modelClass.relations) {
        const rel = modelClass.relations[r];
        const belongsToUser = rel.type === 'belongsTo' && isUserClass(rel.modelTo);
        if (!belongsToUser) {
          continue;
        }

        const relatedUser = rel.modelTo;
        const userModelName = relatedUser.modelName;
        const isMultipleUsers = _isMultipleUsers(relatedUser);
        if ((!isMultipleUsers && principalType === Principal.USER) ||
            (isMultipleUsers && principalType === userModelName)) {
          debug('Checking relation %s to %s: %j', r, userModelName, rel);
          if (typeof inst[r] === 'function') {
            try {
              inst[r](function processRelatedUser(err, user) {
                if (err) return callback(err, false);
                if (!user) return callback(null, false);
                if (Array.isArray(user)) {
                  if (user.length === 0) return callback(null, false);
                  user = user[0];
                }
                if (!user || typeof user !== 'object') return callback(null, false);
                if (!('id' in user)) return callback(null, false);
                debug('User found: %j', user.id);
                callback(null, matches(user.id, userId));
              });
              return;
            } catch (e) {
              debug('Error calling relation %s: %s', r, e.message);
              return callback(null, false);
            }
          } else {
            debug('Relation %s is not a function', r);
            continue;
          }
        }
      }
      debug('No matching belongsTo relation found for model %j - user %j principalType %j',
        modelId, userId, principalType);
      callback(null, false);
    }

    function checkOwnership(inst) {
      const ownerRelations = inst.constructor.settings.ownerRelations;
      const relWithUsers = [];
      for (const r in modelClass.relations) {
        const rel = modelClass.relations[r];
        if (rel.type !== 'belongsTo' || !isUserClass(rel.modelTo)) {
          continue;
        }

        const relatedUser = rel.modelTo;
        const userModelName = relatedUser.modelName;
        const isMultipleUsers = _isMultipleUsers(relatedUser);
        if ((!isMultipleUsers && principalType === Principal.USER) ||
            (isMultipleUsers && principalType === userModelName)) {
          debug('Checking relation %s to %s: %j', r, userModelName, rel);
          if (ownerRelations === true) {
            relWithUsers.push(r);
          } else if (Array.isArray(ownerRelations) && ownerRelations.indexOf(r) !== -1) {
            relWithUsers.push(r);
          }
        }
      }
      if (relWithUsers.length === 0) {
        debug('No matching belongsTo relation found for model %j and user: %j principalType %j',
          modelId, userId, principalType);
        return callback(null, false);
      }

      async.someSeries(relWithUsers, processRelation, callback);

      function processRelation(r, cb) {
        if (typeof inst[r] === 'function') {
          try {
            inst[r](function processRelatedUser(err, user) {
              if (err) return cb(err, false);
              if (!user) return cb(null, false);
              if (Array.isArray(user)) {
                if (user.length === 0) return cb(null, false);
                user = user[0];
              }
              if (!user || typeof user !== 'object') return cb(null, false);
              if (!('id' in user)) return cb(null, false);
              debug('User found: %j (through %j)', user.id, r);
              cb(null, matches(user.id, userId));
            });
          } catch (e) {
            debug('Error calling relation %s: %s', r, e.message);
            return cb(null, false);
          }
        } else {
          debug('Relation %s is not a function', r);
          cb(null, false);
        }
      }
    }

    function _isMultipleUsers(userModel) {
      const oneOfUserModels = userModel || _this.registry.getModelByType('User');
      const accessTokensRel = oneOfUserModels.relations.accessTokens;
      return !!(accessTokensRel && accessTokensRel.polymorphic);
    }
  };

  Role.registerResolver(Role.AUTHENTICATED, function(role, context, callback) {
    if (!context) {
      process.nextTick(function() {
        if (callback) callback(null, false);
      });
      return;
    }
    Role.isAuthenticated(context, callback);
  });

  /**
   * Check if the user ID is authenticated
   * @param {Object} context The security context.
   *
   * @callback {Function} callback Callback function.
   * @param {Error} err Error object.
   * @param {Boolean} isAuthenticated True if the user is authenticated.
   * @promise
   */
  Role.isAuthenticated = function isAuthenticated(context, callback) {
    if (!callback) {
      return new Promise((resolve, reject) => {
        process.nextTick(() => {
          resolve(context.isAuthenticated());
        });
      });
    }
    process.nextTick(function() {
      if (callback) callback(null, context.isAuthenticated());
    });
  };

  Role.registerResolver(Role.UNAUTHENTICATED, function(role, context, callback) {
    process.nextTick(function() {
      if (callback) callback(null, !context || !context.isAuthenticated());
    });
  });

  Role.registerResolver(Role.EVERYONE, function(role, context, callback) {
    process.nextTick(function() {
      if (callback) callback(null, true); // Always true
    });
  });

  /**
   * Check if a given principal is in the specified role.
   *
   * @param {String} role The role name.
   * @param {Object} context The context object.
   *
   * @callback {Function} callback Callback function.
   * @param {Error} err Error object.
   * @param {Boolean} isInRole True if the principal is in the specified role.
   * @promise
   */
  Role.isInRole = function(role, context, callback) {
    context.registry = this.registry;
    if (!(context instanceof AccessContext)) {
      context = new AccessContext(context);
    }

    if (!callback) {
      return new Promise((resolve, reject) => {
        this.isInRole(role, context, (err, result) => err ? reject(err) : resolve(!!result));
      });
    }

    this.resolveRelatedModels();

    debug('isInRole(): %s', role);
    context.debug();

    const resolver = Role.resolvers[role];
    if (resolver) {
      debug('Custom resolver found for role %s', role);

      const promise = resolver(role, context, callback);
      if (promise && typeof promise.then === 'function') {
        promise.then(
          function(result) { callback(null, !!result); },
          callback
        );
      }
      return;
    }

    if (context.principals.length === 0) {
      debug('isInRole() returns: false');
      process.nextTick(function() {
        if (callback) callback(null, false);
      });
      return;
    }

    const inRole = context.principals.some(function(p) {
      const principalType = p.type || undefined;
      const principalId = p.id || undefined;

      // Check if it's the same role
      return principalType === RoleMapping.ROLE && principalId === role;
    });

    if (inRole) {
      debug('isInRole() returns: %j', inRole);
      process.nextTick(function() {
        if (callback) callback(null, true);
      });
      return;
    }

    const roleMappingModel = this.roleMappingModel;
    this.findOne({where: {name: role}}, function(err, result) {
      if (err) {
        if (callback) callback(err);
        return;
      }
      if (!result) {
        if (callback) callback(null, false);
        return;
      }
      debug('Role found: %j', result);

      async.some(context.principals, function(p, done) {
        const principalType = p.type || undefined;
        let principalId = p.id || undefined;
        const roleId = result.id.toString();
        const principalIdIsString = typeof principalId === 'string';

        if (principalId !== null && principalId !== undefined && !principalIdIsString) {
          principalId = principalId.toString();
        }

        if (principalType && principalId) {
          roleMappingModel.findOne({where: {roleId: roleId,
            principalType: principalType, principalId: principalId}},
          function(err, result) {
            debug('Role mapping found: %j', result);
            done(!err && result);
          });
        } else {
          process.nextTick(function() {
            done(false);
          });
        }
      }, function(inRole) {
        debug('isInRole() returns: %j', inRole);
        if (callback) callback(null, inRole);
      });
    });
  };

  /**
   * List roles for a given principal.
   * @param {Object} context The security context.
   *
   * @callback {Function} callback Callback function.
   * @param {Error} err Error object.
   * @param {String[]} roles An array of role IDs
   * @promise
   */
  Role.getRoles = function(context, options, callback) {
    if (!callback) {
      if (typeof options === 'function') {
        callback = options;
        options = {};
      } else {
        return new Promise((resolve, reject) => {
          this.getRoles(context, options, (err, result) => err ? reject(err) : resolve(result));
        });
      }
    }
    if (!options) options = {};

    context.registry = this.registry;
    if (!(context instanceof AccessContext)) {
      context = new AccessContext(context);
    }
    const roles = [];
    this.resolveRelatedModels();

    const addRole = function(role) {
      if (role && roles.indexOf(role) === -1) {
        roles.push(role);
      }
    };

    const self = this;
    const inRoleTasks = [];
    Object.keys(Role.resolvers).forEach(function(role) {
      inRoleTasks.push(function(done) {
        self.isInRole(role, context, function(err, inRole) {
          if (debug.enabled) {
            debug('In role %j: %j', role, inRole);
          }
          if (!err && inRole) {
            addRole(role);
            done();
          } else {
            done(err, null);
          }
        });
      });
    });

    const roleMappingModel = this.roleMappingModel;
    context.principals.forEach(function(p) {
      const principalType = p.type || undefined;
      let principalId = p.id == null ? undefined : p.id;

      if (typeof principalId !== 'string' && principalId != null) {
        principalId = principalId.toString();
      }

      if (principalType === RoleMapping.ROLE && principalId) {
        addRole(principalId);
      }

      if (principalType && principalId) {
        inRoleTasks.push(function(done) {
          const filter = {where: {principalType: principalType, principalId: principalId}};
          if (options.returnOnlyRoleNames === true) {
            filter.include = ['role'];
          }
          roleMappingModel.find(filter, function(err, mappings) {
            debug('Role mappings found: %s %j', err, mappings);
            if (err) {
              if (done) done(err);
              return;
            }
            mappings.forEach(function(m) {
              let role;
              if (options.returnOnlyRoleNames === true) {
                role = m.toJSON().role.name;
              } else {
                role = m.roleId;
              }
              addRole(role);
            });
            if (done) done();
          });
        });
      }
    });

    async.parallel(inRoleTasks, function(err, results) {
      debug('getRoles() returns: %j %j', err, roles);
      if (callback) callback(err, roles);
    });
  };

  Role.validatesUniquenessOf('name', {message: 'already exists'});

  Role.prototype.users = function(cb) {
    if (!cb) {
      return new Promise((resolve, reject) => {
        this.constructor.resolveRelatedModels();
        const userModel = this.constructor.userModel;
        const roleMappingModel = this.constructor.roleMappingModel;
        roleMappingModel.find({
          where: {roleId: this.id, principalType: RoleMapping.USER}
        }, function(err, mappings) {
          if (err) return reject(err);
          const userIds = mappings.map(m => m.principalId);
          userModel.find({where: {id: {inq: userIds}}}, (err, result) => err ? reject(err) : resolve(result));
        });
      });
    }

    this.constructor.resolveRelatedModels();
    const userModel = this.constructor.userModel;
    const roleMappingModel = this.constructor.roleMappingModel;
    roleMappingModel.find({
      where: {roleId: this.id, principalType: RoleMapping.USER}
    }, function(err, mappings) {
      if (err) return cb(err);
      const userIds = mappings.map(m => m.principalId);
      userModel.find({where: {id: {inq: userIds}}}, cb);
    });
  };
};
