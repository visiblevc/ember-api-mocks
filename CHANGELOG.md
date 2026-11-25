# Changelog

## Release (2026-11-25)

* @visiblevc/ember-api-mocks 0.4.1 (patch)

#### :bug: Bug Fix
* `@visiblevc/ember-api-mocks`
  * [#11](https://github.com/visiblevc/ember-api-mocks/pull/11) Read request bodies in Firefox ([@grayt0r](https://github.com/grayt0r))

#### :house: Internal
* `@visiblevc/ember-api-mocks`
  * [#9](https://github.com/visiblevc/ember-api-mocks/pull/9) Attest npm provenance on release ([@whatthewhat](https://github.com/whatthewhat))

#### Committers: 2
- Mikhail Topolskiy ([@whatthewhat](https://github.com/whatthewhat))
- Ross Grayton ([@grayt0r](https://github.com/grayt0r))

## Release (2026-11-24)

* @visiblevc/ember-api-mocks 0.4.0 (minor)

#### :rocket: Enhancement
* `@visiblevc/ember-api-mocks`
  * [#7](https://github.com/visiblevc/ember-api-mocks/pull/7) Add an id option and withBody, count default associations as declared, mock through teardown ([@whatthewhat](https://github.com/whatthewhat))

#### Committers: 1
- Mikhail Topolskiy ([@whatthewhat](https://github.com/whatthewhat))

## Release (2026-11-23)

* @visiblevc/ember-api-mocks 0.3.0 (minor)

#### :rocket: Enhancement
* `@visiblevc/ember-api-mocks`
  * [#5](https://github.com/visiblevc/ember-api-mocks/pull/5) Replace the setup wrappers with a `setupApiMocks` hook ([@whatthewhat](https://github.com/whatthewhat))

#### Committers: 1
- Mikhail Topolskiy ([@whatthewhat](https://github.com/whatthewhat))

## Release (2026-11-23)

* @visiblevc/ember-api-mocks 0.2.0 (major)

#### :boom: Breaking Change
* `@visiblevc/ember-api-mocks`
  * [#4](https://github.com/visiblevc/ember-api-mocks/pull/4) `api.query` takes a responder; stop exporting `sourceOf` and `HttpResponse` ([@whatthewhat](https://github.com/whatthewhat))

#### Committers: 1
- Mikhail Topolskiy ([@whatthewhat](https://github.com/whatthewhat))

## Release (2026-11-23)

* @visiblevc/ember-api-mocks 0.1.1 (patch)

#### :memo: Documentation
* `@visiblevc/ember-api-mocks`
  * [#2](https://github.com/visiblevc/ember-api-mocks/pull/2) Tidy the README ([@whatthewhat](https://github.com/whatthewhat))

#### Committers: 1
- Mikhail Topolskiy ([@whatthewhat](https://github.com/whatthewhat))

## Release (2026-11-23)

* @visiblevc/ember-api-mocks 0.1.0 (minor)

First release: in-page MSW request mocking for Ember tests, factories that build API JSON in ActiveModel, REST and JSON:API formats, request mocks with body, query and header guards, `seed` for pushing factory records into the ember-data store, and `setupTest` / `setupRenderingTest` / `setupApplicationTest` wrappers.
