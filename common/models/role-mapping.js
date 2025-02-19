// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const loopback = require('../../lib/loopback');
const utils = require('../../lib/utils');

/**
 * The `RoleMapping` model extends from the built in `loopback.Model` type.
 *
 * @property {String} id Generated ID.
 * @property {String} name Name of the role.
 * @property {String} Description Text description.
 *
 * @class RoleMapping
 * @inherits {PersistedModel}
 */

module.exports = function(RoleMapping) {
  // Principal types
  RoleMapping.USER = 'USER';
  RoleMapping.APP = RoleMapping.APPLICATION = 'APP';
  RoleMapping.ROLE = 'ROLE';

  RoleMapping.resolveRelatedModels = function() {
    if (!this.userModel) {
      const reg = this.registry;
      this.roleModel = reg.getModelByType('Role');
      this.userModel = reg.getModelByType('User');
      this.applicationModel = reg.getModelByType('Application');
    }
  };

  /**
   * Get the application principal
   * @callback {Function} callback
   * @param {Error} err
   * @param {Application} application
   */
  RoleMapping.prototype.application = function(callback) {
    // if no callback provided, return a native Promise
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.constructor.resolveRelatedModels();
        if (this.principalType === RoleMapping.APPLICATION) {
          const applicationModel = this.constructor.applicationModel;
          applicationModel.findById(this.principalId, (err, result) => err ? reject(err) : resolve(result));
        } else {
          process.nextTick(() => resolve(null));
        }
      });
    }
    // callback provided
    this.constructor.resolveRelatedModels();
    if (this.principalType === RoleMapping.APPLICATION) {
      const applicationModel = this.constructor.applicationModel;
      return applicationModel.findById(this.principalId, callback);
    } else {
      process.nextTick(() => callback(null, null));
    }
  };

  /**
   * Get the user principal
   * @callback {Function} callback
   * @param {Error} err
   * @param {User} user
   */
  RoleMapping.prototype.user = function(callback) {
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.constructor.resolveRelatedModels();
        let userModel;
        if (this.principalType === RoleMapping.USER) {
          userModel = this.constructor.userModel;
          userModel.findById(this.principalId, (err, result) => err ? reject(err) : resolve(result));
          return;
        }
        // try resolving a user model that matches principalType
        userModel = this.constructor.registry.findModel(this.principalType);
        if (userModel) {
          userModel.findById(this.principalId, (err, result) => err ? reject(err) : resolve(result));
        } else {
          process.nextTick(() => resolve(null));
        }
      });
    }
    this.constructor.resolveRelatedModels();
    let userModel;
    if (this.principalType === RoleMapping.USER) {
      userModel = this.constructor.userModel;
      return userModel.findById(this.principalId, callback);
    }
    userModel = this.constructor.registry.findModel(this.principalType);
    if (userModel) {
      return userModel.findById(this.principalId, callback);
    } else {
      process.nextTick(() => callback(null, null));
    }
  };

  /**
   * Get the child role principal
   * @callback {Function} callback
   * @param {Error} err
   * @param {User} childUser
   */
  RoleMapping.prototype.childRole = function(callback) {
    if (!callback) {
      return new Promise((resolve, reject) => {
        this.constructor.resolveRelatedModels();
        if (this.principalType === RoleMapping.ROLE) {
          const roleModel = this.constructor.roleModel;
          roleModel.findById(this.principalId, (err, result) => err ? reject(err) : resolve(result));
        } else {
          process.nextTick(() => resolve(null));
        }
      });
    }
    this.constructor.resolveRelatedModels();
    if (this.principalType === RoleMapping.ROLE) {
      const roleModel = this.constructor.roleModel;
      return roleModel.findById(this.principalId, callback);
    } else {
      process.nextTick(() => callback(null, null));
    }
  };
};
