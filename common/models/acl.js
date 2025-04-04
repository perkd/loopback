// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
/*!
 Schema ACL options
 Object level permissions, for example, an album owned by a user
 Factors to be authorized against:
 * model name: Album
 * model instance properties: userId of the album, friends, shared
 * methods
 * app and/or user ids/roles
 ** loggedIn
 ** roles
 ** userId
 ** appId
 ** none
 ** everyone
 ** relations: owner/friend/granted
 Class level permissions, for example, Album
 * model name: Album
 * methods
 URL/Route level permissions
 * url pattern
 * application id
 * ip addresses
 * http headers
 Map to oAuth 2.0 scopes
 */

const assert = require('node:assert')
const g = require('../../lib/globalize')
const loopback = require('../../lib/loopback')
const debug = require('debug')('loopback:security:acl');
const ctx = require('../../lib/access-context');

const AccessContext = ctx.AccessContext;
const Principal = ctx.Principal;
const AccessRequest = ctx.AccessRequest;

const Role = loopback.Role;
assert(Role, 'Role model must be defined before ACL model');

/**
 * A Model for access control meta data.
 *
 * System grants permissions to principals (users/applications, can be grouped
 * into roles).
 *
 * Protected resource: the model data and operations
 * (model/property/method/relation/…)
 *
 * For a given principal, such as client application and/or user, is it allowed
 * to access (read/write/execute)
 * the protected resource?
 *
 * @header ACL
 * @property {String} model Name of the model.
 * @property {String} property Name of the property, method, scope, or relation.
 * @property {String} accessType Type of access being granted: one of READ, WRITE, or EXECUTE.
 * @property {String} permission Type of permission granted. One of:
 *
 *  - ALARM: Generate an alarm, in a system-dependent way, the access specified in the permissions component of the ACL entry.
 *  - ALLOW: Explicitly grants access to the resource.
 *  - AUDIT: Log, in a system-dependent way, the access specified in the permissions component of the ACL entry.
 *  - DENY: Explicitly denies access to the resource.
 * @property {String} principalType Type of the principal; one of: APPLICATION, USER, ROLE.
 * @property {String} principalId ID of the principal - such as appId, userId or roleId.
 * @property {Object} settings Extends the `Model.settings` object.
 * @property {String} settings.defaultPermission Default permission setting: ALLOW, DENY, ALARM, or AUDIT. Default is ALLOW.
 * Set to DENY to prohibit all API access by default.
 *
 * @class ACL
 * @inherits PersistedModel
 */

