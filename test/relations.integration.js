// Copyright IBM Corp. 2013,2019. All Rights Reserved.
// Node module: loopback
// This file is licensed under the MIT License.
// License text available at https://opensource.org/licenses/MIT

'use strict';
const path = require('node:path');
const assert = require('node:assert');
const loopback = require('../');
const lt = require('./helpers/loopback-testing-helper');
const SIMPLE_APP = path.join(__dirname, 'fixtures', 'simple-integration-app');
const app = require(path.join(SIMPLE_APP, 'server/server.js'));
const expect = require('./helpers/expect');
const debug = require('debug')('loopback:test:relations.integration')

describe('relations - integration', function() {
  lt.beforeEach.withApp(app)
  lt.beforeEach.givenModel('store')

  beforeEach(async function() {
    this.widgetName = 'foo';
    await this.store.widgets.create({
      name: this.widgetName
    })
  })

  afterEach(async function() {
    await this.app.models.widget.destroyAll();
  });

  describe('polymorphicHasMany', function() {
    before(function defineProductAndCategoryModels() {
      const Team = app.registry.createModel('Team', {name: 'string'});
      const Reader = app.registry.createModel('Reader', {name: 'string'});
      const Picture = app.registry.createModel('Picture',
        {name: 'string', imageableId: 'number', imageableType: 'string'});

      app.model(Team, {dataSource: 'db'});
      app.model(Reader, {dataSource: 'db'});
      app.model(Picture, {dataSource: 'db'});

      Reader.hasMany(Picture, {polymorphic: { // alternative syntax
        as: 'imageable', // if not set, default to: reference
        foreignKey: 'imageableId', // defaults to 'as + Id'
        discriminator: 'imageableType', // defaults to 'as + Type'
      }});

      Picture.belongsTo('imageable', {polymorphic: {
        foreignKey: 'imageableId',
        discriminator: 'imageableType',
      }});

      Reader.belongsTo(Team);
    });

    before(function createEvent(done) {
      const test = this;
      app.models.Team.create({name: 'Team 1'},
        function(err, team) {
          if (err) return done(err);

          test.team = team;
          app.models.Reader.create({name: 'Reader 1'},
            function(err, reader) {
              if (err) return done(err);

              test.reader = reader;
              reader.pictures.create({name: 'Picture 1'});
              reader.pictures.create({name: 'Picture 2'});
              reader.team(test.team);
              reader.save(done);
            });
        });
    });

    after(async function() {
      await this.app.models.Reader.destroyAll()
    })

    it('includes the related child model', async function() {
      const url = '/api/readers/' + this.reader.id;
      const res = await this.get(url)
        .query({'filter': {'include': 'pictures'}})
        .expect(200)

      expect(res.body.name).to.be.equal('Reader 1')
      expect(res.body.pictures).to.be.eql([
        {name: 'Picture 1', id: 1, imageableId: 1, imageableType: 'Reader'},
        {name: 'Picture 2', id: 2, imageableId: 1, imageableType: 'Reader'},
      ])
    })

    it('includes the related parent model', async function() {
      const url = '/api/pictures';
      const res = await this.get(url)
        .query({'filter': {'include': 'imageable'}})
        .expect(200)

      expect(res.body[0].name).to.be.equal('Picture 1')
      expect(res.body[1].name).to.be.equal('Picture 2')
      expect(res.body[0].imageable).to.be.eql({name: 'Reader 1', id: 1, teamId: 1})
    })

    it('includes related models scoped to the related parent model', async function() {
      const url = '/api/pictures';
      const res = await this.get(url)
        .query({'filter': {'include': {
          'relation': 'imageable',
          'scope': {'include': 'team'},
        }}})
        .expect(200)

      expect(res.body[0].name).to.be.equal('Picture 1')
      expect(res.body[1].name).to.be.equal('Picture 2')
      expect(res.body[0].imageable.name).to.be.eql('Reader 1')
      expect(res.body[0].imageable.team).to.be.eql({name: 'Team 1', id: 1})
    })
  })

  describe('/store/superStores', function() {
    it('should invoke scoped methods remotely', async function() {
      const res = await this.get('/api/stores/superStores')
        .expect(200)

      expect(res.body).to.be.an('array')
    })
  })

  describe('/store/:id/widgets', function() {
    beforeEach(function() {
      this.url = '/api/stores/' + this.store.id + '/widgets';
    })

    lt.describe.whenCalledRemotely('GET', '/api/stores/:id/widgets', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
      })

      describe('widgets (response.body)', function() {
        beforeEach(function() {
          debug('GET /api/stores/:id/widgets response: %s' +
              '\nheaders: %j\nbody string: %s',
          this.res.statusCode,
          this.res.headers,
          this.res.text);
          this.widgets = this.res.body;
          this.widget = this.res.body && this.res.body[0];
        })

        it('should be an array', function() {
          assert(Array.isArray(this.widgets))
        })

        it('should include a single widget', function() {
          assert(this.widgets.length === 1);
          assert(this.widget)
        })

        it('should be a valid widget', function() {
          assert(this.widget.id)
          assert.equal(this.widget.storeId, this.store.id)
          assert.equal(this.widget.name, this.widgetName)
        })
      })
    })

    describe('POST /api/store/:id/widgets', function() {
      beforeEach(function() {
        this.newWidgetName = 'baz';
        this.newWidget = {
          name: this.newWidgetName,
        };
      })

      beforeEach(function(done) {
        this.http = this.post(this.url, this.newWidget);
        this.http.send(this.newWidget);
        this.http.end(function(err) {
          if (err) return done(err);

          this.req = this.http.req;
          this.res = this.http.response;

          done();
        }.bind(this));
      })

      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
      })

      describe('widget (response.body)', function() {
        beforeEach(function() {
          this.widget = this.res.body;
        })

        it('should be an object', function() {
          assert(typeof this.widget === 'object');
          assert(!Array.isArray(this.widget));
        })

        it('should be a valid widget', function() {
          assert(this.widget.id);
          assert.equal(this.widget.storeId, this.store.id);
          assert.equal(this.widget.name, this.newWidgetName)
        })
      })

      it('should have a single widget with storeId', async function() {
        const count = await this.app.models.widget.count({
          storeId: this.store.id,
        })
        assert.equal(count, 2)
      })
    })

    describe('PUT /api/store/:id/widgets/:fk', function() {
      beforeEach(async function() {
        this.widget = await this.store.widgets.create({
          name: this.widgetName,
        })
        this.url = '/api/stores/' + this.store.id + '/widgets/' + this.widget.id
      })

      it('does not add default properties to request body', async function() {
        await this.put(this.url)
          .send({active: true})
          .expect(200)

        const widget = await this.app.models.widget.findById(this.widget.id)
        expect(widget.name).to.equal(this.widgetName)
        expect(widget.active).to.equal(true)
      })
    })
  })

  describe('/stores/:id/widgets/:fk - 200', function() {
    beforeEach(async function() {
      this.widget = await this.store.widgets.create({
        name: this.widgetName,
      })
      this.url = '/api/stores/' + this.store.id + '/widgets/' + this.widget.id
    })

    lt.describe.whenCalledRemotely('GET', '/stores/:id/widgets/:fk', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
        assert.equal(this.res.body.id, this.widget.id);
      });
    });
  });

  describe('/stores/:id/widgets/:fk - 404', function() {
    beforeEach(function() {
      this.url = '/api/stores/' + this.store.id + '/widgets/123456';
    })

    lt.describe.whenCalledRemotely('GET', '/stores/:id/widgets/:fk', function() {
      it('should fail with statusCode 404', function() {
        assert.equal(this.res.statusCode, 404);
        assert.equal(this.res.body.error.statusCode, 404);
      });
    });
  });

  describe('/store/:id/widgets/count', function() {
    beforeEach(function() {
      this.url = '/api/stores/' + this.store.id + '/widgets/count';
    })

    lt.describe.whenCalledRemotely('GET', '/api/stores/:id/widgets/count', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
      });
      it('should return the count', function() {
        assert.equal(this.res.body.count, 1);
      });
    });
  });

  describe('/store/:id/widgets/count - filtered (matches)', function() {
    beforeEach(function() {
      this.url = '/api/stores/' + this.store.id + '/widgets/count?where[name]=foo';
    })

    lt.describe.whenCalledRemotely('GET', '/api/stores/:id/widgets/count?where[name]=foo', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
      });
      it('should return the count', function() {
        assert.equal(this.res.body.count, 1);
      });
    });
  });

  describe('/store/:id/widgets/count - filtered (no matches)', function() {
    beforeEach(function() {
      this.url = '/api/stores/' + this.store.id + '/widgets/count?where[name]=bar';
    })

    lt.describe.whenCalledRemotely('GET', '/api/stores/:id/widgets/count?where[name]=bar', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
      });
      it('should return the count', function() {
        assert.equal(this.res.body.count, 0);
      });
    });
  });

  describe('/widgets/:id/store', function() {
    beforeEach(async function() {
      this.widget = await this.store.widgets.create({
        name: this.widgetName,
      })
      this.url = '/api/widgets/' + this.widget.id + '/store'
    })

    lt.describe.whenCalledRemotely('GET', '/api/widgets/:id/store', function() {
      it('should succeed with statusCode 200', function() {
        assert.equal(this.res.statusCode, 200);
        assert.equal(this.res.body.id, this.store.id);
      });
    });
  });

  describe('hasMany through', function() {
    async function setup(connecting) {
      const root = {};

      // Clean up models
      await app.models.physician.destroyAll()
      await app.models.patient.destroyAll()
      await app.models.appointment.destroyAll()

      // Create a physician
      root.physician = await app.models.physician.create({name: 'ph1'})

      // Create a patient based on "connecting" flag
      if (connecting) {
        root.patient = await root.physician.patients.create({name: 'pa1'})
      }
      else {
        root.patient = await app.models.patient.create({name: 'pa1'})
      }
      root.relUrl =
        '/api/physicians/' +
        root.physician.id +
        '/patients/rel/' +
        root.patient.id;

      return root
    }

    describe('PUT /physicians/:id/patients/rel/:fk', function() {
      before(async function() {
        const root = await setup(false)
        this.url = root.relUrl
        this.patient = root.patient
        this.physician = root.physician
      })

      lt.describe.whenCalledRemotely('PUT', '/api/physicians/:id/patients/rel/:fk', function() {
        it('should succeed with statusCode 200', function() {
          assert.equal(this.res.statusCode, 200);
          assert.equal(this.res.body.patientId, this.patient.id);
          assert.equal(this.res.body.physicianId, this.physician.id);
        });

        it('should create a record in appointment', async function() {
          const apps = await this.app.models.appointment.find()
          assert.equal(apps.length, 1)
          assert.equal(apps[0].patientId, this.patient.id)
        })

        it('should connect physician to patient', async function() {
          const patients = await this.physician.patients.find()
          assert.equal(patients.length, 1)
          assert.equal(patients[0].id, this.patient.id)
        })
      })
    })

    describe('PUT /physicians/:id/patients/rel/:fk with data', function() {
      before(async function() {
        const root = await setup(false)
        this.url = root.relUrl
        this.patient = root.patient
        this.physician = root.physician
      })

      const NOW = Date.now();
      const data = {date: new Date(NOW)};

      lt.describe.whenCalledRemotely('PUT', '/api/physicians/:id/patients/rel/:fk', data, function() {
        it('should succeed with statusCode 200', function() {
          assert.equal(this.res.statusCode, 200);
          assert.equal(this.res.body.patientId, this.patient.id);
          assert.equal(this.res.body.physicianId, this.physician.id);
          assert.equal(new Date(this.res.body.date).getTime(), NOW);
        });

        it('should create a record in appointment', async function() {
          const apps = await this.app.models.appointment.find()
          assert.equal(apps.length, 1)
          assert.equal(apps[0].patientId, this.patient.id)
          assert.equal(apps[0].physicianId, this.physician.id)
          assert.equal(apps[0].date.getTime(), NOW)
        })

        it('should connect physician to patient', async function() {
          const patients = await this.physician.patients.find()
          assert.equal(patients.length, 1)
          assert.equal(patients[0].id, this.patient.id)
        })
      })
    })

    describe('HEAD /physicians/:id/patients/rel/:fk', function() {
      before(async function() {
        const root = await setup(true)
        this.url = root.relUrl
        this.patient = root.patient
        this.physician = root.physician
      })

      lt.describe.whenCalledRemotely('HEAD', '/api/physicians/:id/patients/rel/:fk', function() {
        it('should succeed with statusCode 200', function() {
          assert.equal(this.res.statusCode, 200);
        });
      });
    });

    describe('HEAD /physicians/:id/patients/rel/:fk that does not exist', function() {
      before(async function() {
        const root = await setup(true)
        this.url = '/api/physicians/' + root.physician.id +
          '/patients/rel/' + '999'
        this.patient = root.patient
        this.physician = root.physician
      })

      lt.describe.whenCalledRemotely('HEAD', '/api/physicians/:id/patients/rel/:fk', function() {
        it('should succeed with statusCode 404', function() {
          assert.equal(this.res.statusCode, 404);
        });
      });
    });

    describe('DELETE /physicians/:id/patients/rel/:fk', function() {
      before(async function() {
        const root = await setup(true)
        this.url = root.relUrl
        this.patient = root.patient
        this.physician = root.physician
      })

      it('should create a record in appointment', async function() {
        const apps = await this.app.models.appointment.find()
        assert.equal(apps.length, 1)
        assert.equal(apps[0].patientId, this.patient.id)
      })

      it('should connect physician to patient', async function() {
        const patients = await this.physician.patients.find()
        assert.equal(patients.length, 1)
        assert.equal(patients[0].id, this.patient.id)
      })

      lt.describe.whenCalledRemotely('DELETE', '/api/physicians/:id/patients/rel/:fk', function() {
        it('should succeed with statusCode 204', function() {
          assert.equal(this.res.statusCode, 204);
        });

        it('should remove the record in appointment', async function() {
          const apps = await this.app.models.appointment.find()
          assert.equal(apps.length, 0)
        })

        it('should remove the connection between physician and patient', async function() {
          // Need to refresh the cache
          const patients = await this.physician.patients.find(true)
          assert.equal(patients.length, 0)
        })
      })
    })

    describe('GET /physicians/:id/patients/:fk', function() {
      before(async function() {
        const root = await setup(true)
        this.url = '/api/physicians/' + root.physician.id +
          '/patients/' + root.patient.id
        this.patient = root.patient
        this.physician = root.physician
      })

      lt.describe.whenCalledRemotely('GET', '/api/physicians/:id/patients/:fk', function() {
        it('should succeed with statusCode 200', function() {
          assert.equal(this.res.statusCode, 200);
          assert.equal(this.res.body.id, this.physician.id);
        });
      });
    });

    describe('DELETE /physicians/:id/patients/:fk', function() {
      before(async function() {
        const root = await setup(true)
        this.url = '/api/physicians/' + root.physician.id +
          '/patients/' + root.patient.id
        this.patient = root.patient
        this.physician = root.physician
      })

      lt.describe.whenCalledRemotely('DELETE', '/api/physicians/:id/patients/:fk', function() {
        it('should succeed with statusCode 204', function() {
          assert.equal(this.res.statusCode, 204);
        });

        it('should remove the record in appointment', async function() {
          const apps = await this.app.models.appointment.find()
          assert.equal(apps.length, 0)
        })

        it('should remove the connection between physician and patient', async function() {
          // Need to refresh the cache
          const patients = await this.physician.patients.find(true)
          assert.equal(patients.length, 0)
        })

        it('should remove the record in patient', async function() {
          const patients = await this.app.models.patient.find()
          assert.equal(patients.length, 0)
        })
      })
    })
  })

  describe('hasAndBelongsToMany', function() {
    beforeEach(function defineProductAndCategoryModels() {
      // Disable "Warning: overriding remoting type product"
      this.app.remotes()._typeRegistry._options.warnWhenOverridingType = false;

      const product = app.registry.createModel(
        'product',
        {id: 'string', name: 'string'},
      );
      const category = app.registry.createModel(
        'category',
        {id: 'string', name: 'string'},
      );
      app.model(product, {dataSource: 'db'});
      app.model(category, {dataSource: 'db'});

      product.hasAndBelongsToMany(category);
      category.hasAndBelongsToMany(product);
    });

    lt.beforeEach.givenModel('category');

    beforeEach(async function createProductsInCategory() {
      this.product = await this.category.products.create({ name: 'a-product' })
    })

    beforeEach(async function createAnotherCategoryAndProduct() {
      const cat = await app.models.category.create({ name: 'another-category' })
      await cat.products.create({ name: 'another-product' })
    })

    afterEach(async function() {
      await this.app.models.product.destroyAll()
    })

    it.skip('allows to find related objects via where filter', async function() {
      // TODO https://github.com/strongloop/loopback-datasource-juggler/issues/94
      const expectedProduct = this.product;
      const res = await this.get('/api/products?filter[where][categoryId]=' + this.category.id)

      expect(res.body).to.eql([
        {
          id: expectedProduct.id,
          name: expectedProduct.name,
        },
      ])
    })

    it('allows to find related object via URL scope', async function() {
      const expectedProduct = this.product;
      const res = await this.get('/api/categories/' + this.category.id + '/products')

      expect(res.body).to.eql([
        {
          id: expectedProduct.id,
          name: expectedProduct.name,
        },
      ])
    })

    it('includes requested related models in `find`', async function() {
      const expectedProduct = this.product;
      const url = '/api/categories/findOne?filter[where][id]=' +
        this.category.id + '&filter[include]=products';

      const res = await this.get(url)

      expect(res.body).to.have.property('products');
      expect(res.body.products).to.eql([
        {
          id: expectedProduct.id,
          name: expectedProduct.name,
        },
      ])
    })

    it.skip('includes requested related models in `findById`', async function() {
      // TODO https://github.com/strongloop/loopback-datasource-juggler/issues/93
      const expectedProduct = this.product;
      // Note: the URL format is not final
      const url = '/api/categories/' + this.category.id + '?include=products';

      const res = await this.get(url)

      expect(res.body).to.have.property('products');
      expect(res.body.products).to.eql([
        {
          id: expectedProduct.id,
          name: expectedProduct.name,
        },
      ])
    })
  })

  describe('embedsOne', function() {
    before(function defineGroupAndPosterModels() {
      const group = app.registry.createModel(
        'group',
        {name: 'string'},
        {plural: 'groups'},
      );
      app.model(group, {dataSource: 'db'});

      const poster = app.registry.createModel(
        'poster',
        {url: 'string'},
      );
      app.model(poster, {dataSource: 'db'});

      group.embedsOne(poster, {as: 'cover'});
    });

    before(async function createImage() {
      this.group = await app.models.group.create({ name: 'Group 1' })
    })

    after(async function() {
      await this.app.models.group.destroyAll()
    })

    it('creates an embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      const res = await this.post(url)
        .send({url: 'http://image.url'})
        .expect(200)

      expect(res.body).to.be.eql({url: 'http://image.url'})
    })

    it('includes the embedded models', async function() {
      const url = '/api/groups/' + this.group.id;
      const res = await this.get(url)

      expect(res.body.name).to.be.equal('Group 1');
      expect(res.body.poster).to.be.eql({url: 'http://image.url'})
    })

    it('returns the embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      const res = await this.get(url)

      expect(res.body).to.be.eql({url: 'http://image.url'})
    })

    it('updates an embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      const res = await this.put(url)
        .send({url: 'http://changed.url'})
        .expect(200)

      expect(res.body.url).to.be.equal('http://changed.url')
    })

    it('returns the updated embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      const res = await this.get(url)

      expect(res.body).to.be.eql({url: 'http://changed.url'})
    })

    it('deletes an embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      await this.del(url).expect(204)
    })

    it('deleted the embedded model', async function() {
      const url = '/api/groups/' + this.group.id + '/cover';
      await this.get(url).expect(404)
    })
  })

  describe('embedsMany', function() {
    before(function defineProductAndCategoryModels() {
      const todoList = app.registry.createModel(
        'todoList',
        {name: 'string'},
        {plural: 'todo-lists'},
      );
      app.model(todoList, {dataSource: 'db'});

      const todoItem = app.registry.createModel(
        'todoItem',
        {content: 'string'}, {forceId: false},
      );
      app.model(todoItem, {dataSource: 'db'});

      todoList.embedsMany(todoItem, {as: 'items'});
    });

    before(async function createTodoList() {
      this.todoList = await app.models.todoList.create({name: 'List A'})
      this.todoList.items.build({content: 'Todo 1'})
      this.todoList.items.build({content: 'Todo 2'})
      await this.todoList.save()
    })

    after(async function() {
      await this.app.models.todoList.destroyAll()
    })

    it('includes the embedded models', async function() {
      const url = '/api/todo-lists/' + this.todoList.id;
      const res = await this.get(url).expect(200)

      expect(res.body.name).to.be.equal('List A')
      expect(res.body.todoItems).to.be.eql([
        {content: 'Todo 1', id: 1},
        {content: 'Todo 2', id: 2},
      ])
    })

    it('returns the embedded models', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {content: 'Todo 1', id: 1},
        {content: 'Todo 2', id: 2},
      ])
    })

    it('filters the embedded models', async function() {
      let url = '/api/todo-lists/' + this.todoList.id + '/items';
      url += '?filter[where][id]=2';

      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {content: 'Todo 2', id: 2},
      ])
    })

    it('creates embedded models', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items';
      const expected = {content: 'Todo 3', id: 3};
      const res = await this.post(url)
        .send({content: 'Todo 3'})
        .expect(200)

      expect(res.body).to.be.eql(expected)
    })

    it('includes the created embedded model', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {content: 'Todo 1', id: 1},
        {content: 'Todo 2', id: 2},
        {content: 'Todo 3', id: 3},
      ])
    })

    it('returns an embedded model by (internal) id', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items/3';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql({content: 'Todo 3', id: 3})
    })

    it('removes an embedded model', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items/2';
      await this.del(url).expect(204)
    })

    it('returns the embedded models - verify', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {content: 'Todo 1', id: 1},
        {content: 'Todo 3', id: 3},
      ])
    })

    it('returns a 404 response when embedded model is not found', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items/2'
      const res = await this.get(url).expect(404)

      expect(res.body.error.status).to.be.equal(404);
      expect(res.body.error.message).to.be.equal('Unknown "todoList" id "2".');
      expect(res.body.error.code).to.be.equal('MODEL_NOT_FOUND');
    })

    it('checks if an embedded model exists - ok', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items/3'
      await this.head(url).expect(200)
    })

    it('checks if an embedded model exists - fail', async function() {
      const url = '/api/todo-lists/' + this.todoList.id + '/items/2'
      await this.head(url).expect(404)
    })
  })

  describe('referencesMany', function() {
    before(function defineProductAndCategoryModels() {
      const recipe = app.registry.createModel(
        'recipe',
        {name: 'string'},
      );
      app.model(recipe, {dataSource: 'db'});

      const ingredient = app.registry.createModel(
        'ingredient',
        {name: 'string'},
      );
      app.model(ingredient, {dataSource: 'db'});

      const photo = app.registry.createModel(
        'photo',
        {name: 'string'},
      );
      app.model(photo, {dataSource: 'db'});

      recipe.referencesMany(ingredient);
      // contrived example for test:
      recipe.hasOne(photo, {
        as: 'picture',
        options: { http: {path: 'image'} }
      })
    })

    before(async function createRecipe() {
      this.recipe = await app.models.recipe.create({name: 'Recipe'})
      const ing = await this.recipe.ingredients.create({name: 'Chocolate'})
      this.ingredient1 = ing.id
      await this.recipe.picture.create({name: 'Photo 1'})
    })

    before(async function createIngredient() {
      const ing = await app.models.ingredient.create({name: 'Sugar'})
      this.ingredient2 = ing.id
    })

    after(async function() {
      await this.app.models.recipe.destroyAll()
      await this.app.models.ingredient.destroyAll()
      await this.app.models.photo.destroyAll()
    })

    it('keeps an array of ids', async function() {
      const url = '/api/recipes/' + this.recipe.id;
      const res = await this.get(url).expect(200)

      expect(res.body.ingredientIds).to.eql([this.ingredient1])
      expect(res.body).to.not.have.property('ingredients')
    })

    it('creates referenced models', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/ingredients';
      const res = await this.post(url)
        .send({ name: 'Butter' })
        .expect(200)

      expect(res.body.name).to.be.eql('Butter')
      this.ingredient3 = res.body.id
    })

    it('has created models', async function() {
      const url = '/api/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Sugar', id: this.ingredient2},
        {name: 'Butter', id: this.ingredient3},
      ])
    })

    it('returns the referenced models', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Butter', id: this.ingredient3},
      ])
    })

    it('filters the referenced models', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients';
      url += '?filter[where][name]=Butter';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Butter', id: this.ingredient3},
      ])
    })

    it('includes the referenced models', async function() {
      let url = '/api/recipes/findOne?filter[where][id]=' + this.recipe.id;
      url += '&filter[include]=ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body.ingredients).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Butter', id: this.ingredient3},
      ])

      expect(res.body.ingredientIds).to.eql([
        this.ingredient1, this.ingredient3,
      ])
    })

    it('returns a referenced model by id', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients/';
      url += this.ingredient3;
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql({name: 'Butter', id: this.ingredient3})
    })

    it('keeps an array of ids - verify', async function() {
      const url = '/api/recipes/' + this.recipe.id;
      const res = await this.get(url).expect(200)
      const expected = [this.ingredient1, this.ingredient3];

      expect(res.body.ingredientIds).to.eql(expected);
      expect(res.body).to.not.have.property('ingredients');
    })

    it('destroys a referenced model', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients/';
      url += this.ingredient3;

      await this.del(url).expect(204)
    })

    it('has destroyed a referenced model', async function() {
      const url = '/api/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Sugar', id: this.ingredient2},
      ])
    })

    it('returns the referenced models without the deleted one', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
      ])
    })

    it('creates/links a reference by id', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients';
      url += '/rel/' + this.ingredient2;

      const res = await this.put(url).expect(200)
      expect(res.body).to.be.eql({name: 'Sugar', id: this.ingredient2})
    })

    it('returns the referenced models - verify', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Sugar', id: this.ingredient2},
      ])
    })

    it('removes/unlinks a reference by id', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients';
      url += '/rel/' + this.ingredient1;
      await this.del(url).expect(204)
    })

    it('returns the referenced models without the unlinked one', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Sugar', id: this.ingredient2},
      ])
    })

    it('has not destroyed an unlinked model', async function() {
      const url = '/api/ingredients';
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.eql([
        {name: 'Chocolate', id: this.ingredient1},
        {name: 'Sugar', id: this.ingredient2},
      ])
    })

    it('uses a custom relation path', async function() {
      const url = '/api/recipes/' + this.recipe.id + '/image';
      const res = await this.get(url).expect(200)

      expect(res.body.name).to.equal('Photo 1')
    })

    it.skip('checks if a referenced model exists - ok', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients/';
      url += this.ingredient1;

      await this.head(url).expect(200)
    })

    it('checks if an referenced model exists - fail', async function() {
      let url = '/api/recipes/' + this.recipe.id + '/ingredients/';
      url += this.ingredient3;

      await this.head(url).expect(404)
    })
  })

  describe('nested relations', function() {
    let accessOptions;

    before(function defineModels() {
      const Book = app.registry.createModel(
        'Book',
        {name: 'string'},
        {plural: 'books'},
      );
      app.model(Book, {dataSource: 'db'});

      const Page = app.registry.createModel(
        'Page',
        {name: 'string'},
        {plural: 'pages'},
      );
      app.model(Page, {dataSource: 'db'});

      const Image = app.registry.createModel(
        'Image',
        {name: 'string'},
        {plural: 'images'},
      );
      app.model(Image, {dataSource: 'db'});

      const Note = app.registry.createModel(
        'Note',
        {text: 'string'},
        {plural: 'notes'},
      );
      app.model(Note, {dataSource: 'db'});

      const Chapter = app.registry.createModel(
        'Chapter',
        {name: 'string'},
        {plural: 'chapters'},
      );
      app.model(Chapter, {dataSource: 'db'});

      Book.hasMany(Page, {options: {nestRemoting: true}});
      Book.hasMany(Chapter);
      Page.hasMany(Note);
      Page.belongsTo(Book, {options: {nestRemoting: true}});
      Chapter.hasMany(Note);
      Image.belongsTo(Book);

      // fake a remote method that match the filter in Model.nestRemoting()
      Page.prototype['__throw__errors'] = function() {
        throw new Error('This should not crash the app');
      };

      Page.remoteMethod('__throw__errors', {isStatic: false, http: {path: '/throws', verb: 'get'},
        accepts: [{arg: 'options', type: 'object', http: 'optionsFromRequest'}]});

      // Now `pages` has nestRemoting set to true and no need to call nestRemoting()
      // Book.nestRemoting('pages');
      Book.nestRemoting('chapters');
      Image.nestRemoting('book');

      expect(Book.prototype['__findById__pages']).to.be.a('function');
      expect(Image.prototype['__get__book']).to.be.a('function');

      Page.beforeRemote('prototype.__findById__notes', function(ctx, result, next) {
        ctx.res.set('x-before', 'before');

        next();
      });

      Page.afterRemote('prototype.__findById__notes', function(ctx, result, next) {
        ctx.res.set('x-after', 'after')
        next();
      });

      Page.observe('access', function(ctx, next) {
        accessOptions = ctx.options;
        next();
      });
    });

    beforeEach(function resetAccessOptions() {
      accessOptions = 'access hook not triggered';
    });

    before(async function createBook() {
      this.book = await app.models.Book.create({name: 'Book 1'})
      this.page = await this.book.pages.create({name: 'Page 1'})
      this.note = await this.page.notes.create({text: 'Page Note 1'})
    })

    before(async function createChapters() {
      this.chapter = await this.book.chapters.create({name: 'Chapter 1'})
      this.cnote = await this.chapter.notes.create({text: 'Chapter Note 1'})
    })

    before(async function createCover() {
      this.image = await app.models.Image.create({name: 'Cover 1', book: this.book})
    })

    it('has regular relationship routes - pages', async function() {
      const url = '/api/books/' + this.book.id + '/pages'
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.an('array')
      expect(res.body).to.have.length(1)
      expect(res.body[0].name).to.equal('Page 1')
    })

    it('has regular relationship routes - notes', async function() {
      const url = '/api/pages/' + this.page.id + '/notes/' + this.note.id
      const res = await this.get(url).expect(200)

      expect(res.headers['x-before']).to.equal('before')
      expect(res.headers['x-after']).to.equal('after')
      expect(res.body).to.be.an('object')
      expect(res.body.text).to.equal('Page Note 1')
    })

    it('has a basic error handler', async function() {
      const url = '/api/books/unknown/pages/' + this.page.id + '/notes'
      const res = await this.get(url).expect(404)

      expect(res.body.error).to.be.an('object')
      const expected = 'could not find a model with id unknown'
      expect(res.body.error.message).to.equal(expected)
      expect(res.body.error.code).to.be.equal('MODEL_NOT_FOUND')
    })

    it('enables nested relationship routes - belongsTo find', async function() {
      const url = '/api/images/' + this.image.id + '/book/pages'
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.an('array')
      expect(res.body).to.have.length(1)
      expect(res.body[0].name).to.equal('Page 1')
    })

    it('enables nested relationship routes - belongsTo findById', async function() {
      const url = '/api/images/' + this.image.id + '/book/pages/' + this.page.id
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.an('object')
      expect(res.body.name).to.equal('Page 1')
    })

    it('enables nested relationship routes - hasMany find', async function() {
      const url = '/api/books/' + this.book.id + '/pages/' + this.page.id + '/notes'
      const res = await this.get(url).expect(200)

      expect(res.body).to.be.an('array')
      expect(res.body).to.have.length(1)
      expect(res.body[0].text).to.equal('Page Note 1')
    })

    it('enables nested relationship routes - hasMany findById', async function() {
      const url = '/api/books/' + this.book.id + '/pages/' + this.page.id + '/notes/' + this.note.id
      const res = await this.get(url).expect(200)

      expect(res.headers['x-before']).to.equal('before')
      expect(res.headers['x-after']).to.equal('after')
      expect(res.body).to.be.an('object')
      expect(res.body.text).to.equal('Page Note 1')
    })

    it('passes options to nested relationship routes', async function() {
      const url = '/api/books/' + this.book.id + '/pages/' + this.page.id + '/notes/' + this.note.id

      await this.get(url).expect(200)
      expect(accessOptions).to.have.property('accessToken')
    })

    it('should nest remote hooks of ModelTo - hasMany findById', async function() {
      const url = '/api/books/' + this.book.id + '/chapters/' + this.chapter.id + '/notes/' + this.cnote.id
      const res = await this.get(url).expect(200)

      expect(res.headers['x-before']).to.be.undefined()
      expect(res.headers['x-after']).to.be.undefined()
    })

    it('should have proper http.path for remoting', function() {
      [app.models.Book, app.models.Image].forEach(function(Model) {
        Model.sharedClass.methods().forEach(function(method) {
          const http = Array.isArray(method.http) ? method.http : [method.http];
          http.forEach(function(opt) {
            // destroyAll has been shared but missing http property
            if (opt.path === undefined) return;

            expect(opt.path, method.stringName).to.match(/^\/.*/);
          });
        });
      });
    });

    it('should catch error if nested function throws', async function() {
      const url = '/api/books/' + this.book.id + '/pages/' + this.page.id + '/throws'
      const res = await this.get(url).expect(500)

      expect(res.body).to.be.an('object')
      expect(res.body.error).to.be.an('object')
      expect(res.body.error.name).to.equal('Error')
      expect(res.body.error.statusCode).to.equal(500)
      expect(res.body.error.message).to.equal('This should not crash the app')
    })
  })

  describe('hasOne', function() {
    let cust;

    before(async function createCustomer() {
      cust = await app.models.customer.create({name: 'John'})
    })

    after(async function() {
      await app.models.customer.destroyAll()
      await app.models.profile.destroyAll()
    })

    it('should create the referenced model', async function() {
      const url = '/api/customers/' + cust.id + '/profile';
      const res = await this.post(url)
        .send({points: 10})
        .expect(200)

      expect(res.body.points).to.be.eql(10)
      expect(res.body.customerId).to.be.eql(cust.id)
    })

    it('should find the referenced model', async function() {
      const url = '/api/customers/' + cust.id + '/profile';
      const res = await this.get(url).expect(200)

      expect(res.body.points).to.be.eql(10)
      expect(res.body.customerId).to.be.eql(cust.id)
    })

    it('should not create the referenced model twice', function(done) {
      const url = '/api/customers/' + cust.id + '/profile';
      this.post(url)
        .send({points: 20})
        .expect(500, function(err, res) {
          done(err);
        });
    });

    it('should update the referenced model', async function() {
      const url = '/api/customers/' + cust.id + '/profile';
      const res = await this.put(url)
        .send({points: 100})
        .expect(200)

      expect(res.body.points).to.be.eql(100)
      expect(res.body.customerId).to.be.eql(cust.id)
    })

    it('should delete the referenced model', async function() {
      const url = '/api/customers/' + cust.id + '/profile';
      await this.del(url).expect(204)
    })

    it('should not find the referenced model', async function() {
      const url = '/api/customers/' + cust.id + '/profile'
      const res = await this.get(url).expect(404)
      expect(res.body.error.code).to.be.equal('MODEL_NOT_FOUND')
    })
  })
})
