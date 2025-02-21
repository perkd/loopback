// Copyright IBM Corp. 2015,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const async = require('async');
const debug = require('debug')('test');
const extend = require('util')._extend;
const loopback = require('../');
const expect = require('./helpers/expect');
const supertest = require('supertest');

describe('Replication over REST', function() {

  const ALICE = {id: 'a', username: 'alice', email: 'a@t.io', password: 'p'};
  const PETER = {id: 'p', username: 'peter', email: 'p@t.io', password: 'p'};
  const EMERY = {id: 'e', username: 'emery', email: 'e@t.io', password: 'p'};

  /* eslint-disable one-var */
  let serverApp, serverUrl, ServerUser, ServerCar, serverCars;
  let aliceId, peterId, aliceToken, peterToken, emeryToken, request;
  let clientApp, LocalUser, LocalCar, RemoteUser, RemoteCar, clientCars;
  let conflictedCarId;
  /* eslint-enable one-var */

  before(setupServer);
  before(setupClient);
  beforeEach(seedServerData);
  beforeEach(seedClientData);

  describe('the replication scenario scaffolded for the tests', function() {
    describe('Car model', function() {
      it('rejects anonymous READ', function(done) {
        listCars().expect(401, done);
      });

      it('rejects anonymous WRITE', function(done) {
        createCar().expect(401, done);
      });

      it('allows EMERY to READ', function(done) {
        listCars()
          .set('Authorization', emeryToken)
          .expect(200, done);
      });

      it('denies EMERY to WRITE', function(done) {
        createCar()
          .set('Authorization', emeryToken)
          .expect(401, done);
      });

      it('allows ALICE to READ', function(done) {
        listCars()
          .set('Authorization', aliceToken)
          .expect(200, done);
      });

      it('denies ALICE to WRITE', function(done) {
        createCar()
          .set('Authorization', aliceToken)
          .expect(401, done);
      });

      it('allows PETER to READ', function(done) {
        listCars()
          .set('Authorization', peterToken)
          .expect(200, done);
      });

      it('allows PETER to WRITE', function(done) {
        createCar()
          .set('Authorization', peterToken)
          .expect(200, done);
      });

      function listCars() {
        return request.get('/Cars');
      }

      function createCar() {
        return request.post('/Cars').send({model: 'a-model'});
      }
    });
  });

  describe('sync with model-level permissions', function() {
    describe('as anonymous user', function() {
      it('rejects pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      });

      it('rejects push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      });
    });

    describe('as user with READ-only permissions', function() {
      beforeEach(function() {
        setAccessToken(emeryToken);
      });

      it('rejects pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      });

      it('rejects push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      });
    });

    describe('as user with REPLICATE-only permissions', function() {
      beforeEach(function() {
        setAccessToken(aliceToken);
      });

      it('allows pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar)
        const { conflicts } = result

        if (conflicts.length) return conflictError(conflicts)

        const list = await LocalCar.find()
        expect(list.map(carToString)).to.include.members(serverCars)
      })

      it('rejects push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      })
    })

    describe('as user with READ and WRITE permissions', function() {
      beforeEach(function() {
        setAccessToken(peterToken);
      });

      it('allows pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar)
        const { conflicts } = result

        if (conflicts.length) return conflictError(conflicts)

        const list = await LocalCar.find()
        expect(list.map(carToString)).to.include.members(serverCars)
      })

      it('allows push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar)
        const { conflicts, checkpoints } = result

        if (conflicts.length) return conflictError(conflicts)

        const list = await RemoteCar.find()
        expect(list.map(carToString)).to.include.members(clientCars)
      })
    })
  })

  describe('conflict resolution with model-level permissions', function() {
    let LocalConflict, RemoteConflict;

    before(function setupConflictModels() {
      LocalConflict = LocalCar.getChangeModel().Conflict;
      RemoteConflict = RemoteCar.getChangeModel().Conflict;
    })

    beforeEach(async function() {
      await seedConflict()
    })

    describe('as anonymous user', function() {
      it('rejects resolve() on the client', async function() {
        // simulate replication Client->Server
        const conflict = new LocalConflict(conflictedCarId, LocalCar, RemoteCar)
        try {
          await conflict.resolveUsingSource()
          throw new Error('resolveUsingSource should have failed')
        }
        catch (err) {
          expect(err).to.have.property('statusCode', 401)
        }
      })

      it('rejects resolve() on the server', async function() {
        // simulate replication Server->Client
        const conflict = new RemoteConflict(conflictedCarId, RemoteCar, LocalCar)
        try {
          await conflict.resolveUsingSource()
          throw new Error('resolveUsingSource should have failed')
        }
        catch (err) {
          expect(err).to.have.property('statusCode', 401)
        }
      })
    })

    describe('as user with READ-only permissions', function() {
      beforeEach(function() {
        setAccessToken(emeryToken)
      })

      it('allows resolve() on the client', async function() {
        // simulate replication Client->Server
        const conflict = new LocalConflict(conflictedCarId, LocalCar, RemoteCar)
        await conflict.resolveUsingSource()
      })

      it('rejects resolve() on the server', async function() {
        // simulate replication Server->Client
        const conflict = new RemoteConflict(conflictedCarId, RemoteCar, LocalCar)
        try {
          await conflict.resolveUsingSource()
          throw new Error('resolveUsingSource should have failed')
        }
        catch (err) {
          expect(err).to.have.property('statusCode', 401)
        }
      })
    })

    describe('as user with REPLICATE-only permissions', function() {
      beforeEach(function() {
        setAccessToken(aliceToken);
      })

      it('allows reverse resolve() on the client', async function() {
        const result = await RemoteCar.replicate(LocalCar)
        const { conflicts } = result
        expect(conflicts, 'conflicts').to.have.length(1)
        
        // Await the resolution after swapping parties
        await conflicts[0].swapParties().resolveUsingTarget()
        
        const local = await RemoteCar.replicate(LocalCar)
        const { conflicts: localConflicts } = local
        expect(localConflicts).to.have.length(1)
        
        await localConflicts[0].resolveUsingSource()
        if (localConflicts.length) throw conflictError(localConflicts)
      })

      it('rejects resolve() on the server', async function() {
        const result = await RemoteCar.replicate(LocalCar)
        const { conflicts } = result
        expect(conflicts, 'conflicts').to.have.length(1)
        try {
          await conflicts[0].resolveUsingSource()
          throw new Error('resolveUsingSource should have failed')
        }
        catch (err) {
          expect(err).to.have.property('statusCode', 401)
        }
      })
    })

    describe('as user with READ and WRITE permissions', function() {
      beforeEach(function() {
        setAccessToken(peterToken);
      });

      it('allows resolve() on the client', async function() {
        const local = await LocalCar.replicate(RemoteCar)
        const { conflicts } = local
        expect(conflicts, 'conflicts').to.have.length(1)
        await conflicts[0].resolveUsingSource()
        
        const remote = await LocalCar.replicate(RemoteCar)
        const { conflicts: remoteConflicts } = remote
        expect(remoteConflicts).to.have.length(1)
        await remoteConflicts[0].resolveUsingSource()
        if (remoteConflicts.length) throw conflictError(remoteConflicts)
      })

      it('allows resolve() on the server', async function() {
        const remote = await RemoteCar.replicate(LocalCar)
        const { conflicts } = remote
        expect(conflicts).to.have.length(1)
        await conflicts[0].resolveUsingSource()
        
        const local = await RemoteCar.replicate(LocalCar)
        const { conflicts: localConflicts } = local
        expect(localConflicts).to.have.length(1)
        await localConflicts[0].resolveUsingSource()
        if (localConflicts.length) throw conflictError(localConflicts)
      })
    })
  })

  describe.skip('sync with instance-level permissions', function() {
    it('pulls only authorized records', async function() {
      setAccessToken(aliceToken)

      const result = await RemoteUser.replicate(LocalUser)
      const { conflicts } = result
      if (conflicts.length) return conflictError(conflicts)

      const users = await LocalUser.find()
      const userNames = users.map(function(u) { return u.username; })
      expect(userNames).to.eql([ALICE.username])
    })

    it('rejects push of unauthorized records', async function() {
      // First, set up the modified local copy of Alice
      await setupModifiedLocalCopyOfAlice()

      // Simulate a replication attempt with a user who doesn't have write permissions
      setAccessToken(peterToken)
      try {
        await LocalUser.replicate(RemoteUser)
        throw new Error('Replicate should have failed.')
      }
      catch (err) {
        expect(err).to.have.property('statusCode', 401)
      }

      // Verify that the server record was not modified
      const found = await ServerUser.findById(aliceId)
      expect(found.toObject()).to.not.have.property('fullname')
    })

    it('allows push of authorized records', async function() {
      // First, set up the modified local copy of Alice
      await setupModifiedLocalCopyOfAlice()

      // Simulate replication with proper write permissions
      setAccessToken(aliceToken)
      const result = await LocalUser.replicate(RemoteUser)
      if (result.conflicts && result.conflicts.length) {
        throw conflictError(result.conflicts)
      }

      // Verify that the server record was updated
      const found = await RemoteUser.findById(aliceId)
      expect(found.toObject()).to.have.property('fullname', 'Alice Smith')
    })

    // TODO(bajtos) verify conflict resolution

    async function setupModifiedLocalCopyOfAlice() {
      // Replicate directly, bypassing REST+AUTH layers
      await replicateServerToLocal()

      await LocalUser.updateAll(
        {id: aliceId},
        {fullname: 'Alice Smith'},
      )
    }
  })

  const USER_PROPS = {
    id: {type: 'string', id: true},
  };

  const USER_OPTS = {
    base: 'User',
    plural: 'Users', // use the same REST path in all models
    trackChanges: true,
    strict: 'throw',
    persistUndefinedAsNull: true,
    // Speed up the password hashing algorithm for tests
    saltWorkFactor: 4,
  };

  const CAR_PROPS = {
    id: {type: 'string', id: true, defaultFn: 'guid'},
    model: {type: 'string', required: true},
    maker: {type: 'string'},
  };

  const CAR_OPTS = {
    base: 'PersistedModel',
    plural: 'Cars', // use the same REST path in all models
    trackChanges: true,
    strict: 'throw',
    persistUndefinedAsNull: true,
    acls: [
      // disable anonymous access
      {
        principalType: 'ROLE',
        principalId: '$everyone',
        permission: 'DENY',
      },
      // allow all authenticated users to read data
      {
        principalType: 'ROLE',
        principalId: '$authenticated',
        permission: 'ALLOW',
        accessType: 'READ',
      },
      // allow Alice to pull changes
      {
        principalType: 'USER',
        principalId: ALICE.id,
        permission: 'ALLOW',
        accessType: 'REPLICATE',
      },
      // allow Peter to write data
      {
        principalType: 'USER',
        principalId: PETER.id,
        permission: 'ALLOW',
        accessType: 'WRITE',
      },
    ],
  };

  function setupServer(done) {
    serverApp = loopback({localRegistry: true, loadBuiltinModels: true});
    serverApp.set('remoting', {errorHandler: {debug: true, log: false}});
    serverApp.dataSource('db', {connector: 'memory'});

    // Setup a custom access-token model that is not shared
    // with the client app
    const ServerToken = serverApp.registry.createModel('ServerToken', {}, {
      base: 'AccessToken',
      relations: {
        user: {
          type: 'belongsTo',
          model: 'ServerUser',
          foreignKey: 'userId',
        },
      },
    });
    serverApp.model(ServerToken, {dataSource: 'db', public: false});

    ServerUser = serverApp.registry.createModel('ServerUser', USER_PROPS, USER_OPTS);
    serverApp.model(ServerUser, {
      dataSource: 'db',
      public: true,
      relations: {accessTokens: {model: 'ServerToken'}},
    });

    serverApp.enableAuth({dataSource: 'db'});

    ServerCar = serverApp.registry.createModel('ServerCar', CAR_PROPS, CAR_OPTS);
    serverApp.model(ServerCar, {dataSource: 'db', public: true});

    serverApp.use(function(req, res, next) {
      debug(req.method + ' ' + req.path);

      next();
    });
    serverApp.use(loopback.token({model: ServerToken}));
    serverApp.use(loopback.rest());

    serverApp.set('port', 0);
    serverApp.set('host', '127.0.0.1');
    serverApp.listen(function() {
      serverUrl = serverApp.get('url').replace(/\/+$/, '');
      request = supertest(serverUrl);

      done();
    });
  }

  function setupClient() {
    clientApp = loopback({localRegistry: true, loadBuiltinModels: true});
    clientApp.dataSource('db', {connector: 'memory'});
    clientApp.dataSource('remote', {
      connector: 'remote',
      url: serverUrl,
    });

    // NOTE(bajtos) At the moment, all models share the same Checkpoint
    // model. This causes the in-process replication to work differently
    // than client-server replication.
    // As a workaround, we manually setup unique Checkpoint for ClientModel.
    const ClientCheckpoint = clientApp.registry.createModel({
      name: 'ClientCheckpoint',
      base: 'Checkpoint',
    });
    ClientCheckpoint.attachTo(clientApp.dataSources.db);

    LocalUser = clientApp.registry.createModel('LocalUser', USER_PROPS, USER_OPTS);
    if (LocalUser.Change) LocalUser.Change.Checkpoint = ClientCheckpoint;
    clientApp.model(LocalUser, {dataSource: 'db'});

    LocalCar = clientApp.registry.createModel('LocalCar', CAR_PROPS, CAR_OPTS);
    LocalCar.Change.Checkpoint = ClientCheckpoint;
    clientApp.model(LocalCar, {dataSource: 'db'});

    let remoteOpts = createRemoteModelOpts(USER_OPTS);
    RemoteUser = clientApp.registry.createModel('RemoteUser', USER_PROPS, remoteOpts);
    clientApp.model(RemoteUser, {dataSource: 'remote'});

    remoteOpts = createRemoteModelOpts(CAR_OPTS);
    RemoteCar = clientApp.registry.createModel('RemoteCar', CAR_PROPS, remoteOpts);
    clientApp.model(RemoteCar, {dataSource: 'remote'});
  }

  function createRemoteModelOpts(modelOpts) {
    return extend(modelOpts, {
      // Disable change tracking, server will call rectify/rectifyAll
      // after each change, because it's tracking the changes too.
      trackChanges: false,
      // Enable remote replication in order to get remoting API metadata
      // used by the remoting connector
      enableRemoteReplication: true,
    });
  }

  function seedServerData(done) {
    async.series([
      function(next) {
        serverApp.dataSources.db.automigrate(next);
      },
      function(next) {
        ServerUser.create([ALICE, PETER, EMERY], function(err, created) {
          if (err) return next(err);

          aliceId = created[0].id;
          peterId = created[1].id;

          next();
        });
      },
      function(next) {
        ServerUser.login(ALICE, function(err, token) {
          if (err) return next(err);

          aliceToken = token.id;

          ServerUser.login(PETER, function(err, token) {
            if (err) return next(err);

            peterToken = token.id;

            ServerUser.login(EMERY, function(err, token) {
              emeryToken = token.id;

              next();
            });
          });
        });
      },
      function(next) {
        ServerCar.create(
          [
            {id: 'Ford-Mustang', maker: 'Ford', model: 'Mustang'},
            {id: 'Audi-R8', maker: 'Audi', model: 'R8'},
          ],
          function(err, cars) {
            if (err) return next(err);

            serverCars = cars.map(carToString);

            next();
          },
        );
      },
    ], done);
  }

  function seedClientData(done) {
    async.series([
      function(next) {
        clientApp.dataSources.db.automigrate(next);
      },
      function(next) {
        LocalCar.create(
          [{maker: 'Local', model: 'Custom'}],
          function(err, cars) {
            if (err) return next(err);

            clientCars = cars.map(carToString);

            next();
          },
        );
      },
    ], done);
  }

  async function seedConflict() {
    const server = await LocalCar.replicate(ServerCar)
    const { conflicts: serverConflicts } = server

    if (serverConflicts.length) return conflictError(serverConflicts)

    const local = await ServerCar.replicate(LocalCar)
    const { conflicts: localConflicts } = local

    if (localConflicts.length) return conflictError(localConflicts)

    // Hard-coded, see the seed data above
    conflictedCarId = 'Ford-Mustang';

    await new LocalCar({id: conflictedCarId})
        .updateAttributes({model: 'Client'})

    await new ServerCar({id: conflictedCarId})
      .updateAttributes({model: 'Server'})
  }

  function setAccessToken(token) {
    clientApp.dataSources.remote.connector.remotes.auth = {
      bearer: new Buffer(token).toString('base64'),
      sendImmediately: true,
    };
  }

  function expectHttpError(code, done) {
    return function(err) {
      if (!err) return done(new Error('The method should have failed.'));

      expect(err).to.have.property('statusCode', code);

      done();
    };
  }

  async function replicateServerToLocal() {
    const result = await ServerUser.replicate(LocalUser)
    const { conflicts } = result
    if (conflicts.length) return conflictError(conflicts)
  }

  function conflictError(conflicts) {
    const err = new Error('Unexpected conflicts\n' +
      conflicts.map(JSON.stringify).join('\n'));
    err.name = 'ConflictError';
  }

  function carToString(c) {
    return c.maker ? c.maker + ' ' + c.model : c.model;
  }
});
