import { module, test } from 'qunit';

import {
  api,
  build,
  buildList,
  payload,
  reply,
  seed,
  sideload,
} from '#src/index.ts';
import { sourceOf } from '#src/store.ts';

import { API_HOST } from '../config.ts';
import { collectFailures, send, setupTest } from '../helpers.js';

module('Unit | api', function (hooks) {
  setupTest(hooks);

  test('responds with JSON and records calls', async function (assert) {
    const handle = api.get('/widgets/:id', ({ params }) => ({
      widget: { id: params.id },
    }));

    const response = await send(
      'GET',
      '/widgets/7?tab=all&ids[]=1&ids[]=2&tag=a&tag=b&at[0]=x&__proto__[polluted]=1&constructor[prototype][polluted]=1',
    );

    assert.deepEqual(await response.json(), { widget: { id: '7' } });
    assert.strictEqual(handle.timesCalled, 1);
    const { query } = handle.lastCall;
    assert.deepEqual(
      [query.tab, query.ids, query.tag, query.at],
      ['all', ['1', '2'], ['a', 'b'], ['x']],
    );
    assert.strictEqual({}.polluted, undefined);
    assert.deepEqual(Object.getOwnPropertyNames(query.__proto__), ['polluted']);
    assert.strictEqual(handle.lastCall.method, 'GET');
    assert.strictEqual(api.lastRequest('GET', '/widgets/7'), handle.lastCall);
    assert.deepEqual(api.requests, [handle.lastCall]);
  });

  test('withQuery answers only the exact query', async function (assert) {
    const fallback = api.get('/widgets', { widgets: [] });
    const page = api.get('/widgets', { widgets: [2] }).withQuery({ page: 2 });
    const empty = api.get('/widgets', { widgets: [1] }).withQuery({ tag: '' });
    const scalar = api.get('/widgets', { widgets: [3] }).withQuery({ id: 1 });
    const nested = api
      .get('/widgets', { widgets: [4] })
      .withQuery({ filter: { name: 'a', ids: [1, 2] } });

    const exact = await send('GET', '/widgets?page=2');
    await send('GET', '/widgets?page=2&page_size=10');
    await send('GET', '/widgets?other=x');
    await send('GET', '/widgets?tag=');
    await send('GET', '/widgets?id[]=1');
    await send(
      'GET',
      '/widgets?filter[name]=a&filter[ids][]=1&filter[ids][]=2',
    );

    assert.deepEqual(await exact.json(), { widgets: [2] });
    assert.deepEqual(
      [page, empty, scalar, nested, fallback].map((h) => h.timesCalled),
      [1, 1, 0, 1, 3],
    );
  });

  test('a partial query ignores other params', async function (assert) {
    const fallback = api.get('/widgets', { widgets: [] });
    const partial = api
      .get('/widgets', { widgets: [2] })
      .withQuery({ page: 2 }, { partial: true });
    const tag = api
      .get('/widgets', { widgets: [3] })
      .withQuery({ tag: 1 }, { partial: true });

    await send('GET', '/widgets?page=2&page_size=10');
    await send('GET', '/widgets?tag[]=1');

    assert.deepEqual(
      [partial, tag, fallback].map((h) => h.timesCalled),
      [1, 0, 1],
    );
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

  test('match answers a body that contains the expected keys', async function (assert) {
    const fallback = api.put('/widgets/7', { widget: { id: 7 } });
    const subset = api
      .update('widget', 7)
      .match({ widget: { name: 'Right', tag_ids: [1, 2] } });
    const one = api.update('widget', 7).match({ widget: { tag_ids: [1] } });
    const cleared = api.update('widget', 7).match({ widget: { size: null } });
    const blank = api.update('widget', 7).match({ widget: { name: '' } });

    await send('PUT', '/widgets/7', {
      widget: { name: 'Right', size: 1, tag_ids: ['1', '2'] },
    });
    await send('PUT', '/widgets/7', { widget: { label: 'x' } });
    await send('PUT', '/widgets/7', { widget: { size: null } });
    await send('PUT', '/widgets/7', { widget: { name: '' } });

    assert.deepEqual(
      [subset, one, cleared, blank, fallback].map((h) => h.timesCalled),
      [1, 0, 1, 1, 1],
    );
  });

  test('match accepts predicates', async function (assert) {
    const whole = api
      .create('widget')
      .match(({ widget }) => widget.name.startsWith('Wid'));
    const inside = api
      .create('gadget')
      .match({ gadget: { name: (name) => name.length > 3 } });

    const response = await send('POST', '/widgets', {
      widget: { name: 'Widget' },
    });
    await send('POST', '/gadgets', { gadget: { name: 'Gadget' } });

    assert.deepEqual(await response.json(), { widget: { id: 1 } });
    assert.deepEqual([whole.timesCalled, inside.timesCalled], [1, 1]);
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
    api.create('contact').returns(null);
    const created = await send('POST', '/contacts', { contact: {} });

    assert.strictEqual(raw.status, 418);
    assert.deepEqual(await computed.json(), { page: '3' });
    assert.strictEqual(empty.status, 204);
    assert.strictEqual(created.status, 204);
  });

  test('reply without a body sends an empty body', async function (assert) {
    api.get('/accepted', reply(202));
    api.get('/down', reply(502));
    api.get('/gone', reply(204));

    const accepted = await send('GET', '/accepted');
    const down = await send('GET', '/down');
    const gone = await send('GET', '/gone');

    assert.deepEqual(
      [accepted.status, down.status, gone.status],
      [202, 502, 204],
    );
    assert.strictEqual(await accepted.text(), '');
    assert.strictEqual(await down.text(), '');
  });

  test('paths start with a slash or are absolute URLs', function (assert) {
    assert.throws(
      () => api.get('widgets'),
      /api paths start with "\/" or are absolute URLs, got "widgets"/,
    );
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

  test('query takes a responder', async function (assert) {
    const companies = buildList('company', 3);
    api.query('company', ({ query }) =>
      payload('company', companies.slice(0, Number(query.limit)), {
        meta: { total: companies.length },
      }),
    );

    const body = await (await send('GET', '/companies?limit=2')).json();

    assert.strictEqual(body.companies.length, 2);
    assert.deepEqual(body.meta, { total: 3 });
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

    test('a near miss on headers shows the received values', async function (assert) {
      api.get('/widgets', null).withHeaders({ Authorization: 'Basic abc' });

      await fetch(`${API_HOST}/widgets`, {
        headers: { authorization: 'Basic xyz' },
      });

      assert.strictEqual(this.failures.length, 1);
      assert.true(
        this.failures[0].includes('"authorization": "Basic abc"'),
        this.failures[0],
      );
      assert.true(
        this.failures[0].includes('"authorization": "Basic xyz"'),
        this.failures[0],
      );
    });

    test('a handler that throws fails the test', async function (assert) {
      api.get('/widgets', () => {
        throw new Error('broken handler');
      });

      await send('GET', '/widgets').catch(() => undefined);

      assert.deepEqual(this.failures, ['broken handler']);
    });
  });

  test('withHeaders matches header names in any case', async function (assert) {
    const fallback = api.get('/widgets', { widgets: [] });
    const authorized = api
      .get('/widgets', { widgets: [1] })
      .withHeaders({ Authorization: 'Basic abc', 'X-Version': 2 });
    const bearer = api
      .get('/widgets', { widgets: [2] })
      .withHeaders({ authorization: (value) => value?.startsWith('Bearer ') });

    await fetch(`${API_HOST}/widgets`, {
      headers: { authorization: 'Basic abc', 'x-version': '2' },
    });
    await fetch(`${API_HOST}/widgets`, {
      headers: { AUTHORIZATION: 'Bearer t' },
    });
    await fetch(`${API_HOST}/widgets`, {
      headers: { authorization: 'Basic other' },
    });

    assert.strictEqual(authorized.timesCalled, 1);
    assert.strictEqual(bearer.timesCalled, 1);
    assert.strictEqual(fallback.timesCalled, 1);
  });

  test('type shortcuts take a responder instead of an id', async function (assert) {
    const update = api.update('person', ({ params }) => ({
      data: { id: params.id, type: 'people', attributes: {} },
    }));
    const find = api.find('person', () => reply(410));
    const destroy = api.destroy('person', () => reply(409));

    const updated = await send('PATCH', '/people/4', {});
    const found = await send('GET', '/people/4');
    const destroyed = await send('DELETE', '/people/4');

    assert.deepEqual((await updated.json()).data.id, '4');
    assert.strictEqual(update.lastCall.url, `${API_HOST}/people/4`);
    assert.strictEqual(found.status, 410);
    assert.strictEqual(find.timesCalled, 1);
    assert.strictEqual(destroyed.status, 409);
    assert.strictEqual(destroy.timesCalled, 1);
  });

  test('find takes top-level extra keys', async function (assert) {
    const company = build('company', { name: 'Acme' });
    const byRecord = api.find(company, { meta: { role: 'admin' } });

    const first = await (await send('GET', '/companies/1')).json();
    byRecord.returns(company, { meta: { role: 'viewer' } });
    const second = await (await send('GET', '/companies/1')).json();
    api.find('company', 7, { meta: { total: 1 } });
    const third = await (await send('GET', '/companies/7')).json();
    api.find('company', { meta: { any: true } });
    const fourth = await (await send('GET', '/companies/8')).json();

    assert.deepEqual(first.meta, { role: 'admin' });
    assert.strictEqual(first.company.name, 'Acme');
    assert.deepEqual(second.meta, { role: 'viewer' });
    assert.deepEqual(third, { company: { id: 7 }, meta: { total: 1 } });
    assert.deepEqual(fourth, { company: { id: '8' }, meta: { any: true } });
  });
});
