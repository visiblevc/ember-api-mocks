import { module, test } from 'qunit';

import { api } from '#src/index.ts';
import { disableNetwork, enableNetwork } from '#src/network.ts';

import { API_HOST } from '../config.ts';

const WRAPPER = Symbol.for('ember-api-mocks.fetch');

function wrappers() {
  const chain = [];
  for (let current = window.fetch; current[WRAPPER];) {
    chain.push(current[WRAPPER]);
    current = current[WRAPPER].original;
  }
  return chain;
}

module('Unit | fetch stubbed by a test', function () {
  test('a stub restored after teardown leaves a wrapper that is unwrapped next time', async function (assert) {
    const native = window.fetch;
    enableNetwork();
    const wrapped = window.fetch;
    window.fetch = (...args) => wrapped(...args);
    const handle = api.get('/stubbed', { ok: true });

    const response = await fetch(`${API_HOST}/stubbed`);

    assert.deepEqual(await response.json(), { ok: true });
    assert.strictEqual(handle.timesCalled, 1);

    disableNetwork();
    window.fetch = wrapped;
    const [stale] = wrappers();

    assert.false(stale.active);
    assert.strictEqual(stale.original, native);
    assert.deepEqual(
      await (await fetch('data:application/json,{"a":1}')).json(),
      { a: 1 },
    );

    enableNetwork();
    const chain = wrappers().map(({ active, original }) => [active, original]);
    disableNetwork();

    assert.deepEqual(chain, [[true, native]]);
    assert.strictEqual(window.fetch, native);
  });
});
