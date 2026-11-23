import { clearRequests } from './api.ts';
import { resetSequences } from './factories.ts';
import { disableNetwork, enableNetwork, settleRequests } from './network.ts';

export function setupApiMocks(hooks: NestedHooks): void {
  hooks.beforeEach(function (this: { owner?: unknown }) {
    if (!this.owner) {
      throw new Error(
        'Call setupApiMocks(hooks) after setupTest, setupRenderingTest or setupApplicationTest',
      );
    }
    resetSequences();
    enableNetwork();
  });
  hooks.afterEach(async function () {
    await settleRequests();
    disableNetwork();
    clearRequests();
  });
}
