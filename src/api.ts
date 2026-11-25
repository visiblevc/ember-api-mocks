import { http, HttpResponse } from 'msw';

import { settings } from './config.ts';
import { definitionOf, factoryOf, nextId, payload } from './factories.ts';
import type { Attrs, BuiltRecord } from './formats.ts';
import {
  finishRequest,
  isBypassed,
  nearMisses,
  reportFailure,
  useHandler,
} from './network.ts';
import { sourceOf } from './store.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Json = any;

export interface Call {
  method: string;
  url: string;
  params: Record<string, string | readonly string[] | undefined>;
  query: Json;
  body: Json;
  headers: Headers;
}

type Responder = (call: Call) => unknown;
type ResponseValue = Responder | Response | object | null | undefined;
type HeaderValue = string | number | null | ((value: string | null) => unknown);
type Arg = ResponseValue | string | number;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Guard {
  body?: unknown;
  exactBody?: unknown;
  query?: unknown;
  partialQuery?: unknown;
  headers?: Record<string, HeaderValue>;
}

const requests: Call[] = [];

export interface Handle {
  readonly calls: Call[];
  readonly timesCalled: number;
  readonly lastCall: Call;
  returns(...args: Arg[]): Handle;
  fails(status?: number, body?: unknown): Handle;
  withBody(
    body: object | ((body: Json) => unknown),
    options?: { exact?: boolean },
  ): Handle;
  withQuery(query: Attrs, options?: { partial?: boolean }): Handle;
  withHeaders(headers: Record<string, HeaderValue>): Handle;
  remove(): void;
}

function parseEntries(entries: Iterable<[string, unknown]>): Attrs {
  const result: Attrs = {};
  for (const [path, value] of entries) {
    const keys = path.replace(/\]/g, '').split('[');
    let node: Attrs = result;
    keys.forEach((key, index) => {
      const next = keys[index + 1];
      const slot =
        Array.isArray(node) && key === '' ? String(node.length) : key;
      const current = Object.hasOwn(node, slot) ? node[slot] : undefined;
      const item =
        next === undefined
          ? current === undefined
            ? value
            : [current, value].flat()
          : isObject(current)
            ? current
            : /^\d*$/.test(next)
              ? []
              : {};
      Object.defineProperty(node, slot, {
        value: item,
        enumerable: true,
        writable: true,
        configurable: true,
      });
      node = item as Attrs;
    });
  }
  return result;
}

async function parseBody(request: Request): Promise<unknown> {
  const text = await request.clone().text();
  if (!text) {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';
  if (contentType.includes('json')) {
    return JSON.parse(text);
  } else if (
    contentType.includes('form-data') ||
    contentType.includes('x-www-form-urlencoded')
  ) {
    return parseEntries(await request.clone().formData());
  }
  return text;
}

function plain(value: unknown): unknown {
  return value !== null &&
    typeof value === 'object' &&
    typeof (value as { toJSON?: unknown }).toJSON === 'function'
    ? (value as { toJSON(): unknown }).toJSON()
    : value;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : (JSON.stringify(value) ?? '');
}

function isObject(value: unknown): value is Attrs {
  return value !== null && typeof value === 'object';
}

interface Comparison {
  exact?: boolean;
  typed?: boolean;
}

function isSubset(
  expected: unknown,
  actual: unknown,
  comparison: Comparison = {},
): boolean {
  const { exact = false, typed = false } = comparison;
  expected = plain(expected);
  if (typeof expected === 'function') {
    return Boolean((expected as (value: unknown) => unknown)(actual));
  } else if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) =>
        isSubset(value, actual[index], comparison),
      )
    );
  } else if (isObject(expected)) {
    const entries = Object.entries(expected);
    return (
      isObject(actual) &&
      !Array.isArray(actual) &&
      (!exact ||
        Object.keys(actual).every(
          (key) => Object.hasOwn(expected, key) && expected[key] !== undefined,
        )) &&
      entries.every(
        ([key, value]) =>
          (Object.hasOwn(actual, key) ||
            value === undefined ||
            typeof value === 'function') &&
          isSubset(value, actual[key], comparison),
      )
    );
  } else if (expected === null || expected === undefined) {
    return actual === expected;
  } else if (isObject(actual)) {
    return false;
  }
  return typed ? expected === actual : text(expected) === text(actual);
}

function hasHeaders(
  expected: Record<string, HeaderValue>,
  headers: Headers,
): boolean {
  return Object.entries(expected).every(([name, value]) => {
    const actual = headers.get(name);
    if (typeof value === 'function') {
      return Boolean(value(actual));
    }
    return value == null ? actual === null : actual === text(value);
  });
}

