import { jsonApi, type Format } from './formats.ts';
import { setInflector } from './inflection.ts';

export type UnhandledPolicy = 'error' | 'warn' | 'not-found' | 'passthrough';

export interface Options {
  apiHost?: string;
  namespace?: string;
  origins?: string[];
  format?: Format;
  onUnhandledRequest?: {
    app?: UnhandledPolicy;
    other?: UnhandledPolicy;
  };
  beacons?: boolean;
  pluralize?: (word: string) => string;
  singularize?: (word: string) => string;
}

export interface Settings {
  apiBase: string;
  namespace: string;
  appOrigins: string[];
  format: Format;
  onUnhandledRequest: { app: UnhandledPolicy; other: UnhandledPolicy };
  beacons: boolean;
}

let options: Options = {};
let resolved: Settings | undefined;

export function configure(next: Options): void {
  options = { ...options, ...next };
  resolved = undefined;
  if (next.pluralize || next.singularize) {
    setInflector({
      pluralize: options.pluralize,
      singularize: options.singularize,
    });
  }
}

function toUrl(host: string): URL {
  return new URL(host, window.location.href);
}

export function settings(): Settings {
  if (resolved) {
    return resolved;
  }
  const api = toUrl(options.apiHost ?? window.location.origin);
  resolved = {
    apiBase: `${api.origin}${api.pathname}`.replace(/\/$/, ''),
    namespace: (options.namespace ?? '').replace(/\/$/, ''),
    appOrigins: [
      ...new Set([
        window.location.origin,
        api.origin,
        ...(options.origins ?? []).map((origin) => toUrl(origin).origin),
      ]),
    ],
    format: options.format ?? jsonApi(),
    onUnhandledRequest: {
      app: options.onUnhandledRequest?.app ?? 'error',
      other: options.onUnhandledRequest?.other ?? 'not-found',
    },
    beacons: options.beacons ?? false,
  };
  return resolved;
}
