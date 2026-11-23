import { settled } from '@ember/test-helpers';
import { hasPendingWaiters } from '@ember/test-waiters';
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

  test('settled() waits for a raw fetch', async function (assert) {
    let body;
    api.get(
      '/slow',
      () => new Promise((resolve) => setTimeout(() => resolve({ ok: 1 }), 30)),
    );

    fetch(`${API_HOST}/slow`)
      .then((response) => response.json())
      .then((json) => (body = json));
    await settled();

    assert.deepEqual(body, { ok: 1 });
  });

  test('a request that never settles does not leak its waiter', async function (assert) {
    api.get('/hanging', () => new Promise(() => undefined));

    send('GET', '/hanging');
    await new Promise((resolve) => setTimeout(resolve, 10));

    assert.true(hasPendingWaiters());

    await settleRequests();

    assert.false(hasPendingWaiters());
    assert.strictEqual(this.failures.length, 1);
  });

  test("Percy's local server is never mocked", async function (assert) {
    const handle = api.get('http://localhost:5338/percy/healthcheck', {
      success: true,
    });

    await assert.rejects(fetch('http://localhost:5338/percy/healthcheck'));
    await settled();

    assert.strictEqual(handle.timesCalled, 0);
    assert.deepEqual(this.failures, []);
  });

  module('bypass', function (hooks) {
    hooks.before(function () {
      configure({ bypass: ['http://127.0.0.1:1/ignored'] });
    });

    hooks.after(function () {
      configureDefaults();
    });

    test('configured origins pass through untouched', async function (assert) {
      const handle = api.get('http://127.0.0.1:1/widgets', { widgets: [] });

      await assert.rejects(fetch('http://127.0.0.1:1/widgets'));
      const percy = await fetch('http://localhost:5338/percy/healthcheck');

      assert.strictEqual(handle.timesCalled, 0);
      assert.strictEqual(percy.status, 404);
    });
  });

  test('settled() waits for the app to read the response body', async function (assert) {
    api.get('/value', { x: 42 });
    api.get('/next', { y: 7 });
    const state = {};

    (async () => {
      const response = await fetch(`${API_HOST}/value`);
      state.value = (await response.json()).x;
      const next = await fetch(`${API_HOST}/next`);
      state.next = (await next.json()).y;
    })();
    await settled();

    assert.deepEqual(state, { value: 42, next: 7 });
  });

  test('the waiter stays open while the app reads the response', async function (assert) {
    api.get('/value', { x: 42 });

    const response = await fetch(`${API_HOST}/value`);

    assert.true(hasPendingWaiters());

    await response.json();

    assert.true(hasPendingWaiters());

    await settled();

    assert.false(hasPendingWaiters());
  });

  test('settled() waits for a slow response body the app reads', async function (assert) {
    api.get(
      '/slow-body',
      () =>
        new Response(
          new ReadableStream({
            start(controller) {
              setTimeout(() => {
                controller.enqueue(new TextEncoder().encode('{"x":42}'));
                controller.close();
              }, 30);
            },
          }),
          { headers: { 'Content-Type': 'application/json' } },
        ),
    );
    const state = {};

    (async () => {
      const response = await fetch(`${API_HOST}/slow-body`);
      state.value = (await response.clone().json()).x;
    })();
    await settled();

    assert.strictEqual(state.value, 42);
  });

  test('an unread response does not hold settled()', async function (assert) {
    api.get('/ignored', { x: 1 });

    const response = await fetch(`${API_HOST}/ignored`);
    await settled();

    assert.true(response.ok);
    assert.false(hasPendingWaiters());
  });

  test('a fetch that fails releases its waiter', async function (assert) {
    configure({ onUnhandledRequest: { other: 'passthrough' } });
    try {
      await assert.rejects(fetch('http://127.0.0.1:1/down'));
      await settled();

      assert.false(hasPendingWaiters());
    } finally {
      configureDefaults();
    }
  });

  test("Percy's runtime address is bypassed too", async function (assert) {
    window.PercySDKUtils = { percy: { address: 'http://127.0.0.1:1' } };
    try {
      const handle = api.get('http://127.0.0.1:1/percy/healthcheck', {});

      await assert.rejects(fetch('http://127.0.0.1:1/percy/healthcheck'));

      assert.strictEqual(handle.timesCalled, 0);
    } finally {
      delete window.PercySDKUtils;
    }
  });
});
