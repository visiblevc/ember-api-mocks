# @visiblevc/ember-api-mocks

Request mocking and API-shaped test data for Ember apps.

- Requests are intercepted in the page by [MSW](https://mswjs.io) interceptors that patch `fetch` and `XMLHttpRequest`. There is no service worker, nothing to register, and no `public/mockServiceWorker.js`.
- Factories build the JSON your API sends: ActiveModel, REST or JSON:API, with your key casing and relationship ids. Mocks serve that JSON, so the app parses real responses through its own adapters and serializers.
- Component and unit tests push the same JSON into the store with `store.pushPayload`. Nothing reads or writes ember-data internals.
- A request the test did not mock fails the test and says which mock came close.

```js
import { api, buildList, setupApplicationTest } from '@visiblevc/ember-api-mocks';

module('Acceptance | contacts', function (hooks) {
  setupApplicationTest(hooks);

  test('renames a contact', async function (assert) {
    const contacts = buildList('contact', 2, { company_id: 1 });
    api.query('contact', contacts, { meta: { total: 2 } });
    const update = api.update(contacts[0]).match({ contact: { name: 'Ada' } });

    await visit('/contacts');
    await fillIn('[data-test-name]', 'Ada');
    await click('[data-test-save]');

    assert.strictEqual(update.timesCalled, 1);
  });
});
```

## Compatibility

CI runs the addon's tests against:

| | Versions |
| --- | --- |
| ember-source | 5.8, 5.12, 6.4, 6.12, 7.x (latest, beta, alpha) |
| ember-data | 4.12 (with ember-data-model-fragments 9), 5.8, latest 5.x |
| Builds | Vite with Embroider, and classic ember-cli with ember-auto-import 2 |
| Node | 22.12 or later (required by MSW 3) |

It is also used with ember-data 5.3 and 5.6. ember-data is optional: `api` and `build` work without it, `seed` needs it.

Peer dependencies: `qunit` 2.17+, `ember-qunit` 8+, `@ember/test-helpers` 3+, `@ember/test-waiters` 3+. Optional: `ember-data`, `ember-inflector`, `@ember-data/request-utils`, `ember-data-model-fragments`.

## Installation

```sh
pnpm add -D @visiblevc/ember-api-mocks
```

It is a v2 addon. Classic apps need `ember-auto-import` 2.

Configure it once in `tests/test-helper.js`, before `start()`:

```js
import { activeModel, configure } from '@visiblevc/ember-api-mocks';
import config from 'my-app/config/environment';

configure({
  apiHost: config.API_HOST,
  format: activeModel(),
});
```

Then use this package's setup functions instead of ember-qunit's:

```js
import {
  setupApplicationTest,
  setupRenderingTest,
  setupTest,
} from '@visiblevc/ember-api-mocks';
```

If your app has its own wrappers in `tests/helpers`, wrap those instead: `withApi(setup)` returns the same setup function with mocking on, and `setupApi(hooks)` only turns mocking on and off around each test.

### `configure` options

| Option | Default | |
| --- | --- | --- |
| `apiHost` | the page origin | Base URL for paths that start with `/`. May include a path (`https://api.example.com/v2`). |
| `namespace` | `''` | Prefix for type shortcut URLs only (`api/v1`). |
| `format` | `jsonApi()` | Default wire format. A factory can override it. |
| `origins` | `[]` | More origins that count as your app (a CDN, a second API). |
| `onUnhandledRequest` | `{ app: 'error', other: 'not-found' }` | What happens to a request no mock answers. See [Unhandled requests](#unhandled-requests). |
| `bypass` | Percy's local server | Origins that always reach the network untouched. By default that is Percy's server, read from `@percy/sdk-utils` at request time (`http://localhost:5338` unless Percy says otherwise). Setting `bypass` replaces the default, so list Percy's address yourself if you need both. |
| `beacons` | `false` | Send `navigator.sendBeacon` through `fetch` so mocks can answer it. |
| `pluralize`, `singularize` | the app's inflector | Override pluralization. |

`configure` merges with earlier calls. Settings are read when the first test runs.

### Formats

The format decides the document shape, the key check on overrides, how relationships are written, the default collection URL and the update method.

ActiveModel (Rails with active_model_serializers and similar): underscored root keys, `company_id` and `tag_ids`, sideloaded arrays, `PUT`.

```js
configure({ format: activeModel() });
// GET /contacts/1 -> { contact: { id: 1, name: 'Ada', company_id: 3 }, companies: [...] }
```

REST (ember-data's `RESTSerializer`): relationship keys are the relationship names, root keys follow `keys` (`'camel'`, `'snake'` or `'dash'`), `PUT`. The default path is the stock `RESTAdapter` one (`/sharedDecks`), so apps whose adapters underscore or dasherize pass `path`:

```js
import { underscore } from '@ember/string';
import { pluralize } from 'ember-inflector';

configure({
  format: rest({ keys: 'snake', path: (type) => `/${pluralize(underscore(type))}` }),
});
// GET /shared_decks/1 -> { shared_deck: { id: 1, title: 'Q3', owner: 2 } }
```

JSON:API: `{ data, included }`, plural dasherized types, string ids, `PATCH`. A relationship's `data` is written only when the related records are in the document, as jsonapi-resources does; `jsonApi({ linkage: 'always' })` writes it for every relationship.

```js
configure({ format: jsonApi() });
// GET /investors/1 -> { data: { id: '1', type: 'investors', attributes: {...}, relationships: {...} }, included: [...] }
```

A factory can use another format or a fixed URL:

```js
defineFactory('connect-investor', {
  format: jsonApi(),
  url: 'https://connect.example.com/api/investors',
});
```

## Factories

Define factories once, for example in `tests/factories/*.js` imported from `tests/test-helper.js`. Keys are the API's keys, in the format's casing.

```js
import {
  belongsTo,
  defineFactory,
  hasMany,
  sequence,
} from '@visiblevc/ember-api-mocks';

defineFactory('company', {
  default: {
    name: (company) => `Company #${company.id}`,
    slug: sequence((n) => `company-${n}`),
    settings: { currency: 'USD' },
  },
  traits: {
    withSubscription: {
      subscriptions: hasMany('subscription', 1, 'trialing'),
    },
    archived: { archived_at: '2024-01-01T00:00:00Z' },
    shouting: (company) => {
      company.name = company.name.toUpperCase();
    },
  },
  transient: { role: 'admin' },
});

