// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const expect = require('./helpers/expect');
const loopback = require('../');
const path = require('path');
const request = require('supertest');
const errorHandler = require('strong-error-handler');

describe('loopback.rest', function() {
  this.timeout(10000);
  let app, MyModel;

  beforeEach(function() {
    // override the global app object provided by test/support.js
    // and create a local one that does not share state with other tests
    app = loopback({localRegistry: true, loadBuiltinModels: true})
    app.set('remoting', {
      rest: {
        handleErrors: false,
        normalizeHttpPath: false,
        xml: false
      },
      json: {strict: false, limit: '100kb'},
      urlencoded: {extended: true, limit: '100kb'},
      errorHandler: {debug: true, log: false}
    })
    const db = app.dataSource('db', {connector: 'memory'})
    MyModel = app.registry.createModel('MyModel')
    MyModel.attachTo(db)
  });

  it('works out-of-the-box', function(done) {
    app.model(MyModel);
    app.use(loopback.rest());
    request(app).get('/mymodels')
      .expect(200)
      .end(done);
  });

  it('should report 200 for DELETE /:id found', function(done) {
    app.model(MyModel);
    app.use(loopback.rest());
    MyModel.create({name: 'm1'}, function(err, inst) {
      request(app)
        .del('/mymodels/' + inst.id)
        .expect(200, function(err, res) {
          expect(res.body.count).to.equal(1);

          done();
        });
    });
  });

  it('should report 404 for GET /:id not found', function(done) {
    app.model(MyModel)
    app.use(loopback.rest())
    app.use(errorHandler({
      debug: true,
      log: false
    }))

    request(app).get('/mymodels/1')
      .set('Accept', 'application/json')
      .expect('Content-Type', /json/)
      .expect(404)
      .end(function(err, res) {
        if (err) return done(err)
        expect(res.body).to.be.an('object')
        expect(res.body.error).to.be.an('object')
        expect(res.body.error.statusCode).to.equal(404)
        expect(res.body.error.code).to.equal('MODEL_NOT_FOUND')
        expect(res.body.error.name).to.equal('Error')
        done()
      })
  });

  it('should report 404 for HEAD /:id not found', async function() {
    app.model(MyModel);
    app.use(loopback.rest());
    await request(app).head('/mymodels/1')
      .expect(404)
  })

  it('should report 200 for GET /:id/exists not found', async function() {
    app.model(MyModel);
    app.use(loopback.rest());
    const res = await request(app).get('/mymodels/1/exists')
    expect(res.body).to.eql({exists: false})
  })

  it('should report 200 for GET /:id found', async function() {
    app.model(MyModel);
    app.use(loopback.rest());
    const inst = await MyModel.create({name: 'm1'})
    await request(app).get('/mymodels/' + inst.id).expect(200)
  })

  it('should report 200 for HEAD /:id found', async function() {
    app.model(MyModel);
    app.use(loopback.rest());
    const inst = await MyModel.create({name: 'm2'})
    await request(app).head('/mymodels/' + inst.id).expect(200)
  })

  it('should report 200 for GET /:id/exists found', async function() {
    app.model(MyModel);
    app.use(loopback.rest());
    const inst = await MyModel.create({name: 'm3'})
    const res = await request(app).get('/mymodels/' + inst.id + '/exists')
    expect(res.body).to.eql({exists: true})
  })

  it('should honour `remoting.rest.supportedTypes`', async function() {
    const app = loopback({localRegistry: true});

    // NOTE it is crucial to set `remoting` before creating any models
    const supportedTypes = ['json', 'application/javascript', 'text/javascript'];
    app.set('remoting', {rest: {supportedTypes: supportedTypes}});

    app.model(MyModel);
    app.use(loopback.rest());

   await request(app).get('/mymodels')
      .set('Accept', 'text/html,application/xml;q= 0.9,*/*;q= 0.8')
      .expect('Content-Type', 'application/json; charset=utf-8')
      .expect(200)
  })

  it('allows models to provide a custom HTTP path', async function() {
    const CustomModel = app.registry.createModel('CustomModel',
      {name: String},
      {http: {'path': 'domain1/CustomModelPath'}});

    app.model(CustomModel, {dataSource: 'db'});
    app.use(loopback.rest());

    await request(app).get('/domain1/CustomModelPath').expect(200)
  })

  it('should report 200 for url-encoded HTTP path', async function() {
    const CustomModel = app.registry.createModel('CustomModel',
      {name: String},
      {http: {path: 'domain%20one/CustomModelPath'}});

    app.model(CustomModel, {dataSource: 'db'});
    app.use(loopback.rest());

    await request(app).get('/domain%20one/CustomModelPath').expect(200)
  })

  it('includes loopback.token when necessary', async function() {
    givenUserModelWithAuth();
    app.enableAuth({dataSource: 'db'});
    app.use(loopback.rest());

    const token = await givenLoggedInUser()
    expect(token).instanceOf(app.models.AccessToken);
    await request(app).get('/users/' + token.userId)
      .set('Authorization', token.id)
      .expect(200)
  })

  it('does not include loopback.token when auth not enabled', async function() {
    const User = givenUserModelWithAuth();
    User.getToken = async function(req) {
      return req.accessToken ? req.accessToken.id : null
    }

    loopback.remoteMethod(User.getToken, {
      accepts: [{type: 'object', http: {source: 'req'}}],
      returns: [{type: 'object', name: 'id'}],
    });

    app.use(loopback.rest());
    const token = await givenLoggedInUser()
    const res = await request(app).get('/users/getToken')
      .set('Authorization', token.id)
      .expect(200)

    expect(res.body.id).to.equal(null)
  })

  it('rebuilds REST endpoints after a model was added', async function() {
    app.use(loopback.rest())

    await request(app).get('/mymodels').expect(404)
    app.model(MyModel)
    await request(app).get('/mymodels').expect(200)
  })

  it('rebuilds REST endpoints after a model was deleted', async function() {
    app.model(MyModel)
    app.use(loopback.rest())

    await request(app).get('/mymodels').expect(200)
    app.deleteModelByName('MyModel')
    await request(app).get('/mymodels').expect(404)
  })

  it('rebuilds REST endpoints after a remoteMethod was added', async function() {
    app.model(MyModel)
    app.use(loopback.rest())

    await request(app).get('/mymodels/customMethod').expect(404)
    MyModel.customMethod = async function(req) {
      return true
    }
    MyModel.remoteMethod('customMethod', {
      http: {verb: 'get'},
      accepts: [{type: 'object', http: {source: 'req'}}],
      returns: [{type: 'boolean', name: 'success'}],
    })

    await request(app).get('/mymodels/customMethod').expect(200)
  })

  it('rebuilds REST endpoints after a remoteMethod was disabled', function(done) {
    app.model(MyModel)
    app.use(loopback.rest())

    MyModel.customMethod = function(req, cb) {
      cb(null, {success: true})
    }

    MyModel.remoteMethod('customMethod', {
      http: {verb: 'get', path: '/customMethod'},
      accepts: [{type: 'object', http: {source: 'req'}}],
      returns: {type: 'object', root: true}
    })

    // First request to ensure endpoint is available
    request(app)
      .get('/mymodels/customMethod')
      .expect(200)
      .end(function(err) {
        if (err) return done(err)

        // Disable the method
        MyModel.disableRemoteMethodByName('customMethod')

        // Give the app time to rebuild endpoints
        setTimeout(function() {
          // Second request should fail with 404
          request(app)
            .get('/mymodels/customMethod')
            .expect(404, done)
        }, 100)
      })
  });

  function givenUserModelWithAuth() {
    const AccessToken = app.registry.getModel('AccessToken');
    app.model(AccessToken, {dataSource: 'db'});
    const User = app.registry.getModel('User');
    // Speed up the password hashing algorithm for tests
    User.settings.saltWorkFactor = 4;
    app.model(User, {dataSource: 'db'});

    // NOTE(bajtos) This is puzzling to me. The built-in User & AccessToken
    // models should come with both relations already set up, i.e. the
    // following two lines should not be neccessary.
    // And it does behave that way when only tests in this file are run.
    // However, when I run the full test suite (all files), the relations
    // get broken.
    AccessToken.belongsTo(User, {as: 'user', foreignKey: 'userId'});
    User.hasMany(AccessToken, {as: 'accessTokens', foreignKey: 'userId'});

    return User;
  }

  async function givenLoggedInUser() {
    const credentials = {email: 'user@example.com', password: 'pwd'};
    const { User } = app.models
    await User.create(credentials)
    const token = await User.login(credentials)
    return token
  }

  describe('shared methods', function() {
    function getFixturePath(dirName) {
      return path.join(__dirname, 'fixtures/shared-methods/' + dirName +
          '/server/server.js');
    }

    describe('with specific definitions in model-config.json', function() {
      it('should not be exposed when the definition value is false',
        function(done) {
          const app = require(getFixturePath('model-config-defined-false'));
          request(app)
            .get('/todos')
            .expect(404, done);
        });

      it('should be exposed when the definition value is true', function(done) {
        const app = require(getFixturePath('model-config-defined-true'));
        request(app)
          .get('/todos')
          .expect(200, done);
      });
    });

    describe('with default definitions in model-config.json', function() {
      it('should not be exposed when the definition value is false',
        function(done) {
          const app = require(getFixturePath('model-config-default-false'));
          request(app)
            .get('/todos')
            .expect(404, done);
        });

      it('should be exposed when the definition value is true', function(done) {
        const app = require(getFixturePath('model-config-default-true'));

        // Create records via HTTP requests instead of direct model access
        // This works around the issue where app.models.Todo is undefined
        const createRequests = [
          request(app).post('/todos').send({content: 'a'}),
          request(app).post('/todos').send({content: 'b'}),
          request(app).post('/todos').send({content: 'c'})
        ];

        Promise.all(createRequests.map(req => new Promise((resolve, reject) => {
          req.expect(200).end((err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        }))).then(() => {
          request(app)
            .del('/todos')
            .expect(200)
            .end(function(err, res) {
              if (err) return done(err);

              expect(res.body.count).to.equal(3);

              done();
            });
        }).catch(done);
      });
    });

    describe('with specific definitions in config.json', function() {
      it('should not be exposed when the definition value is false',
        function(done) {
          const app = require(getFixturePath('config-defined-false'));
          request(app)
            .get('/todos')
            .expect(404, done);
        });

      it('should be exposed when the definition value is true',
        function(done) {
          const app = require(getFixturePath('config-defined-true'));
          request(app)
            .get('/todos')
            .expect(200, done);
        });
    });

    describe('with default definitions in config.json', function() {
      it('should not be exposed when the definition value is false',
        function(done) {
          const app = require(getFixturePath('config-default-false'));
          request(app)
            .get('/todos')
            .expect(404, done);
        });

      it('should be exposed when the definition value is true', function(done) {
        const app = require(getFixturePath('config-default-true'));

        // Create records via HTTP requests instead of direct model access
        // This works around the issue where app.models.Todo is undefined
        const createRequests = [
          request(app).post('/todos').send({content: 'a'}),
          request(app).post('/todos').send({content: 'b'}),
          request(app).post('/todos').send({content: 'c'})
        ];

        Promise.all(createRequests.map(req => new Promise((resolve, reject) => {
          req.expect(200).end((err, res) => {
            if (err) reject(err);
            else resolve(res);
          });
        }))).then(() => {
          request(app)
            .del('/todos')
            .expect(200)
            .end(function(err, res) {
              if (err) return done(err);

              expect(res.body.count).to.equal(3);

              done();
            });
        }).catch(done);
      });
    });

    // The fixture in `shared-method/both-configs-set/config.json` has `*:false`
    // set which disables the REST endpoints for built-in models such as User as
    // a side effect since tests share the same loopback instance. As a
    // consequence, this causes the tests in user.integration to fail.
    describe.skip('with definitions in both config.json and model-config.json',
      function() {
        it('should prioritize the settings in model-config.json', function(done) {
          const app = require(getFixturePath('both-configs-set'));
          request(app)
            .del('/todos')
            .expect(404, done);
        });

        it('should fall back to config.json settings if setting is not found in' +
          'model-config.json', function(done) {
          const app = require(getFixturePath('both-configs-set'));
          request(app)
            .get('/todos')
            .expect(404, done);
        });
      });
  });
});
