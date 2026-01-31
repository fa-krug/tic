# GitHub Actions CI/CD + npm Semantic Release Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add GitHub Actions for CI checks on all pushes/PRs and automated npm publishing via semantic-release on pushes to main.

**Architecture:** Two workflow files — `ci.yml` for checks everywhere, `release.yml` for npm publishing on main. semantic-release reads conventional commits to determine version bumps. Package config updated with `files`, `publishConfig`, and `release` fields.

**Tech Stack:** GitHub Actions, Node.js 22, semantic-release, npm

**Design doc:** `docs/plans/2026-01-31-github-actions-ci-release-design.md`

---

### Task 1: Create CI Checks Workflow

**Files:**
- Create: `.github/workflows/ci.yml`

**Step 1: Create the workflow directory**

```bash
mkdir -p .github/workflows
```

**Step 2: Create `.github/workflows/ci.yml`**

```yaml
name: CI

on:
  push:
  pull_request:

jobs:
  check:
    name: Check
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Check formatting
        run: npm run format:check

      - name: Lint
        run: npm run lint

      - name: Build
        run: npm run build

      - name: Test
        run: npm test
```

**Step 3: Verify the YAML is valid**

Run: `npx yaml-lint .github/workflows/ci.yml` or visually inspect — the file should have no syntax errors.

**Step 4: Commit**

```bash
git add .github/workflows/ci.yml
git commit -m "ci: add CI checks workflow for all pushes and PRs"
```

---

### Task 2: Create Release Workflow

**Files:**
- Create: `.github/workflows/release.yml`

**Step 1: Create `.github/workflows/release.yml`**

```yaml
name: Release

on:
  push:
    branches:
      - main

jobs:
  release:
    name: Release
    runs-on: ubuntu-latest
    permissions:
      contents: write
      issues: write
      pull-requests: write
      id-token: write
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      - run: npm ci

      - name: Build
        run: npm run build

      - name: Release
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          NPM_TOKEN: ${{ secrets.NPM_TOKEN }}
        run: npx semantic-release
```

Key details:
- `fetch-depth: 0` gives semantic-release full git history to analyze commits.
- `permissions` block grants write access for creating GitHub releases and git tags.
- `GITHUB_TOKEN` is auto-provided by Actions. `NPM_TOKEN` must be set as a repo secret.

**Step 2: Commit**

```bash
git add .github/workflows/release.yml
git commit -m "ci: add release workflow with semantic-release on main"
```

---

### Task 3: Install semantic-release

**Files:**
- Modify: `package.json` (devDependencies)

**Step 1: Install semantic-release as a dev dependency**

Run: `npm install --save-dev semantic-release`

Expected: `package.json` devDependencies gains `"semantic-release": "^24.x.x"` (or latest). `package-lock.json` is updated.

**Step 2: Verify installation**

Run: `npx semantic-release --version`
Expected: Prints the installed version number.

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add semantic-release dev dependency"
```

---

### Task 4: Update package.json with publish and release config

**Files:**
- Modify: `package.json:1-45` (add `files`, `publishConfig`, `release` fields)

**Step 1: Add `files` field to `package.json`**

Add after the `"bin"` field:

```json
"files": [
  "dist",
  "README.md"
],
```

This limits the npm tarball to compiled output and the README.

**Step 2: Add `publishConfig` field to `package.json`**

Add after `"license"`:

```json
"publishConfig": {
  "access": "public"
},
```

**Step 3: Add `release` config to `package.json`**

Add at the end of the top-level object (before the closing `}`):

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

**Step 4: Verify package.json is valid JSON**

Run: `node -e "require('./package.json')"`
Expected: No error output.

Note: This will fail because the project uses ESM (`"type": "module"`). Instead run:
Run: `node -e "import('file:///$(pwd)/package.json', { with: { type: 'json' } }).then(m => console.log(m.default.name))"` or simply `cat package.json | npx json5`
Or just validate with: `node -e "JSON.parse(require('fs').readFileSync('package.json', 'utf8'))"`

Expected: No error.

**Step 5: Verify npm pack shows only intended files**

Run: `npm pack --dry-run`
Expected output should list only files from `dist/`, `README.md`, `package.json`, and `LICENSE` (if present). No `src/`, `docs/`, or test files.

**Step 6: Commit**

```bash
git add package.json
git commit -m "chore: add files, publishConfig, and release config to package.json"
```

---

### Task 5: Verify everything works locally

**Step 1: Run the full check suite locally**

Run each command and verify it passes:

```bash
npm run format:check
npm run lint
npm run build
npm test
```

Expected: All four commands pass without errors.

**Step 2: Dry-run semantic-release**

Run: `npx semantic-release --dry-run`

Expected: It will likely warn about missing `NPM_TOKEN` or `GITHUB_TOKEN` — that's fine. The point is to verify the config is parsed correctly and no plugin errors occur. Look for output mentioning the plugin chain loading successfully.

**Step 3: Commit any fixes if needed**

If anything needed fixing, commit with an appropriate message.

---

## Post-Implementation: Manual Setup

These steps must be done by the repository owner (not automatable in code):

1. **Check npm name availability:** Run `npm info tic` — if the package exists, choose a scoped name
2. **Create npm access token:** Go to npmjs.com → Access Tokens → Generate New Token (Automation type)
3. **Add GitHub secret:** Go to the GitHub repo → Settings → Secrets and variables → Actions → New repository secret → Name: `NPM_TOKEN`, Value: the npm token
4. **Push to main:** The release workflow will run on the next push to main with a `feat:` or `fix:` commit
