import { jsonApi, type Format } from './formats.ts';

export interface Options {
  apiHost?: string | null;
  namespace?: string;
  origins?: (string | null | undefined)[];
  format?: Format;
  beacons?: boolean;
  bypass?: string[];
}

export interface Settings {
  apiBase: string;
  namespace: string;
  appOrigins: string[];
  format: Format;
  beacons: boolean;
  bypass: string[];
  bypassPercy: boolean;
}

let options: Options = {};
let resolved: Settings | undefined;

export function configure(next: Options): void {
  options = { ...options, ...next };
  resolved = undefined;
}

export function resetConfiguration(): void {
  options = {};
  resolved = undefined;
}

const PERCY_DEFAULT = 'http://localhost:5338';

export function percyOrigin(): string {
  const scope = globalThis as {
    PercySDKUtils?: { percy?: { address?: unknown } };
    process?: { env?: Record<string, string | undefined> };
  };
  const runtime = scope.PercySDKUtils?.percy?.address;
  const address =
    typeof runtime === 'string'
      ? runtime
      : (scope.process?.env?.PERCY_SERVER_ADDRESS ?? PERCY_DEFAULT);
  return new URL(URL.canParse(address) ? address : PERCY_DEFAULT).origin;
}

function toUrl(host: string): URL {
  return new URL(host, window.location.href);
}

export function settings(): Settings {
  if (resolved) {
    return resolved;
  }
  const api = toUrl(options.apiHost || window.location.origin);
  resolved = {
    apiBase: `${api.origin}${api.pathname}`.replace(/\/$/, ''),
    namespace: (options.namespace ?? '')
      .replace(/^\/*/, '/')
      .replace(/\/+$/, ''),
    appOrigins: [
      ...new Set([
        window.location.origin,
        api.origin,
        ...(options.origins ?? [])
          .filter((origin): origin is string => Boolean(origin))
          .map((origin) => toUrl(origin).origin),
      ]),
    ],
    format: options.format ?? jsonApi(),
    beacons: options.beacons ?? false,
    bypass: (options.bypass ?? []).map((origin) => toUrl(origin).origin),
    bypassPercy: options.bypass === undefined,
  };
  return resolved;
}