function matches(
  { body, exactBody, query, partialQuery, headers }: Guard,
  call: Call,
): boolean {
  const typed = (call.headers.get('content-type') ?? '').includes('json');
  return (
    (body === undefined || isSubset(body, call.body, { typed })) &&
    (exactBody === undefined ||
      isSubset(exactBody, call.body, { exact: true, typed })) &&
    (query === undefined || isSubset(query, call.query, { exact: true })) &&
    (partialQuery === undefined || isSubset(partialQuery, call.query)) &&
    (headers === undefined || hasHeaders(headers, call.headers))
  );
}

function unwrapRecords(body: unknown): unknown {
  if (!isObject(body) || Object.getPrototypeOf(body) !== Object.prototype) {
    return body;
  }
  return Object.fromEntries(
    Object.entries(body).map(([key, value]) => [
      key,
      Array.isArray(value) ? value.map(sourceOf) : sourceOf(value),
    ]),
  );
}

async function toResponse(
  response: ResponseValue,
  call: Call,
): Promise<Response> {
  const resolved =
    typeof response === 'function'
      ? await (response as Responder)(call)
      : response;
  if (resolved instanceof Response) {
    return resolved.clone();
  } else if (resolved == null) {
    return new HttpResponse(null, { status: 204 });
  }
  return HttpResponse.json(unwrapRecords(resolved) as Attrs);
}

export function absoluteUrl(path: string): string {
  if (/^https?:/.test(path)) {
    return path;
  } else if (path.startsWith('//')) {
    return `${window.location.protocol}${path}`;
  } else if (!path.startsWith('/')) {
    throw new Error(
      `api paths start with "/" or are absolute URLs, got "${path}"`,
    );
  }
  return `${settings().apiBase}${path}`;
}

function register(
  method: Method,
  path: string,
  initial: ResponseValue,
  toPayload?: (...args: unknown[]) => ResponseValue,
): Handle {
  const url = absoluteUrl(path);
  const calls: Call[] = [];
  let response = initial;
  let removed = false;
  let where: Guard = {};

  const handle: Handle = {
    calls,
    get timesCalled() {
      return calls.length;
    },
    get lastCall() {
      return calls.at(-1) as Call;
    },
    returns(...args) {
      const [value] = args;
      const isRaw =
        value === null ||
        value instanceof Response ||
        typeof value === 'function';
      response =
        toPayload && !isRaw ? toPayload(...args) : (value as ResponseValue);
      return handle;
    },
    fails(status = 500, body = {}) {
      response = reply(status, body);
      return handle;
    },
    withBody(body, { exact = false } = {}) {
      const { body: _body, exactBody: _exact, ...rest } = where;
      where = { ...rest, [exact ? 'exactBody' : 'body']: body };
      return handle;
    },
    withQuery(query, { partial = false } = {}) {
      const { query: _query, partialQuery: _partial, ...rest } = where;
      where = { ...rest, [partial ? 'partialQuery' : 'query']: query };
      return handle;
    },
    withHeaders(headers) {
      where = {
        ...where,
        headers: {
          ...where.headers,
          ...Object.fromEntries(
            Object.entries(headers).map(([name, value]) => [
              name.toLowerCase(),
              value,
            ]),
          ),
        },
      };
      return handle;
    },
    remove() {
      removed = true;
    },
  };

  const respond = async ({
    request,
    params,
    requestId,
  }: {
    request: Request;
    params: Call['params'];
    requestId: string;
  }) => {
    if (removed || isBypassed(request.url)) {
      return undefined;
    }
    const call: Call = {
      method: request.method,
      url: request.url,
      params,
      query: parseEntries(new URL(request.url).searchParams),
      body: await parseBody(request),
      headers: request.headers,
    };
    if (!matches(where, call)) {
      nearMisses.set(requestId, [
        ...(nearMisses.get(requestId) ?? []),
        {
          expected: where as Attrs,
          received: { ...call, headers: Object.fromEntries(call.headers) },
        },
      ]);
      return undefined;
    }
    calls.push(call);
    requests.push(call);
    return toResponse(response, call);
  };

  useHandler(
    http[method](url, async (info) => {
      try {
        return await respond(info);
      } catch (failure) {
        finishRequest(info.requestId);
        reportFailure(failure);
        throw failure;
      }
    }),
  );

  return handle;
}

function collectionUrl(type: string): string {
  const { url, format } = definitionOf(type);
  return url ?? `${settings().namespace}${format.path(type)}`;
}

function memberUrl(type: string, id?: unknown): string {
  return `${collectionUrl(type)}/${id == null ? ':id' : text(id)}`;
}

