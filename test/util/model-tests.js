// Copyright IBM Corp. 2014,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const assert = require('node:assert');
const describe = require('./describe');
const loopback = require('../../');
const PersistedModel = loopback.PersistedModel;
const TaskEmitter = require('strong-task-emitter');

module.exports = function defineModelTestsWithDataSource(options) {
    describe('Model Tests', function () {
        let User, dataSource;

        if (options.beforeEach) {
            beforeEach(options.beforeEach);
        }

        beforeEach(function () {
            const test = this;

            // setup a model / datasource
            dataSource = this.dataSource || loopback.createDataSource(options.dataSource);

            const extend = PersistedModel.extend;

            // create model hook
            PersistedModel.extend = function () {
                const extendedModel = extend.apply(PersistedModel, arguments);

                if (options.onDefine) {
                    options.onDefine.call(test, extendedModel);
                }

                return extendedModel;
            };

            User = PersistedModel.extend('UtilUser', {
                id: { id: true, type: String, defaultFn: 'guid' },
                'first': String,
                'last': String,
                'age': Number,
                'password': String,
                'gender': String,
                'domain': String,
                'email': String,
            }, {
                trackChanges: options.trackChanges !== false,
                enableRemoteReplication: options.enableRemoteReplication,
            });

            User.attachTo(dataSource);
            User.handleChangeError = function (err) {
                console.warn('WARNING: unhandled change-tracking error');
                console.warn(err);
            };
        });

        describe('Model.validatesPresenceOf(properties...)', function () {
            it('Require a model to include a property to be considered valid', function () {
                User.validatesPresenceOf('first', 'last', 'age');
                const joe = new User({ first: 'joe' });
                assert(joe.isValid() === false, 'model should not validate');
                assert(joe.errors.last, 'should have a missing last error');
                assert(joe.errors.age, 'should have a missing age error');
            });
        });

        describe('Model.validatesLengthOf(property, options)', function () {
            it('Require a property length to be within a specified range', function () {
                User.validatesLengthOf('password', { min: 5, message: { min: 'Password is too short' } });
                const joe = new User({ password: '1234' });
                assert(joe.isValid() === false, 'model should not be valid');
                assert(joe.errors.password, 'should have password error');
            });
        });

        describe('Model.validatesInclusionOf(property, options)', function () {
            it('Require a value for `property` to be in the specified array', function () {
                User.validatesInclusionOf('gender', { in: ['male', 'female'] });
                const foo = new User({ gender: 'bar' });
                assert(foo.isValid() === false, 'model should not be valid');
                assert(foo.errors.gender, 'should have gender error');
            });
        });

        describe('Model.validatesExclusionOf(property, options)', function () {
            it('Require a value for `property` to not exist in the specified array', function () {
                User.validatesExclusionOf('domain', { in: ['www', 'billing', 'admin'] });
                const foo = new User({ domain: 'www' });
                const bar = new User({ domain: 'billing' });
                const bat = new User({ domain: 'admin' });
                assert(foo.isValid() === false);
                assert(bar.isValid() === false);
                assert(bat.isValid() === false);
                assert(foo.errors.domain, 'model should have a domain error');
                assert(bat.errors.domain, 'model should have a domain error');
                assert(bat.errors.domain, 'model should have a domain error');
            });
        });

        describe('Model.validatesNumericalityOf(property, options)', function () {
            it('Require a value for `property` to be a specific type of `Number`', function () {
                User.validatesNumericalityOf('age', { int: true });
                const joe = new User({ age: 10.2 });
                assert(joe.isValid() === false);
                const bob = new User({ age: 0 });
                assert(bob.isValid() === true);
                assert(joe.errors.age, 'model should have an age error');
            });
        });

        describe('myModel.isValid()', function () {
            it('Validate the model instance', function () {
                User.validatesNumericalityOf('age', { int: true });
                const user = new User({ first: 'joe', age: 'flarg' });
                const valid = user.isValid();
                assert(valid === false);
                assert(user.errors.age, 'model should have age error');
            });

            it('Asynchronously validate the model', function (done) {
                User.validatesNumericalityOf('age', { int: true });
                const user = new User({ first: 'joe', age: 'flarg' });
                user.isValid(function (valid) {
                    assert(valid === false);
                    assert(user.errors.age, 'model should have age error');

                    done();
                });
            });
        });

        describe('Model.create([data])', function () {
            it('Create an instance of Model with given data and save to the attached data source',
                async function () {
                    const user = await User.create({ first: 'Joe', last: 'Bob' })
                    assert(user instanceof User)
                })
        })

        describe('model.save([options])', function () {
            it('Save an instance of a Model to the attached data source', async function () {
                const joe = new User({ first: 'Joe', last: 'Bob' });
                await joe.save()
                assert(joe.id)
                assert(!joe.errors)
            })
        })

        describe('model.updateAttributes(data)', function () {
            it('Save specified attributes to the attached data source', async function () {
                const user = await User.create({ first: 'joe', age: 100 })
                assert(!user.errors)
                assert.equal(user.first, 'joe')

                const updatedUser = await user.updateAttributes({
                    first: 'updatedFirst',
                    last: 'updatedLast',
                })
                assert(!updatedUser.errors)
                assert.equal(updatedUser.first, 'updatedFirst')
                assert.equal(updatedUser.last, 'updatedLast')
                assert.equal(updatedUser.age, 100)
            })
        })

        describe('Model.upsert(data)', function () {
            it('Update when record with id=data.id found, insert otherwise', async function () {
                const user = await User.upsert({ first: 'joe', id: 7 })
                assert.equal(user.first, 'joe')

                const updatedUser = await User.upsert({ first: 'bob', id: 7 })
                assert.equal(updatedUser.first, 'bob')
            })
        })

        describe('model.destroy()', function () {
            it('Remove a model from the attached data source', async function () {
                const user = await User.create({ first: 'joe', last: 'bob' })
                const foundUser = await User.findById(user.id)
                assert.equal(user.id, foundUser.id)
                
                await User.deleteById(foundUser.id)
                const found = await User.find({ where: { id: user.id } })
                assert.equal(found.length, 0)
            })
        })

        describe('Model.deleteById(id)', function () {
            it('Delete a model instance from the attached data source', async function () {
                const user = await User.create({ first: 'joe', last: 'bob' })
                await User.deleteById(user.id)
                const notFound = await User.findById(user.id)
                assert.equal(notFound, null)
            })
        })

        describe('Model.exists(id)', function () {
            it('returns true when the model with the given id exists', async function () {
                const user = await User.create({ first: 'max' })
                const exists = await User.exists(user.id)
                assert.equal(exists, true)
            })

            it('returns false when there is no model with the given id', async function () {
                const exists = await User.exists('user-id-does-not-exist')
                assert.equal(exists, false)
            })
        })

        describe('Model.findById(id)', function () {
            it('Find an instance by id', async function () {
                const user = await User.create({ first: 'michael', last: 'jordan', id: 23 })
                const found = await User.findById(user.id)
                assert.equal(user.id, 23)
                assert.equal(user.first, 'michael')
                assert.equal(user.last, 'jordan')
            })
        })

        describe('Model.count([query])', function () {
            it('Query count of Model instances in data source', async function () {
                (new TaskEmitter())
                    .task(User, 'create', { first: 'jill', age: 100 })
                    .task(User, 'create', { first: 'bob', age: 200 })
                    .task(User, 'create', { first: 'jan' })
                    .task(User, 'create', { first: 'sam' })
                    .task(User, 'create', { first: 'suzy' })
                    .on('done', async function () {
                        const count = await User.count({ age: { gt: 99 } })
                        assert.equal(count, 2)
                    })
            })
        })
    })
}
