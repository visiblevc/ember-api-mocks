import { buildWaiter } from '@ember/test-waiters';

const waiter = buildWaiter('ember-api-mocks:responses');
const nativeSetTimeout = window.setTimeout.bind(window);
const READERS = [
  'json',
  'text',
  'arrayBuffer',
  'blob',
  'formData',
  'bytes',
] as const;

interface Pending {
  token: unknown;
  reads: number;
  readStarted: boolean;
  ended: boolean;
}

const open = new Set<Pending>();
let patchedFetch: typeof fetch | undefined;

function end(pending: Pending): void {
  if (!pending.ended) {
    pending.ended = true;
    waiter.endAsync(pending.token);
    open.delete(pending);
  }
}

function endAfterReads(pending: Pending): void {
  nativeSetTimeout(() => {
    if (pending.reads === 0) {
      end(pending);
    }
  }, 0);
}

function instrument(response: Response, pending: Pending): Response {
  const target = response as unknown as Record<string, unknown>;
  for (const reader of READERS) {
    const original = target[reader];
    if (typeof original !== 'function') {
      continue;
    }
    target[reader] = (...args: unknown[]) => {
      pending.reads += 1;
      pending.readStarted = true;
      return (original as (...a: unknown[]) => Promise<unknown>)
        .apply(response, args)
        .finally(() => {
          pending.reads -= 1;
          endAfterReads(pending);
        });
    };
  }
  const clone = response.clone.bind(response);
  target.clone = () => instrument(clone(), pending);
  return response;
}

function urlOf(input: RequestInfo | URL): string | undefined {
  const raw = input instanceof Request ? input.url : String(input);
  return URL.canParse(raw, window.location.href)
    ? new URL(raw, window.location.href).href
    : undefined;
}

export function installFetchWaiter(tracks: (url: string) => boolean): void {
  if (patchedFetch) {
    return;
  }
  const inner = globalThis.fetch;
  patchedFetch = inner;
  globalThis.fetch = function (input: RequestInfo | URL, init?: RequestInit) {
    const url = urlOf(input);
    if (url === undefined || !tracks(url)) {
      return inner(input, init);
    }
    const pending: Pending = {
      token: waiter.beginAsync(),
      reads: 0,
      readStarted: false,
      ended: false,
    };
    open.add(pending);
    return inner(input, init).then(
      (response) => {
        nativeSetTimeout(
          () =>
            nativeSetTimeout(() => {
              if (!pending.readStarted) {
                end(pending);
              }
            }, 0),
          0,
        );
        return instrument(response, pending);
      },
      (error: unknown) => {
        endAfterReads(pending);
        throw error;
      },
    );
  };
}

export function endOpenResponses(): void {
  [...open].forEach(end);
}

export function removeFetchWaiter(): void {
  if (patchedFetch) {
    globalThis.fetch = patchedFetch;
    patchedFetch = undefined;
  }
  endOpenResponses();
}
