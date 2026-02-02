# ADO Backend E2E Tests Design

## Overview

Add end-to-end tests for the Azure DevOps backend that run against a real ADO organization. The tests create an isolated private project, exercise all CLI commands through the backend, and tear down the project afterward. Tests are manual-only — excluded from `npm test` and run via a dedicated `npm run test:e2e` script.

## Prerequisites

- `az` CLI installed and authenticated (`az login`)
- A default ADO organization configured (`az devops configure --defaults organization=https://dev.azure.com/<org>`)
- The authenticated user has permission to create/delete projects in the org

## File Structure

```
src/backends/ado/ado.e2e.test.ts   # E2E test suite
vitest.e2e.config.ts               # Vitest config for E2E tests
```

## Test Infrastructure

### Vitest E2E Config (`vitest.e2e.config.ts`)

Separate vitest config that:
- Includes only `**/*.e2e.test.ts` files
- Sets 5-minute test timeout
- Uses sequential test execution (no parallelism)

### npm Scripts

Add to `package.json`:
```json
"test:e2e": "vitest run --config vitest.e2e.config.ts"
```

Modify existing test script to also exclude E2E files:
```json
"test": "vitest run --exclude 'dist/**' --exclude '.worktrees/**' --exclude '**/*.e2e.test.ts'"
```

## Project Lifecycle

### Setup (`beforeAll`)

1. Parse default org from `az devops configure --list` (look for `organization` key)
2. If no org configured, skip the entire suite with a descriptive message
3. Generate random project name: `tic-e2e-<8 random hex chars>`
4. Create project: `az devops project create --name <name> --org <org> --visibility private`
5. Poll `az devops project show --project <name> --org <org>` until state is `wellFormed` (ADO project creation is async)
6. Create a temp directory with `fs.mkdtempSync()`
7. Initialize a git repo in the temp dir and add an ADO remote pointing at the new project: `git remote add origin https://dev.azure.com/<org>/<project>/_git/<project>`
8. Construct `AzureDevOpsBackend` with the temp dir as `cwd`

### Teardown (`afterAll`)

1. Delete the project: `az devops project delete --id <projectId> --org <org> --yes`
2. Remove the temp directory: `fs.rmSync(tmpDir, { recursive: true })`

Teardown runs even if tests fail. The `tic-e2e-` prefix makes orphaned projects identifiable for manual cleanup.

## Test Suite Structure

Sequential `describe`/`it` blocks sharing state via module-scoped variables:

```typescript
let backend: AzureDevOpsBackend;
let org: string;
let projectName: string;
let projectId: string;
let tmpDir: string;

// Item IDs populated by earlier tests, used by later ones
let createdItemId: string;
let parentItemId: string;
let childItemId: string;
let depSourceId: string;
let depTargetId: string;
```

### Test Blocks

```
describe('ADO E2E')
  beforeAll → create project, init backend
  afterAll  → delete project, cleanup

  describe('backend info')
    it('reports correct capabilities')
    it('returns available statuses')
    it('returns available work item types')
    it('returns assignees')

  describe('item CRUD')
    it('creates a work item with defaults')
    it('lists work items')
    it('shows a work item by ID')
    it('updates title, status, priority, assignee, labels')
    it('deletes a work item')

  describe('relationships')
    it('creates parent and child items')
    it('sets parent on child via update')
    it('retrieves children of parent')
    it('creates dependency between items')
    it('retrieves dependents')
    it('removes parent relationship')
    it('removes dependency relationship')

  describe('comments')
    it('adds a comment to a work item')
    it('shows work item with comments included')

  describe('iterations')
    it('lists available iterations')
    it('gets current iteration')
```

## How Tests Invoke Commands

Tests call the CLI command runner functions directly (same pattern as existing CLI tests):

```typescript
import {
  runItemCreate, runItemList, runItemShow,
  runItemUpdate, runItemDelete, runItemComment,
} from '../../cli/commands/item.js';
import { runIterationList } from '../../cli/commands/iteration.js';
```

This tests the real CLI code path (including field defaults, option parsing, and backend method calls) against a real ADO project. No mocking.

## Helper Utilities

**`getDefaultOrg()`**: Parses `az devops configure --list` output to extract the default organization URL. Returns `undefined` if not configured.

**`waitForProject(org, name, timeoutMs)`**: Polls `az devops project show` every 2 seconds until the project state is `wellFormed` or the timeout is reached.

**`randomProjectName()`**: Returns `tic-e2e-<crypto.randomBytes(4).toString('hex')>`.

## Error Handling

- If `az` is not authenticated or no default org is set, the suite skips with `describe.skip` and a console warning
- If project creation fails, `beforeAll` throws and all tests are skipped; `afterAll` still attempts cleanup
- Individual test failures don't affect subsequent tests (they use shared state but each test is resilient to partial state)

## Implementation Tasks

1. Create `vitest.e2e.config.ts`
2. Update `package.json` scripts (add `test:e2e`, update `test` exclusion)
3. Write `src/backends/ado/ado.e2e.test.ts` with all test blocks
