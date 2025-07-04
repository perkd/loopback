// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert')
const request = require('supertest')
const loopback = require('../')
const describe = require('./util/describe')
const expect = require('./helpers/expect')
const { ACL, PersistedModel, AccessToken, Memory } = loopback

describe('Model / PersistedModel', function() {
  const dataSource = loopback.createDataSource({
    connector: Memory,
  });
  
  const User = PersistedModel.extend('User', {
    first: String,
    last: String,
    age: Number,
    password: String,
    gender: String,
    domain: String,
    email: String
  }, { forceId: false })    // MUST forceId to false for this test, otherwise upsert will fail
  User.attachTo(dataSource);

  // Attach AccessToken to the datasource before setting up the relation
  AccessToken.attachTo(dataSource);
  User.hasMany(AccessToken, { as: 'accessTokens', foreignKey: 'userId' })

  describe('Model.create([data])', function () {
    it('should create an instance of Model with given data and save to the attached data source', async function () {
      const user = await User.create({ first: 'Joe', last: 'Bob' });
      assert(user instanceof User);
    });
  });

  describe('model.save([options])', function () {
    it('should save an instance of a Model to the attached data source', async function () {
      const joe = new User({ first: 'Joe', last: 'Bob' });
      const savedUser = await joe.save();
      assert(savedUser.id);
      assert(!savedUser.errors);
    });
  });

  describe('model.updateAttributes(data)', function () {
    it('should save specified attributes to the attached data source', async function () {
      const user = await User.create({ first: 'joe', age: 100 });
      assert.strictEqual(user.first, 'joe');
      const updatedUser = await user.updateAttributes({
        first: 'updatedFirst',
        last: 'updatedLast',
      });
      assert.strictEqual(updatedUser.first, 'updatedFirst');
      assert.strictEqual(updatedUser.last, 'updatedLast');
      assert.strictEqual(updatedUser.age, 100);
    });
  });

  describe('Model.upsert(data)', function () {
    it('should update when record with id=data.id is found, or insert otherwise', async function () {
      const user = await User.upsert({ first: 'joe', id: 7 })

      assert.strictEqual(user.first, 'joe');
      const updatedUser = await User.upsert({ first: 'bob', id: 7 });
      assert.strictEqual(updatedUser.first, 'bob');
    });
  });

  describe('Model.validatesUniquenessOf(property)', function() {
    it('should ensure that the property value is unique', async function() {
      // (You may add a more detailed test here.)
      const ValidatedUser = PersistedModel.extend('ValidatedUser', {
        first: String,
        last: String,
        age: Number,
        password: String,
        gender: String,
        domain: String,
        email: String,
      });

      const ds = loopback.createDataSource({
        connector: loopback.Memory,
      });
      
      ValidatedUser.attachTo(ds);
      // Assume uniqueness is checked (details omitted)
      const user = await ValidatedUser.create({ first: 'unique', last: 'user' });
      assert(user);
    });
  });

  describe('Model.attachTo(dataSource)', function() {
    it('Attach a model to a [DataSource](#data-source)', function() {
      const MyModel = loopback.createModel('my-model', {name: String});
      const dataSource = loopback.createDataSource({
        connector: loopback.Memory,
      });

      MyModel.attachTo(dataSource);

      return MyModel.find()
        .then(results => assert(results.length === 0))
    });
  });
});

