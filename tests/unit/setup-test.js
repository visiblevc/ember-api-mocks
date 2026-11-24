import { module, test } from 'qunit';

import { api, setupApiMocks } from '#src/index.ts';

import { collectFailures, send } from '../helpers.js';
import { setupTest } from 'ember-qunit';

module('Unit | setupApiMocks', function () {
  test('must run after the ember-qunit setup', function (assert) {
    const beforeEach = [];
    setupApiMocks({
      beforeEach: (callback) => beforeEach.push(callback),
      afterEach() {},
    });

    assert.throws(
      () => beforeEach[0].call({}),
      /Call setupApiMocks\(hooks\) after setupTest/,
    );
  });
});

module('Unit | setupApiMocks teardown', function (hooks) {
  hooks.afterEach(async function (assert) {
    const response = await send('GET', '/teardown');
    assert.strictEqual(response.status, 200);
  });
  setupTest(hooks);
  setupApiMocks(hooks);

  test('requests made during teardown are still mocked', function (assert) {
    api.get('/teardown', { ok: true });
    assert.expect(2);
    assert.ok(true);
  });
});

module('Unit | setupApiMocks unhandled teardown', function (hooks) {
  collectFailures(hooks);
  hooks.afterEach(async function (assert) {
    await send('GET', '/unhandled-teardown');
    assert.strictEqual(this.failures.length, 1);
  });
  setupTest(hooks);
  setupApiMocks(hooks);

  test('an unhandled request during teardown fails the test', function (assert) {
    assert.expect(2);
    assert.ok(true);
  });
});
