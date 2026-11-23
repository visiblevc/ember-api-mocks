import { module, test } from 'qunit';

import { api, configure, defineFactory, rest, setupTest } from '#src/index.ts';
import { resetConfiguration } from '#src/config.ts';

import { API_HOST, configureDefaults } from '../config.ts';
import { collectFailures, send } from '../helpers.js';

module('Unit | configure', function (hooks) {
  setupTest(hooks);
  collectFailures(hooks);

  hooks.afterEach(function () {
    configureDefaults();
  });

  test('apiHost defaults to the page origin', async function (assert) {
    resetConfiguration();
    const handle = api.get('/widgets', { widgets: [] });

    const response = await fetch('/widgets');

    assert.deepEqual(await response.json(), { widgets: [] });
    assert.strictEqual(
      handle.lastCall.url,
      `${window.location.origin}/widgets`,
    );
  });

  test('apiHost with a path prefixes explicit paths', async function (assert) {
    configure({ apiHost: `${API_HOST}/v2/` });
    const handle = api.get('/widgets', { widgets: [] });
    const find = api.find('company', 1);

    await send('GET', '/v2/widgets');
    await send('GET', '/v2/companies/1');

    assert.strictEqual(handle.timesCalled, 1);
    assert.strictEqual(find.timesCalled, 1);
    assert.strictEqual(api.lastRequest('GET', '/widgets'), handle.lastCall);
  });

  test('absolute URLs are used as is', async function (assert) {
    const handle = api.get('https://elsewhere.example.test/things', {
      things: [],
    });

    await fetch('https://elsewhere.example.test/things');

    assert.strictEqual(handle.timesCalled, 1);
  });

  test('namespace prefixes type shortcuts but not explicit paths', async function (assert) {
    configure({ namespace: 'api/v1/' });
    const find = api.find('company', 1);
    const explicit = api.post('/oauth/token', { token: 'x' });

    await send('GET', '/api/v1/companies/1');
    await send('POST', '/oauth/token');

    assert.strictEqual(find.timesCalled, 1);
    assert.strictEqual(explicit.timesCalled, 1);
  });

  test('a factory url or a rest path sets the collection path', async function (assert) {
    defineFactory('legacy-widget', { url: '/legacy/widgets' });
    defineFactory('archived-post', {
      format: rest({ path: (type) => `/v2/${type}s` }),
    });
    const query = api.query('legacy-widget');
    const find = api.find('legacy-widget', 2);
    const post = api.find('archived-post', 3);

    await send('GET', '/legacy/widgets');
    await send('GET', '/legacy/widgets/2');
    await send('GET', '/v2/archived-posts/3');

    assert.deepEqual(
      [query, find, post].map((h) => h.timesCalled),
      [1, 1, 1],
    );
  });

  test('configure merges with earlier calls', async function (assert) {
    configure({ namespace: 'api' });
    configure({ apiHost: 'https://other.example.test' });
    const find = api.find('company', 1);

    await fetch('https://other.example.test/api/companies/1');

    assert.strictEqual(find.timesCalled, 1);
  });

  test('the page origin and origins are treated as the app', async function (assert) {
    configure({ origins: ['https://cdn.example.test/assets'] });

    const response = await fetch('https://cdn.example.test/file.json');
    await fetch('/not-mocked');

    assert.strictEqual(response.status, 404);
    assert.strictEqual(this.failures.length, 2);
    assert.true(
      this.failures[0].startsWith(
        'No handler for GET https://cdn.example.test/file.json',
      ),
    );
  });

  test('non-http requests always pass through', async function (assert) {
    const response = await fetch('data:application/json,{"a":1}');

    assert.deepEqual(await response.json(), { a: 1 });
    assert.deepEqual(this.failures, []);
  });
});
