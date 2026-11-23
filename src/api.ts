import { http, HttpResponse } from 'msw';

import { settings } from './config.ts';
import { factoryOf, formatOf, nextId, payload, urlOf } from './factories.ts';
import type { Attrs, BuiltRecord } from './formats.ts';
import {
  finishRequest,
  nearMisses,
  reportFailure,
  useHandler,
} from './network.ts';
import { sourceOf } from './store.ts';

export interface Call {
  method: string;
  url: string;
  params: Record<string, string | readonly string[] | undefined>;
  query: Attrs;
  body: unknown;
  headers: Headers;
}

type Responder = (call: Call) => unknown;
type ResponseValue = unknown;
type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';

interface Guard {
  body?: unknown;
  query?: unknown;
  partialQuery?: unknown;
}

const requests: Call[] = [];

export class Handle {
  calls: Call[] = [];
  removed = false;
  where: Guard = {};

  constructor(
    public response: ResponseValue,
    private readonly toResponse?: (...args: unknown[]) => ResponseValue,
  ) {}

  get timesCalled(): number {
    return this.calls.length;
  }

  get lastCall(): Call | undefined {
    return this.calls.at(-1);
  }

  returns(...args: unknown[]): this {
    const [value] = args;
    const isRaw = value instanceof Response || typeof value === 'function';
    this.response =
      this.toResponse && !isRaw ? this.toResponse(...args) : value;
    return this;
  }

  fails(status = 500, body: unknown = {}): this {
    this.response = reply(status, body);
    return this;
  }

  match(body: unknown): this {
    this.where = { ...this.where, body };
    return this;
  }

  withQuery(query: Attrs, { partial = false } = {}): this {
    const { query: _query, partialQuery: _partial, ...where } = this.where;
    this.where = { ...where, [partial ? 'partialQuery' : 'query']: query };
    return this;
  }

  remove(): void {
    this.removed = true;
  }
}

function assign(target: Attrs, path: string, value: unknown): void {
  const keys = path.replace(/\]/g, '').split('[');
  let node: unknown = target;
  keys.slice(0, -1).forEach((key, index) => {
    const container = node as Attrs;
    container[key] ??= keys[index + 1] === '' ? [] : {};
    node = container[key];
  });
  const last = keys.at(-1) ?? '';
  if (Array.isArray(node) && last === '') {
    node.push(value);
  } else {
    (node as Attrs)[last] = value;
  }
}

function parseEntries(entries: Iterable<[string, unknown]>): Attrs {
  const result: Attrs = {};
  for (const [key, value] of entries) {
    assign(result, key, value);
  }
  return result;
}

