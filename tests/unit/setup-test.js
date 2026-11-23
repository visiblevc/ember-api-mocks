import { module, test } from 'qunit';

import { setupApiMocks } from '#src/index.ts';

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
