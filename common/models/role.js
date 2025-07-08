// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../lib/loopback');
const debug = require('debug')('loopback:security:role');
const assert = require('node:assert');
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
       * @function Role.prototype#users
       * @param {object} [query] query object passed to model find call
       * @returns {Promise<Array>} Promise resolving to list of models
       */
      Role.prototype[rel] = async function(query = {}) {
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
          query.where?.principalType &&
          query.where.principalType !== RoleMapping.USER;

        if (isCustomUserPrincipalType) {
          const registry = this.constructor.registry;
          principalModel = registry.findModel(query.where.principalType);
          principalType = query.where.principalType;
        }
        // remove principalType from query
        if (query.where?.principalType) {
          delete query.where.principalType;
        }

        if (principalModel) {
          return listByPrincipalType(this, principalModel, principalType, query);
        } else {
          return [];
        }
      };
    });

    /**
     * Fetch all models assigned to this role
     * @private
     * @param {object} context Role context
     * @param {*} model Model type to fetch
     * @param {String} principalType PrincipalType used in the rolemapping for model
     * @param {object} query Query object passed to model find call
     * @return {Promise<Array>} Promise resolving to an array of models
     */
    async function listByPrincipalType(context, model, principalType, query = {}) {
      const mappings = await roleModel.roleMappingModel.find({
        where: {roleId: context.id, principalType: principalType},
      });
      
      const ids = mappings.map(m => m.principalId);
      query.where = query.where || {};
      query.where.id = {inq: ids};
      return model.find(query);
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
   * Should return a promise.
   */
  Role.registerResolver = function(role, resolver) {
    if (!Role.resolvers) {
      Role.resolvers = {};
    }
    Role.resolvers[role] = resolver;
  };

  Role.registerResolver(Role.OWNER, async function(role, context) {
    try {
      if (!context || !context.model || !context.modelId) {
        return false;
      }
      const modelClass = context.model;
      const modelId = context.modelId;
      let user = null;
      if (typeof context.getUser === 'function') {
        user = context.getUser();
      } else {
        // Handle the case where context is a plain object
        user = {
          id: context.principalId,
          principalType: context.principalType
        };
      }
      const userId = user?.id;
      const principalType = user?.principalType;
      
      // Create options object with accessToken if present
      const options = {};
      if (context.accessToken) {
        options.accessToken = context.accessToken;
      }
      
      // Debug the options being passed
      debug('OWNER resolver options: %j', options);
      
      return Role.isOwner(modelClass, modelId, userId, principalType, options);
    } catch (e) {
      debug('Error in Role.registerResolver(OWNER): %s', e.message);
      return false;
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
        return false;
      }
      return id1 === id2 || id1.toString() === id2.toString();
    } catch (e) {
      debug('Error in matches: %s', e.message);
      return false;
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
   * @returns {Promise<Boolean>} Promise resolving to true if the user is an owner.
   */
  Role.isOwner = async function isOwner(modelClass, modelId, userId, principalType, options = {}) {
    const _this = this;

    if (typeof principalType === 'object' && !options) {
      options = principalType;
      principalType = undefined;
    }
    
    principalType = principalType || Principal.USER;

    assert(modelClass, 'Model class is required');

    debug('isOwner(): %s %s userId: %s principalType: %s',
      modelClass && modelClass.modelName, modelId, userId, principalType);
    debug('isOwner(): options: %j', options);

    if (!userId) {
      debug('isOwner(): no user id was set, returning false');
      return false;
    }

    const isMultipleUsers = _isMultipleUsers();
    const isPrincipalTypeValid =
      (!isMultipleUsers && principalType === Principal.USER) ||
      (isMultipleUsers && principalType !== Principal.USER);

    debug('isOwner(): isMultipleUsers?', isMultipleUsers,
      'isPrincipalTypeValid?', isPrincipalTypeValid);

    if (!isPrincipalTypeValid) {
      return false;
    }

    if (isUserClass(modelClass)) {
      const userModelName = modelClass.modelName;
      if (principalType === Principal.USER || principalType === userModelName) {
        return matches(modelId, userId);
      }
    }

    // Make sure options is properly passed to findById
    const inst = await modelClass.findById(modelId, options);
    if (!inst) {
      debug('Model not found for id %j', modelId);
      return false;
    }
    debug('Model found: %j', inst);

    const ownerRelations = modelClass.settings.ownerRelations;
    if (!ownerRelations) {
      return legacyOwnershipCheck(inst);
    } else {
      return checkOwnership(inst);
    }

    async function legacyOwnershipCheck(inst) {
      const ownerId = inst.userId || inst.owner;
      if (principalType === Principal.USER && ownerId && typeof ownerId !== 'function') {
        return matches(ownerId, userId);
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
              const user = await new Promise((resolve, reject) => {
                inst[r]((err, user) => {
                  if (err) reject(err);
                  else resolve(user);
                });
              });
              
              if (!user) return false;
              if (Array.isArray(user)) {
                if (user.length === 0) return false;
                user = user[0];
              }
              if (!user || typeof user !== 'object') return false;
              if (!('id' in user)) return false;
              debug('User found: %j', user.id);
              return matches(user.id, userId);
            } catch (e) {
              debug('Error calling relation %s: %s', r, e.message);
              return false;
            }
          } else {
            debug('Relation %s is not a function', r);
            continue;
          }
        }
      }
      debug('No matching belongsTo relation found for model %j - user %j principalType %j',
        modelId, userId, principalType);
      return false;
    }

    async function checkOwnership(inst) {
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
        return false;
      }

      // Check each relation until one returns true
      for (const r of relWithUsers) {
        const result = await processRelation(r);
        if (result) return true;
      }
      return false;

      async function processRelation(r) {
        if (typeof inst[r] === 'function') {
          try {
            const user = await new Promise((resolve, reject) => {
              inst[r]((err, user) => {
                if (err) reject(err);
                else resolve(user);
              });
            });
            
            if (!user) return false;
            if (Array.isArray(user)) {
              if (user.length === 0) return false;
              user = user[0];
            }
            if (!user || typeof user !== 'object') return false;
            if (!('id' in user)) return false;
            debug('User found: %j (through %j)', user.id, r);
            return matches(user.id, userId);
          } catch (e) {
            debug('Error calling relation %s: %s', r, e.message);
            return false;
          }
        } else {
          debug('Relation %s is not a function', r);
          return false;
        }
      }
    }

    function _isMultipleUsers(userModel) {
      const oneOfUserModels = userModel || _this.registry.getModelByType('User');
      const accessTokensRel = oneOfUserModels.relations.accessTokens;
      return !!(accessTokensRel && accessTokensRel.polymorphic);
    }
  };

  Role.registerResolver(Role.AUTHENTICATED, async function(role, context) {
    if (!context) {
      return false;
    }
    return Role.isAuthenticated(context);
  });

  /**
   * Check if the user ID is authenticated
   * @param {Object} context The security context.
   * @returns {Promise<Boolean>} Promise resolving to true if user is authenticated.
   */
  Role.isAuthenticated = async function isAuthenticated(context) {
    return context.isAuthenticated();
  };

  Role.registerResolver(Role.UNAUTHENTICATED, async function(role, context) {
    return !context || !context.isAuthenticated();
  });

  Role.registerResolver(Role.EVERYONE, async function(role, context) {
    return true; // Always true
  });

  /**
   * Check if a given principal is in the specified role.
   *
   * @param {String} role The role name.
   * @param {Object} context The context object.
   * @returns {Promise<Boolean>} Promise resolving to true if the principal is in the specified role.
   */
  Role.isInRole = async function(role, context) {
    context.registry = this.registry;
    if (!(context instanceof AccessContext)) {
      context = new AccessContext(context);
    }

    this.resolveRelatedModels();

    debug('isInRole(): %s', role);
    context.debug();

    const resolver = Role.resolvers[role];
    if (resolver) {
      debug('Custom resolver found for role %s', role);
      const result = await resolver(role, context);
      return !!result;
    }

    if (context.principals.length === 0) {
      debug('isInRole() returns: false');
      return false;
    }

    const inRole = context.principals.some(function(p) {
      const principalType = p.type || undefined;
      const principalId = p.id || undefined;

      // Check if it's the same role
      return principalType === RoleMapping.ROLE && principalId === role;
    });

    if (inRole) {
      debug('isInRole() returns: %j', inRole);
      return true;
    }

    const roleMappingModel = this.roleMappingModel;
    const result = await this.findOne({where: {name: role}});
    
    if (!result) {
      return false;
    }
    
    debug('Role found: %j', result);

    // Use Promise.any or a custom implementation to check if any principal is in role
    return checkAnyPrincipalInRole(context.principals, result.id.toString());
    
    async function checkAnyPrincipalInRole(principals, roleId) {
      // Create an array of Promises for each principal check
      const checks = principals.map(async (p) => {
        const principalType = p.type || undefined;
        let principalId = p.id || undefined;
        const principalIdIsString = typeof principalId === 'string';

        if (principalId !== null && principalId !== undefined && !principalIdIsString) {
          principalId = principalId.toString();
        }

        if (principalType && principalId) {
          const result = await roleMappingModel.findOne({
            where: {
              roleId: roleId,
              principalType: principalType, 
              principalId: principalId
            }
          });
          debug('Role mapping found: %j', result);
          return !!result;
        }
        return false;
      });

      // Check if any principle is in role (similar to Promise.any but works in older Node versions)
      try {
        for (const checkPromise of checks) {
          const isInRole = await checkPromise;
          if (isInRole) return true;
        }
        return false;
      } catch (err) {
        debug('Error checking roles: %s', err.message);
        return false;
      }
    }
  };

  /**
   * List roles for a given principal.
   * @param {Object} context The security context.
   * @param {Object} options Options object
   * @returns {Promise<String[]>} Promise resolving to an array of role IDs
   */
  Role.getRoles = async function(context, options = {}) {
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

    // Check against the smart roles
    // Process special roles in a specific order to match tests
    const specialRoles = [Role.AUTHENTICATED, Role.UNAUTHENTICATED, Role.EVERYONE];
    for (const role of specialRoles) {
      try {
        const inRole = await this.isInRole(role, context);
        if (inRole) {
          debug('In role %j: %j', role, inRole);
          addRole(role);
        }
      } catch (err) {
        debug('Error checking role %s: %s', role, err.message);
      }
    }

    // Process other role resolvers
    const roleTasks = [];
    for (const role of Object.keys(Role.resolvers)) {
      if (specialRoles.includes(role)) continue; // Skip special roles already processed
      roleTasks.push(async () => {
        try {
          const inRole = await this.isInRole(role, context);
          if (inRole) {
            debug('In role %j: %j', role, inRole);
            addRole(role);
          }
        } catch (err) {
          debug('Error checking role %s: %s', role, err.message);
        }
      });
    }

    // Process principals
    const principalTasks = [];
    const roleMappingModel = this.roleMappingModel;
    
    for (const p of context.principals) {
      // Check against the role mappings
      const principalType = p.type || undefined;
      let principalId = p.id == null ? undefined : p.id;

      if (typeof principalId !== 'string' && principalId != null) {
        principalId = principalId.toString();
      }

      // Add the role itself
      if (principalType === RoleMapping.ROLE && principalId) {
        addRole(principalId);
      }

      if (principalType && principalId) {
        principalTasks.push(async () => {
          const filter = {where: {principalType: principalType, principalId: principalId}};
          if (options.returnOnlyRoleNames === true) {
            filter.include = ['role'];
          }
          
          const mappings = await roleMappingModel.find(filter);
          debug('Role mappings found: %j', mappings);
          
          mappings.forEach(function(m) {
            let role;
            if (options.returnOnlyRoleNames === true) {
              role = m.toJSON().role.name;
            } else {
              role = m.roleId;
            }
            addRole(role);
          });
        });
      }
    }

    // Run all role resolver checks for non-special roles
    const roleFuncs = roleTasks.map(task => task());
    await Promise.all(roleFuncs);
    
    // Run all principal mapping checks
    const principalFuncs = principalTasks.map(task => task());
    await Promise.all(principalFuncs);
    
    debug('getRoles() returns: %j', roles);
    return roles;
  };

  Role.validatesUniquenessOf('name', {message: 'already exists'});

  /**
   * Check if a given principal is mapped to the specified role
   * @param {String} role The role ID or name
   * @param {String} principalType The principal type
   * @param {String} principalId The principal ID
   * @returns {Promise<Boolean>} True if the principal is mapped to the role
   */
  Role.isMappedToRole = function(role, principalType, principalId) {
    const ACL = loopback.ACL;
    return Promise.resolve(ACL.isMappedToRole(principalType, principalId, role));
  };

  Role.prototype.users = async function() {
    this.constructor.resolveRelatedModels();
    const userModel = this.constructor.userModel;
    const roleMappingModel = this.constructor.roleMappingModel;
    
    const mappings = await roleMappingModel.find({
      where: {roleId: this.id, principalType: RoleMapping.USER}
    });
    
    const userIds = mappings.map(m => m.principalId);
    return userModel.find({where: {id: {inq: userIds}}});
  };
};
