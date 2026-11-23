# Release Process

Releases in this repo are mostly automated using [release-plan](https://github.com/embroider-build/release-plan/). Once you label all your PRs correctly (see below) you will have an automatically generated PR that updates your CHANGELOG.md file and a `.release-plan.json` that is used to prepare the release once the PR is merged.

## Preparation

Since the majority of the actual release process is automated, the remaining tasks before releasing are:

- correctly labeling **all** pull requests that have been merged since the last release
- updating pull request titles so they make sense to our users

Some great information on why this is important can be found at [keepachangelog.com](https://keepachangelog.com/en/1.1.0/), but the overall
guiding principle here is that changelogs are for humans, not machines.

When reviewing merged PR's the labels to be used are:

- breaking - Used when the PR is considered a breaking change.
- enhancement - Used when the PR adds a new feature or enhancement.
- bug - Used when the PR fixes a bug included in a previous release.
- documentation - Used when the PR adds or updates documentation.
- internal - Internal changes or things that don't fit in any other category.

**Note:** `release-plan` requires that **all** PRs are labeled. If a PR doesn't fit in a category it's fine to label it as `internal`

## Release

Once the prep work is completed, the actual release is straight forward: you just need to merge the open [Plan Release](https://github.com/visiblevc/ember-api-mocks/pulls?q=is%3Apr+is%3Aopen+%22Prepare+Release%22+in%3Atitle) PR

## Publishing

`.github/workflows/publish.yml` publishes with [npm trusted publishing](https://docs.npmjs.com/trusted-publishers): GitHub Actions authenticates to npm with OIDC, so there is no `NPM_TOKEN` secret.

### The first release (0.1.0)

npm only lets you add a trusted publisher to a package that already exists, so the maintainer publishes 0.1.0 by hand:

1. Merge the Prepare Release PR so `package.json` says `0.1.0`, and make sure that commit is tagged `v0.1.0`. The Publish Stable workflow cannot publish yet; a failure at its npm step is expected.
2. Log in to npm (`npm login`) as a user who can publish to the `@visiblevc` scope.
3. Publish from a clean checkout of the tag, so no stale `dist` or `declarations` files are packed:

   ```sh
   git clone git@github.com:visiblevc/ember-api-mocks.git
   cd ember-api-mocks
   git checkout v0.1.0
   pnpm install --frozen-lockfile
   pnpm publish --no-git-checks
   ```

   `prepack` builds `dist` and `declarations`; `publishConfig.access` is `public`. `--no-git-checks` is needed because a tag checkout is not on `main`.
4. On npmjs.com, add a trusted publisher for `@visiblevc/ember-api-mocks`: this repository and the `publish.yml` workflow. Later releases publish from CI.

### Provenance

A hand-published version has no provenance attestation. CI can attest provenance only for a public repository: once the repository is public, set `NPM_CONFIG_PROVENANCE: true` on the publish step.

See [CONTRIBUTING.md](CONTRIBUTING.md#versioning) for how versions are chosen before 1.0.