module.exports = function(ACL) {
  ACL.ALL = AccessContext.ALL;

  ACL.DEFAULT = AccessContext.DEFAULT; // Not specified
  ACL.ALLOW = AccessContext.ALLOW; // Allow
  ACL.ALARM = AccessContext.ALARM; // Warn - send an alarm
  ACL.AUDIT = AccessContext.AUDIT; // Audit - record the access
  ACL.DENY = AccessContext.DENY; // Deny

  ACL.READ = AccessContext.READ; // Read operation
  ACL.REPLICATE = AccessContext.REPLICATE; // Replicate (pull) changes
  ACL.WRITE = AccessContext.WRITE; // Write operation
  ACL.EXECUTE = AccessContext.EXECUTE; // Execute operation

  ACL.USER = Principal.USER;
  ACL.APP = ACL.APPLICATION = Principal.APPLICATION;
  ACL.ROLE = Principal.ROLE;
  ACL.SCOPE = Principal.SCOPE;

  ACL.DEFAULT_SCOPE = ctx.DEFAULT_SCOPES[0];

  /**
   * Calculate the matching score for the given rule and request
   * @param {ACL} rule The ACL entry
   * @param {AccessRequest} req The request
   * @returns {Number}
   */
  ACL.getMatchingScore = function getMatchingScore(rule, req) {
    const props = ['model', 'property', 'accessType'];
    let score = 0;

    for (let i = 0; i < props.length; i++) {
      // Shift the score by 4 for each of the properties as the weight
      score = score * 4;
      const ruleValue = rule[props[i]] || ACL.ALL;
      const requestedValue = req[props[i]] || ACL.ALL;
      const isMatchingMethodName = props[i] === 'property' &&
        req.methodNames.indexOf(ruleValue) !== -1;

      let isMatchingAccessType = ruleValue === requestedValue;
      if (props[i] === 'accessType' && !isMatchingAccessType) {
        switch (ruleValue) {
          case ACL.EXECUTE:
            // EXECUTE should match READ, REPLICATE and WRITE
            isMatchingAccessType = true;
            break;
          case ACL.WRITE:
            // WRITE should match REPLICATE too
            isMatchingAccessType = requestedValue === ACL.REPLICATE;
            break;
        }
      }

      if (isMatchingMethodName || isMatchingAccessType) {
        // Exact match
        score += 3;
      } else if (ruleValue === ACL.ALL) {
        // Wildcard match
        score += 2;
      } else if (requestedValue === ACL.ALL) {
        score += 1;
      } else {
        // Doesn't match at all
        return -1;
      }
    }

    // Weigh against the principal type into 4 levels
    // - user level (explicitly allow/deny a given user)
    // - app level (explicitly allow/deny a given app)
    // - role level (role based authorization)
    // - other
    // user > app > role > ...
    score = score * 4;
    switch (rule.principalType) {
      case ACL.USER:
        score += 4;
        break;
      case ACL.APP:
        score += 3;
        break;
      case ACL.ROLE:
        score += 2;
        break;
      default:
        score += 1;
    }

    // Weigh against the roles
    // everyone < authenticated/unauthenticated < related < owner < ...
    score = score * 8;
    if (rule.principalType === ACL.ROLE) {
      switch (rule.principalId) {
        case Role.OWNER:
          score += 4;
          break;
        case Role.RELATED:
          score += 3;
          break;
        case Role.AUTHENTICATED:
        case Role.UNAUTHENTICATED:
          score += 2;
          break;
        case Role.EVERYONE:
          score += 1;
          break;
        default:
          score += 5;
      }
    }
    score = score * 4;
    score += AccessContext.permissionOrder[rule.permission || ACL.ALLOW] - 1;
    return score;
  };

  /**
   * Get matching score for the given `AccessRequest`.
   * @param {AccessRequest} req The request
   * @returns {Number} score
   */

  ACL.prototype.score = function(req) {
    return this.constructor.getMatchingScore(this, req);
  };

  /*!
   * Resolve permission from the ACLs
   * @param {Object[]) acls The list of ACLs
   * @param {AccessRequest} req The access request
   * @returns {AccessRequest} result The resolved access request
   */
  ACL.resolvePermission = function resolvePermission(acls, req) {
    if (!(req instanceof AccessRequest)) {
      req.registry = this.registry;
      req = new AccessRequest(req);
    }

    // Sort by the matching score in descending order
    acls = acls.sort(function(rule1, rule2) {
      return ACL.getMatchingScore(rule2, req) - ACL.getMatchingScore(rule1, req);
    });

    let permission = ACL.DEFAULT;
    let score = -1;

    for (let i = 0; i < acls.length; i++) {
      const candidate = acls[i];
      const candidateScore = ACL.getMatchingScore(candidate, req);
      if (candidateScore < 0) continue;

      if (score === -1) {
        // First match
        score = candidateScore;
        permission = candidate.permission;
      } else if (candidateScore === score) {
        // For equal scores:
        if (candidate.principalType === ACL.ROLE) {
          // Role-based permissions take precedence
          if (isStrongerRole(candidate.principalId, acls[i - 1].principalId)) {
            permission = candidate.permission;
          }
        } else if (candidate.accessType === req.accessType) {
          // Specific access type takes precedence
          permission = candidate.permission;
        }
      } else {
        // Lower score - stop processing
        break;
      }

      if (!req.isWildcard()) {
        // We should stop from the first match for non-wildcard
        break;
      }
    }

    // If checking ALL access type, verify all specific types
    // only if the permission is not explicitly set to DEFAULT
    if (req.accessType === ACL.ALL && permission === ACL.DEFAULT) {
      const specificTypes = [ACL.READ, ACL.WRITE, ACL.EXECUTE];
      for (const type of specificTypes) {
        const specificReq = new AccessRequest({
          model: req.model,
          property: req.property,
          accessType: type,
          registry: req.registry
        });

        // Check permission for the specific access type
        const typePermission = this.resolvePermission(acls, specificReq).permission;
        if (typePermission === ACL.DENY) {
          permission = ACL.DENY;
          break;
        }
      }
    }

    if (debug.enabled) {
      debug('The following ACLs were searched: ');
      acls.forEach(function(acl) {
        acl.debug();
        debug('with score:', acl.score(req));
      });
    }

    const res = new AccessRequest({
      model: req.model,
      property: req.property,
      accessType: req.accessType,
      permission: permission || ACL.DEFAULT,
      registry: this.registry});

    // Elucidate permission status if DEFAULT
    res.settleDefaultPermission();

    return res;
  };

  /**
   * Check if role1 is stronger than role2
   * @param {String} role1 First role
   * @param {String} role2 Second role
   * @returns {Boolean} true if role1 is stronger
   */
  function isStrongerRole(role1, role2) {
    const roles = {
      [Role.OWNER]: 4,
      [Role.RELATED]: 3,
      [Role.AUTHENTICATED]: 2,
      [Role.UNAUTHENTICATED]: 2,
      [Role.EVERYONE]: 1
    };
    return (roles[role1] || 5) > (roles[role2] || 5);
  }

  /*!
   * Get the static ACLs from the model definition
   * @param {String} model The model name
   * @param {String} property The property/method/relation name
   *
   * @return {Object[]} An array of ACLs
   */
  ACL.getStaticACLs = function getStaticACLs(model, property) {
    const modelClass = this.registry.findModel(model);
    const staticACLs = [];
    if (modelClass && modelClass.settings.acls) {
      modelClass.settings.acls.forEach(function(acl) {
        let prop = acl.property;
        // We support static ACL property with array of string values.
        if (Array.isArray(prop) && prop.indexOf(property) >= 0)
          prop = property;
        if (!prop || prop === ACL.ALL || property === prop) {
          staticACLs.push(new ACL({
            model: model,
            property: prop || ACL.ALL,
            principalType: acl.principalType,
            principalId: acl.principalId, // TODO: Should it be a name?
            accessType: acl.accessType || ACL.ALL,
            permission: acl.permission,
          }));
        }
      });
    }
    const prop = modelClass && (
      // regular property
      modelClass.definition.properties[property] ||
      // relation/scope
      (modelClass._scopeMeta && modelClass._scopeMeta[property]) ||
      // static method
      modelClass[property] ||
      // prototype method
      modelClass.prototype[property]);
    if (prop && prop.acls) {
      prop.acls.forEach(function(acl) {
        staticACLs.push(new ACL({
          model: modelClass.modelName,
          property: property,
          principalType: acl.principalType,
          principalId: acl.principalId,
          accessType: acl.accessType,
          permission: acl.permission,
        }));
      });
    }
    return staticACLs;
  };

  /**
   * Check if the given principal is allowed to access the model/property
   * @param {String} principalType The principal type.
   * @param {String} principalId The principal ID.
   * @param {String} model The model name.
   * @param {String} property The property/method/relation name.
   * @param {String} accessType The access type.
   * @returns {Promise<AccessRequest>} The resolved access request.
   */
  ACL.checkPermission = async function(principalType, principalId, model, property, accessType) {
    if (principalId !== null && principalId !== undefined && (typeof principalId !== 'string')) {
      principalId = principalId.toString()
    }
    
    property = property || ACL.ALL
    const propertyQuery = (property === ACL.ALL) ? undefined : {inq: [property, ACL.ALL]}
    accessType = accessType || ACL.ALL
    const accessTypeQuery = (accessType === ACL.ALL) ? undefined : {inq: [accessType, ACL.ALL, ACL.EXECUTE]}

    const req = new AccessRequest({model, property, accessType, registry: this.registry})

    let acls = this.getStaticACLs(model, property)

    // resolved is an instance of AccessRequest
    let resolved = this.resolvePermission(acls, req)

    if (resolved && resolved.permission === ACL.DENY) {
      return resolved
    }

    // Find dynamic ACLs
    const dynACLs = await this.find({
      where: {
        principalType: principalType, 
        principalId: principalId,
        model: model, 
        property: propertyQuery, 
        accessType: accessTypeQuery
      }
    })
    
    acls = acls.concat(dynACLs)
    resolved = this.resolvePermission(acls, req)
    return resolved
  }

  ACL.prototype.debug = function() {
    if (debug.enabled) {
      debug('---ACL---');
      debug('model %s', this.model);
      debug('property %s', this.property);
      debug('principalType %s', this.principalType);
      debug('principalId %s', this.principalId);
      debug('accessType %s', this.accessType);
      debug('permission %s', this.permission);
    }
  };

  // NOTE Regarding ACL.isAllowed() and ACL.prototype.isAllowed()
  // Extending existing logic, including from ACL.checkAccessForContext() method,
  // ACL instance with missing property `permission` are not promoted to
  // permission = ACL.DEFAULT config. Such ACL instances will hence always be
  // inefective

  /**
   * Test if ACL's permission is ALLOW
   * @param {String} permission The permission to test, expects one of 'ALLOW', 'DENY', 'DEFAULT'
   * @param {String} defaultPermission The default permission to apply if not providing a finite one in the permission parameter
   * @returns {Boolean} true if ACL permission is ALLOW
   */
  ACL.isAllowed = function(permission, defaultPermission) {
    if (permission === ACL.DEFAULT) {
      permission = defaultPermission || ACL.ALLOW;
    }
    return permission !== loopback.ACL.DENY;
  };

  /**
   * Test if ACL's permission is ALLOW
   * @param {String} defaultPermission The default permission to apply if missing in ACL instance
   * @returns {Boolean} true if ACL permission is ALLOW
   */
  ACL.prototype.isAllowed = function(defaultPermission) {
    return this.constructor.isAllowed(this.permission, defaultPermission);
  };

  /**
   * Check if the request has the permission to access.
   * @options {AccessContext|Object} context
   * An AccessContext instance or a plain object with the following properties.
   * @property {Object[]} principals An array of principals.
   * @property {String|Model} model The model name or model class.
   * @property {*} modelId The model instance ID.
   * @property {String} property The property/method/relation name.
   * @property {String} accessType The access type:
   * READ, REPLICATE, WRITE, or EXECUTE.
   * @returns {Promise<AccessRequest>} The resolved access request.
   */
  ACL.checkAccessForContext = async function(context) {
    const self = this
    self.resolveRelatedModels()
    const roleModel = self.roleModel

    if (!(context instanceof AccessContext)) {
      context.registry = this.registry
      context = new AccessContext(context)
    }

    let authorizedRoles = {}
    const remotingContext = context.remotingContext
    const model = context.model
    const modelDefaultPermission = model && model.settings.defaultPermission
    const property = context.property
    const accessType = context.accessType
    const modelName = context.modelName

    const methodNames = context.methodNames
    const propertyQuery = (property === ACL.ALL) ? undefined : { inq: methodNames.concat([ACL.ALL]) }

    const accessTypeQuery = (accessType === ACL.ALL) ?
      undefined :
      (accessType === ACL.REPLICATE) ?
        { inq: [ACL.REPLICATE, ACL.WRITE, ACL.ALL] } :
        { inq: [accessType, ACL.ALL] }

    const req = new AccessRequest({
      model: modelName,
      property,
      accessType,
      permission: ACL.DEFAULT,
      methodNames,
      registry: this.registry
    })

    if (!context.isScopeAllowed()) {
      req.permission = ACL.DENY
      debug('--Denied by scope config--')
      debug('Scopes allowed:', context.accessToken.scopes || ctx.DEFAULT_SCOPES)
      debug('Scope required:', context.getScopes())
      context.debug()
      return req
    }

    const effectiveACLs = []
    const staticACLs = self.getStaticACLs(model.modelName, property)

    const query = {
      where: {
        model: { inq: [model.modelName, ACL.ALL] },
        property: propertyQuery,
        accessType: accessTypeQuery,
      }
    }

    const acls = [...staticACLs, ...await this.find(query)]
    
    // First add exact principal matches to effectiveACLs
    acls.forEach(acl => {
      // Check exact matches
      for (let i = 0; i < context.principals.length; i++) {
        const p = context.principals[i]
        if (p.type === acl.principalType && String(p.id) === String(acl.principalId)) {
          effectiveACLs.push(acl)
          return
        }
      }
    })
    
    // Then process role-based permissions in parallel
    const roleChecks = acls
      .filter(acl => acl.principalType === ACL.ROLE)
      .map(async acl => {
        try {
          const inRole = await roleModel.isInRole(acl.principalId, context)
          if (inRole) {
            effectiveACLs.push(acl)
            if (acl.isAllowed(modelDefaultPermission)) {
              authorizedRoles[acl.principalId] = true
            }
          }
          return acl
        } catch (err) {
          debug('Error checking role membership: %j', err)
          throw err
        }
      })

    // Wait for all role checks to complete
    await Promise.all(roleChecks)
    
    // Resolve the final permission
    const resolved = self.resolvePermission(effectiveACLs, req)
    debug('---Resolved---')
    resolved.debug()
    
    // Store authorized roles in the remoting context
    authorizedRoles = resolved.isAllowed() ? authorizedRoles : {}
    saveAuthorizedRolesToRemotingContext(remotingContext, authorizedRoles)
    
    return resolved
  }

  function saveAuthorizedRolesToRemotingContext(remotingContext, authorizedRoles) {
    const options = remotingContext && remotingContext.args && remotingContext.args.options
    if (options && typeof options === 'object') {
      options.authorizedRoles = authorizedRoles
    }
  }

  /**
   * Check if the given access token can invoke the method
   * @param {AccessToken} token The access token
   * @param {String} model The model name
   * @param {*} modelId The model id
   * @param {String} method The method name
   * @returns {Promise<Boolean>} is the request allowed
   */
  ACL.checkAccessForToken = async function(token, model, modelId, method) {
    assert(token, 'Access token is required')
    
    const context = new AccessContext({
      registry: this.registry, 
      accessToken: token, 
      model: model, 
      property: method, 
      method: method, 
      modelId: modelId
    })
    
    const accessRequest = await this.checkAccessForContext(context)
    return accessRequest.isAllowed()
  }

  ACL.resolveRelatedModels = function() {
    if (!this.roleModel) {
      const reg = this.registry;
      this.roleModel = reg.getModelByType('Role');
      this.roleMappingModel = reg.getModelByType('RoleMapping');
      this.userModel = reg.getModelByType('User');
      this.applicationModel = reg.getModelByType('Application');
    }
  };

  /**
   * Resolve a principal by type/id
   * @param {String} type Principal type - ROLE/APP/USER
   * @param {String|Number} id Principal id or name
   * @returns {Promise<Object>} An instance of principal (Role, Application or User)
   */
  ACL.resolvePrincipal = async function(type, id) {
    type = type || ACL.ROLE
    this.resolveRelatedModels()
    
    switch (type) {
      case ACL.ROLE:
        return this.roleModel.findOne({where: {or: [{name: id}, {id: id}]}})
      case ACL.USER:
        return this.userModel.findOne({where: {or: [{username: id}, {email: id}, {id: id}]}})
      case ACL.APP:
        return this.applicationModel.findOne({where: {or: [{name: id}, {email: id}, {id: id}]}})
      default:
        const userModel = this.registry.findModel(type)
        if (userModel) {
          return userModel.findOne({where: {or: [{username: id}, {email: id}, {id: id}]}})
        } else {
          const err = new Error(g.f('Invalid principal type: %s', type))
          err.statusCode = 400
          err.code = 'INVALID_PRINCIPAL_TYPE'
          throw err
        }
    }
  }

  /**
   * Check if the given principal is mapped to the role
   * @param {String} principalType Principal type
   * @param {String|*} principalId Principal id/name
   * @param {String|*} role Role id/name
   * @returns {Promise<Boolean>} is the ACL mapped to the role
   */
  ACL.isMappedToRole = async function(principalType, principalId, role) {
    const principal = await this.resolvePrincipal(principalType, principalId)
    if (principal != null) {
      principalId = principal.id
    }
    
    principalType = principalType || 'ROLE'
    const roleInstance = await this.resolvePrincipal('ROLE', role)
    
    if (!roleInstance) {
      return false
    }
    
    const result = await this.roleMappingModel.findOne({
      where: {
        roleId: roleInstance.id,
        principalType: principalType,
        principalId: String(principalId)
      }
    })
    
    return !!result
  }
};