interface Target {
  type: string;
  record?: BuiltRecord;
  id?: unknown;
  rest: unknown[];
}

function resolve(typeOrRecord: unknown, ...args: unknown[]): Target {
  if (typeof typeOrRecord === 'string') {
    const [recordOrId, ...rest] = args;
    if (
      typeof recordOrId === 'function' ||
      recordOrId instanceof Response ||
      (isObject(recordOrId) && !('id' in recordOrId))
    ) {
      return { type: typeOrRecord, rest: args };
    }
    const isRecord = isObject(recordOrId);
    return {
      type: typeOrRecord,
      record: isRecord ? (recordOrId as BuiltRecord) : undefined,
      id: isRecord ? (recordOrId as BuiltRecord).id : recordOrId,
      rest,
    };
  }
  const record = typeOrRecord as BuiltRecord & {
    constructor: { modelName?: string };
  };
  const type = record.constructor.modelName ?? factoryOf(record);
  if (!type) {
    throw new Error(
      'api shortcuts need a type name, a record from build() or a seeded model',
    );
  }
  return { type, record, id: record.id, rest: args };
}

export function reply(status: number, body?: unknown): Response {
  return body === undefined
    ? new HttpResponse(null, { status })
    : HttpResponse.json(body as Attrs, { status });
}

export function clearRequests(): void {
  requests.length = 0;
}

export const api = {
  get requests(): Call[] {
    return requests;
  },

  lastRequest(method: string, path: string): Call | undefined {
    const { pathname } = new URL(absoluteUrl(path));
    return requests.findLast(
      (call) =>
        call.method === method.toUpperCase() &&
        new URL(call.url).pathname === pathname,
    );
  },

  get: (path: string, response?: ResponseValue) =>
    register('get', path, response),
  post: (path: string, response?: ResponseValue) =>
    register('post', path, response),
  put: (path: string, response?: ResponseValue) =>
    register('put', path, response),
  patch: (path: string, response?: ResponseValue) =>
    register('patch', path, response),
  delete: (path: string, response?: ResponseValue) =>
    register('delete', path, response),

  find(typeOrRecord: string | object, ...args: Arg[]): Handle {
    const { type, record, id, rest } = resolve(typeOrRecord, ...args);
    const [last] = rest;
    const raw =
      typeof last === 'function' || last instanceof Response ? last : undefined;
    const extra = raw === undefined && isObject(last) ? last : undefined;
    const one = (value: unknown, more?: Attrs) => () =>
      payload(type, sourceOf(value) as BuiltRecord, more);
    const any =
      (more?: Attrs) =>
      ({ params }: Call) =>
        payload(type, { id: id ?? params.id }, more);

    return register(
      'get',
      memberUrl(type, id),
      raw ?? (record ? one(record, extra) : any(extra)),
      one as (...args: unknown[]) => ResponseValue,
    );
  },

  query(
    type: string,
    records: unknown[] | Responder | Response = [],
    extra: Attrs = {},
  ): Handle {
    const many =
      (list: unknown[] = [], more: Attrs = {}) =>
      () =>
        payload(type, list.map(sourceOf), more);

    return register(
      'get',
      collectionUrl(type),
      Array.isArray(records) ? many(records, extra) : records,
      many as (...args: unknown[]) => ResponseValue,
    );
  },

  create(type: string, attrs: Attrs | Responder = {}): Handle {
    const { format } = definitionOf(type);
    const created = (values: Attrs | Responder) =>
      typeof values === 'function'
        ? values
        : ({ body }: Call) =>
            payload(type, {
              id:
                format.idFromBody(type, body) ??
                settings().id(type, nextId(type)),
              ...values,
            });

    return register(
      'post',
      collectionUrl(type),
      created(attrs),
      created as (...args: unknown[]) => ResponseValue,
    );
  },

  update(typeOrRecord: string | object, ...args: Arg[]): Handle {
    const { type, id, rest } = resolve(typeOrRecord, ...args);
    const attrs = (rest[0] ?? {}) as Attrs | Responder;
    const updated = (values: Attrs | Responder) =>
      typeof values === 'function'
        ? values
        : ({ params }: Call) =>
            payload(type, { id: id ?? params.id, ...values });

    return register(
      definitionOf(type).format.updateMethod,
      memberUrl(type, id),
      updated(attrs),
      updated as (...args: unknown[]) => ResponseValue,
    );
  },

  destroy(typeOrRecord: string | object, ...args: Arg[]): Handle {
    const { type, id, rest } = resolve(typeOrRecord, ...args);
    return register('delete', memberUrl(type, id), rest[0] ?? null);
  },
};