defineFactory('subscription', {
  default: { plan_id: 'basic' },
  traits: { trialing: { status: 'trialing' } },
  relationships: { company: belongsTo('company') },
});
```

- `build(name, ...traits, overrides)` returns a plain JSON record with an `id`. `buildList(name, 3, ...traits, overrides)` returns three; without a count, each argument describes one record: `buildList('user', { name: 'A' }, ['admin', { name: 'B' }])`.
- Ids count up from 1 per factory and restart for every test. An explicit id (`{ id: 5 }` or `{ id: '5' }`) moves the counter past it. For string or uuid ids, set `default.id` to a `sequence((n) => ...)` or a function of `n`.
- Defaults are copied per record. A function value is called with the record once the other values are set.
- `transient` values are options, not attributes. Read them with `transientOf(record)` or in `afterSeed`.
- An override key in the wrong case for the format throws (`planId` for ActiveModel, `plan_id` for JSON:API). The serializer would ignore it and the test would run on the wrong data.

### Relationships

In `default` or a trait, `belongsTo(type, ...)` and `hasMany(type, count, ...)` build the related records, write their ids, and remember them so they are sideloaded (or `included`) with the parent:

```js
const company = build('company', 'withSubscription');
payload('company', company);
// { company: { id: 1, name: 'Company #1', ..., subscription_ids: [1] },
//   subscriptions: [{ id: 1, plan_id: 'basic', status: 'trialing' }] }
```

In `relationships`, they only declare the type, so overrides can pass an id, a list of ids, a built record or, for a polymorphic relationship, `{ type, id }`:

```js
build('subscription', { company: 3 }); // company_id: 3
build('subscription', { company }); // company_id: 1, company sideloaded
build('note', { subject: { type: 'person', id: 4 } }); // JSON:API: { type: 'people', id: '4' }
```

Declared relationships also apply to values assigned after `build`: `subscription.company = company` serves `company_id` and sideloads the company. Without a declaration, write the wire key yourself: `{ company_id: 3 }`. A built record under an undeclared key throws. JSON:API keeps relationships apart from attributes, so declare every relationship there; `seed` throws on an undeclared one.

`fragment(type, ...)` builds a nested object without an id, for embedded objects and ember-data-model-fragments.

### Payloads

- `payload(type, recordOrList, extra)` returns the document a request would get. `extra` adds top-level keys such as `{ meta }` or `{ links }`.
- `sideload(record, ...others)` attaches more records to a record's documents.
- `mergePayloads(...payloads)` concatenates arrays under the same key.
- `factoryOf(record)` returns the factory name of a built record.

## Component and unit tests: `seed`

`seed`, `seedList` and `seedRecord` push factory JSON through your serializers with `store.pushPayload` and return the models.

```js
import { seed, setupRenderingTest } from '@visiblevc/ember-api-mocks';

