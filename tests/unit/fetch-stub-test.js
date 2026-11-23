import { module, test } from 'qunit';

import { api, setupTest } from '#src/index.ts';

import { API_HOST } from '../config.ts';

const nativeFetch = window.fetch;
const WRAPPER = Symbol.for('ember-api-mocks.fetch');

function wrappers() {
  const chain = [];
  for (let current = window.fetch; current[WRAPPER];) {
    chain.push(current[WRAPPER]);
    current = current[WRAPPER].original;
  }
  return chain;
}

module('Unit | fetch stubbed by a test', function (hooks) {
  let captured;

  hooks.afterEach(function () {
    window.fetch = captured;
  });

  setupTest(hooks);

  test('a stub restored after teardown', async function (assert) {
    captured = window.fetch;
    window.fetch = (...args) => captured(...args);
    const handle = api.get('/stubbed', { ok: true });

    const response = await fetch(`${API_HOST}/stubbed`);

    assert.deepEqual(await response.json(), { ok: true });
    assert.strictEqual(handle.timesCalled, 1);
  });

  test('mocking wraps the original fetch once', async function (assert) {
    captured = window.fetch;
    const [state] = wrappers();

    assert.true(state.active);
    assert.strictEqual(state.original, nativeFetch);
  });
});

module('Unit | fetch after a late restore', function () {
  test('the stale wrapper is inactive and calls the original', async function (assert) {
    const [state] = wrappers();

    assert.false(state.active);
    assert.strictEqual(state.original, nativeFetch);

    const response = await window.fetch('data:application/json,{"a":1}');

    assert.deepEqual(await response.json(), { a: 1 });
  });

  module('with mocking on again', function (hooks) {
    setupTest(hooks);

    test('fetch is wrapped once around the original', async function (assert) {
      const chain = wrappers();
      api.get('/again', { ok: true });

      const response = await fetch(`${API_HOST}/again`);

      assert.strictEqual(chain.length, 1);
      assert.true(chain[0].active);
      assert.strictEqual(chain[0].original, nativeFetch);
      assert.deepEqual(await response.json(), { ok: true });
    });
  });

  test('without mocking, fetch is native once unwrapped', function (assert) {
    assert.strictEqual(window.fetch, nativeFetch);
  });
});
