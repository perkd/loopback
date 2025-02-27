// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const sinon = require('sinon');
const loopback = require('../index');
const extend = require('util')._extend;
const expect = require('./helpers/expect');

describe('role model', function() {
  let app, Role, RoleMapping, User, Application, ACL;

  beforeEach(function() {
    // Use local app registry to ensure models are isolated to avoid
    // pollutions from other tests
    app = loopback({localRegistry: true, loadBuiltinModels: true});
    app.dataSource('db', {connector: 'memory'});

    ACL = app.registry.getModel('ACL');
    app.model(ACL, {dataSource: 'db'});

    User = app.registry.getModel('User');
    // Speed up the password hashing algorithm for tests
    User.settings.saltWorkFactor = 4;
    app.model(User, {dataSource: 'db'});

    Role = app.registry.getModel('Role');
    app.model(Role, {dataSource: 'db'});

    RoleMapping = app.registry.getModel('RoleMapping');
    app.model(RoleMapping, {dataSource: 'db'});

    Application = app.registry.getModel('Application');
    app.model(Application, {dataSource: 'db'});

    ACL.roleModel = Role;
    ACL.roleMappingModel = RoleMapping;
    ACL.userModel = User;
    ACL.applicationModel = Application;
  });

  it('should define role/role relations', async function() {
    const userRole = await Role.create({name: 'user'});
    const adminRole = await Role.create({name: 'admin'});
    
    const mapping = await userRole.principals.create(
      {principalType: RoleMapping.ROLE, principalId: adminRole.id}
    );

    await Promise.all([
      async function() {
        const roles = await Role.find();
        assert.equal(roles.length, 2);
      }(),
      async function() {
        const mappings = await RoleMapping.find();
        assert.equal(mappings.length, 1);
        assert.equal(mappings[0].principalType, RoleMapping.ROLE);
        assert.equal(mappings[0].principalId, adminRole.id);
      }(),
      async function() {
        const principals = await userRole.principals();
        assert.equal(principals.length, 1);
      }(),
      async function() {
        const roles = await userRole.roles();
        assert.equal(roles.length, 1);
      }()
    ]);
  });

  it('should generate created/modified properties', () => {
    return Role.create({name: 'ADMIN'})
      .then(role => {
        expect(role.toJSON().created).to.be.instanceOf(Date);
        expect(role.toJSON().modified).to.be.instanceOf(Date);
      });
  });

  it('should define role/user relations', async function() {
    const user = await User.create({name: 'Raymond', email: 'x@y.com', password: 'foobar'});
    const role = await Role.create({name: 'userRole'});
    const p = await role.principals.create({principalType: RoleMapping.USER, principalId: user.id});
    await Promise.all([
      async function() {
        const roles = await Role.find();
        assert.equal(roles.length, 1);
        assert.equal(roles[0].name, 'userRole');
      }(),
      async function() {
        const principals = await role.principals();
        assert.equal(principals.length, 1);
        assert.equal(principals[0].principalType, RoleMapping.USER);
        assert.equal(principals[0].principalId, user.id);
      }(),
      async function() {
        const users = await role.users();
        assert.equal(users.length, 1);
        assert.equal(users[0].id, user.id);
      }()
    ]);
  });

  it('should not allow duplicate role name', async function() {
    const role = await Role.create({name: 'userRole'});

    try {
      await Role.create({name: 'userRole'});
      assert(false);
    } catch (err) {
      expect(err).to.exist();
      expect(err).to.have.property('name', 'ValidationError');
      expect(err).to.have.nested.property('details.codes.name');
      expect(err.details.codes.name).to.contain('uniqueness');
      expect(err).to.have.property('statusCode', 422);
    }
  });

  it('should automatically generate role id', async function() {
    const user = await User.create({name: 'Raymond', email: 'x@y.com', password: 'foobar'});
    const role = await Role.create({name: 'userRole'});
    assert(role.id);
    const p = await role.principals.create({principalType: RoleMapping.USER, principalId: user.id});
    assert(p.id);
    assert.equal(p.roleId, role.id);
    const roles = await Role.find();
    assert.equal(roles.length, 1);
    assert.equal(roles[0].name, 'userRole');
  });

  it('should support getRoles() and isInRole()', async function() {
    const user = await User.create({name: 'Raymond', email: 'x@y.com', password: 'foobar'});
    const role = await Role.create({name: 'userRole'});
    const p = await role.principals.create({principalType: RoleMapping.USER, principalId: user.id});
    await Promise.all([
      async function() {
        const isInRole = await Role.isInRole(
          'userRole',
          {principalType: RoleMapping.USER, principalId: user.id}
        );
        assert(!!isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          'userRole',
          {principalType: RoleMapping.APP, principalId: user.id}
        );
        assert(!isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          'userRole',
          {principalType: RoleMapping.USER, principalId: 100}
        );
        assert(!isInRole);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.USER, principalId: user.id}
        );
        expect(roles).to.eql([
          Role.AUTHENTICATED,
          Role.EVERYONE,
          role.id,
        ]);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.USER, principalId: user.id},
          {returnOnlyRoleNames: true}
        );
        expect(roles).to.eql([
          Role.AUTHENTICATED,
          Role.EVERYONE,
          role.name,
        ]);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.APP, principalId: user.id}
        );
        expect(roles).to.eql([
          Role.AUTHENTICATED,
          Role.EVERYONE,
        ]);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.USER, principalId: 100}
        );
        expect(roles).to.eql([
          Role.AUTHENTICATED,
          Role.EVERYONE,
        ]);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.USER, principalId: null}
        );
        expect(roles).to.eql([
          Role.UNAUTHENTICATED,
          Role.EVERYONE,
        ]);
      }()
    ]);
  });

  it('supports isInRole() returning a Promise', async function() {
    const userData = {name: 'Raymond', email: 'x@y.com', password: 'foobar'};
    const user = await User.create(userData);
    const role = await Role.create({name: 'userRole'});
    const principalData = {
      principalType: RoleMapping.USER,
      principalId: user.id,
    };
    const p = await role.principals.create(principalData);
    const isInRole = await Role.isInRole('userRole', principalData);
    expect(isInRole).to.be.true();
  });

  it('supports getRole() returning a Promise', async function() {
    const userData = {name: 'Raymond', email: 'x@y.com', password: 'foobar'};
    const user = await User.create(userData);
    const role = await Role.create({name: 'userRole'});
    const principalData = {
      principalType: RoleMapping.USER,
      principalId: user.id,
    };
    const p = await role.principals.create(principalData);
    const roles = await Role.getRoles(principalData);
    expect(roles).to.eql([
      Role.AUTHENTICATED,
      Role.EVERYONE,
      role.id,
    ]);
  });

  it('should be properly authenticated with 0 userId', async function() {
    const userData = {name: 'Raymond', email: 'x@y.com', password: 'foobar', id: 0};
    const TestUser = app.registry.createModel({
      name: 'TestUser',
      base: 'User',
      // forceId is set to false so we can create a user with a known ID,
      // in this case 0 - which used to fail the falsy checks.
      forceId: false,
    });
    app.model(TestUser, {dataSource: 'db'});

    const user = await TestUser.create(userData);
    const role = await Role.create({name: 'userRole'});
    const p = await role.principals.create({principalType: RoleMapping.USER, principalId: user.id});
    await Promise.all([
      async function() {
        const isInRole = await Role.isInRole(
          'userRole',
          {principalType: RoleMapping.USER, principalId: user.id}
        );
        assert(!!isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          'userRole',
          {principalType: RoleMapping.APP, principalId: user.id}
        );
        assert(!isInRole);
      }(),
      async function() {
        const roles = await Role.getRoles(
          {principalType: RoleMapping.USER, principalId: user.id}
        );
        expect(roles).to.eql([
          Role.AUTHENTICATED,
          Role.EVERYONE,
          role.id,
        ]);
      }()
    ]);
  });

  // this test should be split to address one resolver at a time
  it('supports built-in role resolvers', async function() {
    Role.registerResolver('returnPromise', function(role, context) {
      return new Promise(function(resolve) {
        process.nextTick(function() {
          resolve(true);
        });
      });
    });

    const Album = app.registry.createModel('Album', {
      name: String,
      userId: Number,
    }, {
      relations: {
        user: {
          type: 'belongsTo',
          model: 'User',
          foreignKey: 'userId',
        },
      },
    });
    app.model(Album, {dataSource: 'db'});

    const user = await User.create({name: 'Raymond', email: 'x@y.com', password: 'foobar'});
    await Promise.all([
      async function() {
        const isInRole = await Role.isInRole(
          'returnPromise',
          {principalType: ACL.USER, principalId: user.id}
        );
        assert(isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.AUTHENTICATED,
          {principalType: ACL.USER, principalId: user.id}
        );
        assert(isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.AUTHENTICATED,
          {principalType: ACL.USER, principalId: null}
        );
        assert(!isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.UNAUTHENTICATED,
          {principalType: ACL.USER, principalId: user.id}
        );
        assert(!isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.UNAUTHENTICATED,
          {principalType: ACL.USER, principalId: null}
        );
        assert(isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.EVERYONE,
          {principalType: ACL.USER, principalId: user.id}
        );
        assert(isInRole);
      }(),
      async function() {
        const isInRole = await Role.isInRole(
          Role.EVERYONE,
          {principalType: ACL.USER, principalId: null}
        );
        assert(isInRole);
      }(),
      async function() {
        const album1 = await Album.create({name: 'Album 1', userId: user.id});
        let role = {
          principalType: ACL.USER, principalId: user.id,
          model: Album, id: album1.id,
        };
        const isInRole = await Role.isInRole(Role.OWNER, role);
        assert(isInRole);

        const album2 = await Album.create({name: 'Album 2'});
        role = {
          principalType: ACL.USER, principalId: user.id,
          model: Album, id: album2.id,
        };
        const isInRole2 = await Role.isInRole(Role.OWNER, role);
        assert(!isInRole2);
      }()
    ]);
  });

  describe('$owner role resolver', function() {
    let sender, receiver;
    const users = [
      {username: 'sender', email: 'sender@example.com', password: 'pass'},
      {username: 'receiver', email: 'receiver@example.com', password: 'pass'},
    ];

    describe('ownerRelations not set (legacy behaviour)', () => {
      it('resolves the owner via property "userId"', async function() {
        let user;
        const Album = app.registry.createModel('Album', {
          name: String,
          userId: Number,
        });
        app.model(Album, {dataSource: 'db'});

        user = await User.create({email: 'test@example.com', password: 'pass'});
        const album = await Album.create({name: 'Album 1', userId: user.id});
        const isInRole = await Role.isInRole(Role.OWNER, {
          principalType: ACL.USER,
          principalId: user.id,
          model: Album,
          id: album.id,
        });
        expect(isInRole).to.be.true();
      });

      it('resolves the owner via property "owner"', async function() {
        let user;
        const Album = app.registry.createModel('Album', {
          name: String,
          owner: Number,
        });
        app.model(Album, {dataSource: 'db'});

        user = await User.create({email: 'test@example.com', password: 'pass'});
        const album = await Album.create({name: 'Album 1', owner: user.id});
        const isInRole = await Role.isInRole(Role.OWNER, {
          principalType: ACL.USER,
          principalId: user.id,
          model: Album,
          id: album.id,
        });
        expect(isInRole).to.be.true();
      });

      it('resolves the owner via a belongsTo relation', async function() {
        // passing no options will result calling
        // the legacy $owner role resolver behavior
        const Message = givenModelWithSenderReceiverRelations('ModelWithNoOptions');

        const [sender, receiver] = await givenUsers();
        const messages = [
          {content: 'firstMessage', senderId: sender.id},
          {content: 'secondMessage', receiverId: receiver.id},
          {content: 'thirdMessage'},
        ];
        const createdMessages = await Promise.all(messages.map(msg => Message.create(msg)));
        const results = await Promise.all([
          isOwnerForMessage(sender, createdMessages[0]),
          isOwnerForMessage(receiver, createdMessages[1]),
          isOwnerForMessage(receiver, createdMessages[2])
        ]);
        expect(results).to.eql([
          {user: 'sender', msg: 'firstMessage', isOwner: true},
          {user: 'receiver', msg: 'secondMessage', isOwner: false},
          {user: 'receiver', msg: 'thirdMessage', isOwner: false},
        ]);
      });
    });

    it('resolves as false without belongsTo relation', async function() {
      let user;
      const Album = app.registry.createModel(
        'Album',
        {
          name: String,
          userId: Number,
          owner: Number,
        },
        // passing {ownerRelations: true} will enable the new $owner role resolver
        // and hence resolve false when no belongsTo relation is defined
        {ownerRelations: true},
      );
      app.model(Album, {dataSource: 'db'});

      user = await User.create({email: 'test@example.com', password: 'pass'});
      const album = await Album.create({name: 'Album 1', userId: user.id, owner: user.id});
      const isInRole = await Role.isInRole(Role.OWNER, {
        principalType: ACL.USER,
        principalId: user.id,
        model: Album,
        id: album.id,
      });
      expect(isInRole).to.be.false();
    });

    it('resolves the owner using the corrent belongsTo relation', async function() {
      // passing {ownerRelations: true} will enable the new $owner role resolver
      // with any belongsTo relation allowing to resolve truthy
      const Message = givenModelWithSenderReceiverRelations(
        'ModelWithAllRelations',
        {ownerRelations: true},
      );

      const [sender, receiver] = await givenUsers();
      const messages = [
        {content: 'firstMessage', senderId: sender.id},
        {content: 'secondMessage', receiverId: receiver.id},
        {content: 'thirdMessage'},
      ];
      const createdMessages = await Promise.all(messages.map(msg => Message.create(msg)));
      const results = await Promise.all([
        isOwnerForMessage(sender, createdMessages[0]),
        isOwnerForMessage(receiver, createdMessages[1]),
        isOwnerForMessage(receiver, createdMessages[2])
      ]);
      expect(results).to.eql([
        {user: 'sender', msg: 'firstMessage', isOwner: true},
        {user: 'receiver', msg: 'secondMessage', isOwner: true},
        {user: 'receiver', msg: 'thirdMessage', isOwner: false},
      ]);
    });

    it('allows fine-grained control of which relations grant ownership',
      async function() {
      // passing {ownerRelations: true} will enable the new $owner role resolver
      // with a specified list of belongsTo relations allowing to resolve truthy
        const Message = givenModelWithSenderReceiverRelations(
          'ModelWithCoercedRelations',
          {ownerRelations: ['receiver']},
        );

        const [sender, receiver] = await givenUsers();
        const messages = [
          {content: 'firstMessage', senderId: sender.id},
          {content: 'secondMessage', receiverId: receiver.id},
          {content: 'thirdMessage'},
        ];
        const createdMessages = await Promise.all(messages.map(msg => Message.create(msg)));
        const results = await Promise.all([
          isOwnerForMessage(sender, createdMessages[0]),
          isOwnerForMessage(receiver, createdMessages[1]),
          isOwnerForMessage(receiver, createdMessages[2])
        ]);
        expect(results).to.eql([
          {user: 'sender', msg: 'firstMessage', isOwner: false},
          {user: 'receiver', msg: 'secondMessage', isOwner: true},
          {user: 'receiver', msg: 'thirdMessage', isOwner: false},
        ]);
      });

    // helpers
    async function givenUsers(count = 2) {
      const createdUsers = await Promise.all(users.slice(0, count).map(async userData => {
        return await User.create(userData);
      }));
      sender = createdUsers[0];
      receiver = createdUsers[1];
      return createdUsers;
    }

    async function isOwnerForMessage(user, msg) {
      const accessContext = {
        principalType: ACL.USER,
        principalId: user.id,
        model: msg.constructor,
        id: msg.id,
      };
      const isOwner = await Role.isInRole(Role.OWNER, accessContext);
      return {
        user: user.username,
        msg: msg.content,
        isOwner,
      };
    }

    function givenModelWithSenderReceiverRelations(name, options) {
      const baseOptions = {
        relations: {
          sender: {
            type: 'belongsTo',
            model: 'User',
            foreignKey: 'senderId',
          },
          receiver: {
            type: 'belongsTo',
            model: 'User',
            foreignKey: 'receiverId',
          },
        },
      };
      options = extend(baseOptions, options);
      const Model = app.registry.createModel(
        name,
        {content: String},
        options,
      );
      app.model(Model, {dataSource: 'db'});
      return Model;
    }
  });

  it('passes accessToken to modelClass.findById when resolving OWNER', async function() {
    const Album = app.registry.createModel('Album', {name: String});
    app.model(Album, {dataSource: 'db'});
    Album.belongsTo(User);

    // Override findById to capture the options
    const originalFindById = Album.findById;
    let capturedOptions = null;
    Album.findById = function(id, options, callback) {
      capturedOptions = options || {};
      return originalFindById.apply(this, arguments);
    };

    const user = await User.create({email: 'test@example.com', password: 'pass'});
    const album = await Album.create({name: 'Album 1', userId: user.id});
    const isInRole = await Role.isInRole(Role.OWNER, {
      principalType: ACL.USER, principalId: user.id,
      model: Album, id: album.id,
      accessToken: 'test-token',
    });
    expect(capturedOptions).to.eql({accessToken: 'test-token'});
  });

  describe('isMappedToRole', function() {
    let user, app, role;

    beforeEach(async function() {
      user = await User.create({
        username: 'john',
        email: 'john@gmail.com',
        password: 'jpass',
      });

      app = await Application.create({
        name: 'demo',
      });

      role = await Role.create({
        name: 'admin',
      });

      const principals = [
        {
          principalType: ACL.USER,
          principalId: user.id,
        },
        {
          principalType: ACL.APP,
          principalId: app.id,
        },
      ];
      
      // Use Promise.all instead of async.each
      await Promise.all(principals.map(p => role.principals.create(p)));
    });

    it('supports ACL.resolvePrincipal() returning a promise', async function() {
      const u = await ACL.resolvePrincipal(ACL.USER, user.id);
      expect(u.id).to.eql(user.id);
    });

    it('should resolve user by id', async function() {
      const u = await ACL.resolvePrincipal(ACL.USER, user.id);
      expect(u.id).to.eql(user.id);
    });

    it('should resolve user by username', async function() {
      const u = await ACL.resolvePrincipal(ACL.USER, user.username);
      expect(u.username).to.eql(user.username);
    });

    it('should resolve user by email', async function() {
      const u = await ACL.resolvePrincipal(ACL.USER, user.email);
      expect(u.email).to.eql(user.email);
    });

    it('should resolve app by id', async function() {
      const a = await ACL.resolvePrincipal(ACL.APP, app.id);
      expect(a.id).to.eql(app.id);
    });

    it('should resolve app by name', async function() {
      const a = await ACL.resolvePrincipal(ACL.APP, app.name);
      expect(a.name).to.eql(app.name);
    });

    it('should report isMappedToRole by user.username', async function() {
      const isMappedToRole = await ACL.isMappedToRole(
        ACL.USER, user.username, 'admin');
      expect(isMappedToRole).to.be.true();
    });

    it('should report isMappedToRole by user.email', async function() {
      const isMappedToRole = await ACL.isMappedToRole(
        ACL.USER, user.email, 'admin');
      expect(isMappedToRole).to.be.true();
    });

    it('should report isMappedToRole by user.id', async function() {
      const isMappedToRole = await ACL.isMappedToRole(
        ACL.USER, user.id, 'admin');
      expect(isMappedToRole).to.be.true();
    });

    it('should report isMappedToRole by app.name', async function() {
      const isMappedToRole = await ACL.isMappedToRole(
        ACL.APP, app.name, 'admin');
      expect(isMappedToRole).to.be.true();
    });

    it('should report isMappedToRole by app.id', async function() {
      const isMappedToRole = await ACL.isMappedToRole(
        ACL.APP, app.id, 'admin');
      expect(isMappedToRole).to.be.true();
    });

    it('should support isInRole() returning a Promise', async function() {
      // Create a simple context with principals
      const context = {
        principals: [
          {principalType: ACL.USER, principalId: 'a'},
          {principalType: ACL.APP, principalId: 'b'},
        ],
        isAuthenticated: function() { return true }
      };
     
      const isInRole = await Role.isInRole(Role.EVERYONE, context);
      expect(isInRole).to.be.true();
    });

    it('should determine if a user is the owner via Promise API', async function() {
      const result = await Role.isOwner(User, user.id, user.id);
      assert(result);
    });
  });

  describe('listByPrincipalType', function() {
    let sandbox

    beforeEach(function() {
      sandbox = sinon.createSandbox()
    })

    afterEach(function() {
      sandbox.restore()
    })

    it('should fetch all models assigned to the role', async function() {
      const principalTypesToModels = {}
      let runs = 0

      principalTypesToModels[RoleMapping.USER] = User
      principalTypesToModels[RoleMapping.APPLICATION] = Application
      principalTypesToModels[RoleMapping.ROLE] = Role

      const mappings = Object.keys(principalTypesToModels)

      for (const principalType of mappings) {
        const Model = principalTypesToModels[principalType]
        const model = await Model.create({name: 'test', email: 'x@y.com', password: 'foobar'})
        const uniqueRoleName = 'testRoleFor' + principalType
        const role = await Role.create({name: uniqueRoleName})
        await role.principals.create({principalType: principalType, principalId: model.id})
        
        const pluralName = Model.pluralModelName.toLowerCase()
        const models = await role[pluralName]()
        assert.equal(models.length, 1)
      }
    })

    it('should fetch all models only assigned to the role', async function() {
      const principalTypesToModels = {}

      principalTypesToModels[RoleMapping.USER] = User
      principalTypesToModels[RoleMapping.APPLICATION] = Application
      principalTypesToModels[RoleMapping.ROLE] = Role

      const mappings = Object.keys(principalTypesToModels)

      for (const principalType of mappings) {
        const Model = principalTypesToModels[principalType]

        // Create models
        const models = await Model.create([
          {name: 'test', email: 'x@y.com', password: 'foobar'},
          {name: 'test2', email: 'f@v.com', password: 'bargoo'},
          {name: 'test3', email: 'd@t.com', password: 'bluegoo'}
        ])

        // Create Roles
        const uniqueRoleName = 'testRoleFor' + principalType
        const otherUniqueRoleName = 'otherTestRoleFor' + principalType
        const roles = await Role.create([
          {name: uniqueRoleName},
          {name: otherUniqueRoleName}
        ])

        // Create principles
        await Promise.all([
          roles[0].principals.create({principalType: principalType, principalId: models[0].id}),
          roles[1].principals.create({principalType: principalType, principalId: models[1].id})
        ])

        // Run tests against unique Role
        const pluralName = Model.pluralModelName.toLowerCase()
        const uniqueRole = roles[0]
        const uniqueRoleModels = await uniqueRole[pluralName]()
        assert.equal(uniqueRoleModels.length, 1)
      }
    })

    it('should apply query', async function() {
      const user = await User.create({name: 'Raymond', email: 'x@y.com', password: 'foobar'})
      const role = await Role.create({name: 'userRole'})
      await role.principals.create({principalType: RoleMapping.USER, principalId: user.id})
      
      const query = {fields: ['id', 'name']}
      sandbox.spy(User, 'find')
      const users = await role.users(query)
      
      assert.equal(users.length, 1)
      assert.equal(users[0].id, user.id)
      assert(User.find.calledWith(query))
    })

    it('supports Promise API', async function() {
      const userData = {name: 'Raymond', email: 'x@y.com', password: 'foobar'}
      const user = await User.create(userData)
      const role = await Role.create({name: 'userRole'})
      
      const principalData = {
        principalType: RoleMapping.USER,
        principalId: user.id,
      }
      await role.principals.create(principalData)
      
      const users = await role.users()
      const userIds = users.map(function(u) { return u.id })
      expect(userIds).to.eql([user.id])
    })
  })

  describe('isOwner', function() {
    it('supports app-local model registry', async function() {
      const app = loopback({localRegistry: true, loadBuiltinModels: true})
      app.dataSource('db', {connector: 'memory'})
      // attach all auth-related models to 'db' datasource
      app.enableAuth({dataSource: 'db'})

      const Role = app.models.Role
      const User = app.models.User

      // Speed up the password hashing algorithm for tests
      User.settings.saltWorkFactor = 4

      const u = app.registry.findModel('User')
      const credentials = {email: 'test@example.com', password: 'pass'}
      const user = await User.create(credentials)

      const result = await Role.isOwner(User, user.id, user.id)
      expect(result, 'isOwner result').to.equal(true)
    })

    it('supports Promise API', async function() {
      const credentials = {email: 'test@example.com', password: 'pass'}
      const user = await User.create(credentials)

      const result = await Role.isOwner(User, user.id, user.id)
      expect(result, 'isOwner result').to.equal(true)
    })
  })
});
