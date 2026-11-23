import { module, test } from 'qunit';

import {
  belongsTo,
  build,
  buildList,
  defineFactory,
  factoryOf,
  hasMany,
  jsonApi,
  mergePayloads,
  payload,
  rest,
  sequence,
  sideload,
} from '#src/index.ts';
import { setupTest } from '../helpers.js';
import { transientOf } from '#src/factories.ts';

module('Unit | formats', function (hooks) {
  setupTest(hooks);

  module('activeModel', function () {
    test('a declared relationship writes x_id and sideloads a record', function (assert) {
      defineFactory('seat', {
        relationships: {
          company: belongsTo('company'),
          contacts: hasMany('contact'),
        },
      });
      const company = build('company', { name: 'Acme' });

      assert.deepEqual(payload('seat', build('seat', { company: 3 })), {
        seat: { id: 1, company_id: 3 },
      });
      assert.deepEqual(
        payload('seat', build('seat', { company, contacts: [4, 5] })),
        {
          seat: { id: 2, company_id: 1, contact_ids: [4, 5] },
          companies: [company],
        },
      );
    });

    test('associations in the factory write ids and sideload', function (assert) {
      defineFactory('membership', {
        default: { company: belongsTo('company', { name: 'Acme' }) },
      });

      const membership = build('membership');

      assert.deepEqual(payload('membership', membership), {
        membership: { id: 1, company_id: 1 },
        companies: [
          { id: 1, name: 'Acme', events: { added_data_source: true } },
        ],
      });
    });

    test('a list uses the plural root key', function (assert) {
      const body = payload('subscription', buildList('subscription', 2), {
        meta: { total: 2 },
      });

      assert.deepEqual(body, {
        subscriptions: [
          { id: 1, plan_id: 'starter' },
          { id: 2, plan_id: 'starter' },
        ],
        meta: { total: 2 },
      });
    });

    test('nested sideloads are collected once', function (assert) {
      const company = build('company', 'withSubscription');
      const contact = build('contact', { company_id: company.id });
      sideload(contact, company, null);
      sideload(company, contact);

      const body = payload('contact', contact);

      assert.deepEqual(Object.keys(body).sort(), [
        'companies',
        'contact',
        'subscriptions',
      ]);
      assert.strictEqual(body.companies.length, 1);
      assert.strictEqual(body.subscriptions.length, 1);
    });

    test('mergePayloads concatenates arrays and keeps the rest', function (assert) {
      const merged = mergePayloads(
        payload('subscription', [build('subscription')]),
        payload('subscription', [build('subscription')], { meta: { a: 1 } }),
      );

      assert.deepEqual(
        merged.subscriptions.map(({ id }) => id),
        [1, 2],
      );
      assert.deepEqual(merged.meta, { a: 1 });
    });
  });

  module('rest', function () {
    test('relationship keys are the names and root keys follow the key case', function (assert) {
      const post = build('post', 'withComments', 'withAuthor');

      assert.deepEqual(payload('post', post), {
        post: { id: 1, title: 'Post #1', comments: [1, 2], author: 1 },
        comments: [
          { id: 1, body: 'Nice' },
          { id: 2, body: 'Nice' },
        ],
        authors: [{ id: 1, name: 'Grace' }],
      });
    });

    test('root keys follow the key case', function (assert) {
      defineFactory('blog-post', { format: rest(), default: {} });
      defineFactory('snake-post', { format: rest({ keys: 'snake' }) });
      defineFactory('dash-post', { format: rest({ keys: 'dash' }) });

      assert.deepEqual(Object.keys(payload('blog-post', build('blog-post'))), [
        'blogPost',
      ]);
      assert.deepEqual(
        Object.keys(payload('snake-post', [build('snake-post')])),
        ['snake_posts'],
      );
      assert.deepEqual(
        Object.keys(payload('dash-post', [build('dash-post')])),
        ['dash-posts'],
      );
    });

    test('key checks follow the key case', function (assert) {
      defineFactory('snake-post', { format: rest({ keys: 'snake' }) });
      defineFactory('dash-post', { format: rest({ keys: 'dash' }) });

      assert.throws(() => build('post', { post_title: 'x' }), /camelCase/);
      assert.throws(() => build('post', { 'post-title': 'x' }), /camelCase/);
      assert.strictEqual(build('post', { postTitle: 'x' }).postTitle, 'x');
      assert.throws(
        () => build('snake-post', { postTitle: 'x' }),
        /snake_case/,
      );
      assert.strictEqual(
        build('snake-post', { post_title: 'x' }).post_title,
        'x',
      );
      assert.throws(
        () => build('dash-post', { post_title: 'x' }),
        /dasherized/,
      );
      assert.strictEqual(
        build('dash-post', { 'post-title': 'x' })['post-title'],
        'x',
      );
    });

    test('built records under an undeclared key throw', function (assert) {
      assert.throws(
        () => build('post', { comments: buildList('comment', 2) }),
        /build\('post'\) got built records under "comments". Declare it in the post factory's relationships/,
      );
    });

    test('a declared relationship takes an id, a record or a { type, id }', function (assert) {
      const author = build('author');
      const byId = build('post', { author: 7 });
      const byRecord = build('post', { author });
      const polymorphic = build('comment', { post: { type: 'page', id: 3 } });

      assert.strictEqual(byId.author, 7);
      assert.strictEqual(byRecord.author, author.id);
      assert.deepEqual(payload('post', byRecord).authors, [author]);
      assert.deepEqual(polymorphic.post, { type: 'page', id: 3 });
    });
  });

  module('jsonApi', function () {
    test('builds a document with data and included', function (assert) {
      const investor = build('investor', 'withPeople', 'withGroup');

      assert.deepEqual(payload('investor', investor), {
        data: {
          id: '1',
          type: 'investors',
          attributes: { name: 'Investor #1' },
          relationships: {
            people: {
              data: [
                { type: 'people', id: '1' },
                { type: 'people', id: '2' },
              ],
            },
            group: { data: { type: 'investor-groups', id: '1' } },
          },
        },
        included: [
          {
            id: '1',
            type: 'people',
            attributes: { 'first-name': 'Ada' },
          },
          {
            id: '2',
            type: 'people',
            attributes: { 'first-name': 'Ada' },
          },
          {
            id: '1',
            type: 'investor-groups',
            attributes: { name: 'Seed' },
          },
        ],
      });
    });

    test('a list and extra top-level keys', function (assert) {
      const body = payload('investor-group', buildList('investor-group', 2), {
        meta: { 'record-count': 2 },
        links: { next: null },
      });

      assert.deepEqual(body, {
        data: [
          { id: '1', type: 'investor-groups', attributes: { name: 'Seed' } },
          { id: '2', type: 'investor-groups', attributes: { name: 'Seed' } },
        ],
        meta: { 'record-count': 2 },
        links: { next: null },
      });
    });

    test('linkage is left out unless the related record is in the document', function (assert) {
      const group = build('investor-group');
      const investor = build('investor', { group: 9, people: [1, 2] });
      const withGroup = build('investor', { group });
      const cleared = build('investor', { group: null, people: [] });

      assert.strictEqual(
        payload('investor', investor).data.relationships,
        undefined,
      );
      assert.deepEqual(payload('investor', withGroup).data.relationships, {
        group: { data: { type: 'investor-groups', id: '1' } },
      });
      assert.deepEqual(payload('investor', cleared).data.relationships, {
        group: { data: null },
        people: { data: [] },
      });
    });

    test('a polymorphic relationship takes { type, id }', function (assert) {
      defineFactory('note', {
        format: jsonApi(),
        relationships: { subject: belongsTo('investor') },
      });

      const note = build('note', { subject: { type: 'person', id: 4 } });
      sideload(note, build('person', { id: 4 }));

      assert.deepEqual(payload('note', note).data.relationships, {
        subject: { data: { type: 'people', id: '4' } },
      });
    });

    test('included comes from sideloads', function (assert) {
      const investor = build('investor', { group: 1 });
      sideload(investor, build('investor-group'));

      const body = payload('investor', investor);

      assert.deepEqual(body.included, [
        { id: '1', type: 'investor-groups', attributes: { name: 'Seed' } },
      ]);
      assert.deepEqual(body.data.relationships, {
        group: { data: { type: 'investor-groups', id: '1' } },
      });
    });
  });

  test('relationships assigned after build write ids and sideload', function (assert) {
    const company = build('company', { name: 'Acme' });
    const byId = build('subscription');
    byId.company = 4;
    const byRecord = build('subscription');
    byRecord.company = company;
    const post = build('post');
    post.author = build('author');
    const investor = build('investor');
    investor.people = buildList('person', 2);
    investor.group = 9;

    assert.deepEqual(payload('subscription', byId).subscription.company_id, 4);
    assert.deepEqual(payload('subscription', byRecord), {
      subscription: { id: 2, plan_id: 'starter', company_id: 1 },
      companies: [company],
    });
    assert.strictEqual(byRecord.company, company);
    assert.deepEqual(payload('post', post), {
      post: { id: 1, title: 'Post #1', author: 1 },
      authors: [post.author],
    });
    const body = payload('investor', investor);
    assert.deepEqual(body.data.attributes, { name: 'Investor #1' });
    assert.deepEqual(body.data.relationships, {
      people: {
        data: [
          { type: 'people', id: '1' },
          { type: 'people', id: '2' },
        ],
      },
    });
    assert.deepEqual(
      body.included.map(({ type, id }) => `${type}:${id}`),
      ['people:1', 'people:2'],
    );
  });

  module('factories', function () {
    test('traits, transient values, sequences and function values', function (assert) {
      defineFactory('gadget', {
        default: {
          serial: sequence((n) => `SN-${n}`),
          label: (gadget) => `${gadget.serial} (${gadget.color})`,
          color: 'red',
        },
        transient: { owner: 'nobody' },
        traits: {
          blue: { color: 'blue' },
          tagged: (gadget) => {
            gadget.tags = ['new'];
          },
        },
      });

      const first = build('gadget');
      const second = build('gadget', 'blue', 'tagged', { owner: 'Ada' });

      assert.deepEqual(first, {
        id: 1,
        serial: 'SN-1',
        label: 'SN-1 (red)',
        color: 'red',
      });
      assert.deepEqual(second, {
        id: 2,
        serial: 'SN-2',
        label: 'SN-2 (blue)',
        color: 'blue',
        tags: ['new'],
      });
      assert.deepEqual(transientOf(second), { owner: 'Ada' });
      assert.strictEqual(factoryOf(second), 'gadget');
      assert.strictEqual(factoryOf({ id: 1 }), undefined);
    });

    test('a default id can be a sequence', function (assert) {
      defineFactory('uuid-thing', {
        default: { id: sequence((n) => `thing-${n}`), label: (t) => t.id },
      });

      assert.deepEqual(buildList('uuid-thing', 2), [
        { id: 'thing-1', label: 'thing-1' },
        { id: 'thing-2', label: 'thing-2' },
      ]);
      assert.strictEqual(build('uuid-thing', { id: 'mine' }).id, 'mine');
      assert.strictEqual(build('uuid-thing').id, 'thing-3');
    });

    test('numeric string ids keep later ids from colliding', function (assert) {
      build('person', { id: '1' });
      build('person', { id: '2' });

      assert.strictEqual(build('person').id, 3);
    });

    test('defaults are copied for every record', function (assert) {
      const first = build('company');
      first.events.added_data_source = false;

      assert.true(build('company').events.added_data_source);
    });

    test('buildList takes a count or one spec per record', function (assert) {
      const counted = buildList('subscription', 2, 'custom');
      const specs = buildList('subscription', { plan_id: 'a' }, [
        'custom',
        { id: 10 },
      ]);

      assert.deepEqual(
        counted.map(({ plan_id }) => plan_id),
        ['custom', 'custom'],
      );
      assert.deepEqual(specs, [
        { id: 3, plan_id: 'a' },
        { id: 10, plan_id: 'custom' },
      ]);
    });

    test('hasMany in a default or trait needs a count', function (assert) {
      defineFactory('holder', {
        traits: { empty: { subscriptions: hasMany('subscription') } },
      });

      assert.throws(
        () => build('holder', 'empty'),
        /hasMany\('subscription'\) in a default or trait needs a count/,
      );
    });

    test('unknown factories and traits throw', function (assert) {
      assert.throws(() => build('nope'), /No factory defined for "nope"/);
      assert.throws(
        () => build('company', 'nope'),
        /Factory "company" has no trait "nope"/,
      );
    });

    test('fragment builds a nested object without an id', function (assert) {
      const company = build('company', 'withAddress');

      assert.deepEqual(company.address, {
        street: '1 Main St',
        city: 'Springfield',
      });
    });
  });
});
