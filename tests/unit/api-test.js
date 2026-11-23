import { module, test } from 'qunit';

import {
  api,
  build,
  buildList,
  payload,
  reply,
  seed,
  setupTest,
  sideload,
  sourceOf,
} from '#src/index.ts';

import { API_HOST } from '../config.ts';
import { collectFailures, send } from '../helpers.js';

module('Unit | api', function (hooks) {
  setupTest(hooks);

  test('responds with JSON and records calls', async function (assert) {
    const handle = api.get('/widgets/:id', ({ params }) => ({
      widget: { id: params.id },
    }));

    const response = await send('GET', '/widgets/7?tab=all&ids[]=1&ids[]=2');

    assert.deepEqual(await response.json(), { widget: { id: '7' } });
    assert.strictEqual(handle.timesCalled, 1);
    assert.deepEqual(handle.lastCall.query, { tab: 'all', ids: ['1', '2'] });
    assert.strictEqual(handle.lastCall.method, 'GET');
    assert.strictEqual(api.lastRequest('GET', '/widgets/7'), handle.lastCall);
    assert.deepEqual(api.requests, [handle.lastCall]);
  });

  test('withQuery answers only the exact query', async function (assert) {
    api.get('/widgets', { widgets: [] });
    const first = api.get('/widgets', { widgets: [1] }).withQuery({ page: 1 });
    const second = api.get('/widgets', { widgets: [2] }).withQuery({ page: 2 });

    const exact = await send('GET', '/widgets?page=2');
    const extra = await send('GET', '/widgets?page=2&page_size=10');

    assert.deepEqual(await exact.json(), { widgets: [2] });
    assert.deepEqual(await extra.json(), { widgets: [] });
    assert.strictEqual(first.timesCalled, 0);
    assert.strictEqual(second.timesCalled, 1);
  });

  test('a partial query ignores other params', async function (assert) {
    const handle = api
      .get('/widgets', { widgets: [2] })
      .withQuery({ page: 2 }, { partial: true });

    await send('GET', '/widgets?page=2&page_size=10');

    assert.strictEqual(handle.timesCalled, 1);
  });

  test('withQuery tells a missing param from an empty one', async function (assert) {
    const fallback = api.get('/widgets', { widgets: [] });
    const empty = api.get('/widgets', { widgets: [1] }).withQuery({ tag: '' });

    await send('GET', '/widgets?other=x');
    await send('GET', '/widgets?tag=');

    assert.strictEqual(fallback.timesCalled, 1);
    assert.strictEqual(empty.timesCalled, 1);
  });

  test('withQuery tells an array param from a scalar', async function (assert) {
    const fallback = api.get('/widgets', { widgets: [] });
    const scalar = api.get('/widgets', { widgets: [1] }).withQuery({ id: 1 });
    const partial = api
      .get('/widgets', { widgets: [2] })
      .withQuery({ tag: 1 }, { partial: true });

    await send('GET', '/widgets?id[]=1');
    await send('GET', '/widgets?tag[]=1');

    assert.strictEqual(scalar.timesCalled, 0);
    assert.strictEqual(partial.timesCalled, 0);
    assert.strictEqual(fallback.timesCalled, 2);
  });

  test('withQuery matches nested params', async function (assert) {
    const handle = api
      .get('/widgets', { widgets: [] })
      .withQuery({ filter: { name: 'a', ids: [1, 2] } });

    await send(
      'GET',
      '/widgets?filter[name]=a&filter[ids][]=1&filter[ids][]=2',
    );

    assert.strictEqual(handle.timesCalled, 1);
  });

  test('the latest handler wins and can be removed', async function (assert) {
    api.get('/widgets', { widgets: [] });
    const failing = api.get(
      '/widgets',
      reply(422, { errors: { name: ['x'] } }),
    );

    const failed = await send('GET', '/widgets');
    const again = await send('GET', '/widgets');
    failing.remove();
    const succeeded = await send('GET', '/widgets');

    assert.strictEqual(failed.status, 422);
    assert.deepEqual(await failed.json(), { errors: { name: ['x'] } });
    assert.strictEqual(again.status, 422);
    assert.strictEqual(succeeded.status, 200);
  });

  test('match answers only a body that contains the expected keys', async function (assert) {
    const update = api
      .update('widget', 7)
      .match({ widget: { name: 'Right', tag_ids: [1, 2] } });

    const matched = await send('PUT', '/widgets/7', {
      widget: { name: 'Right', size: 1, tag_ids: ['1', '2'] },
    });

    assert.strictEqual(matched.status, 200);
    assert.strictEqual(update.timesCalled, 1);
  });

  test('match compares arrays in full', async function (assert) {
    const fallback = api.put('/widgets/7', { widget: { id: 7 } });
    const empty = api.update('widget', 7).match({ widget: { tag_ids: [] } });
    const one = api.update('widget', 7).match({ widget: { tag_ids: [1] } });

    await send('PUT', '/widgets/7', { widget: { tag_ids: [1, 2] } });

    assert.strictEqual(empty.timesCalled, 0);
    assert.strictEqual(one.timesCalled, 0);
    assert.strictEqual(fallback.timesCalled, 1);
  });

  test('match expects null to be sent', async function (assert) {
    const fallback = api.put('/widgets/7', { widget: { id: 7 } });
    const cleared = api.update('widget', 7).match({ widget: { size: null } });

    await send('PUT', '/widgets/7', { widget: { name: 'x' } });
    await send('PUT', '/widgets/7', { widget: { size: null } });

    assert.strictEqual(fallback.timesCalled, 1);
    assert.strictEqual(cleared.timesCalled, 1);
  });

  test('match accepts a predicate', async function (assert) {
    const create = api
      .create('widget')
      .match(({ widget }) => widget.name.startsWith('Wid'));

    const response = await send('POST', '/widgets', {
      widget: { name: 'Widget' },
    });

    assert.deepEqual(await response.json(), { widget: { id: 1 } });
    assert.strictEqual(create.timesCalled, 1);
  });

  test('match accepts predicates inside the expected body', async function (assert) {
    const create = api
      .create('widget')
      .match({ widget: { name: (name) => name.length > 3 } });

    await send('POST', '/widgets', { widget: { name: 'Widget' } });

    assert.strictEqual(create.timesCalled, 1);
  });

  test('fails and returns change what a handler answers', async function (assert) {
    const company = build('company', { name: 'Acme' });
    const find = api.find(company).fails(403, { error: 'forbidden' });

    const forbidden = await send('GET', `/companies/${company.id}`);
    find.returns(company);
    const found = await send('GET', `/companies/${company.id}`);

    assert.strictEqual(forbidden.status, 403);
    assert.deepEqual(await forbidden.json(), { error: 'forbidden' });
    assert.strictEqual((await found.json()).company.name, 'Acme');
  });

  test('returns takes a raw response or a function', async function (assert) {
    const handle = api.get('/widgets', { widgets: [] });

    handle.returns(reply(418, { tea: true }));
    const raw = await send('GET', '/widgets');
    handle.returns(({ query }) => ({ page: query.page }));
    const computed = await send('GET', '/widgets?page=3');
    handle.returns(null);
    const empty = await send('GET', '/widgets');

    assert.strictEqual(raw.status, 418);
    assert.deepEqual(await computed.json(), { page: '3' });
    assert.strictEqual(empty.status, 204);
  });

  test('find without a record answers any id', async function (assert) {
    api.find('company');

    const response = await send('GET', '/companies/41');

    assert.deepEqual(await response.json(), { company: { id: '41' } });
  });

  test('query serves a list with extra top-level keys', async function (assert) {
    const companies = buildList('company', 2);
    api.query('company', companies, { meta: { total: 2 } });

    const body = await (await send('GET', '/companies')).json();

    assert.deepEqual(
      body.companies.map(({ id }) => id),
      [1, 2],
    );
    assert.deepEqual(body.meta, { total: 2 });
  });

  test('query.returns swaps the list and extra keys', async function (assert) {
    const query = api.query('company');

    const empty = await (await send('GET', '/companies')).json();
    query.returns(buildList('company', 1), { meta: { total: 1 } });
    const one = await (await send('GET', '/companies')).json();

    assert.deepEqual(empty, { companies: [] });
    assert.deepEqual(one.meta, { total: 1 });
    assert.strictEqual(one.companies.length, 1);
  });

  test('seeded models in a plain response become their JSON', async function (assert) {
    const company = seed('company', { name: 'Acme' });
    const contacts = [seed('contact')];
    api.get('/dashboard', { company, contacts, total: 1 });

    const body = await (await send('GET', '/dashboard')).json();

    assert.strictEqual(body.company.name, 'Acme');
    assert.strictEqual(body.contacts[0].name, 'Ada');
    assert.strictEqual(body.total, 1);
  });

  test('resource payloads are built when the request arrives', async function (assert) {
    const company = build('company');
    api.find(company);
    company.name = 'Renamed';
    sideload(company, build('subscription', { plan_id: 'late' }));

    const body = await (await send('GET', `/companies/${company.id}`)).json();

    assert.strictEqual(body.company.name, 'Renamed');
    assert.strictEqual(body.subscriptions[0].plan_id, 'late');
  });

  test('parses JSON, form and text bodies', async function (assert) {
    const create = api.post('/widgets', null);
    const form = new FormData();
    form.append('widget[name]', 'From form');
    form.append('widget[tags][]', 'a');
    form.append('widget[tags][]', 'b');

    await send('POST', '/widgets', { widget: { name: 'From JSON' } });
    const response = await fetch(`${API_HOST}/widgets`, {
      method: 'POST',
      body: form,
    });
    await fetch(`${API_HOST}/widgets`, { method: 'POST', body: 'plain' });

    assert.strictEqual(response.status, 204);
    assert.deepEqual(create.calls[0].body, { widget: { name: 'From JSON' } });
    assert.deepEqual(create.calls[1].body, {
      widget: { name: 'From form', tags: ['a', 'b'] },
    });
    assert.strictEqual(create.calls[2].body, 'plain');
  });

  test('records request headers', async function (assert) {
    const handle = api.get('/widgets', { widgets: [] });

    await fetch(`${API_HOST}/widgets`, { headers: { 'X-Token': 'abc' } });

    assert.strictEqual(handle.lastCall.headers.get('x-token'), 'abc');
  });

  test('handles XMLHttpRequest', async function (assert) {
    api.get('/widgets', { widgets: [] });

    const body = await new Promise((resolve) => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', `${API_HOST}/widgets`);
      xhr.onload = () => resolve(xhr.responseText);
      xhr.send();
    });

    assert.deepEqual(JSON.parse(body), { widgets: [] });
  });

  test('builds sideloaded payloads from associations', function (assert) {
    const company = build('company', 'withSubscription', { name: 'Acme' });

    assert.deepEqual(payload('company', company), {
      company: {
        id: 1,
        name: 'Acme',
        events: { added_data_source: true },
        subscription_ids: [1],
      },
      subscriptions: [{ id: 1, plan_id: 'custom' }],
    });
  });

  test('explicit ids keep later automatic ids from colliding', function (assert) {
    build('company', { id: 5 });

    assert.strictEqual(build('company').id, 6);
  });

  test('ids restart for every test', function (assert) {
    assert.strictEqual(build('company').id, 1);
  });

  test('build rejects camelCase override keys', function (assert) {
    assert.throws(
      () => build('subscription', { planId: 'custom' }),
      /Overrides use the API's snake_case keys/,
    );
  });

  test('seed rejects override keys the model does not read', function (assert) {
    assert.throws(
      () => seed('contact', { company: 1 }),
      /seed\('contact'\) got company, which the contact model does not read/,
    );
    const contact = seed('contact', { company_id: 1 });

    assert.strictEqual(contact.belongsTo('company').id(), '1');
  });

  test('seed pushes the payload through the app serializers', function (assert) {
    const company = seed('company', 'withSubscription');

    assert.strictEqual(company.name, 'Company #1');
    assert.true(company.events.added_data_source);
    assert.strictEqual(company.subscriptions.length, 1);
    assert.strictEqual(company.subscriptions[0].planId, 'custom');
  });

  test('serves the source JSON of a seeded record', async function (assert) {
    const company = seed('company', { name: 'Acme' });
    api.find(company);

    const response = await send('GET', `/companies/${company.id}`);

    assert.strictEqual((await response.json()).company.name, 'Acme');
    assert.strictEqual(sourceOf(company).name, 'Acme');
  });

  test('sourceOf rejects a record that was not seeded', function (assert) {
    const store = this.owner.lookup('service:store');
    const company = store.createRecord('company', { name: 'New' });

    assert.throws(
      () => sourceOf(company),
      /A company record that was not created with seed\(\) was used in a mocked response/,
    );
    assert.deepEqual(sourceOf({ id: 1 }), { id: 1 });
  });

  module('unhandled requests', function (hooks) {
    collectFailures(hooks);

    test('an app request with no handler fails the test', async function (assert) {
      api
        .get('/widgets', { widgets: [] })
        .withQuery({ page: 1 }, { partial: true });

      const response = await send('GET', '/widgets?page=2');

      assert.strictEqual(response.status, 404);
      assert.strictEqual(this.failures.length, 1);
      assert.true(
        this.failures[0].startsWith(
          `No handler for GET ${API_HOST}/widgets?page=2`,
        ),
      );
      assert.true(
        this.failures[0].includes('"partialQuery": {\n    "page": "2"'),
      );
    });

    test('a near miss on the body shows what was sent', async function (assert) {
      api.post('/widgets', null).match({ widget: { name: 'A' } });

      await send('POST', '/widgets', { widget: { name: 'B' } });

      assert.strictEqual(this.failures.length, 1);
      assert.true(this.failures[0].includes('"name": "B"'));
    });

    test('a third-party request gets a 404 without failing', async function (assert) {
      const response = await fetch('https://third-party.example/widgets');

      assert.strictEqual(response.status, 404);
      assert.deepEqual(this.failures, []);
    });

    test('a removed handler no longer answers', async function (assert) {
      api.get('/widgets', { widgets: [] }).remove();

      const response = await send('GET', '/widgets');

      assert.strictEqual(response.status, 404);
      assert.strictEqual(this.failures.length, 1);
    });

    test('a handler that throws fails the test', async function (assert) {
      api.get('/widgets', () => {
        throw new Error('broken handler');
      });

      await send('GET', '/widgets').catch(() => undefined);

      assert.deepEqual(this.failures, ['broken handler']);
    });
  });
});
