# GitHub Actions CI/CD + npm Semantic Release

## Overview

Add GitHub Actions workflows for continuous integration and automated npm publishing. CI checks run on all pushes and PRs. When commits land on `main`, semantic-release analyzes conventional commits to determine version bumps and publishes to npm automatically.

## CI Checks Workflow

**File:** `.github/workflows/ci.yml`

**Triggers:** All pushes, all pull requests.

**Environment:** Node.js 22

**Steps:**

1. Checkout code
2. Set up Node.js 22
3. `npm ci`
4. `npm run format:check`
5. `npm run lint`
6. `npm run build`
7. `npm test`

This mirrors the existing Husky pre-commit hook (format:check, lint, tsc) plus tests.

## Release Workflow

**File:** `.github/workflows/release.yml`

**Triggers:** Push to `main` only.

**Environment:** Node.js 22

**Steps:**

1. Checkout code with full git history (`fetch-depth: 0` — required by semantic-release to read commit history)
2. Set up Node.js 22
3. `npm ci`
4. `npm run build`
5. Run semantic-release

**Secrets required:**

- `NPM_TOKEN` — npm access token, stored as a GitHub Actions secret
- `GITHUB_TOKEN` — provided automatically by GitHub Actions

### How semantic-release works

On each push to `main`, semantic-release:

1. Analyzes commits since the last release
2. Determines the version bump based on conventional commit prefixes:
   - `fix:` → patch (1.0.0 → 1.0.1)
   - `feat:` → minor (1.0.0 → 1.1.0)
   - `feat!:` or `BREAKING CHANGE` → major (1.0.0 → 2.0.0)
3. Updates `package.json` version
4. Publishes to npm
5. Creates a GitHub release with auto-generated changelog
6. Creates a git tag (`v1.2.3`)
7. If no releasable commits (e.g., `docs:`, `chore:`), does nothing

### Plugin chain

The default semantic-release plugins (all bundled with the core package):

1. `@semantic-release/commit-analyzer` — reads conventional commits
2. `@semantic-release/release-notes-generator` — generates changelog
3. `@semantic-release/npm` — publishes to npm
4. `@semantic-release/github` — creates GitHub release with changelog

## Package Configuration Changes

### `package.json` modifications

**Add `files` field** — controls what gets included in the npm tarball:

```json
"files": ["dist", "README.md"]
```

This keeps the package small. Source files, tests, docs/plans, config files are all excluded.

**Add `publishConfig`** — required for unscoped packages on first publish:

```json
"publishConfig": { "access": "public" }
```

**Add `release` config** — explicitly lists the plugin chain:

```json
"release": {
  "branches": ["main"],
  "plugins": [
    "@semantic-release/commit-analyzer",
    "@semantic-release/release-notes-generator",
    "@semantic-release/npm",
    "@semantic-release/github"
  ]
}
```

### New dev dependency

- `semantic-release`

## Manual Setup Required

1. Verify `tic` is available on npm: `npm info tic`
2. Create an npm access token (granular or automation token)
3. Add the token as `NPM_TOKEN` in GitHub repo → Settings → Secrets and variables → Actions

## What Doesn't Change

- Existing Husky pre-commit hook stays as-is
- Conventional commit workflow stays the same — it now drives versioning
- The `version` field in `package.json` becomes managed by semantic-release