test('shows the plan', async function (assert) {
  this.company = seed('company', 'withSubscription', { name: 'Acme' });

  await render(hbs`<CompanyCard @company={{this.company}} />`);

  assert.dom('[data-test-name]').hasText('Acme');
});
```

- `seed` throws on an override key the model's serializer would not read, such as `company` where the API sends `company_id`.
- `seedRecord(build(...))` seeds a record built earlier. `seedList` takes `buildList`'s arguments.
- Factories can define `beforeSeed(record, store)` and `afterSeed(model, transient)` hooks. They run for `seed` only.
- In TypeScript, pass the type: `seed<Company>('company')`, `build<CompanyJson>('company')`.
- For a new, unsaved record, use `store.createRecord`.

With ember-data-model-fragments, import the subpath once in `tests/test-helper.js` so fragment factories seed fragments:

```js
import '@visiblevc/ember-api-mocks/model-fragments';
```

## Acceptance tests: `build` and `api`

Acceptance tests build JSON, mock the requests the page makes, and let the app load it.

### Type shortcuts

| Call | Request | Default response |
| --- | --- | --- |
| `api.query('contact', records, extra)` | `GET /contacts` | the list, its sideloads and `extra` |
| `api.find(record, extra)` | `GET /contacts/1` | the record and its sideloads |
| `api.find('contact', id?, extra)` | `GET /contacts/:id` | `{ contact: { id } }` |
| `api.create('contact', attrs)` | `POST /contacts` | `attrs` with the id from the body or the next factory id |
| `api.update(record, attrs)` or `api.update('contact', id?, attrs)` | `PUT` or `PATCH /contacts/:id` | `{ id, ...attrs }` |
| `api.destroy(record)` or `api.destroy('contact', id?)` | `DELETE /contacts/:id` | 204 |

URLs come from the factory's `url`, or `namespace` plus the format's path. `find`, `update` and `destroy` accept a record from `build` or `seed`; without an id they answer any id. Payloads are put together when the request arrives, so later changes to a built record are served. Every shortcut also takes a function of the call in place of the default response.

### Explicit paths

```js
api.get('/users/me', { user: build('user') });
api.post('/files/sign', reply(201, { url: 'https://example.com/upload' }));
api.put('/reports/:id', ({ params, body }) => ({
  report: { id: params.id, ...body.report },
}));
api.patch('/settings', null);
api.delete('https://auth.example.com/sessions', null);
```

Paths that start with `/` are joined to `apiHost`, without `namespace`; absolute URLs are used as is. Any other path throws. A response is an object, a function of the call (sync or async), a `Response` (`reply(status, body)`, `reply(status)` for an empty body, or MSW's `HttpResponse`, re-exported here), or `null` for a 204. A model from `seed` inside a plain response is served as its source JSON.

### Handles

Every call returns a handle:

```js
const create = api
  .create('contact', { name: 'Ada' })
  .match({ contact: { name: 'Ada', tag_ids: ['1', '2'] } })
  .withHeaders({ Authorization: (value) => value?.startsWith('Bearer ') });

