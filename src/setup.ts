import {
  setupApplicationTest as upstreamSetupApplicationTest,
  setupRenderingTest as upstreamSetupRenderingTest,
  setupTest as upstreamSetupTest,
} from 'ember-qunit';

import { clearRequests } from './api.ts';
import { resetSequences } from './factories.ts';
import { disableNetwork, enableNetwork, settleRequests } from './network.ts';

type Setup = (hooks: NestedHooks, options?: object) => void;

function withApi(setup: Setup): Setup {
  return function (hooks, options) {
    hooks.beforeEach(function () {
      resetSequences();
      enableNetwork();
    });
    hooks.afterEach(function () {
      disableNetwork();
      clearRequests();
    });
    setup(hooks, options);
    hooks.afterEach(settleRequests);
  };
}

export const setupApplicationTest = withApi(upstreamSetupApplicationTest);
export const setupRenderingTest = withApi(upstreamSetupRenderingTest);
export const setupTest = withApi(upstreamSetupTest);
