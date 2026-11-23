import { hasPendingWaiters } from '@ember/test-waiters';
import { FetchInterceptor } from '@mswjs/interceptors/fetch';
import { XMLHttpRequestInterceptor } from '@mswjs/interceptors/XMLHttpRequest';
import { http, HttpResponse, passthrough, type HttpHandler } from 'msw';
import { defineNetwork, InterceptorSource } from 'msw/experimental';
import * as QUnit from 'qunit';

import { installBeaconShim, removeBeaconShim } from './beacon.ts';
import { settings, type UnhandledPolicy } from './config.ts';

export interface NearMiss {
  expected: Record<string, unknown>;
  received: Record<string, unknown>;
}

export const nearMisses = new Map<string, NearMiss[]>();

let reporter: (failure: Error) => void = (failure) =>
  QUnit.onUncaughtException(failure);

export function setFailureReporter(next: (failure: Error) => void): () => void {
  const previous = reporter;
  reporter = next;
  return () => {
    reporter = previous;
  };
}

export function reportFailure(failure: unknown): void {
  reporter(failure instanceof Error ? failure : new Error(String(failure)));
}

function describe(value: unknown): string {
  return JSON.stringify(
    value,
    (_key, item: unknown) =>
      typeof item === 'function' ? '[predicate]' : item,
    2,
  );
}

function describeNearMisses(requestId: string): string {
  return (nearMisses.get(requestId) ?? [])
    .map(({ expected, received }) => {
      const actual = Object.fromEntries(
        Object.keys(expected).map((key) => [
          key,
          received[key === 'partialQuery' ? 'query' : key],
        ]),
      );
      return `\nA handler for this URL expected ${describe(expected)}\nbut received ${describe(actual)}`;
    })
    .join('');
}

function applyPolicy(policy: UnhandledPolicy, message: string) {
  if (policy === 'passthrough') {
    return passthrough();
  } else if (policy === 'error') {
    reportFailure(new Error(message));
  } else if (policy === 'warn') {
    console.warn(message);
  }
  return new HttpResponse(null, { status: 404 });
}

const unhandled = http.all('*', ({ request, requestId }) => {
  if (!/^https?:/.test(request.url)) {
    return passthrough();
  }
  const { appOrigins, onUnhandledRequest } = settings();
  const isApp = appOrigins.includes(new URL(request.url).origin);
  return applyPolicy(
    isApp ? onUnhandledRequest.app : onUnhandledRequest.other,
    `No handler for ${request.method} ${request.url}${describeNearMisses(requestId)}`,
  );
});

const pendingRequests = new Set<string>();

function createNetwork() {
  const created = defineNetwork({
    sources: [
      new InterceptorSource({
        interceptors: [new XMLHttpRequestInterceptor(), new FetchInterceptor()],
      }),
    ],
    handlers: [unhandled],
    onUnhandledFrame: 'bypass',
    context: { quiet: true },
  });
  created.events.on('request:start', (event) =>
    pendingRequests.add((event as { requestId: string }).requestId),
  );
  created.events.on('request:end', (event) =>
    pendingRequests.delete((event as { requestId: string }).requestId),
  );
  return created;
}

let instance: ReturnType<typeof createNetwork> | undefined;

function network(): ReturnType<typeof createNetwork> {
  return (instance ??= createNetwork());
}

export function useHandler(handler: HttpHandler): void {
  network().use(handler);
}

export function enableNetwork(): void {
  network().enable();
  if (settings().beacons) {
    installBeaconShim();
  }
}

export function disableNetwork(): void {
  removeBeaconShim();
  network().resetHandlers();
  network().disable();
  pendingRequests.clear();
  nearMisses.clear();
}

export function finishRequest(requestId: string): void {
  pendingRequests.delete(requestId);
}

const nativeSetTimeout = window.setTimeout.bind(window);
const SETTLE_LIMIT = 1000;

export async function settleRequests(): Promise<void> {
  let quiet = 0;
  for (let tries = 0; quiet < 2 && tries < SETTLE_LIMIT; tries++) {
    await new Promise((resolve) => nativeSetTimeout(resolve, 0));
    quiet = pendingRequests.size === 0 && !hasPendingWaiters() ? quiet + 1 : 0;
  }
  if (quiet < 2) {
    reportFailure(new Error('Requests were still pending when the test ended'));
  }
  pendingRequests.clear();
}