async function parseBody(request: Request): Promise<unknown> {
  const contentType = request.headers.get('content-type') ?? '';
  if (!request.body) {
    return undefined;
  } else if (contentType.includes('json')) {
    return request.clone().json();
  } else if (
    contentType.includes('form-data') ||
    contentType.includes('x-www-form-urlencoded')
  ) {
    return parseEntries(await request.clone().formData());
  }
  return request.clone().text();
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

function isSubset(expected: unknown, actual: unknown): boolean {
  expected = plain(expected);
  if (typeof expected === 'function') {
    return Boolean((expected as (value: unknown) => unknown)(actual));
  } else if (Array.isArray(expected)) {
    return (
      Array.isArray(actual) &&
      actual.length === expected.length &&
      expected.every((value, index) => isSubset(value, actual[index]))
    );
  } else if (isObject(expected)) {
    return (
      isObject(actual) &&
      !Array.isArray(actual) &&
      Object.entries(expected).every(([key, value]) =>
        isSubset(value, actual[key]),
      )
    );
  } else if (expected === null || expected === undefined) {
    return actual === expected;
  } else if (isObject(actual)) {
    return false;
  }
  return text(expected) === text(actual);
}

function isSameQuery(expected: unknown, actual: unknown): boolean {
  expected = plain(expected);
  if (isObject(expected)) {
    const keys = Object.keys(expected).filter(
      (key) => expected[key] !== undefined,
    );
    return (
      isObject(actual) &&
      Array.isArray(expected) === Array.isArray(actual) &&
      keys.length === Object.keys(actual).length &&
      keys.every(
        (key) =>
          Object.hasOwn(actual, key) && isSameQuery(expected[key], actual[key]),
      )
    );
  } else if (isObject(actual)) {
    return false;
  }
  return text(expected ?? '') === text(actual ?? '');
}

function matches({ body, query, partialQuery }: Guard, call: Call): boolean {
  return (
    (body === undefined || isSubset(body, call.body)) &&
    (query === undefined || isSameQuery(query, call.query)) &&
    (partialQuery === undefined || isSubset(partialQuery, call.query))
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
  }
  return `${settings().apiBase}${path}`;
}

function register(
  method: Method,
  path: string,
  response: ResponseValue,
  toPayload?: (...args: unknown[]) => ResponseValue,
): Handle {
  const handle = new Handle(response, toPayload);

  const respond = async ({
    request,
    params,
    requestId,
  }: {
    request: Request;
    params: Call['params'];
    requestId: string;
  }) => {
    if (handle.removed) {
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
    if (!matches(handle.where, call)) {
      nearMisses.set(requestId, [
        ...(nearMisses.get(requestId) ?? []),
        { expected: handle.where as Attrs, received: call as unknown as Attrs },
      ]);
      return undefined;
    }
    handle.calls.push(call);
    requests.push(call);
    return toResponse(handle.response, call);
  };

  useHandler(
    http[method](absoluteUrl(path), async (info) => {
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
  return urlOf(type) ?? `${settings().namespace}${formatOf(type).path(type)}`;
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
    if (isObject(recordOrId) && !('id' in recordOrId)) {
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

export function reply(status: number, body: unknown = {}): Response {
  return HttpResponse.json(body as Attrs, { status });
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

  find(typeOrRecord: unknown, recordOrId?: unknown): Handle {
    const { type, record, id } = resolve(typeOrRecord, recordOrId);
    const one = (value: unknown, extra?: Attrs) => () =>
      payload(type, sourceOf(value) as BuiltRecord, extra);
    const any = ({ params }: Call) => payload(type, { id: params.id });

    return register(
      'get',
      `${collectionUrl(type)}/${id == null ? ':id' : text(id)}`,
      record ? one(record) : any,
      one as (...args: unknown[]) => ResponseValue,
    );
  },

  query(type: string, records: unknown[] = [], extra: Attrs = {}): Handle {
    const many =
      (list: unknown[] = [], more: Attrs = {}) =>
      () =>
        payload(type, list.map(sourceOf) as BuiltRecord[], more);

    return register(
      'get',
      collectionUrl(type),
      many(records, extra),
      many as (...args: unknown[]) => ResponseValue,
    );
  },

  create(type: string, attrs: Attrs | Responder = {}): Handle {
    const format = formatOf(type);
    const created = (values: Attrs | Responder) =>
      typeof values === 'function'
        ? values
        : ({ body }: Call) =>
            payload(type, {
              id: format.idFromBody(type, body) ?? nextId(type),
              ...values,
            });

    return register(
      'post',
      collectionUrl(type),
      created(attrs),
      created as (...args: unknown[]) => ResponseValue,
    );
  },

  update(typeOrRecord: unknown, ...args: unknown[]): Handle {
    const { type, id, rest } = resolve(typeOrRecord, ...args);
    const attrs = (rest[0] ?? {}) as Attrs | Responder;
    const updated = (values: Attrs | Responder) =>
      typeof values === 'function'
        ? values
        : ({ params }: Call) =>
            payload(type, { id: id ?? params.id, ...values });

    return register(
      formatOf(type).updateMethod,
      `${collectionUrl(type)}/${id == null ? ':id' : text(id)}`,
      updated(attrs),
      updated as (...args: unknown[]) => ResponseValue,
    );
  },

  destroy(typeOrRecord: unknown, recordOrId?: unknown): Handle {
    const { type, id } = resolve(typeOrRecord, recordOrId);
    return register(
      'delete',
      `${collectionUrl(type)}/${id == null ? ':id' : text(id)}`,
      null,
    );
  },
};
