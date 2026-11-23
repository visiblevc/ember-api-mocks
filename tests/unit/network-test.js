import { module, test } from 'qunit';

import { api, configure, HttpResponse, setupTest } from '#src/index.ts';
import { settleRequests } from '#src/network.ts';

import { API_HOST, configureDefaults } from '../config.ts';
import { collectFailures, send } from '../helpers.js';

module('Unit | network', function (hooks) {
  setupTest(hooks);
  collectFailures(hooks);

  test('api.patch answers PATCH requests', async function (assert) {
    const handle = api.patch('/widgets/:id', ({ params, body }) => ({
      widget: { id: params.id, ...body.widget },
    }));

    const response = await send('PATCH', '/widgets/3', {
      widget: { name: 'x' },
    });

    assert.deepEqual(await response.json(), { widget: { id: '3', name: 'x' } });
    assert.strictEqual(handle.lastCall.method, 'PATCH');
  });

  test('a handler can answer with an msw response', async function (assert) {
    api.get('/report.csv', () => HttpResponse.text('a,b'));

    const response = await send('GET', '/report.csv');

    assert.strictEqual(await response.text(), 'a,b');
  });

  test('settleRequests waits for a slow request', async function (assert) {
    const handle = api.get(
      '/slow',
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: 1 }), 30)),
    );

    send('GET', '/slow');
    await settleRequests();

    assert.strictEqual(handle.timesCalled, 1);
    assert.deepEqual(this.failures, []);
  });

  test('settleRequests fails on a request that never settles', async function (assert) {
    api.get('/hanging', () => new Promise(() => undefined));

    send('GET', '/hanging');
    const started = performance.now();
    await settleRequests();
    const elapsed = performance.now() - started;

    assert.deepEqual(this.failures, [
      'Requests were still pending when the test ended',
    ]);
    assert.true(elapsed >= 900 && elapsed < 2000, `took ${elapsed} ms`);
  });

  module('beacons', function (hooks) {
    hooks.before(function () {
      configure({ beacons: true });
    });

    hooks.after(function () {
      configureDefaults();
    });

    test('a beacon reaches a handler with a parsed body', async function (assert) {
      const form = api.post('/events', null);
      const json = api.post('/json-events', null);

      assert.true(Object.hasOwn(navigator, 'sendBeacon'));
      assert.true(
        navigator.sendBeacon(
          `${API_HOST}/events`,
          new URLSearchParams({ name: 'opened', 'tags[]': 'a' }),
        ),
      );
      navigator.sendBeacon(
        `${API_HOST}/json-events`,
        new Blob([JSON.stringify({ name: 'closed' })], {
          type: 'application/json',
        }),
      );
      await settleRequests();

      assert.deepEqual(form.lastCall.body, { name: 'opened', tags: ['a'] });
      assert.deepEqual(json.lastCall.body, { name: 'closed' });
    });
  });

  test('the beacon shim is removed after the test', function (assert) {
    assert.false(Object.hasOwn(navigator, 'sendBeacon'));
    assert.strictEqual(typeof navigator.sendBeacon, 'function');
  });
});
