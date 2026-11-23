import { setFailureReporter } from '#src/network.ts';

import { API_HOST } from './config.ts';

export function send(method, path, body, host = API_HOST) {
  return fetch(`${host}${path}`, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
}

export function collectFailures(hooks) {
  hooks.beforeEach(function () {
    this.failures = [];
    this.restoreReporter = setFailureReporter((error) =>
      this.failures.push(error.message),
    );
  });

  hooks.afterEach(function () {
    this.restoreReporter();
  });
}