await click('[data-test-save]');

assert.strictEqual(create.timesCalled, 1);
assert.deepEqual(create.lastCall.body.contact.tag_ids, ['1', '2']);
```

- `timesCalled`, `calls` and `lastCall`. A call has `method`, `url`, `params`, `query`, `body` (parsed JSON or form data) and `headers`.
- `.match(body)` answers only when the body contains these keys. Objects match as subsets, arrays in full, values compare as strings, a key must be sent (`null` and `''` too), and a function is called with the value.
- `.withQuery(params)` answers only the exact query: every param present, nothing extra, and `ids[]=1` is an array, not `1`. A repeated `ids=1&ids=2` is an array too. `.withQuery(params, { partial: true })` ignores other params.
- `.withHeaders(headers)` matches header names in any case. A value is a string, a predicate, or `null` for absent.
- `.returns(...)` changes the response. On a shortcut it takes the shortcut's arguments: `query.returns(list, { meta })`, `find.returns(record, extra)`, `create.returns(attrs)`.
- `.fails(status = 500, body = {})` answers with an error.
- `.remove()` takes the mock away.

The newest mock for a URL answers first. A mock whose guard does not fit is skipped and the next one is tried. `api.requests` lists every answered call and `api.lastRequest(method, path)` finds one.

### Unhandled requests

| Policy | Effect |
| --- | --- |
| `'error'` | 404, and the test fails with `No handler for GET https://...` plus what any near-miss guard expected and received |
| `'warn'` | 404 and a console warning |
| `'not-found'` | 404 |
| `'passthrough'` | the real request goes out |

`onUnhandledRequest.app` covers the page origin, `apiHost` and `origins` (default `'error'`); `.other` covers everything else (default `'not-found'`). Non-http URLs (`data:`, `blob:`) and `bypass` origins always go out untouched.

### Waiting for requests

Mocked requests register with a test waiter, so `await settled()`, `click`, `visit` and the other helpers wait for them, including a raw `fetch` from a service. A `fetch` stays pending until the app has read the response body with `json()`, `text()` or another reader, or for two macrotasks if it never reads one. Reading `response.body` as a stream is not tracked. After each test, `settleRequests` waits up to one second for requests still in flight and fails the test if any remain.

### Beacons

With `configure({ beacons: true })`, `navigator.sendBeacon` goes through `fetch` while mocking is on, so a mock answers it and `handle.lastCall.body` holds the parsed body. Set it in `tests/test-helper.js`; it takes effect when a test starts.

## Migrating

### From ember-data-factory-guy

| factory-guy | ember-api-mocks |
| --- | --- |
| `make('user', 'admin', { name })` | `seed('user', 'admin', { name })` |
| `makeList('user', 2)` | `seedList('user', 2)` |
| `build('user')`, `buildList('user', 2)` | `build`, `buildList` (plain wire JSON) |
| `mockFindRecord(user)` | `api.find(user)` |
| `mockFindAll('user')` | `api.query('user', records)` |
| `mockQuery('user', { page: 1 }).returns({ models })` | `api.query('user', records).withQuery({ page: 1 })` |
| `mockCreate('user').match(attrs).returns({ attrs })` | `api.create('user', attrs).match(wireBody)` |
| `mockUpdate(user).fails({ status: 422, response })` | `api.update(user).fails(422, body)` |
| `mockDelete(user)` | `api.destroy(user)` |
| `mock({ type: 'GET', url, responseText })` | `api.get(url, response)` |
| `.timesCalled` | `.timesCalled`, `.calls`, `.lastCall` |
| `setupFactoryGuy(this)` | `setupTest(hooks)` and the other setup functions |

