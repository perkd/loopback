// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const loopback = require('../../lib/loopback');

/**
 * Resource owner grants/delegates permissions to client applications
 *
 * For a protected resource, does the client application have the authorization
 * from the resource owner (user or system)?
 *
 * Scope has many resource access entries
 *
 * @class Scope
 */

module.exports = function(Scope) {
  Scope.resolveRelatedModels = function() {
    if (!this.aclModel) {
      const reg = this.registry;
      this.aclModel = reg.getModelByType(loopback.ACL);
    }
  };

  /**
   * Check if the given scope is allowed to access the model/property
   * @param {String} scope The scope name
   * @param {String} model The model name
   * @param {String} property The property/method/relation name
   * @param {String} accessType The access type
   * @param {String|Error} err The error object
   * @param {AccessRequest} result The access permission
   */
  Scope.checkPermission = async function(scope, model, property, accessType) {
    this.resolveRelatedModels()

    const { aclModel } = this
    assert(aclModel, 'ACL model must be defined before Scope.checkPermission is called')

    const scopeRecord = await this.findOne({where: {name: scope}})
    if (!scopeRecord) {
      const error = new Error('Scope ' + scope + ' not found')
      error.statusCode = 403
      error.code = 'SCOPE_NOT_FOUND'
      throw error
    }

    return aclModel.checkPermission(
      aclModel.SCOPE,
      scopeRecord.id,
      model,
      property,
      accessType
    )
  }
}
