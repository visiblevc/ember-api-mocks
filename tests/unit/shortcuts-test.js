import { module, test } from 'qunit';

import { api, build, buildList, seed, setupTest } from '#src/index.ts';

import { API_HOST } from '../config.ts';

module('Unit | type shortcuts through ember-data', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.store = this.owner.lookup('service:store');
  });

  module('activeModel', function () {
    test('find and query', async function (assert) {
      const company = build('company', 'withSubscription', { name: 'Acme' });
      const find = api.find(company);
      const query = api.query('company', buildList('company', 2), {
        meta: { total: 2 },
      });

      const found = await this.store.findRecord('company', String(company.id));
      const list = await this.store.query('company', { page: 1 });

      assert.strictEqual(find.lastCall.url, `${API_HOST}/companies/1`);
      assert.strictEqual(found.name, 'Acme');
      assert.strictEqual(found.subscriptions[0].planId, 'custom');
      assert.strictEqual(query.lastCall.query.page, '1');
      assert.deepEqual(
        list.map(({ id }) => id),
        ['2', '3'],
      );
      assert.deepEqual(list.meta, { total: 2 });
    });

    test('create, update and destroy', async function (assert) {
      const create = api.create('contact', { name: 'From server' });
      const contact = this.store.createRecord('contact', { name: 'Draft' });
      await contact.save();

      assert.strictEqual(create.lastCall.method, 'POST');
      assert.strictEqual(create.lastCall.url, `${API_HOST}/contacts`);
      assert.deepEqual(create.lastCall.body.contact.name, 'Draft');
      assert.strictEqual(contact.id, '1');
      assert.strictEqual(contact.name, 'From server');

      const update = api.update(contact, { name: 'Updated' });
      contact.name = 'Local';
      await contact.save();

      assert.strictEqual(update.lastCall.method, 'PUT');
      assert.strictEqual(update.lastCall.url, `${API_HOST}/contacts/1`);
      assert.strictEqual(update.lastCall.body.contact.name, 'Local');
      assert.strictEqual(contact.name, 'Updated');

      const destroy = api.destroy(contact);
      await contact.destroyRecord();

      assert.strictEqual(destroy.lastCall.method, 'DELETE');
      assert.true(contact.isDeleted);
    });

    test('shortcuts accept a type and an id', async function (assert) {
      const company = seed('company');
      const update = api.update('company', 1, { name: 'Renamed' });
      const destroy = api.destroy('company', 1);

      await company.save();
      await company.destroyRecord();

      assert.strictEqual(update.timesCalled, 1);
      assert.strictEqual(destroy.timesCalled, 1);
    });

    test('update and destroy without an id answer any id', async function (assert) {
      const company = seed('company', { id: 8 });
      const update = api.update('company', { name: 'Any' });
      const destroy = api.destroy('company');

      await company.save();

      assert.strictEqual(company.name, 'Any');

      await company.destroyRecord();

      assert.strictEqual(update.lastCall.params.id, '8');
      assert.strictEqual(destroy.lastCall.params.id, '8');
    });

    test('a create responder can compute the response', async function (assert) {
      api.create('contact', ({ body }) => ({
        contact: { id: 42, name: body.contact.name.toUpperCase() },
      }));
      const contact = this.store.createRecord('contact', { name: 'ada' });

      await contact.save();

      assert.strictEqual(contact.id, '42');
      assert.strictEqual(contact.name, 'ADA');
    });

    test('a failing save surfaces the errors', async function (assert) {
      api.create('contact').fails(422, { errors: { name: ['is taken'] } });
      const contact = this.store.createRecord('contact', { name: 'x' });

      await assert.rejects(contact.save());

      assert.deepEqual(
        contact.errors.errorsFor('name').map(({ message }) => message),
        ['is taken'],
      );
    });
  });

  module('rest', function () {
    test('find, query, create, update and destroy', async function (assert) {
      const post = build('post', 'withComments', 'withAuthor');
      api.find(post);
      api.query('post', [post]);

      const found = await this.store.findRecord('post', '1');
      const list = await this.store.query('post', {});

      assert.strictEqual(found.title, 'Post #1');
      assert.strictEqual(found.author.name, 'Grace');
      assert.strictEqual(found.comments.length, 2);
      assert.strictEqual(list.length, 1);

      const create = api.create('comment', { body: 'Saved' });
      const comment = this.store.createRecord('comment', {
        body: 'Draft',
        post: found,
      });
      await comment.save();

      assert.strictEqual(create.lastCall.url, `${API_HOST}/comments`);
      assert.deepEqual(create.lastCall.body, {
        comment: { body: 'Draft', post: '1' },
      });
      assert.strictEqual(comment.id, '3');
      assert.strictEqual(comment.body, 'Saved');

      const update = api.update(found);
      found.title = 'Edited';
      await found.save();

      assert.strictEqual(update.lastCall.method, 'PUT');
      assert.strictEqual(update.lastCall.body.post.title, 'Edited');

      const destroy = api.destroy(found);
      await found.destroyRecord();

      assert.strictEqual(destroy.timesCalled, 1);
    });
  });

  module('jsonApi', function () {
    test('find and query', async function (assert) {
      const investor = build('investor', 'withPeople', 'withGroup');
      const find = api.find(investor);
      const query = api.query('investor', [investor], {
        meta: { 'record-count': 1 },
      });

      const found = await this.store.findRecord('investor', '1');
      const list = await this.store.query('investor', { include: 'people' });

      assert.strictEqual(find.lastCall.url, `${API_HOST}/investors/1`);
      assert.strictEqual(found.name, 'Investor #1');
      assert.strictEqual(found.group.name, 'Seed');
      assert.deepEqual(
        found.people.map(({ firstName }) => firstName),
        ['Ada', 'Ada'],
      );
      assert.strictEqual(query.lastCall.query.include, 'people');
      assert.strictEqual(list.length, 1);
      assert.deepEqual(list.meta, { 'record-count': 1 });
    });

    test('find serves the document for any id', async function (assert) {
      api.find('investor-group');

      const group = await this.store.findRecord('investor-group', '12');

      assert.strictEqual(group.id, '12');
    });

    test('create without a client id continues the factory sequence', async function (assert) {
      buildList('person', 2);
      build('person', { id: '7' });
      api.create('person');
      api.create('investor-group');
      const person = this.store.createRecord('person', { firstName: 'C' });
      const group = this.store.createRecord('investor-group', { name: 'x' });

      await person.save();
      await group.save();

      assert.strictEqual(person.id, '8');
      assert.strictEqual(group.id, '1');
    });

    test('create takes a client id from the body', async function (assert) {
      const create = api.create('investor', { name: 'Saved' });
      const investor = this.store.createRecord('investor', {
        id: 'abc',
        name: 'Draft',
      });

      await investor.save();

      assert.strictEqual(create.lastCall.url, `${API_HOST}/investors`);
      assert.deepEqual(create.lastCall.body.data.attributes, { name: 'Draft' });
      assert.strictEqual(investor.id, 'abc');
      assert.strictEqual(investor.name, 'Saved');
    });

    test('update uses PATCH with a { data } body, destroy uses DELETE', async function (assert) {
      const investor = seed('investor', { name: 'Old' });
      const update = api.update(investor, { name: 'From server' });
      const match = api
        .update('investor', investor.id)
        .match({ data: { attributes: { name: 'Never' } } });

      investor.name = 'New';
      await investor.save();

      assert.strictEqual(update.lastCall.method, 'PATCH');
      assert.strictEqual(update.lastCall.url, `${API_HOST}/investors/1`);
      assert.deepEqual(update.lastCall.body.data.attributes, { name: 'New' });
      assert.strictEqual(update.lastCall.body.data.type, 'investors');
      assert.strictEqual(match.timesCalled, 0);
      assert.strictEqual(investor.name, 'From server');

      const destroy = api.destroy(investor);
      await investor.destroyRecord();

      assert.strictEqual(destroy.lastCall.method, 'DELETE');
    });
  });
});
