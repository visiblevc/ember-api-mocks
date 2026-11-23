# How To Contribute

## Installation

- `git clone <repository-url>`
- `cd ember-api-mocks`
- `pnpm install`

## Linting

- `pnpm lint`
- `pnpm lint:fix`

## Building the addon

- `pnpm build`

## Running tests

- `pnpm test` – Runs the test suite on the current Ember version

## Running a try scenario

- `pnpm dlx @embroider/try list` – Lists the scenarios in `.try.mjs`
- `pnpm dlx @embroider/try apply <name>` – Rewrites `package.json` for a scenario (do this in a throwaway clone)
- `pnpm install --no-lockfile && pnpm test` – Runs the suite against it; scenarios with `ENABLE_COMPAT_BUILD` need that variable set

## Versioning

Until 1.0, a breaking change bumps the minor version instead of the major one:

- breaking: 0.1.3 to 0.2.0
- enhancement: 0.1.3 to 0.2.0
- bug fix: 0.1.3 to 0.1.4

`release-plan.semverIncrementAs` in `package.json` maps a breaking change to a minor bump. From 1.0 on, normal semver applies and that setting goes away.

Label breaking pull requests `breaking` so release-plan picks the right version. See [RELEASE.md](RELEASE.md) for the release process.
