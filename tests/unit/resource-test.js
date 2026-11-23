import { module, test } from 'qunit';

import { api, build, buildList, setupTest } from '#src/index.ts';

import { API_HOST } from '../config.ts';

module('Unit | api.resource through ember-data', function (hooks) {
  setupTest(hooks);

  hooks.beforeEach(function () {
    this.store = this.owner.lookup('service:store');
  });

  test('activeModel: index, find, create, update and destroy', async function (assert) {
    const contacts = api.resource('contact', buildList('contact', 2));

    const allIds = (await this.store.findAll('contact')).map(({ id }) => id);
    const found = await this.store.findRecord('contact', '2', {
      reload: true,
    });
    const created = this.store.createRecord('contact', { name: 'New' });
    await created.save();

    assert.deepEqual(allIds, ['1', '2']);
    assert.strictEqual(found.name, 'Ada');
    assert.strictEqual(created.id, '3');
    assert.deepEqual(contacts.records.at(-1), {
      id: 3,
      name: 'New',
      company_id: null,
    });
    assert.strictEqual(contacts.create.lastCall.url, `${API_HOST}/contacts`);

    found.name = 'Renamed';
    await found.save();

    assert.strictEqual(contacts.records[1].name, 'Renamed');
    assert.strictEqual(contacts.update.lastCall.method, 'PUT');

    await found.destroyRecord();

    assert.deepEqual(
      contacts.records.map(({ id }) => id),
      [1, 3],
    );
    assert.strictEqual(contacts.destroy.timesCalled, 1);
  });

  test('rest: create stores relationship ids from the body', async function (assert) {
    const posts = api.resource('post', [build('post')]);
    const comments = api.resource('comment');

    const post = await this.store.findRecord('post', '1');
    const comment = this.store.createRecord('comment', { body: 'Hi', post });
    await comment.save();

    assert.strictEqual(posts.find.timesCalled, 1);
    assert.deepEqual(comments.records, [{ id: 1, body: 'Hi', post: '1' }]);
    assert.strictEqual(comment.id, '1');
    assert.strictEqual(comment.post, post);
  });

  test('jsonApi: create, PATCH and a filtered index', async function (assert) {
    const groups = api.resource('investor-group', [build('investor-group')]);
    const investors = api.resource('investor', [], {
      filter: (investor, query) =>
        !query.filter || investor.name.includes(query.filter.name),
    });

    const group = await this.store.findRecord('investor-group', '1');
    const investor = this.store.createRecord('investor', {
      id: 'abc',
      name: 'Acme Capital',
      group,
    });
    await investor.save();
    await this.store
      .createRecord('investor', { name: 'Other Fund', group })
      .save();

    assert.strictEqual(groups.find.timesCalled, 1);
    assert.deepEqual(
      investors.records.map(({ id, name, group: groupId }) => [
        id,
        name,
        groupId,
      ]),
      [
        ['abc', 'Acme Capital', '1'],
        [1, 'Other Fund', '1'],
      ],
    );

    investor.name = 'Acme Ventures';
    await investor.save();

    assert.strictEqual(investors.update.lastCall.method, 'PATCH');
    assert.strictEqual(investors.records[0].name, 'Acme Ventures');

    const filtered = await this.store.query('investor', {
      filter: { name: 'Acme' },
    });

    assert.deepEqual(
      filtered.map(({ id }) => id),
      ['abc'],
    );
    assert.strictEqual(filtered[0].group, group);

    await investor.destroyRecord();

    assert.deepEqual(
      investors.records.map(({ id }) => id),
      [1],
    );
  });

  test('unknown ids get a 404 and handles can be overridden', async function (assert) {
    const contacts = api.resource('contact');
    contacts.create.fails(422, { errors: { name: ['is taken'] } });

    await assert.rejects(this.store.findRecord('contact', '9'));
    await assert.rejects(
      this.store.createRecord('contact', { name: 'x' }).save(),
    );
    assert.deepEqual(contacts.records, []);
    assert.strictEqual(contacts.find.lastCall.params.id, '9');
  });
});
