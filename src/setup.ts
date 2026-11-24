import * as QUnit from 'qunit';

import { clearRequests } from './api.ts';
import { resetSequences } from './factories.ts';
import { disableNetwork, enableNetwork, settleRequests } from './network.ts';

let enabled = false;
let registered = false;

function registerTeardown(): void {
  if (registered) {
    return;
  }
  registered = true;
  QUnit.hooks.afterEach(function () {
    if (enabled) {
      enabled = false;
      disableNetwork();
      clearRequests();
    }
  });
}

export function setupApiMocks(hooks: NestedHooks): void {
  registerTeardown();
  hooks.beforeEach(function (this: { owner?: unknown }) {
    if (!this.owner) {
      throw new Error(
        'Call setupApiMocks(hooks) after setupTest, setupRenderingTest or setupApplicationTest',
      );
    }
    resetSequences();
    enableNetwork();
    enabled = true;
  });
  hooks.afterEach(async function () {
    await settleRequests();
  });
}
