import { module, test } from 'qunit';

import '#src/model-fragments.ts';
import {
  build,
  buildList,
  defineFactory,
  seed,
  seedList,
  seedRecord,
  setupTest,
  sourceOf,
} from '#src/index.ts';

module('Unit | seed', function (hooks) {
  setupTest(hooks);

  module('activeModel', function () {
    test('pushes related records and declared relationships', function (assert) {
      const company = seed('company', 'withSubscription', { name: 'Acme' });
      const subscription = seed('subscription', { company: company.id });

      assert.strictEqual(company.name, 'Acme');
      assert.strictEqual(subscription.company, company);
      assert.strictEqual(company.subscriptions.length, 2);
    });

    test('seedList and seedRecord', function (assert) {
      const companies = seedList('company', 2, { name: 'Same' });
      const record = build('company', { name: 'Built' });
      const seeded = seedRecord(record);

      assert.deepEqual(
        companies.map(({ id, name }) => [id, name]),
        [
          ['1', 'Same'],
          ['2', 'Same'],
        ],
      );
      assert.strictEqual(seeded.name, 'Built');
      assert.strictEqual(sourceOf(seeded), record);
      assert.throws(
        () => seedRecord({ id: 1 }),
        /seedRecord\(\) takes a record from build\(\)/,
      );
    });

    test('beforeSeed sees the record, afterSeed gets the model and transient values', function (assert) {
      const calls = [];
      defineFactory('contact', {
        default: { name: 'Ada' },
        transient: { tag: 'none' },
        beforeSeed: (record, store) =>
          calls.push(['before', record.name, typeof store.pushPayload]),
        afterSeed: (model, transient) =>
          calls.push(['after', model.name, transient.tag]),
      });
      try {
        seed('contact', { tag: 'vip' });
      } finally {
        defineFactory('contact', { default: { name: 'Ada' } });
      }

      assert.deepEqual(calls, [
        ['before', 'Ada', 'function'],
        ['after', 'Ada', 'vip'],
      ]);
    });

    test('fragments in a factory and in overrides', function (assert) {
      const company = seed('company', 'withAddress');
      const overridden = seed('company', {
        address: { street: '2 Side St', city: 'Shelbyville' },
        branches: [{ street: '3 Far Rd', city: 'Capital City' }],
      });

      assert.strictEqual(company.address.street, '1 Main St');
      assert.strictEqual(overridden.address.city, 'Shelbyville');
      assert.deepEqual(
        overridden.branches.map(({ city }) => city),
        ['Capital City'],
      );
    });

    test('a fragment factory seeds a fragment', function (assert) {
      const address = seed('address', 'remote', { street: '9 Elm' });

      assert.strictEqual(address.street, '9 Elm');
      assert.strictEqual(address.city, 'Remote');
      assert.strictEqual(address.constructor.modelName, 'address');
    });
  });

  module('rest', function () {
    test('pushes sideloads and relationship ids', function (assert) {
      const post = seed('post', 'withComments', 'withAuthor');
      const comment = seed('comment', { post: post.id, body: 'Later' });

      assert.strictEqual(post.title, 'Post #1');
      assert.strictEqual(post.author.name, 'Grace');
      assert.strictEqual(comment.post, post);
      assert.strictEqual(post.comments.length, 3);
    });

    test('rejects keys the serializer does not read', function (assert) {
      assert.throws(
        () => seed('post', { headline: 'x' }),
        /seed\('post'\) got headline, which the post model does not read/,
      );
    });
  });

  module('jsonApi', function () {
    test('pushes included records and linkage', function (assert) {
      const investor = seed('investor', 'withPeople', 'withGroup');

      assert.strictEqual(investor.name, 'Investor #1');
      assert.strictEqual(investor.group.name, 'Seed');
      assert.deepEqual(
        investor.people.map(({ firstName }) => firstName),
        ['Ada', 'Ada'],
      );
    });

    test('dasherized attributes and relationship ids', function (assert) {
      const investor = seed('investor');
      const person = seed('person', {
        'first-name': 'Bo',
        investor: investor.id,
      });

      assert.strictEqual(person.firstName, 'Bo');
      assert.strictEqual(person.investor, investor);
    });

    test('relationships assigned after build reach the store', function (assert) {
      const investor = build('investor');
      investor.people = buildList('person', 2);

      const seeded = seedRecord(investor);

      assert.strictEqual(seeded.people.length, 2);
    });

    test('rejects keys the serializer does not read', function (assert) {
      assert.throws(
        () => seed('person', { nickname: 'x' }),
        /seed\('person'\) got nickname/,
      );
    });

    test('rejects a relationship the factory does not declare', function (assert) {
      assert.throws(
        () => seed('investor-group', { investors: [1] }),
        /seed\('investor-group'\) got investors, a relationship the investor-group factory does not declare/,
      );
    });
  });
});

module('Unit | seed without a test context', function () {
  test('seed explains what it needs', function (assert) {
    assert.throws(
      () => seed('company'),
      /seed\(\) needs a test set up with setupTest or setupRenderingTest/,
    );
  });
});