`match` sees the request body as sent, in the API's keys, not model attributes.

### From Mirage

| Mirage | ember-api-mocks |
| --- | --- |
| `server.create('user', attrs)` | `build('user', attrs)` plus a mock that serves it |
| `server.createList('user', 3)` | `buildList('user', 3)` |
| `this.get('/users')` shorthand | `api.query('user', records)` |
| `this.get('/users/:id', (schema, request) => ...)` | `api.get('/users/:id', ({ params, query, body }) => ...)` |
| `schema.users.where(...)`, `.update(...)` | an array of built records kept in the test, read and changed by responders |
| `this.normalizedRequestAttrs()` | `call.body` |
| `new Response(422, {}, errors)` | `reply(422, errors)` |
| `server.pretender.handledRequests` | `api.requests`, `handle.calls` |
| factory `afterCreate` | a trait function, or `afterSeed` for `seed` |
| `this.passthrough()` | `onUnhandledRequest: { other: 'passthrough' }`, or `passthrough()` from a responder |

Where Mirage kept state in its ORM, keep built records in the test and let responders read and change them:

```js
const users = buildList('user', 2);
api.query('user', users);
const create = api.post('/users', ({ body }) => {
  const user = build('user', body.user);
  users.push(user);
  return payload('user', user);
});
api.destroy('user', ({ params }) => {
  users.splice(users.findIndex(({ id }) => String(id) === params.id), 1);
  return null;
});
```

## Things to know

- Only `fetch` and `XMLHttpRequest` are intercepted. `<img>`, CSS, `<script>`, iframes and WebSockets load for real.
- Code that captured `window.fetch` before the interceptors patched it bypasses the mocks. `@percy/sdk-utils` does this; its server is in `bypass` by default.
- Mock the request instead of stubbing `window.fetch` (for example with `sinon.stub(window, 'fetch')`). A stub replaces the mocking wrapper for that test; one restored after teardown leaves a stale wrapper behind, which passes requests straight to the original `fetch` and is unwrapped when the next test starts.
- `namespace` applies only to type shortcuts. Explicit paths include it themselves.
- Query values arrive as strings, and an exact `withQuery` must list empty params too (`?tag=` is `{ tag: '' }`).
- Built ids are numbers (JSON:API documents stringify them) and request bodies carry strings. Compare with `String(record.id)`.
- A record in a response must come from `build` or `seed`. A record from `store.createRecord` throws; respond with JSON.
- Mocked responses arrive in real time, also under fake timers.
- Requests sent together (`Promise.all`) are matched after their bodies are parsed, so their handlers can run in either order. Assert on each handle's `calls`, not on the order of `api.requests`.
- A `sequence` advances only when the default value is used. For names that follow the id, as in Mirage's `(i) => ...`, use a function of the record: `` name: ({ id }) => `User ${id}` ``.
- `api.query` answers the same payload whatever the query. For paging or search, use `api.get` with a function that returns `payload(type, records.slice(...), { meta })`.
- JSON:API responses leave out linkage to records outside the document unless `linkage: 'always'`. `seed` always writes linkage.
- Pluralization comes from `@ember-data/request-utils` on ember-data 5.3 and later, then `ember-inflector`, then built-in rules. Register custom rules where your serializers read them, or pass `configure({ pluralize, singularize })`.
- `seed` uses `store.pushPayload`, which ember-data 5 deprecates.
- Interception uses `defineNetwork` from `msw/experimental`, so `msw` is pinned to an exact version and updated deliberately.

### Custom formats

A format is an object with `name`, `updateMethod`, `keyError(key)`, `relationshipKey(key, kind)`, `path(type)`, `document(type, data, extra, context)` and `idFromBody(type, body)`. Start from one of the built-ins.

## Contributing

See `CONTRIBUTING.md` in the repository.

## License

MIT
