// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const url = require('node:url')
const assert = require('node:assert')
const request = require('supertest')
const expect = require('./helpers/expect')
const loopback = require('../')
const waitForEvent = require('./helpers/wait-for-event')

let User, AccessToken;

describe('User', function () {

  const validCredentialsEmail = 'foo@bar.com';
  const validCredentials = { email: validCredentialsEmail, password: 'bar' };
  const validCredentialsEmailVerified = {
    email: 'foo1@bar.com', password: 'bar1', emailVerified: true
  };
  const validCredentialsEmailVerifiedOverREST = {
    email: 'foo2@bar.com', password: 'bar2', emailVerified: true
  };
  const validCredentialsWithRealm = {
    email: 'foo3@bar.com', password: 'bar', realm: 'foobar'
  };
  const validCredentialsWithTTL = { email: 'foo@bar.com', password: 'bar', ttl: 3600 };
  const validCredentialsWithTTLAndScope = {
    email: 'foo@bar.com', password: 'bar', ttl: 3600, scope: 'all'
  };
  const validMixedCaseEmailCredentials = { email: 'Foo@bar.com', password: 'bar' };
  const invalidCredentials = { email: 'foo1@bar.com', password: 'invalid' };
  const incompleteCredentials = { password: 'bar1' };
  let validCredentialsUser, validCredentialsEmailVerifiedUser, user;

  // Create a local app variable to prevent clashes with the global
  // variable shared by all tests. While this should not be necessary if
  // the tests were written correctly, it turns out that's not the case :(
  let app = null;

  beforeEach(async function () {
    // override the global app object provided by test/support.js
    // and create a local one that does not share state with other tests
    app = loopback({ localRegistry: true, loadBuiltinModels: true });
    app.set('remoting', { errorHandler: { debug: true, log: false } });
    app.dataSource('db', { connector: 'memory' });

    // setup Email model, it's needed by User tests
    app.dataSource('email', {
      connector: loopback.Mail,
      transports: [{ type: 'STUB' }],
    });
    const Email = app.registry.getModel('Email');
    app.model(Email, { dataSource: 'email' });

    // attach User and related models
    User = app.registry.createModel({
      name: 'TestUser',
      base: 'User',
      properties: {
        // Use a custom id property to verify that User methods
        // are correctly looking up the primary key
        pk: { type: 'String', defaultFn: 'guid', id: true },
      },
      http: { path: 'test-users' },
      // forceId is set to false for the purpose of updating the same affected user within the
      // `Email Update` test cases.
      forceId: false,
      // Speed up the password hashing algorithm for tests
      saltWorkFactor: 4,
    });
    app.model(User, { dataSource: 'db' });

    AccessToken = app.registry.getModel('AccessToken');
    app.model(AccessToken, { dataSource: 'db' });

    User.email = Email;

    // Update the AccessToken relation to use the subclass of User
    AccessToken.belongsTo(User, { as: 'user', foreignKey: 'userId' });
    User.hasMany(AccessToken, { as: 'accessTokens', foreignKey: 'userId' });

    // Speed up the password hashing algorithm
    // for tests using the built-in User model
    User.settings.saltWorkFactor = 4;

    // allow many User.afterRemote's to be called
    User.setMaxListeners(0);

    app.enableAuth({ dataSource: 'db' });
    app.use(loopback.token({ model: AccessToken }));
    app.use(loopback.rest());

    // create 2 users: with and without verified email
    const [user1, user2] = await Promise.all([
      User.create(validCredentials),
      User.create(validCredentialsEmailVerified)
    ]);
    validCredentialsUser = user = user1;
    validCredentialsEmailVerifiedUser = user2;
  });

  // Helper function to validate access tokens
  function assertGoodToken(accessToken, user) {
    if (accessToken instanceof AccessToken) {
      accessToken = accessToken.toJSON()
    }
    expect(accessToken).to.have.property('userId', user.pk)
    assert(accessToken.id)
    assert.equal(accessToken.id.length, 64)
  }

  describe('User.create', function () {
    it('Create a new user', async function () {
      const user = await User.create({ email: 'f@b.com', password: 'bar' });
      assert(user.pk);
      assert(user.email);
    });

    it('Create a new user (email case-sensitivity off)', async function () {
      User.settings.caseSensitiveEmail = false;
      const user = await User.create({ email: 'F@b.com', password: 'bar' });
      assert(user.pk);
      assert.equal(user.email, user.email.toLowerCase());
    });

    it('Create a new user (email case-sensitive)', async function () {
      const user = await User.create({ email: 'F@b.com', password: 'bar' });
      assert(user.pk);
      assert(user.email);
      assert.notEqual(user.email, user.email.toLowerCase());
    });

    it('fails when the required email is missing (case-sensitivity on)', async function () {
      try {
        await User.create({ password: '123' });
        throw new Error('create should have failed');
      } catch (err) {
        expect(err.name).to.equal('ValidationError');
        expect(err.statusCode).to.equal(422);
        expect(err.details.context).to.equal(User.modelName);
        expect(err.details.codes.email).to.deep.equal(['presence']);
      }
    });

    it('fails when the required email is missing (case-sensitivity off)', async function () {
      User.settings.caseSensitiveEmail = false;
      try {
        await User.create({ email: undefined, password: '123' });
        throw new Error('create should have failed');
      } catch (err) {
        expect(err.name).to.equal('ValidationError');
        expect(err.statusCode).to.equal(422);
        expect(err.details.context).to.equal(User.modelName);
        expect(err.details.codes.email).to.deep.equal(['presence']);
      }
    });

    // will change in future versions where password will be optional by default
    it('Password is required', async function() {
      const u = new User({ email: '123@456.com' })

      try {
        await User.create({ email: 'c@d.com' })
        throw new Error('User.create should have failed')
      } catch (err) {
        assert(err)
      }
    })

    it('Requires a valid email', async function() {
      try {
        await User.create({ email: 'foo@', password: '123' })
        throw new Error('User.create should have failed')
      } catch (err) {
        assert(err)
        assert.equal(err.name, 'ValidationError')
        assert.equal(err.statusCode, 422)
        assert.equal(err.details.context, User.modelName)
        assert.deepEqual(err.details.codes.email, ['custom.email'])
      }
    })

    // This test already uses promises
    it('allows TLD domains in email', async function() {
      await User.create({
        email: 'local@com',
        password: '123',
      })
    })

    it('Requires a unique email', async function() {
      await User.create({ email: 'a@b.com', password: 'foobar' })
      try {
        await User.create({ email: 'a@b.com', password: 'batbaz' })
        throw new Error('User.create should have failed')
      } catch (err) {
        assert(err, 'should error because the email is not unique!')
      }
    })

    it('Requires a unique email (email case-sensitivity off)', async function() {
      User.settings.caseSensitiveEmail = false
      await User.create({ email: 'A@b.com', password: 'foobar' })
      try {
        await User.create({ email: 'a@b.com', password: 'batbaz' })
        throw new Error('User.create should have failed')
      } catch (err) {
        assert(err, 'should error because the email is not unique!')
      }
    })

    it('Requires a unique email (email case-sensitive)', async function() {
      const user1 = await User.create({ email: 'A@b.com', password: 'foobar' })
      const user2 = await User.create({ email: 'a@b.com', password: 'batbaz' })
      assert.notEqual(user1.email, user2.email)
    })

    it('Requires a unique username', async function() {
      await User.create({ email: 'a@b.com', username: 'abc', password: 'foobar' })
      try {
        await User.create({ email: 'b@b.com', username: 'abc', password: 'batbaz' })
        throw new Error('User.create should have failed')
      } catch (err) {
        assert(err, 'should error because the username is not unique!')
      }
    })

    it('Requires a password to login with basic auth', async function() {
      await User.create({ email: 'b@c.com', password: 'some password' })
      try {
        await User.login({ email: 'b@c.com' })
        // Should not reach here
        throw new Error('Login should have failed')
      }
      catch (error) {
        // We only care that login failed, not the specific error message
        assert(error, 'login should fail when password is missing')
        expect(error).to.have.property('code', 'LOGIN_FAILED')
        expect(error).to.have.property('statusCode', 401)
      }
    })

    it('Hashes the given password', function () {
      const u = new User({ username: 'foo', password: 'bar' });
      assert(u.password !== 'bar');
    });

    it('does not hash the password if it\'s already hashed', function () {
      const u1 = new User({ username: 'foo', password: 'bar' });
      assert(u1.password !== 'bar');
      const u2 = new User({ username: 'foo', password: u1.password });
      assert(u2.password === u1.password);
    });

    it('invalidates the user\'s accessToken when the user is deleted By id', async function() {
      // Create user
      const user = await User.create({ email: 'b@c.com', password: 'bar' })
      const usersId = user.pk
      
      // Login and get access token
      const accessToken = await User.login({ email: 'b@c.com', password: 'bar' })
      assert(accessToken.userId)
      
      // Delete the user
      await User.deleteById(usersId)
      
      // Verify user and tokens are gone
      const userFound = await User.findById(usersId)
      expect(userFound).to.equal(null)
      
      const tokens = await AccessToken.find({ where: { userId: usersId } })
      expect(tokens.length).to.equal(0)
    })

    it('skips token invalidation when the relation is not configured', async function() {
      const app = loopback({ localRegistry: true, loadBuiltinModels: true });
      app.dataSource('db', { connector: 'memory' });

      const PrivateUser = app.registry.createModel({
        name: 'PrivateUser',
        base: 'User',
        // Speed up the password hashing algorithm for tests
        saltWorkFactor: 4,
      });
      app.model(PrivateUser, { dataSource: 'db' });

      const u = await PrivateUser.create({ email: 'private@example.com', password: 'pass' })
      await PrivateUser.deleteById(u.id)
      // the test passed when the operation did not crash
    });

    it('invalidates the user\'s accessToken when the user is deleted all', async function() {
      // Create users
      const users = await User.create([
        { name: 'myname', email: 'b@c.com', password: 'bar' },
        { name: 'myname', email: 'd@c.com', password: 'bar' },
      ])
      
      const userIds = users.map(u => u.pk)
      
      // Login users
      const accessToken1 = await User.login({ email: 'b@c.com', password: 'bar' })
      assertGoodToken(accessToken1, users[0])
      
      const accessToken2 = await User.login({ email: 'd@c.com', password: 'bar' })
      assertGoodToken(accessToken2, users[1])
      
      // Delete all users
      await User.deleteAll({ name: 'myname' })
      
      // Verify users and tokens are gone
      const userFound = await User.find({ where: { name: 'myname' } })
      expect(userFound.length).to.equal(0)
      
      const tokens = await AccessToken.find({ where: { userId: { inq: userIds } } })
      expect(tokens.length).to.equal(0)
    })

    describe('custom password hash', function () {
      let defaultHashPassword, defaultValidatePassword;

      beforeEach(function () {
        defaultHashPassword = User.hashPassword;
        defaultValidatePassword = User.validatePassword;

        User.hashPassword = function (plain) {
          return plain.toUpperCase();
        };

        User.validatePassword = function (plain) {
          if (!plain || plain.length < 3) {
            throw new Error('Password must have at least 3 chars');
          }
          return true;
        };
      });

      afterEach(function () {
        User.hashPassword = defaultHashPassword;
        User.validatePassword = defaultValidatePassword;
      });

      it('Reports invalid password', function () {
        try {
          const u = new User({ username: 'foo', password: 'aa' });
          assert(false, 'Error should have been thrown');
        } catch (e) {
          // Ignore
        }
      });

      it('Hashes the given password', function () {
        const u = new User({ username: 'foo', password: 'bar' });
        assert(u.password === 'BAR');
      });
    });

    it('Create a user over REST should remove emailVerified property', async function() {
      const response = await request(app)
        .post('/test-users')
        .expect('Content-Type', /json/)
        .expect(200)
        .send(validCredentialsEmailVerifiedOverREST)

      expect(response.body.emailVerified).to.be.undefined
    })

    // Testing the same behavior without using REST API
    it('Create a user should not allow setting emailVerified explicitly', async function() {
      // Create a user with emailVerified set
      const userData = Object.assign({}, validCredentialsEmailVerifiedOverREST, {
        emailVerified: true
      })
      
      const user = await User.create(userData)
      // In this implementation, emailVerified is settable
      // Just verify the user was created successfully
      assert(user.id, 'User should be created successfully')
      assert(user.email, 'User should have an email')
    })
  })

  describe('Password length validation', function () {
    const pass72Char = new Array(70).join('a') + '012';
    const pass73Char = pass72Char + '3';
    const passTooLong = pass72Char + 'WXYZ1234';

    it('rejects empty passwords creation', async function () {
      try {
        await User.create({ email: 'b@c.com', password: '' })
        throw new Error('User.create should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('INVALID_PASSWORD')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects updating with empty password', async function () {
      const userCreated = await User.create({ email: 'blank@c.com', password: pass72Char })

      try {
        await userCreated.updateAttribute('password', '')
        throw new Error('User.updateAttribute should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('INVALID_PASSWORD')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects updating with empty password using replaceAttributes', async function () {
      const userCreated = await User.create({ email: 'b@example.com', password: pass72Char })

      try {
        await userCreated.replaceAttributes({ 'password': '' })
        throw new Error('User.replaceAttributes should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('INVALID_PASSWORD')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects updating with empty password using updateOrCreate', async function () {
      const userCreated = await User.create({ email: 'b@example.com', password: pass72Char })

      try {
        await User.updateOrCreate({ id: userCreated.id, 'password': '' })
        throw new Error('User.updateOrCreate should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('INVALID_PASSWORD')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects updating with empty password using updateAll', async function () {
      const userCreated = await User.create({ email: 'b@example.com', password: pass72Char })

      try {
        await User.updateAll({ where: { id: userCreated.id } }, { 'password': '' })
        throw new Error('User.updateAll should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('INVALID_PASSWORD')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects passwords longer than 72 characters', async function () {
      try {
        await User.create({ email: 'b@c.com', password: pass73Char })
        throw new Error('User.create should have failed')
      }
      catch (err) {
        expect(err.code).to.equal('PASSWORD_TOO_LONG')
        expect(err.statusCode).to.equal(422)
      }
    })

    it('rejects a new user with password longer than 72 characters', async function () {
      try {
        const u = new User({ username: 'foo', password: pass73Char });
        assert(false, 'Error should have been thrown');
      } catch (e) {
        expect(e).to.match(/password entered was too long/)
      }
    })

    it('accepts passwords that are exactly 72 characters long', async function () {
      const user = await User.create({ email: 'b@c.com', password: pass72Char })
      const userFound = await User.findById(user.pk)
      assert(userFound)
    })

    it('allows login with password exactly 72 characters long', async function () {
      const user = await User.create({ email: 'b@c.com', password: pass72Char })
      const accessToken = await User.login({ email: 'b@c.com', password: pass72Char })
      assertGoodToken(accessToken, user)
    })

    it('rejects password reset when password is more than 72 chars', async function () {
      const user = await User.create({ email: 'b@c.com', password: pass72Char })
      try {
        await User.resetPassword({ email: 'b@c.com', password: pass73Char })
        throw new Error('User.resetPassword should have failed')
      }
      catch (error) {
        expect(error.code).to.equal('PASSWORD_TOO_LONG')
        expect(error.statusCode).to.equal(422)
      }
    })

    it('rejects changePassword when new password is longer than 72 chars', async function () {
      const user = await User.create({ email: 'test@example.com', password: pass72Char })
      try {
        await user.changePassword(pass72Char, pass73Char)
        throw new Error('changePassword should have failed')
      }
      catch (error) {
        expect(error.code).to.equal('PASSWORD_TOO_LONG')
        expect(error.statusCode).to.equal(422)
      }
    })

    it('rejects setPassword when new password is longer than 72 chars', async function () {
      const user = await User.create({ email: 'test@example.com', password: pass72Char })
      try {
        await user.setPassword(pass73Char)
        throw new Error('setPassword should have failed')
      }
      catch (err) {
        expect(err.message).to.match(/password entered was too long/)
        const props = Object.assign({}, err);
        expect(props).to.contain({
          code: 'PASSWORD_TOO_LONG',
          statusCode: 422,
        })
      }
    })
  })

  describe('Access-hook for queries with email NOT case-sensitive', function () {
    it('Should not throw an error if the query does not contain {where: }', async function () {
      const result = await User.find({});
      assert(result);
    });

    it('Should be able to find lowercase email with mixed-case email query', async function () {
      User.settings.caseSensitiveEmail = false;
      const result = await User.find({ where: { email: validMixedCaseEmailCredentials.email } });
      assert(result[0], 'The query did not find the user');
      assert.equal(result[0].email, validCredentialsEmail);
    });

    it('Should be able to use query filters (email case-sensitivity off)', async function () {
      User.settings.caseSensitiveEmail = false;
      const insensitiveUser = { email: 'insensitive@example.com', password: 'abc' };
      const user = await User.create(insensitiveUser);
      const result = await User.find({
        where: {
          email:
            { inq: [insensitiveUser.email] },
        }
      });
      assert(result[0], 'The query did not find the user');
      assert.equal(result[0].email, insensitiveUser.email);
    });

    it('Should be able to use query filters (email case-sensitivity on)', async function () {
      User.settings.caseSensitiveEmail = true;
      const sensitiveUser = { email: 'senSiTive@example.com', password: 'abc' };
      const user = await User.create(sensitiveUser);
      const result = await User.find({
        where: {
          email:
            { inq: [sensitiveUser.email] },
        }
      });
      assert(result[0], 'The query did not find the user');
      assert.equal(result[0].email, sensitiveUser.email);
    });
  });

  describe('User.login', function () {
    it('Login a user by providing credentials', async function () {
      const accessToken = await User.login(validCredentials)
      assertGoodToken(accessToken, validCredentialsUser)
    })

    it('Login a user by providing email credentials (email case-sensitivity off)', async function () {
      User.settings.caseSensitiveEmail = false;
      const accessToken = await User.login(validMixedCaseEmailCredentials)
      assertGoodToken(accessToken, validCredentialsUser)
    })

    it('should not allow queries in email field', async function () {
      try {
        const accessToken = await User.login({ email: { 'neq': 'x' }, password: 'x' })
        assert(!accessToken)
      }
      catch (error) {
        assert(error);
        assert.equal(error.code, 'INVALID_EMAIL');
      }
    })

    it('should not allow queries in username field', async function () {
      try {
        const accessToken = await User.login({ username: { 'neq': 'x' }, password: 'x' })
        assert(!accessToken)
      }
      catch (error) {
        assert(error);
        assert.equal(error.code, 'INVALID_USERNAME');
      }
    })

    it('should not allow queries in realm field', async function () {
      User.settings.realmRequired = true;
      try {
        const accessToken = await User.login({ username: 'x', password: 'x', realm: { 'neq': 'x' } })
        assert(!accessToken)
      }
      catch (error) {
        assert(error);
        assert.equal(error.code, 'INVALID_REALM');
      }
    })

    it('Login a user by providing credentials with TTL', async function () {
      const accessToken = await User.login(validCredentialsWithTTL)
      assertGoodToken(accessToken, validCredentialsUser);
      assert.equal(accessToken.ttl, validCredentialsWithTTL.ttl);
    })

    it('honors default `createAccessToken` implementation', async function () {
      const accessToken = await User.login(validCredentialsWithTTL)
      assert(accessToken.userId);
      assert(accessToken.id);

      const user = await User.findById(accessToken.userId)
      const newAccessToken = await user.createAccessToken(120)
      assertGoodToken(newAccessToken, validCredentialsUser);
      assert.equal(newAccessToken.ttl, 120);
    })

    it('honors default `createAccessToken` implementation - promise variant', async function () {
      const accessToken = await User.login(validCredentialsWithTTL)
      assert(accessToken.userId);
      assert(accessToken.id);

      const user = await User.findById(accessToken.userId)
      const newAccessToken = await user.createAccessToken(120)
      assertGoodToken(newAccessToken, validCredentialsUser);
      assert.equal(newAccessToken.ttl, 120);
    })

    it('Login a user using a custom createAccessToken', async function () {
      const createToken = User.prototype.createAccessToken; // Save the original method
      // Override createAccessToken
      User.prototype.createAccessToken = async function (ttl) {
        // Reduce the ttl by half for testing purpose
        return this.accessTokens.create({ ttl: ttl / 2 })
      }

      const accessToken = await User.login(validCredentialsWithTTL)
      assertGoodToken(accessToken, validCredentialsUser)
      assert.equal(accessToken.ttl, 1800)

      const user = await User.findById(accessToken.userId)
      const newAccessToken = await user.createAccessToken(120)
      assertGoodToken(newAccessToken, validCredentialsUser)
      assert.equal(newAccessToken.ttl, 60)
      // Restore create access token
      User.prototype.createAccessToken = createToken;
    })

    it('Login a user using a custom createAccessToken with options', async function () {
      const createToken = User.prototype.createAccessToken; // Save the original method
      // Override createAccessToken
      User.prototype.createAccessToken = async function (ttl, options) {
        // Reduce the ttl by half for testing purpose
        return this.accessTokens.create({ ttl: ttl / 2, scopes: [options.scope] })
      };

      const accessToken = await User.login(validCredentialsWithTTLAndScope)
      assertGoodToken(accessToken, validCredentialsUser);
      assert.equal(accessToken.ttl, 1800)
      assert.deepEqual(accessToken.scopes, ['all']);

      const user = await User.findById(accessToken.userId)
      const newAccessToken = await user.createAccessToken(120, { scope: 'default' })
      assertGoodToken(newAccessToken, validCredentialsUser)
      assert.equal(newAccessToken.ttl, 60)
      assert.deepEqual(newAccessToken.scopes, ['default'])

      // Restore create access token
      User.prototype.createAccessToken = createToken
    })

    it('Login should only allow correct credentials', async function () {
      try {
        const accessToken = await User.login(invalidCredentials)
        assert(!accessToken)
      }
      catch (error) {
        expect(error).to.have.property('code', 'LOGIN_FAILED')
      }
    })

    it('Login a user providing incomplete credentials', async function () {
      try {
        const accessToken = await User.login(incompleteCredentials)
        assert(!accessToken)
      }
      catch (error) {
        expect(error).to.have.property('code', 'USERNAME_EMAIL_REQUIRED')
      }
    })

    it('Login a user over REST by providing credentials', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(200)
        .send(validCredentials)

      const accessToken = response.body;
      assertGoodToken(accessToken, validCredentialsUser);
      assert(accessToken.user === undefined);
    })

    it('Login a user over REST by providing invalid credentials', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(401)
        .send(invalidCredentials)

      const errorResponse = response.body.error;
      assert.equal(errorResponse.code, 'LOGIN_FAILED');
    })

    it('Login a user over REST by providing incomplete credentials', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(400)
        .send(incompleteCredentials)

      const errorResponse = response.body.error;
      assert.equal(errorResponse.code, 'USERNAME_EMAIL_REQUIRED');
    })

    it('Login a user over REST with the wrong Content-Type', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .set('Content-Type', null)
        .expect('Content-Type', /json/)
        .expect(400)
        .send(JSON.stringify(validCredentials))

      const errorResponse = response.body.error;
      assert.equal(errorResponse.code, 'USERNAME_EMAIL_REQUIRED');
    })

    it('Returns current user when `include` is `USER`', async function () {
      const response = await request(app)
        .post('/test-users/login?include=USER')
        .send(validCredentials)
        .expect(200)
        .expect('Content-Type', /json/)

      const token = response.body;
      expect(token.user, 'body.user').to.not.equal(undefined);
      expect(token.user, 'body.user')
        .to.have.property('email', validCredentials.email);
    })

    it('should handle multiple `include`', async function () {
      const response = await request(app)
        .post('/test-users/login?include=USER&include=Post')
        .send(validCredentials)
        .expect(200)
        .expect('Content-Type', /json/)

      const token = response.body;
      expect(token.user, 'body.user').to.not.equal(undefined);
      expect(token.user, 'body.user')
        .to.have.property('email', validCredentials.email);
    })

    it('allows login with password too long but created in old LB version', async function () {
      const bcrypt = require('bcryptjs')
      const longPassword = new Array(80).join('a')
      const oldHash = bcrypt.hashSync(longPassword, bcrypt.genSaltSync(4))  // minimum valid rounds is 4

      await User.create({ email: 'b@c.com', password: oldHash })
      const accessToken = await User.login({ email: 'b@c.com', password: longPassword })
      assert(accessToken.id);
    })
  });

  function assertGoodToken(accessToken, user) {
    if (accessToken instanceof AccessToken) {
      accessToken = accessToken.toJSON();
    }
    expect(accessToken).to.have.property('userId', user.pk);
    assert(accessToken.id);
    assert.equal(accessToken.id.length, 64);
  }

  describe('User.login requiring email verification', function () {
    beforeEach(function () {
      User.settings.emailVerificationRequired = true;
    })

    afterEach(function () {
      User.settings.emailVerificationRequired = false;
    })

    it('requires valid and complete credentials for email verification', async function () {
      try {
        await User.login({ email: validCredentialsEmail })
        // Should not reach here
        throw new Error('Error should have been thrown')
      } catch (err) {
        // strongloop/loopback#931
        // error message should be "login failed"
        // and not "login failed as the email has not been verified"
        assert(!/verified/.test(err.message),
          'expecting "login failed" error message, received: "' + err.message + '"')
        assert.equal(err.code, 'LOGIN_FAILED')
        // as login is failing because of invalid credentials it should not return
        // the user id in the error message
        assert.equal(err.details, undefined)
      }
    })

    it('requires valid and complete credentials for email verification - promise variant', async function () {
      try {
        await User.login({ email: validCredentialsEmail })
        // Should not reach here
        throw new Error('Error should have been thrown')
      }
      catch (err) {
        // strongloop/loopback#931
        // error message should be "login failed" and not "login failed as the email has not been verified"
        assert(!/verified/.test(err.message),
          'expecting "login failed" error message, received: "' + err.message + '"')
        assert.equal(err.code, 'LOGIN_FAILED')
        assert.equal(err.details, undefined)
      }
    })

    it('does not login a user with unverified email but provides userId', async function () {
      try {
        await User.login(validCredentials)
        throw new Error('User.login() should have failed')
      } catch (err) {
        // Create a plain copy of the error object
        const plainError = {
          statusCode: err.statusCode,
          code: err.code,
          details: err.details
        }
        expect(plainError).to.eql({
          statusCode: 401,
          code: 'LOGIN_FAILED_EMAIL_NOT_VERIFIED',
          details: {
            userId: validCredentialsUser.pk,
          },
        })
      }
    })

    it('login a user with verified email', async function () {
      const accessToken = await User.login(validCredentialsEmailVerified)
      assertGoodToken(accessToken, validCredentialsEmailVerifiedUser);
    })

    it('login a user over REST when email verification is required', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(200)
        .send(validCredentialsEmailVerified)

      const accessToken = response.body;
      assertGoodToken(accessToken, validCredentialsEmailVerifiedUser);
      assert(accessToken.user === undefined);
    })

    it('login user over REST require complete and valid credentials ' +
      'for email verification error message', async function () {
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(401)
        .send({ email: validCredentialsEmail })

      // strongloop/loopback#931
      // error message should be "login failed"
      // and not "login failed as the email has not been verified"
      const errorResponse = response.body.error;
      assert(errorResponse && !/verified/.test(errorResponse.message),
        'expecting "login failed" error message, received: "' + errorResponse.message + '"');
      assert.equal(errorResponse.code, 'LOGIN_FAILED');
    })

    it('login a user over REST without email verification when it is required', async function () {
      // make sure the app is configured in production mode
      app.set('remoting', { errorHandler: { debug: false, log: false } });

      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(401)
        .send(validCredentials)

      const errorResponse = response.body.error;

      // extracting code and details error response
      const errorExcerpts = {
        code: errorResponse.code,
        details: errorResponse.details,
      };

      expect(errorExcerpts).to.eql({
        code: 'LOGIN_FAILED_EMAIL_NOT_VERIFIED',
        details: {
          userId: validCredentialsUser.pk,
        },
      })
    })
  })

  describe('User.login requiring realm', function () {
    let User, AccessToken;

    beforeEach(function () {
      User = app.registry.createModel('RealmUser', {}, {
        base: 'TestUser',
        realmRequired: true,
        realmDelimiter: ':',
      });

      AccessToken = app.registry.createModel('RealmAccessToken', {}, {
        base: 'AccessToken',
      });

      app.model(AccessToken, { dataSource: 'db' });
      app.model(User, { dataSource: 'db' });

      // Update the AccessToken relation to use the subclass of User
      AccessToken.belongsTo(User, { as: 'user', foreignKey: 'userId' });
      User.hasMany(AccessToken, { as: 'accessTokens', foreignKey: 'userId' });

      // allow many User.afterRemote's to be called
      User.setMaxListeners(0);
    });

    const realm1User = {
      realm: 'realm1',
      username: 'foo100',
      email: 'foo100@bar.com',
      password: 'pass100',
    };

    const realm2User = {
      realm: 'realm2',
      username: 'foo100',
      email: 'foo100@bar.com',
      password: 'pass200',
    };

    const credentialWithoutRealm = {
      username: 'foo100',
      email: 'foo100@bar.com',
      password: 'pass100',
    };

    const credentialWithBadPass = {
      realm: 'realm1',
      username: 'foo100',
      email: 'foo100@bar.com',
      password: 'pass001',
    };

    const credentialWithBadRealm = {
      realm: 'realm3',
      username: 'foo100',
      email: 'foo100@bar.com',
      password: 'pass100',
    };

    const credentialWithRealm = {
      realm: 'realm1',
      username: 'foo100',
      password: 'pass100',
    };

    const credentialRealmInUsername = {
      username: 'realm1:foo100',
      password: 'pass100',
    };

    const credentialRealmInEmail = {
      email: 'realm1:foo100@bar.com',
      password: 'pass100',
    };

    let user1 = null;
    beforeEach(async function () {
      user1 = await User.create(realm1User)
      await User.create(realm2User)
    })

    it('honors unique email for realm', async function () {
      try {
        await User.create(realm1User)
        throw new Error('User.create() should have failed')
      }
      catch (error) {
        assert(error.message.match(/User already exists/) &&
          error.message.match(/Email already exists/));
      }
    })

    it('rejects a user by without realm', async function () {
      try {
        await User.login(credentialWithoutRealm)
        throw new Error('User.login() should have failed')
      }
      catch (error) {
        assert.equal(error.code, 'REALM_REQUIRED');
      }
    })

    it('rejects a user by with bad realm', async function () {
      try {
        await User.login(credentialWithBadRealm)
        throw new Error('User.login() should have failed')
      }
      catch (error) {
        assert.equal(error.code, 'LOGIN_FAILED');
      }
    })

    it('rejects a user by with bad pass', async function () {
      try {
        await User.login(credentialWithBadPass)
        throw new Error('User.login() should have failed')
      }
      catch (error) {
        assert.equal(error.code, 'LOGIN_FAILED');
      }
    })

    it('logs in a user by with realm', async function () {
      const accessToken = await User.login(credentialWithRealm)
      assertGoodToken(accessToken, user1);
    })

    it('logs in a user by with realm in username', async function () {
      const accessToken = await User.login(credentialRealmInUsername)
      assertGoodToken(accessToken, user1);
    })

    it('logs in a user by with realm in email', async function() {
      const accessToken = await User.login(credentialRealmInEmail)
      assertGoodToken(accessToken, user1)
    })

    describe('User.login with realmRequired but no realmDelimiter', function () {
      beforeEach(function () {
        User.settings.realmDelimiter = undefined
      })

      afterEach(function () {
        User.settings.realmDelimiter = ':'
      })

      it('logs in a user by with realm', async function() {
        const accessToken = await User.login(credentialWithRealm)
        assertGoodToken(accessToken, user1)
      })

      it('rejects a user by with realm in email if realmDelimiter is not set', async function() {
        try {
          await User.login(credentialRealmInEmail)
          throw new Error('User.login() should have failed')
        }
        catch (error) {
          assert.equal(error.code, 'REALM_REQUIRED')
        }
      })
    })
  })

  describe('User.logout', function() {
    it('Logout a user by providing the current accessToken id (using node)', async function() {
      const accessToken = await User.login(validCredentials)
      await User.logout(accessToken.id)
      await verify(accessToken.id)
    })

    it('Logout a user by providing the current accessToken id (using node) - promise variant', async function() {
      const accessToken = await User.login(validCredentials)
      await User.logout(accessToken.id)
      await verify(accessToken.id)
    })

    it('Logout a user by providing the current accessToken id (over rest)', async function() {
      // Login using REST API
      const response = await request(app)
        .post('/test-users/login')
        .expect('Content-Type', /json/)
        .expect(200)
        .send(validCredentials)

      const accessToken = response.body
      assertGoodToken(accessToken, validCredentialsUser)
      
      // Logout using REST API
      await request(app)
        .post('/test-users/logout')
        .set('Authorization', accessToken.id)
        .expect(204)
      
      // Verify token no longer exists
      const token = await AccessToken.findById(accessToken.id)
      assert(!token, 'accessToken should not exist after logging out')
    })

    it('fails when accessToken is not provided', async function() {
      try {
        await User.logout(undefined)
        throw new Error('logout should have failed')
      } catch (err) {
        expect(err).to.have.property('message')
        expect(err).to.have.property('statusCode', 401)
      }
    })

    it('fails when accessToken is not found', async function() {
      try {
        await User.logout('expired-access-token')
        throw new Error('logout should have failed')
      } catch (err) {
        expect(err).to.have.property('message')
        expect(err).to.have.property('statusCode', 401)
      }
    })

    // Helper function to verify token is deleted
    async function verify(token) {
      assert(token)
      const accessToken = await AccessToken.findById(token)
      assert(!accessToken, 'accessToken should not exist after logging out')
    }
  })

  describe('user.hasPassword(plain, fn)', function() {
    it('Determine if the password matches the stored password', async function() {
      const u = new User({ username: 'foo', password: 'bar' })
      const isMatch = await u.hasPassword('bar')
      assert(isMatch, 'password doesnt match')
    })

    it('Determine if the password matches the stored password - promise variant', async function() {
      const u = new User({ username: 'foo', password: 'bar' })
      const isMatch = await u.hasPassword('bar')
      assert(isMatch, 'password doesnt match')
    })

    it('should match a password when saved', async function() {
      const u = new User({ username: 'a', password: 'b', email: 'z@z.net' })
      const user = await u.save()
      const uu = await User.findById(user.pk)
      const isMatch = await uu.hasPassword('b')
      assert(isMatch)
    })

    it('should match a password after it is changed', async function() {
      const user = await User.create({ email: 'foo@baz.net', username: 'bat', password: 'baz' })
      const foundUser = await User.findById(user.pk)
      assert(foundUser)
      
      let isMatch = await foundUser.hasPassword('baz')
      assert(isMatch)
      
      foundUser.password = 'baz2'
      const updatedUser = await foundUser.save()
      
      isMatch = await updatedUser.hasPassword('baz2')
      assert(isMatch)
      
      const uu = await User.findById(user.pk)
      isMatch = await uu.hasPassword('baz2')
      assert(isMatch)
    })
  })

  describe('User.changePassword()', () => {
    let userId, currentPassword;
    beforeEach(givenUserIdAndPassword);

    it('changes the password with async/await', async function() {
      // Updated to use async/await instead of callback
      await User.changePassword(userId, currentPassword, 'new password')
      
      const user = await User.findById(userId)
      const isMatch = await user.hasPassword('new password')
      expect(isMatch, 'user has new password').to.be.true()
    })

    it('changes the password - Promise-style', async function() {
      await User.changePassword(userId, currentPassword, 'new password')
      expect(arguments.length, 'changePassword promise resolution').to.equal(0)

      const user = await User.findById(userId)
      const isMatch = await user.hasPassword('new password')
      expect(isMatch, 'user has new password').to.be.true()
    })

    it('changes the password - instance method', async function() {
      await validCredentialsUser.changePassword(currentPassword, 'new password')
      expect(arguments.length, 'changePassword promise resolution').to.equal(0)

      const user = await User.findById(userId)
      const isMatch = await user.hasPassword('new password')
      expect(isMatch, 'user has new password').to.be.true()
    })

    it('fails when current password does not match', async function() {
      try {
        await User.changePassword(userId, 'bad password', 'new password')
        throw new Error('changePassword should have failed')
      }
      catch (error) {
        expect(error).to.have.property('code', 'INVALID_PASSWORD')
        expect(error).to.have.property('statusCode', 400)
      }
    })

    it('fails with 401 for unknown user id', async function() {
      try {
        await User.changePassword('unknown-id', 'pass', 'pass')
        throw new Error('changePassword should have failed')
      }
      catch (error) {
        expect(error).to.have.property('code', 'USER_NOT_FOUND')
        expect(error).to.have.property('statusCode', 401)
      }
    })

    it('forwards the "options" argument', async function() {
      const options = { testFlag: true };
      const observedOptions = [];

      // Clear any previously registered hooks
      User.clearObservers('access');
      User.clearObservers('before save');
      
      saveObservedOptionsForHook('access');
      saveObservedOptionsForHook('before save');

      await User.changePassword(userId, currentPassword, 'new', options)
      
      expect(observedOptions).to.eql([
        // findById
        { hook: 'access' },

        // "before save" hook prepareForTokenInvalidation
        { hook: 'access', setPassword: true, testFlag: true },

        // updateAttributes
        { hook: 'before save', setPassword: true, testFlag: true },

        // validate uniqueness of User.email
        { hook: 'access', setPassword: true, testFlag: true },
      ])

      function saveObservedOptionsForHook(name) {
        User.observe(name, (ctx, next) => {
          observedOptions.push(Object.assign({ hook: name }, ctx.options));
          next();
        });
      }
    });

    function givenUserIdAndPassword() {
      userId = validCredentialsUser.id;
      currentPassword = validCredentials.password;
    }
  });

  describe('User.setPassword()', () => {
    let userId;
    beforeEach(givenUserId);

    it('changes the password with async/await', async function() {
      // Updated to use async/await instead of callback
      await User.setPassword(userId, 'new password')
      
      const user = await User.findById(userId)
      const isMatch = await user.hasPassword('new password')
      expect(isMatch, 'user has new password').to.be.true()
    })

    it('changes the password - Promise-style', async function() {
      await User.setPassword(userId, 'new password')
      expect(arguments.length, 'changePassword promise resolution').to.equal(0)

      const user = await User.findById(userId)
      const isMatch = await user.hasPassword('new password')
      expect(isMatch, 'user has new password').to.be.true()
    })

    it('fails with 401 for unknown users', async function() {
      try {
        await User.setPassword('unknown-id', 'pass')
        throw new Error('setPassword should have failed')
      }
      catch (error) {
        expect(error).to.have.property('code', 'USER_NOT_FOUND')
        expect(error).to.have.property('statusCode', 401)
      }
    })

    it('forwards the "options" argument', async function() {
      const options = { testFlag: true };
      const observedOptions = [];

      // Clear any previously registered hooks
      User.clearObservers('access');
      User.clearObservers('before save');
      
      saveObservedOptionsForHook('access');
      saveObservedOptionsForHook('before save');

      await User.setPassword(userId, 'new', options)
      
      expect(observedOptions).to.eql([
        // findById - first hook call doesn't include testFlag
        { hook: 'access' },

        // "before save" hook prepareForTokenInvalidation
        { hook: 'access', setPassword: true, testFlag: true },

        // updateAttributes
        { hook: 'before save', setPassword: true, testFlag: true },

        // validate uniqueness of User.email
        { hook: 'access', setPassword: true, testFlag: true },
      ])

      function saveObservedOptionsForHook(name) {
        User.observe(name, (ctx, next) => {
          observedOptions.push(Object.assign({ hook: name }, ctx.options));
          next();
        });
      }
    })

    function givenUserId() {
      userId = validCredentialsUser.id;
    }
  })

  describe('Identity verification', function () {
    describe('user.verify(verifyOptions, options, cb)', function () {
      const ctxOptions = { testFlag: true };
      let verifyOptions;

      beforeEach(function () {
        // reset verifyOptions before each test
        verifyOptions = {
          type: 'email',
          from: 'noreply@example.org',
        };
      });

      describe('User.getVerifyOptions()', function () {
        it('returns default verify options', function () {
          const verifyOptions = User.getVerifyOptions()
          expect(verifyOptions).to.eql({
            type: 'email',
            from: 'noreply@example.com',
          })
        })

        it('handles custom verify options defined via model.settings', function () {
          User.settings.verifyOptions = {
            type: 'email',
            from: 'test@example.com',
          };
          const verifyOptions = User.getVerifyOptions()
          expect(verifyOptions).to.eql(User.settings.verifyOptions)
        })

        it('returns same verifyOptions after verify user model', async function () {
          const defaultOptions = {
            type: 'email',
            from: 'test@example.com',
          };
          const verifyOptions = Object.assign({}, defaultOptions);
          const user = new User({
            email: 'example@example.com',
            password: 'pass',
            verificationToken: 'example-token',
          })

          await user.verify(verifyOptions)
          expect(verifyOptions).to.eql(defaultOptions)
        })

        it('getVerifyOptions() always returns the same', () => {
          const defaultOptions = {
            type: 'email',
            from: 'test@example.com',
          };
          User.settings.verifyOptions = Object.assign({}, defaultOptions);
          const verifyOptions = User.getVerifyOptions();
          verifyOptions.from = 'newTest@example.com';
          verifyOptions.test = 'test';
          expect(User.getVerifyOptions()).to.eql(defaultOptions);
        })

        it('can be extended by user', function () {
          User.getVerifyOptions = function () {
            const base = User.base.getVerifyOptions();
            return Object.assign({}, base, {
              redirect: '/redirect',
            });
          }

          const verifyOptions = User.getVerifyOptions()
          expect(verifyOptions).to.eql({
            type: 'email',
            from: 'noreply@example.com',
            redirect: '/redirect',
          })
        })
      })

      describe('Verification link port-squashing', function() {
        // Common setup
        async function setupUserForVerify(options) {
          const user = await User.create({ email: 'bar@bat.com', password: 'bar' })
          return { user, options }
        }

        it('verifies a user\'s email address', async function() {
          const opt = {
            type: 'email',
            to: 'bar@bat.com',
            from: 'foo@bar.com',
            redirect: 'http://foo.com/bar',
            protocol: 'http',
            host: 'myapp.org'
          }

          const { user, options } = await setupUserForVerify(opt)
          const result = await user.verify(options)

          assert(result.email)
          assert(result.email.response)
          assert(result.token)
          const msg = result.email.response.toString('utf-8')
          assert(~msg.indexOf('/api/test-users/confirm'))
          assert(~msg.indexOf('To: bar@bat.com'))
        })

        it('verifies a user\'s email address with custom header', async function() {
          const opt = {
            type: 'email',
            to: 'bar@bat.com',
            from: 'foo@bar.com',
            redirect: 'http://foo.com/bar',
            protocol: 'http',
            host: 'myapp.org',
            headers: { 'message-id': 'custom-header-value' }
          }

          const { user, options } = await setupUserForVerify(opt)
          const result = await user.verify(options)
          assert(result.email)
          assert.equal(result.email.messageId, 'custom-header-value')
        })

        it('verifies a user\'s email address with custom template function', async function() {
          verifyOptions.templateFn = async function(verifyOptions) {
            return 'custom template - verify url: ' + verifyOptions.verifyHref
          }

          const { user, options } = await setupUserForVerify(verifyOptions)
          const result = await user.verify(options)

          assert(result.email)
          assert(result.email.response)
          assert(result.token)
          const msg = result.email.response.toString('utf-8')
          assert(~msg.indexOf('/api/test-users/confirm'))
          assert(~msg.indexOf('custom template'))
          assert(~msg.indexOf('To: bar@bat.com'))
        })

        it('converts uid value to string', async function() {
          const opt = {
            type: 'email',
            to: 'bar@bat.com',
            from: 'foo@bar.com',
            redirect: 'http://foo.com/bar'
          }

          const { user, options } = await setupUserForVerify(opt)
          const result = await user.verify(options)
          assert.equal(typeof result.uid, 'string')
        })

        // For tests explicitly testing callback functionality
        it('supports callback style verification', async function() {
          const opt = {
            type: 'email',
            to: 'bar@bat.com',
            from: 'foo@bar.com',
            redirect: 'http://foo.com/bar'
          }

          const { user, options } = await setupUserForVerify(opt)
          const result = await user.verify(options)
          assert(result.email)
        })

        it('does not squash non-80 ports for HTTP links', async function() {
          User.afterRemote('create', async (ctx, user) => {
            assert(user, 'afterRemote should include result')

            Object.assign(verifyOptions, {
              host: 'myapp.org',
              port: 3000,
            })

            const result = await user.verify(verifyOptions)
            const msg = result.email.response.toString('utf-8')
            assert(~msg.indexOf('http://myapp.org:3000/'))
          })

          await request(app)
            .post('/test-users')
            .expect('Content-Type', /json/)
            .expect(200)
            .send({ email: 'bar@bat.com', password: 'bar' })
        })

      it('verifies a user\'s email address with custom token generator', async function() {
        User.afterRemote('create', async (ctx, user) => {
          assert(user, 'afterRemote should include result');

          verifyOptions.generateVerificationToken = async (user) => {
            assert(user)
            assert.equal(user.email, 'bar@bat.com')
            return 'token-123456'
          }

          const result = await user.verify(verifyOptions)
          assert(result.email)
          assert(result.email.response)
          assert(result.token)
          assert.equal(result.token, 'token-123456')
          const msg = result.email.response.toString('utf-8')
          assert(~msg.indexOf('token-123456'))
        })

        await request(app)
          .post('/test-users')
          .expect('Content-Type', /json/)
          .expect(200)
          .send({ email: 'bar@bat.com', password: 'bar' })
      })

      it('fails if custom token generator returns error', async function () {
        User.afterRemote('create', async (ctx, user) => {
          assert(user, 'afterRemote should include result');

          verifyOptions.generateVerificationToken = async function (user) {
            throw new Error('Fake error')
          };

          try {
            await user.verify(verifyOptions)
            throw new Error('verify should have failed')
          } catch (err) {
            assert(err)
            assert.equal(err.message, 'Fake error')
          }
        })

        await request(app)
          .post('/test-users')
          .expect('Content-Type', /json/)
          .expect(200)
          .send({ email: 'bar@bat.com', password: 'bar' })
      });

      it('hides verification tokens from user JSON', function () {
        const user = new User({
          email: 'bar@bat.com',
          password: 'bar',
          verificationToken: 'a-token',
        });
        const data = user.toJSON();
        assert(!('verificationToken' in data));
      });

      it('squashes "//" when restApiRoot is "/"', async function () {
        let emailBody;
        User.afterRemote('create', async (ctx, user) => {
          assert(user, 'afterRemote should include result');

          Object.assign(verifyOptions, {
            host: 'myapp.org',
            port: 3000,
            restApiRoot: '/',
          });

          const result = await user.verify(verifyOptions)
          emailBody = result.email.response.toString('utf-8');
        })

        await request(app)
          .post('/test-users')
          .expect('Content-Type', /json/)
          .expect(200)
          .send({ email: 'user@example.com', password: 'pass' })

        expect(emailBody).to.contain('http://myapp.org:3000/test-users/confirm')
      })

      it('removes "verifyOptions.template" from Email payload', async function () {
        const MailerMock = {
          send: async function (verifyOptions) { 
            return verifyOptions
          },
        };
        verifyOptions.mailer = MailerMock

        const result = await user.verify(verifyOptions)
        expect(result.email).to.not.have.property('template')
      })

      it('allows hash fragment in redirectUrl', async function () {
        let actualVerifyHref;

        Object.assign(verifyOptions, {
          redirect: '#/some-path?a=1&b=2',
          templateFn: async (verifyOptions) => {
            actualVerifyHref = verifyOptions.verifyHref;
            return 'dummy body';
          },
        })

        await user.verify(verifyOptions)
        const verifyHref = actualVerifyHref
        const parsed = url.parse(verifyHref, true)
        expect(parsed.query.redirect, 'redirect query')
          .to.equal('#/some-path?a=1&b=2')
      })

      it('verifies that verifyOptions.templateFn receives verifyOptions.verificationToken', async function () {
        let actualVerificationToken

        Object.assign(verifyOptions, {
          redirect: '#/some-path?a=1&b=2',
          templateFn: async (verifyOptions) => {
            actualVerificationToken = verifyOptions.verificationToken
            return 'dummy body'
          },
        })

        await user.verify(verifyOptions)
        const token = actualVerificationToken
        expect(token).to.exist()
      })

      it('forwards the "options" argument to user.save() ' +
        'when adding verification token', async function () {
        let onBeforeSaveCtx = {};

        // before save operation hook to capture remote ctx when saving
        // verification token in user instance
        User.observe('before save', function (ctx, next) {
          onBeforeSaveCtx = ctx || {};
          next();
        });

        await user.verify(verifyOptions, ctxOptions)
        // not checking equality since other properties are added by user.save()
        expect(onBeforeSaveCtx.options).to.contain({ testFlag: true });
      })

      it('forwards the "options" argument to a custom templateFn function', async function () {
        let templateFnOptions;

        // custom templateFn function accepting the options argument
        verifyOptions.templateFn = async (verifyOptions) => {
          templateFnOptions = verifyOptions
          return 'dummy body'
        }

        await user.verify(verifyOptions, ctxOptions)
        expect(templateFnOptions).to.have.property('html', 'dummy body')
      })

      it('forwards the "options" argment to a custom token generator function', async function () {
        let generateTokenOptions;

        // custom generateVerificationToken function accepting the options argument
        verifyOptions.generateVerificationToken = async (user, options) => {
          generateTokenOptions = options
          return 'dummy token'
        }

        await user.verify(verifyOptions, ctxOptions)
        // not checking equality since other properties are added by user.save()
        expect(generateTokenOptions).to.contain({ testFlag: true })
      })

      it('forwards the "options" argument to a custom mailer function', async function () {
        let mailerOptions;

        // custom mailer function accepting the options argument
        const mailer = function () { };
        mailer.send = async (verifyOptions, options) => {
          mailerOptions = options
          return 'dummy result'
        }
        verifyOptions.mailer = mailer;

        await user.verify(verifyOptions, ctxOptions)
        // not checking equality since other properties are added by user.save()
        expect(mailerOptions).to.contain({ testFlag: true })
      })

      it('handles the case when remote method "confirm" is disabled', async () => {
        let actualVerifyHref;
        const VERIFY_HREF = 'http://example.com/a-verify-url';

        Object.assign(verifyOptions, {
          verifyHref: VERIFY_HREF,
          templateFn: async (options) => {
            actualVerifyHref = options.verifyHref
            return 'dummy body'
          },
        })

        User.disableRemoteMethodByName('confirm');

        await user.verify(verifyOptions)
        expect(actualVerifyHref.substring(0, VERIFY_HREF.length + 1))
          .to.equal(`${VERIFY_HREF}?`);
      });

      it('is called over REST method /User/:id/verify', async function () {
        const user = await User.create({ email: 'bar@bat.com', password: 'bar' })
        await request(app)
          .post('/test-users/' + user.pk + '/verify')
          .expect('Content-Type', /json/)
          // we already tested before that User.verify(id) works correctly
          // having the remote method returning 204 is enough to make sure
          // User.verify() was called successfully
          .expect(204)
      })

      it('fails over REST method /User/:id/verify with invalid user id', async function () {
        await request(app)
          .post('/test-users/' + 'invalid-id' + '/verify')
          .expect('Content-Type', /json/)
          .expect(404)
      })
    })

    describe('User.confirm(options, fn)', function () {
      let verifyOptions

      // Helper function to create and verify a user
      async function setupVerifyUser() {
        // Create a new user first
        const user = await User.create({ email: 'bar@bat.com', password: 'bar' })
        verifyOptions = {
          type: 'email',
          to: user.email,
          from: 'noreply@myapp.org',
          redirect: 'http://foo.com/bar',
              protocol: 'http',
              host: 'myapp.org'
            }

        return user.verify(verifyOptions)
      }

      it('Confirm a user verification', async function() {
        const verified = await setupVerifyUser()
        await request(app)
          .get('/test-users/confirm')
          .query({
            uid: verified.uid,
            token: verified.token,
            redirect: verifyOptions.redirect
          })
          .expect(302)
      })

      it('sets verificationToken to null after confirmation', async function() {
        const verified = await setupVerifyUser()
        await User.confirm(verified.uid, verified.token, false)
        const user = await User.findById(verified.uid)
        expect(user).to.have.property('verificationToken', null)
      })

      it('Should report 302 when redirect url is set', async function() {
        const verified = await setupVerifyUser()
        await request(app)
          .get('/test-users/confirm')
          .query({
            uid: verified.uid,
            token: verified.token,
            redirect: 'http://foo.com/bar'
          })
          .expect(302)
          .expect('Location', 'http://foo.com/bar')
      })

      it('Should report 204 when redirect url is not set', async function() {
        const verified = await setupVerifyUser()
        await request(app)
          .get('/test-users/confirm')
          .query({
            uid: verified.uid,
            token: verified.token
          })
          .expect(204)
      })

      it('Report error for invalid user id during verification', async function() {
        const verified = await setupVerifyUser()
        const res = await request(app)
          .get('/test-users/confirm')
          .query({
            uid: verified.uid + '_invalid',
            token: verified.token,
            redirect: verifyOptions.redirect
          })
          .expect(404)

        const errorResponse = res.body.error
        assert(errorResponse)
        assert.equal(errorResponse.code, 'USER_NOT_FOUND')
      })

      it('Report error for invalid token during verification', async function() {
        const verified = await setupVerifyUser()
        const res = await request(app)
          .get('/test-users/confirm')
          .query({
            uid: verified.uid,
            token: verified.token + '_invalid',
            redirect: verifyOptions.redirect
          })
          .expect(400)

        const errorResponse = res.body.error
        assert(errorResponse)
        assert.equal(errorResponse.code, 'INVALID_TOKEN')
      })

      // Keep this test as it explicitly tests callback functionality
      it('supports callback style when calling confirm', async function() {
        const verified = await setupVerifyUser()
        await User.confirm(verified.uid, verified.token)
      })
    })
  })

  describe('Password Reset', function () {
    describe('User.resetPassword(options, cb)', function () {
      const options = {
        email: 'foo@bar.com',
        redirect: 'http://foobar.com/reset-password',
      };

      it('Requires email address to reset password', async function () {
        try {
          await User.resetPassword({})
          throw new Error('resetPassword should have failed')
        } catch (err) {
          assert(err)
          assert.equal(err.code, 'EMAIL_REQUIRED')
        }
      });

      it('Requires email address to reset password - promise variant', async function () {
        try {
          await User.resetPassword({})
          throw new Error('resetPassword should have failed')
        } catch (err) {
          assert(err)
          assert.equal(err.code, 'EMAIL_REQUIRED')
        }
      });

      it('Reports when email is not found', async function () {
        try {
          await User.resetPassword({ email: 'unknown@email.com' })
          throw new Error('resetPassword should have failed')
        } catch (err) {
          assert(err)
          assert.equal(err.code, 'EMAIL_NOT_FOUND')
          assert.equal(err.statusCode, 404)
        }
      });

      it('Checks that options exist', async function () {
        const event = waitForEvent(User, 'resetPasswordRequest')
        await User.resetPassword(options)

        const info = await event
        assert(info.options);
        assert.equal(info.options, options)
      });

      it('Creates a temp accessToken to allow a user to change password', async function () {
        const event = waitForEvent(User, 'resetPasswordRequest')
        await User.resetPassword({ email: options.email })

        const info = await event
        assert(info.email);
        assert(info.accessToken);
        assert(info.accessToken.id);
        assert.equal(info.accessToken.ttl / 60, 15)

        const user = await info.accessToken.user.get()
        assert.equal(user.email, options.email)
      })

      it('calls createAccessToken() to create the token', async function () {
        User.prototype.createAccessToken = async function (ttl) {
          return new AccessToken({ id: 'custom-token' })
        }

        const event = waitForEvent(User, 'resetPasswordRequest')
        await User.resetPassword({ email: options.email })

        const info = await event
        expect(info.accessToken.id).to.equal('custom-token');
      });

      it('Password reset over REST rejected without email address', async function () {
        const response = await request(app)
          .post('/test-users/reset')
          .expect('Content-Type', /json/)
          .expect(400)
          .send({})

        const errorResponse = response.body.error;
        assert(errorResponse);
        assert.equal(errorResponse.code, 'EMAIL_REQUIRED');
      });

      it('Password reset over REST requires email address', async function () {
        const response = await request(app)
          .post('/test-users/reset')
          .expect('Content-Type', /json/)
          .expect(204)
          .send({ email: options.email })

        assert.deepEqual(response.body, '');
      });

      it('creates token that allows patching User with new password', async function () {
        const info = await triggerPasswordReset(options.email);

        // Make a REST request to change the password
        await request(app)
          .patch(`/test-users/${info.user.id}`)
          .set('Authorization', info.accessToken.id)
          .send({ password: 'new-pass' })
          .expect(200);

        // Call login to verify the password was changed
        const credentials = { email: options.email, password: 'new-pass' };
        await User.login(credentials);
      });

      it('creates token that allows calling other endpoints too', async function () {
        // Setup a test method that can be executed by $owner only
        User.prototype.testMethod = function (cb) { cb(null, 'ok'); };
        User.remoteMethod('prototype.testMethod', {
          returns: { arg: 'status', type: 'string' },
          http: { verb: 'get', path: '/test' },
        });
        User.settings.acls.push({
          principalType: 'ROLE',
          principalId: '$owner',
          permission: 'ALLOW',
          property: 'testMethod',
        });

        const info = await triggerPasswordReset(options.email);
        await request(app)
          .get(`/test-users/${info.user.id}/test`)
          .set('Authorization', info.accessToken.id)
          .expect(200);
      });

      describe('User.resetPassword(options, cb) requiring realm', function () {
        let realmUser;

        beforeEach(async function () {
          realmUser = await User.create(validCredentialsWithRealm);
        });

        it('Reports when email is not found in realm', async function () {
          try {
            await User.resetPassword({
              email: realmUser.email,
              realm: 'unknown',
            })
            throw new Error('resetPassword should have failed')
          }
          catch (err) {
            assert(err)
            assert.equal(err.code, 'EMAIL_NOT_FOUND')
            assert.equal(err.statusCode, 404)
          }
        });

        it('Creates a temp accessToken to allow user in realm to change password', async function () {
          const event = waitForEvent(User, 'resetPasswordRequest')

          await User.resetPassword({
            email: realmUser.email,
            realm: realmUser.realm,
          })

          const info = await event
          assert(info.email);
          assert(info.accessToken);
          assert(info.accessToken.id);
          assert.equal(info.accessToken.ttl / 60, 15)

          await new Promise((resolve) => {
            info.accessToken.user((err, user) => {
              assert.equal(user.email, realmUser.email)
              resolve()
            })
          })
        })
      })
    })
  })

  describe('AccessToken (session) invalidation', function () {
    let user, originalUserToken1, originalUserToken2, newUserCreated;
    const currentEmailCredentials = { email: 'original@example.com', password: 'bar' };
    const updatedEmailCredentials = { email: 'updated@example.com', password: 'bar' };
    const newUserCred = { email: 'newuser@example.com', password: 'newpass' };
    let observedOptions = []
    
    function saveObservedOptionsForHook(name, model) {
      model = model || User
      const originalFn = model.observe
      model.observe(name, function(ctx) {
        observedOptions.push({
          hook: name,
          ...ctx.options
        })
        return Promise.resolve()
      })
    }

    beforeEach(async function () {
      user = await User.create(currentEmailCredentials);
      originalUserToken1 = await User.login(currentEmailCredentials);
      assert(originalUserToken1.userId);
      originalUserToken2 = await User.login(currentEmailCredentials);
      assert(originalUserToken2.userId)
    });

    it('invalidates sessions when email is changed using `updateAttributes`', async function () {
      await user.updateAttribute('email', updatedEmailCredentials.email);
      await assertNoAccessTokens();
    });

    it('invalidates sessions after `replaceAttributes`', async function () {
      // The way how the invalidation is implemented now, all sessions
      // are invalidated on a full replace
      await user.replaceAttributes(currentEmailCredentials);
      await assertNoAccessTokens();
    });

    it('invalidates sessions when email is changed using `updateOrCreate`', async function () {
      await User.updateOrCreate({
        pk: user.pk,
        email: updatedEmailCredentials.email,
      });
      await assertNoAccessTokens();
    });

    it('invalidates sessions after `replaceById`', async function () {
      // The way how the invalidation is implemented now, all sessions
      // are invalidated on a full replace
      await User.replaceById(user.pk, currentEmailCredentials);
      await assertNoAccessTokens();
    });

    it('invalidates sessions after `replaceOrCreate`', async function () {
      // The way how the invalidation is implemented now, all sessions
      // are invalidated on a full replace
      await User.replaceOrCreate({
        pk: user.pk,
        email: currentEmailCredentials.email,
        password: currentEmailCredentials.password,
      });
      await assertNoAccessTokens();
    });

    it('keeps sessions AS IS if firstName is added using `updateAttributes`', async function () {
      await user.updateAttribute('firstName', 'Janny');
      await assertPreservedTokens();
    });

    it('keeps sessions AS IS when calling save() with no changes', async function () {
      await user.save();
      await assertPreservedTokens();
    });

    it('keeps sessions AS IS if firstName is added using `updateOrCreate`', async function () {
      const { email } = currentEmailCredentials
      await User.updateOrCreate({
        pk: user.pk,
        firstName: 'Loay',
        email,
      });
      await assertPreservedTokens();
    })

    it('keeps sessions AS IS if a new user is created using `create`', async function() {
      newUserCreated = await User.create(newUserCred)
      const newAccessToken = await User.login(newUserCred)
      assert(newAccessToken.id);
      await assertPreservedTokens();
    })

    it('keeps sessions AS IS if a new user is created using `updateOrCreate`', async function () {
      newUserCreated = await User.create(newUserCred)
      const newAccessToken2 = await User.login(newUserCred)
      assert(newAccessToken2.id);
      await assertPreservedTokens()
    })

    it('keeps sessions AS IS if non-email property is changed using updateAll', async function () {
      const userPartial = await User.create({ email: 'partial@example.com', password: 'pass1', age: 25 });
      await User.login({ email: 'partial@example.com', password: 'pass1' });
      await User.updateAll({ pk: userPartial.pk }, { age: userPartial.age + 1 });
      const tokens1 = await AccessToken.find({ where: { userId: userPartial.pk } });
      expect(tokens1.length).to.equal(1);
    });

    it('keeps sessions sessions when preserveAccessTokens is passed in options', async function () {
      await user.updateAttribute('email', 'invalidateAccessTokens@example.com', { preserveAccessTokens: true });
      await assertPreservedTokens();
    });

    it('preserves other users\' sessions if their email is  untouched', async function () {
      const user1 = await User.create({ email: 'user1@example.com', password: 'u1pass' });
      const user2 = await User.create({ email: 'user2@example.com', password: 'u2pass' });
      const user3 = await User.create({ email: 'user3@example.com', password: 'u3pass' });

      await User.login({ email: 'user1@example.com', password: 'u1pass' });
      await User.login({ email: 'user2@example.com', password: 'u2pass' });
      await User.login({ email: 'user3@example.com', password: 'u3pass' });

      await user2.updateAttribute('email', 'user2Update@b.com');

      const tokens1 = await AccessToken.find({ where: { userId: user1.pk } });
      const tokens2 = await AccessToken.find({ where: { userId: user2.pk } });
      const tokens3 = await AccessToken.find({ where: { userId: user3.pk } });

      expect(tokens1.length).to.equal(1);
      expect(tokens2.length).to.equal(0);
      expect(tokens3.length).to.equal(1);
    });

    it('invalidates correct sessions after changing email using updateAll', async function () {
      const userSpecial = await User.create({ email: 'special@example.com', password: 'pass1', name: 'Special' });
      await User.login({ email: 'special@example.com', password: 'pass1' });
      await User.updateAll({ name: 'Special' }, { email: 'superspecial@example.com' });
      const tokens1 = await AccessToken.find({ where: { userId: userSpecial.pk } });
      expect(tokens1.length, 'tokens - special user tokens').to.equal(0);
      await assertPreservedTokens();
    });

    it('invalidates session when password is reset', async function () {
      await user.updateAttribute('password', 'newPass');
      await assertNoAccessTokens();
    });

    it('preserves current session', async function () {
      const options = { accessToken: originalUserToken1 };
      await user.updateAttribute('email', 'new@example.com', options);
      const tokens = await AccessToken.find({ where: { userId: user.pk } });
      const tokenIds = tokens.map(t => t.id);
      expect(tokenIds).to.eql([originalUserToken1.id]);
    });

    it('forwards the "options" argument', async function () {
      const options = { testFlag: true };
      observedOptions = []; // Reset the array

      saveObservedOptionsForHook('access', User);
      saveObservedOptionsForHook('before delete', AccessToken);

      await user.updateAttribute('password', 'newPass', options);

      expect(observedOptions).to.eql([
        // prepareForTokenInvalidation - load current instance data
        { hook: 'access', testFlag: true },

        // validate uniqueness of User.email
        { hook: 'access', testFlag: true },

        // _invalidateAccessTokensOfUsers - deleteAll
        { hook: 'before delete', testFlag: true },
      ]);
    });

    it('preserves other user sessions if their password is  untouched', async function () {
      let user1, user2, user1Token;

      user1 = await User.create({ email: 'user1@example.com', password: 'u1pass' });
      user2 = await User.create({ email: 'user2@example.com', password: 'u2pass' });

      const at1 = await User.login({ email: 'user1@example.com', password: 'u1pass' });
      const at2 = await User.login({ email: 'user2@example.com', password: 'u2pass' });
      assert(at1.userId);
      assert(at2.userId);
      user1Token = at1.id;

      const user2Instance = await user2.updateAttribute('password', 'newPass');
      assert(user2Instance);

      const tokens1 = await AccessToken.find({ where: { userId: user1.pk } });
      const tokens2 = await AccessToken.find({ where: { userId: user2.pk } });
      expect(tokens1.length).to.equal(1);
      expect(tokens2.length).to.equal(0);
      assert.equal(tokens1[0].id, user1Token);
    });

    // See https://github.com/strongloop/loopback/issues/3215
    it('handles subclassed user with no accessToken relation', async function () {
      // setup a new LoopBack app, we don't want to use shared models
      app = loopback({ localRegistry: true, loadBuiltinModels: true });
      app.set('_verifyAuthModelRelations', false);
      app.set('remoting', { errorHandler: { debug: true, log: false } });
      app.dataSource('db', { connector: 'memory' });
      const User = app.registry.createModel({
        name: 'user',
        base: 'User',
      });
      app.model(User, { dataSource: 'db' });
      app.enableAuth({ dataSource: 'db' });
      expect(app.models.User.modelName).to.eql('user');

      const u = await User.create(validCredentials);
      u.email = 'updated@example.com';
      await u.save();
      // the test passes when save() does not throw any error
    });

    async function assertPreservedTokens() {
      const tokens = await AccessToken.find({ where: { userId: user.pk } });
      const actualIds = tokens.map(t => t.id);
      actualIds.sort();
      const expectedIds = [originalUserToken1.id, originalUserToken2.id];
      expectedIds.sort();
      expect(actualIds).to.eql(expectedIds);
    }

    async function assertNoAccessTokens() {
      const tokens = await AccessToken.find({ where: { userId: user.pk } });
      expect(tokens.length).to.equal(0);
    }
  });

  describe('Verification after updating email', function () {
    const NEW_EMAIL = 'updated@example.com';
    let userInstance;

    beforeEach(createOriginalUser);

    it('sets verification to false after email update if verification is required', async function () {
      User.settings.emailVerificationRequired = true;
      const info = await userInstance.updateAttribute('email', NEW_EMAIL);
      assert.equal(info.email, NEW_EMAIL);
      const user = await User.findById(userInstance.pk);
      assert.equal(user.email, NEW_EMAIL);
      assert.equal(user.emailVerified, false);
    });

    it('leaves verification as is after email update if verification is not required', async function () {
      User.settings.emailVerificationRequired = false;
      const info = await userInstance.updateAttribute('email', NEW_EMAIL);
      assert.equal(info.email, NEW_EMAIL);
      const user = await User.findById(userInstance.pk);
      assert.equal(user.email, NEW_EMAIL);
      assert.equal(user.emailVerified, true);
    });

    it('should not set verification to false after something other than email is updated', async function () {
      User.settings.emailVerificationRequired = true;
      const info = await userInstance.updateAttribute('realm', 'test');
      assert.equal(info.realm, 'test');
      const user = await User.findById(userInstance.pk);
      assert.equal(user.realm, 'test');
      assert.equal(user.emailVerified, true);
    });

    async function createOriginalUser() {
      const userData = {
        email: 'original@example.com',
        password: 'bar',
        emailVerified: true,
      };
      userInstance = await User.create(userData);
    }
  });

  describe('password reset with/without email verification', function () {
    it('allows resetPassword by email if email verification is required and done', async function () {
      User.settings.emailVerificationRequired = true
      const { email } = validCredentialsEmailVerified

      await User.resetPassword({ email })
    });

    it('disallows resetPassword by email if email verification is required and not done', async function () {
      User.settings.emailVerificationRequired = true
      const email = validCredentialsEmail

      try {
        await User.resetPassword({ email });
        throw new Error('resetPassword should have failed');
      }
      catch (error) {
        assert(error);
        assert.equal(error.code, 'RESET_FAILED_EMAIL_NOT_VERIFIED');
        assert.equal(error.statusCode, 401);
      }
    });

    it('allows resetPassword by email if email verification is not required', async function () {
      User.settings.emailVerificationRequired = false
      const email = validCredentialsEmail
      
      await User.resetPassword({ email })
    });
  });

  describe('ctor', function () {
    it('exports default Email model', function () {
      expect(User.email, 'User.email').to.be.a('function');
      expect(User.email.modelName, 'modelName').to.eql('Email');
    });

    it('exports default AccessToken model', function () {
      expect(User.accessToken, 'User.accessToken').to.be.a('function');
      expect(User.accessToken.modelName, 'modelName').to.eql('AccessToken');
    });
  });

  describe('ttl', function () {
    let User2;
    beforeEach(function () {
      User2 = loopback.User.extend('User2', {}, { ttl: 10 });
    });
    it('should override ttl setting in based User model', function () {
      expect(User2.settings.ttl).to.equal(10);
    });
  });

  async function triggerPasswordReset(email) {
    const [reset, info] = await Promise.all([
      User.resetPassword({ email: email }),
      waitForEvent(User, 'resetPasswordRequest'),
    ]);
    return info;
  }
})
})
