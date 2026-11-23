import {
  setupApplicationTest as upstreamSetupApplicationTest,
  setupRenderingTest as upstreamSetupRenderingTest,
  setupTest as upstreamSetupTest,
} from 'ember-qunit';

import { clearRequests } from './api.ts';
import { resetSequences } from './factories.ts';
import { disableNetwork, enableNetwork, settleRequests } from './network.ts';

type Setup = (hooks: NestedHooks, options?: object) => void;

export function setupApi(hooks: NestedHooks): void {
  hooks.beforeEach(function () {
    resetSequences();
    enableNetwork();
  });

  hooks.afterEach(function () {
    disableNetwork();
    clearRequests();
  });
}

export function withApi(setup: Setup): Setup {
  return function (hooks, options) {
    setupApi(hooks);
    setup(hooks, options);
    hooks.afterEach(settleRequests);
  };
}

export const setupApplicationTest = withApi(upstreamSetupApplicationTest);
export const setupRenderingTest = withApi(upstreamSetupRenderingTest);
export const setupTest = withApi(upstreamSetupTest);

export { settleRequests };