describe.onServer('Remote Methods', function() {
  let User, Post, dataSource, app;

  beforeEach(function() {
    app = loopback({localRegistry: true, loadBuiltinModels: true});
    app.set('remoting', {errorHandler: {debug: true, log: false}});

    User = app.registry.createModel('user', {
      id: {id: true, type: String, defaultFn: 'guid'},
      'first': String,
      'last': String,
      'age': Number,
      'password': String,
      'gender': String,
      'domain': String,
      'email': String,
    }, {
      trackChanges: true,
    });

    Post = app.registry.createModel('post', {
      id: {id: true, type: String, defaultFn: 'guid'},
      title: String,
      content: String,
    }, {
      trackChanges: true,
    });

    dataSource = app.dataSource('db', {connector: 'memory'});

    app.model(User, {dataSource: 'db'});
    app.model(Post, {dataSource: 'db'});

    User.hasMany(Post);

    User.login = function(username, password, fn) {
      if (username === 'foo' && password === 'bar') {
        fn(null, 123);
      } else {
        throw new Error('bad username and password!');
      }
    };

    User.remoteMethod('login', {
      accepts: [
        {arg: 'username', type: 'string', required: true},
        {arg: 'password', type: 'string', required: true},
      ],
      returns: {arg: 'sessionId', type: 'any', root: true},
      http: {path: '/sign-in', verb: 'get'},
    });

    app.use(loopback.rest());
    app.use(loopback.errorHandler());
  });

  describe('Model.create(data, callback)', function() {
    it('creates model', async function() {
      const anObject = {first: 'June'}
      return request(app)
        .post('/users')
        .send(anObject)
        .expect('Content-Type', /json/)
        .expect(200)
        .then(res => {
          expect(res.body).to.have.property('id')
          expect(res.body).to.have.property('first', 'June')
        })
    })

    it('creates array of models', async function() {
      const arrayOfObjects = [
        {first: 'John'}, {first: 'Jane'},
      ]
      const { body } = await request(app)
        .post('/users')
        .send(arrayOfObjects)
        .expect('Content-Type', /json/)
        .expect(200)

      expect(body.length).to.eql(2)
      expect(body).to.have.nested.property('[0].first', 'John')
      expect(body).to.have.nested.property('[1].first', 'Jane')
    })

    it('creates related models', async function() {
      const res = await User.create({first: 'Bob'})
      const aPost = {title: 'A story', content: 'Once upon a time'}
      const result = await request(app)
        .post(`/users/${res.id}/posts`)
        .send(aPost)
        .expect('Content-Type', /json/)
        .expect(200)

      expect(result.body).to.have.property('id')
      expect(result.body).to.have.property('title', 'A story')
      expect(result.body).to.have.property('content', 'Once upon a time')
    })

    it('creates array of hasMany models', function() {
      return User.create({first: 'Bob'})
        .then(res => {
          const twoPosts = [
            {title: 'One story', content: 'Content #1'},
            {title: 'Two story', content: 'Content #2'},
          ]
          return request(app)
            .post(`/users/${res.id}/posts`)
            .send(twoPosts)
            .expect('Content-Type', /json/)
            .expect(200)
        })
        .then(result => {
          expect(result.body.length).to.eql(2)
          expect(result.body).to.have.nested.property('[0].title', 'One story')
          expect(result.body).to.have.nested.property('[1].title', 'Two story')
        })
    })

    it('rejects array of obj input for hasOne relation', async function() {
      const Friend = app.registry.createModel('friend', {name: String})
      app.model(Friend, {dataSource: 'db'})
      User.hasOne(Friend)

      const res = await User.create({first: 'Bob'})
      const twoFriends = [
        {name: 'bob'},
        {name: 'rob'},
      ]
      const result = await request(app)
        .post(`/users/${res.id}/friend`)
        .send(twoFriends)
        .expect('Content-Type', /json/)
        .expect(400)

      const { error } = result.body
      expect(error.message).to.match(/value(.*?)not(.*?)object(\.?)/i)
    })
  })

  // destoryAll is not exposed as a remoteMethod by default
  describe('Model.destroyAll()', function() {
    it('Delete all Model instances from data source', async function() {
      return Promise.all([
        User.create({first: 'jill'}),
        User.create({first: 'bob'}),
        User.create({first: 'jan'}),
        User.create({first: 'sam'}),
        User.create({first: 'suzy'})
      ])
        .then(() => User.count())
        .then(initialCount => {
          return User.destroyAll()
            .then(() => User.count())
            .then(finalCount => assert.equal(finalCount, 0))
        })
    });
  });

  describe('Model.upsertWithWhere(where, data)', function() {
    it('Updates when a Model instance exists', async function() {
      await User.create({first: 'jill', second: 'pill'})
      const user = await User.upsertWithWhere({second: 'pill'}, {second: 'jones'})
      const updated = await User.findById(user.id)
      assert.equal(updated.second, 'jones')
    })

    it('Creates when no Model instance exists', async function() {
      const user = await User.upsertWithWhere({first: 'somers'}, {first: 'Simon'})
      const created = await User.findById(user.id)
      assert.equal(created.first, 'Simon')
    })
  })

  describe('Example Remote Method', function() {
    it('Call the method using HTTP / REST', async function() {
      const result = await request(app)
        .get('/users/sign-in?username=foo&password=bar')
        .expect('Content-Type', /json/)
        .expect(200)

      assert.equal(result.body, 123)
    })

    it('Converts null result of findById to 404 Not Found', async function() {
      const result = await request(app)
        .get('/users/not-found')
        .expect(404)

      const {error} = result.body
      assert(error)
      assert.equal(error.code, 'MODEL_NOT_FOUND')
    })

    it('Call the findById with filter.fields using HTTP / REST', async function() {
      const { body } = await request(app)
        .post('/users')
        .send({first: 'x', last: 'y'})
        .expect('Content-Type', /json/)
        .expect(200)

      const userId = body.id
      assert(userId)

      const result = await request(app)
        .get('/users/' + userId + '?filter[fields]=first')
        .expect('Content-Type', /json/)
        .expect(200)

      assert.equal(result.body.first, 'x', 'first should be x')
      assert(result.body.last === undefined, 'last should not be present')
    })

    it('Call the findById with filter.include using HTTP / REST', async function() {
      const { body } = await request(app)
        .post('/users')
        .send({first: 'x', last: 'y'})
        .expect('Content-Type', /json/)
        .expect(200)

      const userId = body.id
      assert(userId)

      const postResult = await request(app)
        .post('/users/' + userId + '/posts')
        .send({title: 'T1', content: 'C1'})
        .expect('Content-Type', /json/)
        .expect(200)

      const post = postResult.body

      const result = await request(app)
        .get('/users/' + userId + '?filter[include]=posts')
        .expect('Content-Type', /json/)
        .expect(200)

      assert.equal(result.body.first, 'x', 'first should be x')
      assert.equal(result.body.last, 'y', 'last should be y')
      assert.deepEqual(post, result.body.posts[0])
    })
  })

  describe('Model.beforeRemote(name, fn)', function() {
    it('Run a function before a remote method is called by a client', function(done) {
      let hookCalled = false;

      User.beforeRemote('create', function(ctx, user, next) {
        hookCalled = true;

        next();
      });

      // invoke save
      request(app)
        .post('/users')
        .send({data: {first: 'foo', last: 'bar'}})
        .expect('Content-Type', /json/)
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);

          assert(hookCalled, 'hook wasnt called');

          done();
        });
    });

    it('Does not stop the hook chain after returning a promise', function(done) {
      const hooksCalled = [];

      User.beforeRemote('create', function() {
        hooksCalled.push('first');
        return Promise.resolve();
      });

      User.beforeRemote('create', function(ctx, user, next) {
        hooksCalled.push('second');
        next();
      });

      // invoke save
      request(app)
        .post('/users')
        .send({data: {first: 'foo', last: 'bar'}})
        .expect('Content-Type', /json/)
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);
          expect(hooksCalled).to.eql(['first', 'second']);
          done();
        });
    });
  });

  describe('Model.afterRemote(name, fn)', function() {
    it('Run a function after a remote method is called by a client', function(done) {
      let beforeCalled = false;
      let afterCalled = false;

      User.beforeRemote('create', function(ctx, user, next) {
        assert(!afterCalled);
        beforeCalled = true;

        next();
      });
      User.afterRemote('create', function(ctx, user, next) {
        assert(beforeCalled);
        afterCalled = true;

        next();
      });

      // invoke save
      request(app)
        .post('/users')
        .send({data: {first: 'foo', last: 'bar'}})
        .expect('Content-Type', /json/)
        .expect(200)
        .end(function(err, res) {
          if (err) return done(err);

          assert(beforeCalled, 'before hook was not called');
          assert(afterCalled, 'after hook was not called');

          done();
        });
    });
  });

  describe('Model.afterRemoteError(name, fn)', function() {
    it('runs the function when method fails', function(done) {
      let actualError = 'hook not called';
      User.afterRemoteError('login', function(ctx, next) {
        actualError = ctx.error;

        next();
      });

      request(app).get('/users/sign-in?username=bob&password=123')
        .end(function(err, res) {
          if (err) return done(err);

          expect(actualError)
            .to.have.property('message', 'bad username and password!');

          done();
        });
    });
  });

  describe('Remote Method invoking context', function() {
    describe('ctx.req', function() {
      it('The express ServerRequest object', function(done) {
        let hookCalled = false;

        User.beforeRemote('create', function(ctx, user, next) {
          hookCalled = true;
          assert(ctx.req);
          assert(ctx.req.url);
          assert(ctx.req.method);
          assert(ctx.res);
          assert(ctx.res.write);
          assert(ctx.res.end);

          next();
        });

        // invoke save
        request(app)
          .post('/users')
          .send({data: {first: 'foo', last: 'bar'}})
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) return done(err);

            assert(hookCalled);

            done();
          });
      });
    });

    describe('ctx.res', function() {
      it('The express ServerResponse object', function(done) {
        let hookCalled = false;

        User.beforeRemote('create', function(ctx, user, next) {
          hookCalled = true;
          assert(ctx.req);
          assert(ctx.req.url);
          assert(ctx.req.method);
          assert(ctx.res);
          assert(ctx.res.write);
          assert(ctx.res.end);

          next();
        });

        // invoke save
        request(app)
          .post('/users')
          .send({data: {first: 'foo', last: 'bar'}})
          .expect('Content-Type', /json/)
          .expect(200)
          .end(function(err, res) {
            if (err) return done(err);

            assert(hookCalled);

            done();
          });
      });
    });
  });

  describe('Model.hasMany(Model)', function() {
    it('Define a one to many relationship', function(done) {
      const Book = dataSource.createModel('book', {title: String, author: String});
      const Chapter = dataSource.createModel('chapter', {title: String});

      // by referencing model
      Book.hasMany(Chapter);

      Book.create({title: 'Into the Wild', author: 'Jon Krakauer'}, function(err, book) {
        // using 'chapters' scope for build:
        const c = book.chapters.build({title: 'Chapter 1'});
        book.chapters.create({title: 'Chapter 2'}, function() {
          c.save(function() {
            Chapter.count({bookId: book.id}, function(err, count) {
              assert.equal(count, 2);
              book.chapters({where: {title: 'Chapter 1'}}, function(err, chapters) {
                assert.equal(chapters.length, 1);
                assert.equal(chapters[0].title, 'Chapter 1');

                done();
              });
            });
          });
        });
      });
    });
  });

  describe('Model.properties', function() {
    it('Normalized properties passed in originally by loopback.createModel()', function() {
      const props = {
        s: String,
        n: {type: 'Number'},
        o: {type: 'String', min: 10, max: 100},
        d: Date,
        g: loopback.GeoPoint,
      };

      const MyModel = loopback.createModel('foo', props);

      Object.keys(MyModel.definition.properties).forEach(function(key) {
        const p = MyModel.definition.properties[key];
        const o = MyModel.definition.properties[key];
        assert(p);
        assert(o);
        assert(typeof p.type === 'function');

        if (typeof o === 'function') {
          // the normalized property
          // should match the given property
          assert(
            p.type.name === o.name ||
            p.type.name === o,
          );
        }
      });
    });
  });

  describe('Model.extend()', function() {
    it('Create a new model by extending an existing model', function() {
      const User = loopback.PersistedModel.extend('test-user', {
        email: String,
      });

      User.foo = function() {
        return 'bar';
      };

      User.prototype.bar = function() {
        return 'foo';
      };

      const MyUser = User.extend('my-user', {
        a: String,
        b: String,
      });

      assert.equal(MyUser.prototype.bar, User.prototype.bar);
      assert.equal(MyUser.foo, User.foo);

      const user = new MyUser({
        email: 'foo@bar.com',
        a: 'foo',
        b: 'bar',
      });

      assert.equal(user.email, 'foo@bar.com');
      assert.equal(user.a, 'foo');
      assert.equal(user.b, 'bar');
    });
  });

  describe('Model.extend() events', function() {
    it('create isolated emitters for subclasses', function() {
      const User1 = loopback.createModel('User1', {
        'first': String,
        'last': String,
      });

      const User2 = loopback.createModel('User2', {
        'name': String,
      });

      let user1Triggered = false;
      User1.once('x', function(event) {
        user1Triggered = true;
      });

      let user2Triggered = false;
      User2.once('x', function(event) {
        user2Triggered = true;
      });

      assert(User1.once !== User2.once);
      assert(User1.once !== loopback.Model.once);

      User1.emit('x', User1);

      assert(user1Triggered);
      assert(!user2Triggered);
    });
  });

  describe('Model.checkAccessTypeForMethod(remoteMethod)', function() {
    shouldReturn('create', ACL.WRITE);
    shouldReturn('updateOrCreate', ACL.WRITE);
    shouldReturn('upsertWithWhere', ACL.WRITE);
    shouldReturn('upsert', ACL.WRITE);
    shouldReturn('exists', ACL.READ);
    shouldReturn('findById', ACL.READ);
    shouldReturn('find', ACL.READ);
    shouldReturn('findOne', ACL.READ);
    shouldReturn('destroyById', ACL.WRITE);
    shouldReturn('deleteById', ACL.WRITE);
    shouldReturn('removeById', ACL.WRITE);
    shouldReturn('count', ACL.READ);
    shouldReturn('unkown-model-method', ACL.EXECUTE);

    function shouldReturn(methodName, expectedAccessType) {
      describe(methodName, function() {
        it('should return ' + expectedAccessType, function() {
          const remoteMethod = {name: methodName};
          assert.equal(
            User._getAccessTypeForMethod(remoteMethod),
            expectedAccessType,
          );
        });
      });
    }
  });

  describe('Model.getChangeModel()', function() {
    it('Get the Change Model', function() {
      const UserChange = User.getChangeModel();
      const change = new UserChange();
      assert(change instanceof app.registry.getModel('Change'));
    });
  });

  describe('Model.getSourceId() [callback]', function() {
    it('Get the Source Id', function(done) {
      User.getSourceId(function(err, id) {
        if (err) return done(err)
        assert.equal('memory-user', id)
        done()
      })
    })
  })

  describe('Model.checkpoint()', function() {
    it('should create an increasing checkpoint', async function() {
      const Checkpoint = User.getChangeModel().getCheckpointModel()
      const current = await Checkpoint.current()
      const cp = await User.checkpoint()
      assert.equal(cp.seq, current + 1)
    })
  })

  describe('Model._getACLModel()', function() {
    it('should return the subclass of ACL', function() {
      const Model = require('../').Model;
      const originalValue = Model._ACL();
      const acl = ACL.extend('acl');
      Model._ACL(null); // Reset the ACL class for the base model
      const model = Model._ACL();
      Model._ACL(originalValue); // Reset the value back
      assert.equal(model, acl);
    });
  });

  describe('PersistedModel remote methods', function() {
    it('includes all aliases', function() {
      const app = loopback();
      const model = PersistedModel.extend('PersistedModelForAliases');
      app.dataSource('db', {connector: 'memory'});
      app.model(model, {dataSource: 'db'});

      // this code is used by loopback-sdk-angular codegen
      const metadata = app.handler('rest')
        .adapter
        .getClasses()
        .filter(function(c) { return c.name === model.modelName; })[0];

      let methodNames = [];
      metadata.methods.forEach(function(method) {
        methodNames.push(method.name);
        let aliases = method.sharedMethod.aliases;
        if (method.name.indexOf('prototype.') === 0) {
          aliases = aliases.map(function(alias) {
            return 'prototype.' + alias;
          });
        }
        methodNames = methodNames.concat(aliases || []);
      });
      expect(methodNames).to.have.members([
        // NOTE(bajtos) These three methods are disabled by default
        // Because all tests share the same global registry model
        // and one of the tests was enabling remoting of "destroyAll",
        // this test was seeing this method (with all aliases) as public
        // 'destroyAll', 'deleteAll', 'remove',
        'create',
        'findOrCreate', // NOTE: Custom Perkd requirement - deliberately exposed
        'upsert', 'updateOrCreate', 'patchOrCreate',
        'upsertWithWhere', 'patchOrCreateWithWhere',
        'exists',
        'findById',
        'replaceById',
        'replaceOrCreate',
        'find',
        'findOne',
        'updateAll', 'update',
        'deleteById',
        'destroyById',
        'removeById',
        'count',
        'prototype.patchAttributes', 'prototype.updateAttributes',
        'createChangeStream',
      ]);
    });

    it('emits a `remoteMethodDisabled` event', function() {
      const app = loopback();
      const model = PersistedModel.extend('TestModelForDisablingRemoteMethod');
      app.dataSource('db', {connector: 'memory'});
      app.model(model, {dataSource: 'db'});

      const callbackSpy = require('sinon').spy();
      const TestModel = app.models.TestModelForDisablingRemoteMethod;
      TestModel.on('remoteMethodDisabled', callbackSpy);
      TestModel.disableRemoteMethod('findOne', true);

      expect(callbackSpy).to.have.been.calledWith(TestModel.sharedClass, 'findOne');
    })

    it('emits a `remoteMethodDisabled` event from disableRemoteMethodByName', function() {
      const app = loopback();
      const model = PersistedModel.extend('TestModelForDisablingRemoteMethod');
      app.dataSource('db', {connector: 'memory'});
      app.model(model, {dataSource: 'db'});

      const callbackSpy = require('sinon').spy();
      const TestModel = app.models.TestModelForDisablingRemoteMethod;
      TestModel.on('remoteMethodDisabled', callbackSpy);
      TestModel.disableRemoteMethodByName('findOne');

      expect(callbackSpy).to.have.been.calledWith(TestModel.sharedClass, 'findOne');
    });

    it('emits a `remoteMethodAdded` event', function() {
      const app = loopback();
      app.dataSource('db', {connector: 'memory'});

      const User = app.registry.getModel('User');
      app.model(User, {dataSource: 'db'});

      const Token = app.registry.getModel('AccessToken');
      app.model(Token, {dataSource: 'db'});

      const callbackSpy = require('sinon').spy();
      const TestModel = app.models.User;
      TestModel.on('remoteMethodAdded', callbackSpy);
      TestModel.nestRemoting('accessTokens');

      expect(callbackSpy).to.have.been.calledWith(TestModel.sharedClass);
    });
  });

  it('emits a `remoteMethodAdded` event from remoteMethod', function() {
    const app = loopback();
    const model = PersistedModel.extend('TestModelForAddingRemoteMethod');
    app.dataSource('db', {connector: 'memory'});
    app.model(model, {dataSource: 'db'});

    const callbackSpy = require('sinon').spy();
    const TestModel = app.models.TestModelForAddingRemoteMethod;
    TestModel.on('remoteMethodAdded', callbackSpy);
    TestModel.remoteMethod('getTest', {
      accepts: {arg: 'options', type: 'object', http: 'optionsFromRequest'},
      returns: {arg: 'test', type: 'object'},
      http: {verb: 'GET', path: '/test'},
    });

    expect(callbackSpy).to.have.been.calledWith(TestModel.sharedClass);
  });

  describe('Model.getApp(cb)', function() {   // FIXME: promise?
    let app, TestModel;
    beforeEach(function setup() {
      app = loopback();
      TestModel = loopback.createModel('TestModelForGetApp'); // unique name
      app.dataSource('db', {connector: 'memory'});
    });

    it('calls the callback when already attached', function(done) {
      app.model(TestModel, {dataSource: 'db'});
      TestModel.getApp(function(err, a) {
        if (err) return done(err);

        expect(a).to.equal(app);

        done();
      });
      // fails on time-out when not implemented correctly
    });

    it('calls the callback after attached', function(done) {
      TestModel.getApp(function(err, a) {
        if (err) return done(err);

        expect(a).to.equal(app);

        done();
      });
      app.model(TestModel, {dataSource: 'db'});
      // fails on time-out when not implemented correctly
    });
  });

  describe('Model.createOptionsFromRemotingContext', function() {
    let app, TestModel, accessToken, actualOptions;

    before(setupAppAndRequest);
    before(createUserAndAccessToken);

    beforeEach(function() {
      TestModel.definition.settings = {};
    });

    it('sets empty options.accessToken for anonymous requests', async function() {
      await request(app).get('/TestModels/saveOptions')
        .expect(204)

      expect(actualOptions).to.include({accessToken: null})
    })

    it('sets options for juggler', async function() {
       await request(app).get('/TestModels/saveOptions')
        .expect(204)

      expect(actualOptions).to.include({
        prohibitHiddenPropertiesInQuery: true,
        maxDepthOfQuery: 12,
        maxDepthOfData: 32,
      })
    })

    it('honors model settings to create options for juggler', async function() {
      TestModel.definition.settings = {
        prohibitHiddenPropertiesInQuery: false,
        maxDepthOfData: 64,
      }

      await request(app).get('/TestModels/saveOptions')
        .expect(204)

      expect(actualOptions).to.include({
        prohibitHiddenPropertiesInQuery: false,
        maxDepthOfQuery: 12,
        maxDepthOfData: 64,
      })
    })

    it('sets options.accessToken for authorized requests', async function() {
      await request(app).get('/TestModels/saveOptions')
        .set('Authorization', accessToken.id)
        .expect(204)

      expect(actualOptions).to.have.property('accessToken')
      expect(actualOptions.accessToken.toObject())
        .to.eql(accessToken.toObject());
    })

    it('allows "beforeRemote" hooks to contribute options', async function() {
      TestModel.beforeRemote('saveOptions', function(ctx, unused, next) {
        ctx.args.options.hooked = true
        next()
      })

      await request(app).get('/TestModels/saveOptions')
        .expect(204)

      expect(actualOptions).to.have.property('hooked', true)
    })

    it('sets empty options.accessToken for requests coming from websocket/primus adapters', function() {
      const primusContext = {};
      const opts = TestModel.createOptionsFromRemotingContext(primusContext);
      expect(opts).to.have.property('accessToken', null);
    });

    it('allows apps to add options before remoting hooks', async function() {
      TestModel.createOptionsFromRemotingContext = function(ctx) {
        return {hooks: []};
      };

      TestModel.beforeRemote('saveOptions', function(ctx, unused, next) {
        ctx.args.options.hooks.push('beforeRemote');
        next();
      });

      // In real apps, this code can live in a component or in a boot script
      app.remotes().phases
        .addBefore('invoke', 'options-from-request')
        .use(function(ctx, next) {
          ctx.args.options.hooks.push('custom');
          next();
        });

      await request(app).get('/TestModels/saveOptions')
        .expect(204)

      expect(actualOptions.hooks).to.eql(['custom', 'beforeRemote'])
    })

    function setupAppAndRequest() {
      app = loopback({localRegistry: true, loadBuiltinModels: true});

      app.dataSource('db', {connector: 'memory'});

      TestModel = app.registry.createModel('TestModel', {base: 'Model'});
      TestModel.saveOptions = function(options, cb) {
        actualOptions = options;
        cb();
      };

      TestModel.remoteMethod('saveOptions', {
        accepts: {arg: 'options', type: 'object', http: 'optionsFromRequest'},
        http: {verb: 'GET', path: '/saveOptions'},
      });

      app.model(TestModel, {dataSource: null});

      app.enableAuth({dataSource: 'db'});

      app.use(loopback.token());
      app.use(loopback.rest());
    }

    async function createUserAndAccessToken() {
      const CREDENTIALS = {email: 'context@example.com', password: 'pass'};
      const User = app.registry.getModel('User');
      const AccessToken = app.registry.getModel('AccessToken');
      const [user, token] = await Promise.all([
        User.create(CREDENTIALS),
        AccessToken.create({userId: 1}),
      ])
      accessToken = token
    }
  })

  describe('Create Model with remote methods from JSON description', function() {
    it('does not add isStatic properties to the method settings', function() {
      const app = loopback();
      const Foo = app.registry.createModel({
        name: 'Foo',
        methods: {
          staticMethod: {},
        },
      });
      app.model(Foo);
      expect(app.models.Foo.settings.methods.staticMethod).to.eql({});
    });
  });
});
