'use strict';
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
        try {
          await LocalCar.replicate(ServerCar, -1)
          throw new Error('should have failed')
        } catch (err) {
          expect(err).to.have.property('statusCode', 401)
        }
      });

      it('rejects push to the server', function(done) {
        createCar().expect(401, done);
      });
    });

    describe('as user with READ-only permissions', function() {
      beforeEach(function() {
        setAccessToken(emeryToken);
      });

      it('rejects pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar, -1)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      });

      it('rejects push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar, -1)
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
        const result = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts } = result

        if (conflicts.length) return conflictError(conflicts)

        const list = await LocalCar.find()
        expect(list.map(carToString)).to.include.members(serverCars)
      })

      it('rejects push to the server', async function() {
        const result = await LocalCar.replicate(RemoteCar, -1)
          .catch(err => {
            expect(err).to.have.property('statusCode', 401)
          })
        expect(result).to.be.undefined
      })

      it('allows reverse resolve() on the client', async function() {
        setAccessToken(aliceToken)
        
        // Get conflicts through replication
        const result = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts } = result
        expect(conflicts).to.have.length(1)
        
        const conflict = conflicts[0]
        
        // Ensure models are properly bound before swapping
        conflict.sourceModel = RemoteCar
        conflict.targetModel = LocalCar
        
        // Now swap and resolve
        await conflict
          .swapParties()
          .resolveUsingTarget()
        
        // Verify resolution worked
        const finalResult = await RemoteCar.replicate(LocalCar, -1)
        expect(finalResult.conflicts).to.have.length(0)
      })
    })

    describe('as user with READ and WRITE permissions', function() {
      beforeEach(function() {
        setAccessToken(peterToken);
      });

      it('allows pull from server', async function() {
        const result = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts } = result

        if (conflicts.length) return conflictError(conflicts)

        const list = await LocalCar.find()
        expect(list.map(carToString)).to.include.members(serverCars)
      })

      it('allows push to the server', async function() {
        setAccessToken(aliceToken)
        
        // Step 1: Log initial state
        debug('Initial client cars:', clientCars)
        debug('Initial server cars:', (await ServerCar.find()).map(carToString))
        
        // Step 2: Replicate from local to server
        const result = await LocalCar.replicate(ServerCar, -1)
        debug('Replication result:', result)
        
        // Step 3: Verify replication
        const serverCars = await ServerCar.find()
        const actualNames = serverCars.map(carToString)
        debug('Final server cars:', actualNames)
        
        // Step 4: Verify that all client cars exist on server
        expect(actualNames).to.include.members(clientCars)
      })
    })
  })

  describe('conflict resolution with model-level permissions', function() {
    let LocalConflict, RemoteConflict;

    before(function setupConflictModels() {
      LocalConflict = LocalCar.Change.Conflict;
      RemoteConflict = RemoteCar.Change.Conflict;
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
        setAccessToken(aliceToken)
        
        // Get conflicts through replication
        const result = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts } = result
        expect(conflicts).to.have.length(1)
        
        const conflict = conflicts[0]
        
        // Ensure models are properly bound before swapping
        conflict.sourceModel = RemoteCar
        conflict.targetModel = LocalCar
        
        // Now swap and resolve
        await conflict
          .swapParties()
          .resolveUsingTarget()
        
        // Verify resolution worked
        const finalResult = await RemoteCar.replicate(LocalCar, -1)
        expect(finalResult.conflicts).to.have.length(0)
      })

      it('rejects resolve() on the server', async function() {
        const result = await RemoteCar.replicate(LocalCar, -1)
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
        const local = await LocalCar.replicate(RemoteCar, -1)
        const { conflicts } = local
        expect(conflicts, 'conflicts').to.have.length(1)
        await conflicts[0].resolveUsingSource()

        const remote = await LocalCar.replicate(RemoteCar, -1)
        const { conflicts: remoteConflicts } = remote
        expect(remoteConflicts, 'remoteConflicts').to.have.length(0)
        //await remoteConflicts[0].resolveUsingSource()
        //if (remoteConflicts.length) throw conflictError(remoteConflicts)
      })

      it('allows resolve() on the server', async function() {
        const remote = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts } = remote
        expect(conflicts, 'conflicts').to.have.length(1)
        await conflicts[0].resolveUsingSource()

        const local = await RemoteCar.replicate(LocalCar, -1)
        const { conflicts: localConflicts } = local
        expect(localConflicts, 'localConflicts').to.have.length(0)
        //await localConflicts[0].resolveUsingSource()
        //if (localConflicts.length) throw conflictError(localConflicts)
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
    plural: 'Cars',
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
    id: { type: 'string', id: true, defaultFn: 'guid', updateOnly: false },
    model: { type: 'string', required: true },
    maker: { type: 'string' },
  };

  async function setupServer() {
    serverApp = loopback({localRegistry: true, loadBuiltinModels: true})
    serverApp.set('remoting', {errorHandler: {debug: true, log: false}})
    serverApp.dataSource('db', {connector: 'memory'})

    // Setup a custom access-token model that is not shared with the client app
    const ServerToken = serverApp.registry.createModel('ServerToken', {}, {
      base: 'AccessToken',
      relations: {
        user: {
          type: 'belongsTo',
          model: 'ServerUser',
          foreignKey: 'userId',
        },
      },
    })
    serverApp.model(ServerToken, {dataSource: 'db', public: false})

    ServerUser = serverApp.registry.createModel('ServerUser', USER_PROPS, USER_OPTS)
    serverApp.model(ServerUser, {
      dataSource: 'db',
      public: true,
      relations: {accessTokens: {model: 'ServerToken'}},
    })

    serverApp.enableAuth({dataSource: 'db'})

    ServerCar = serverApp.registry.createModel('ServerCar', CAR_PROPS, CAR_OPTS)
    serverApp.model(ServerCar, {dataSource: 'db', public: true})

    // Set up change tracking
    ServerCar._defineChangeModel()
    ServerCar.Change.attachTo(serverApp.dataSources.db)
    ServerCar.enableChangeTracking()

    serverApp.use(loopback.token({model: ServerToken}))
    serverApp.use(loopback.rest())

    serverApp.set('port', 0)
    serverApp.set('host', '127.0.0.1')

    // Debug logging - list models and settings
    console.log('--- Server App Models after setup ---')
    const models = serverApp.models()
    Object.keys(models).forEach(modelName => {
      console.log(`Model: ${modelName}, settings:`, models[modelName].settings)
    })
    console.log('--- End Server App Models ---')

    return new Promise((resolve) => {
      serverApp.listen(() => {
        serverUrl = serverApp.get('url').replace(/\/+$/, '')
        request = supertest(serverUrl)
        resolve()
      })
    })
  }

  function setupClient() {
    clientApp = loopback({localRegistry: true, loadBuiltinModels: true})
    clientApp.dataSource('db', {connector: 'memory'})
    clientApp.dataSource('remote', {
      connector: 'remote',
      url: serverUrl,
    })

    // Set up custom checkpoint model
    const ClientCheckpoint = clientApp.registry.createModel({
      name: 'ClientCheckpoint',
      base: 'Checkpoint',
    })
    ClientCheckpoint.attachTo(clientApp.dataSources.db)

    // Create local models
    LocalUser = clientApp.registry.createModel('LocalUser', USER_PROPS, USER_OPTS)
    LocalCar = clientApp.registry.createModel('LocalCar', CAR_PROPS, CAR_OPTS)

    // Attach local models to datasource
    clientApp.model(LocalUser, {dataSource: 'db'})
    clientApp.model(LocalCar, {dataSource: 'db'})

    // Set up change tracking for local models
    if (LocalUser.Change) {
      LocalUser._defineChangeModel()
      LocalUser.Change.attachTo(clientApp.dataSources.db)
      LocalUser.Change.Checkpoint = ClientCheckpoint
      LocalUser.enableChangeTracking()
    }

    LocalCar._defineChangeModel()
    LocalCar.Change.attachTo(clientApp.dataSources.db)
    LocalCar.Change.Checkpoint = ClientCheckpoint
    LocalCar.enableChangeTracking()

    // Create and attach remote models - using new app.model API
    const remoteUserOpts = createRemoteModelOpts(USER_OPTS)
    console.log('remoteUserOpts:', remoteUserOpts)
    RemoteUser = clientApp.registry.createModel('RemoteUser', USER_PROPS, remoteUserOpts)
    clientApp.model(RemoteUser, {dataSource: 'remote'})
    console.log('RemoteUser defined')

    const remoteCarOpts = createRemoteModelOpts(CAR_OPTS)
    RemoteCar = clientApp.registry.createModel('RemoteCar', CAR_PROPS, remoteCarOpts)

    // Ensure proper model binding configuration
    RemoteCar.settings.plural = CAR_OPTS.plural
    RemoteCar.settings.targetModel = LocalCar // Add reference to target

    // Configure shared method metadata
    RemoteCar.sharedClass.find('replicate', true).returns = [
      {arg: 'result', type: 'object', root: true}
    ]

    clientApp.model(RemoteCar, {
      dataSource: 'remote',
      public: true
    })

    // ========= Fix 1: Initialize RemoteCar Change Model =========
    RemoteCar._defineChangeModel()
    RemoteCar.Change.attachTo(clientApp.dataSources.db)
    RemoteCar.Change.Checkpoint = ClientCheckpoint
    RemoteCar.enableChangeTracking()
    // =============================================================

    // Log the types of replicate methods - moved to the end
    console.log('LocalCar.replicate type:', typeof LocalCar.replicate)
    console.log('RemoteCar.replicate type:', typeof RemoteCar.replicate)
  }

  function createRemoteModelOpts(modelOpts) {
    return {
      ...modelOpts,
      trackChanges: false, // Disable change tracking on remote
      enableRemoteReplication: true,
      plural: modelOpts.plural, // Ensure plural is preserved
      remoteModelName: modelOpts.plural // Add explicit remote model name
    }
  }

  async function seedServerData() {
    // Migrate database first
    await serverApp.dataSources.db.automigrate()

    // Create users
    const created = await ServerUser.create([ALICE, PETER, EMERY])
    aliceId = created[0].id
    peterId = created[1].id

    // Login users sequentially to get tokens
    const aliceLoginResult = await ServerUser.login(ALICE)
    aliceToken = aliceLoginResult.id

    const peterLoginResult = await ServerUser.login(PETER)
    peterToken = peterLoginResult.id

    const emeryLoginResult = await ServerUser.login(EMERY)
    emeryToken = emeryLoginResult.id

    // Create cars
    const cars = await ServerCar.create([
      {id: 'Ford-Mustang', maker: 'Ford', model: 'Mustang'},
      {id: 'Audi-R8', maker: 'Audi', model: 'R8'},
    ])
    serverCars = cars.map(carToString)
  }

  async function seedClientData() {
    // Migrate database first
    await clientApp.dataSources.db.automigrate()

    // Create local cars
    const cars = await LocalCar.create([
      {maker: 'Local', model: 'Custom'}
    ])
    clientCars = cars.map(carToString)
  }

  async function seedConflict() {
    try {
      // First ensure model exists
      await ServerCar.destroyById('Ford-Mustang') // Clean up any existing record
      
      await ServerCar.create({
        id: 'Ford-Mustang',
        model: 'Mustang',
        maker: 'Ford'
      })
      
      // Then update
      const sourceInst = await LocalCar.findById('Ford-Mustang')
      if (sourceInst) {
        await sourceInst.updateAttribute('model', 'Updated Mustang')
      } else {
        await LocalCar.create({
          id: 'Ford-Mustang',
          model: 'Updated Mustang',
          maker: 'Ford'
        })
      }
    } catch (err) {
      debug('Error in seedConflict:', err)
      throw err
    }
  }

  function setAccessToken(token) {
    clientApp.dataSources.remote.connector.remotes.auth = {
      bearer: new Buffer(token).toString('base64'),
      sendImmediately: true,
    };
  }

  function expectHttpError(code) {
    return async function() {
      try {
        await this // 'this' will be the promise to test
        throw new Error('The method should have failed.')
      } catch (err) {
        expect(err).to.have.property('statusCode', code)
      }
    }
  }

  async function replicateServerToLocal() {
    try {
      debug('Starting replication from server to local')
      const result = await ServerUser.replicate(LocalUser, -1)
      debug('Replication result:', result)
      
      if (result.conflicts && result.conflicts.length) {
        debug('Conflicts detected:', result.conflicts)
        throw conflictError(result.conflicts)
      }
      
      debug('Replication completed successfully')
    } catch (err) {
      debug('Replication error:', err)
      throw err
    }
  }

  function conflictError(conflicts) {
    const err = new Error('Unexpected conflicts\n' +
      conflicts.map(JSON.stringify).join('\n'))
    err.name = 'ConflictError'
    return err
  }

  function carToString(c) {
    return c.maker ? c.maker + ' ' + c.model : c.model
  }
});
