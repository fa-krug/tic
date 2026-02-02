# ADO E2E Tests Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add end-to-end tests for the ADO backend that create an isolated ADO project, run all CLI commands against it, and tear it down.

**Architecture:** Separate vitest config for E2E tests (`.e2e.test.ts` suffix), excluded from default `npm test`. Tests use the real CLI command runner functions against a real ADO project created in `beforeAll` and deleted in `afterAll`.

**Tech Stack:** Vitest 4, Azure CLI (`az`), TypeScript ESM

---

### Task 1: Create Vitest E2E Config

**Files:**
- Create: `vitest.e2e.config.ts`

**Step 1: Write the config file**

```typescript
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['**/*.e2e.test.ts'],
    testTimeout: 300_000,
    hookTimeout: 120_000,
    pool: 'forks',
    poolOptions: {
      forks: {
        singleFork: true,
      },
    },
    sequence: {
      concurrent: false,
    },
  },
});
```

Key settings:
- `testTimeout: 300_000` — 5 minutes for the full suite
- `hookTimeout: 120_000` — 2 minutes for project creation/deletion in beforeAll/afterAll
- `singleFork: true` + `concurrent: false` — sequential execution, tests share state

**Step 2: Verify config is valid**

Run: `npx vitest run --config vitest.e2e.config.ts --dry`
Expected: No syntax errors (will report 0 tests since the test file doesn't exist yet)

**Step 3: Commit**

```bash
git add vitest.e2e.config.ts
git commit -m "chore: add vitest E2E config for manual integration tests"
```

---

### Task 2: Update package.json Scripts

**Files:**
- Modify: `package.json:17` (scripts section)

**Step 1: Add test:e2e script and update test exclusion**

In `package.json`, update the `scripts` section:

```json
"test": "vitest run --exclude 'dist/**' --exclude '.worktrees/**' --exclude '**/*.e2e.test.ts'",
"test:e2e": "vitest run --config vitest.e2e.config.ts",
```

The `test` script gets the additional `--exclude '**/*.e2e.test.ts'` to ensure `npm test` never runs E2E tests.

**Step 2: Verify default tests still work**

Run: `npm test`
Expected: All existing tests pass, no E2E tests included

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: add test:e2e script, exclude e2e from default test run"
```

---

### Task 3: Write E2E Test File — Setup/Teardown and Helpers

**Files:**
- Create: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Write the file with helpers, setup, teardown, and a single smoke test**

Start with just the infrastructure and one basic test to verify the setup works before writing all test cases.

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { AzureDevOpsBackend } from './index.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function getDefaultOrg(): string | undefined {
  try {
    const output = execFileSync('az', ['devops', 'configure', '--list'], {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    for (const line of output.split('\n')) {
      const match = line.match(/^organization\s*=\s*(.+)$/i);
      if (match && match[1]!.trim().length > 0) {
        return match[1]!.trim();
      }
    }
  } catch {
    // az not installed or not authenticated
  }
  return undefined;
}

function randomProjectName(): string {
  return `tic-e2e-${crypto.randomBytes(4).toString('hex')}`;
}

interface AdoProject {
  id: string;
  name: string;
  state: string;
}

function createProject(org: string, name: string): AdoProject {
  const result = execFileSync(
    'az',
    [
      'devops',
      'project',
      'create',
      '--name',
      name,
      '--org',
      org,
      '--visibility',
      'private',
      '-o',
      'json',
    ],
    {
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: 60_000,
    },
  );
  return JSON.parse(result) as AdoProject;
}

function waitForProject(org: string, name: string, timeoutMs: number): void {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const result = execFileSync(
        'az',
        [
          'devops',
          'project',
          'show',
          '--project',
          name,
          '--org',
          org,
          '-o',
          'json',
        ],
        {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
          timeout: 15_000,
        },
      );
      const project = JSON.parse(result) as AdoProject;
      if (project.state === 'wellFormed') return;
    } catch {
      // Project not ready yet
    }
    execFileSync('sleep', ['2']);
  }
  throw new Error(`Project ${name} did not become ready within ${timeoutMs}ms`);
}

function deleteProject(org: string, projectId: string): void {
  try {
    execFileSync(
      'az',
      [
        'devops',
        'project',
        'delete',
        '--id',
        projectId,
        '--org',
        org,
        '--yes',
      ],
      {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30_000,
      },
    );
  } catch (err) {
    console.error(`Failed to delete project ${projectId}:`, err);
  }
}

// ---------------------------------------------------------------------------
// Determine whether we can run
// ---------------------------------------------------------------------------

const org = getDefaultOrg();
const canRun = org !== undefined;

if (!canRun) {
  console.warn(
    'Skipping ADO E2E tests: no default organization configured.\n' +
      'Run: az devops configure --defaults organization=https://dev.azure.com/<org>',
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

const describeE2e = canRun ? describe : describe.skip;

describeE2e('ADO E2E', () => {
  let projectName: string;
  let projectId: string;
  let tmpDir: string;
  let backend: AzureDevOpsBackend;

  beforeAll(() => {
    // Create isolated project
    projectName = randomProjectName();
    console.log(`Creating ADO project: ${projectName} in ${org}`);
    const project = createProject(org!, projectName);
    projectId = project.id;

    // Wait for project to be ready
    waitForProject(org!, projectName, 90_000);
    console.log(`Project ${projectName} is ready (id: ${projectId})`);

    // Set up temp git repo with ADO remote
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-e2e-'));
    execFileSync('git', ['init'], { cwd: tmpDir, stdio: 'pipe' });

    // Parse org name from URL (e.g. https://dev.azure.com/myorg -> myorg)
    const orgName = org!.replace(/\/$/, '').split('/').pop()!;
    const remoteUrl = `https://dev.azure.com/${orgName}/${encodeURIComponent(projectName)}/_git/${encodeURIComponent(projectName)}`;
    execFileSync('git', ['remote', 'add', 'origin', remoteUrl], {
      cwd: tmpDir,
      stdio: 'pipe',
    });

    // Construct backend
    backend = new AzureDevOpsBackend(tmpDir);
  });

  afterAll(() => {
    // Always try to clean up
    if (projectId) {
      console.log(`Deleting ADO project: ${projectName} (${projectId})`);
      deleteProject(org!, projectId);
    }
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it('backend is initialized', () => {
    expect(backend).toBeDefined();
    expect(backend.getCapabilities().relationships).toBe(true);
  });
});
```

**Step 2: Verify file compiles**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 3: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test: add ADO E2E test scaffold with project setup/teardown"
```

---

### Task 4: Add Backend Info Tests

**Files:**
- Modify: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Add the backend info describe block**

Insert after the `it('backend is initialized')` test, inside the main `describeE2e` block:

```typescript
  describe('backend info', () => {
    it('reports correct capabilities', () => {
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(true);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(true);
    });

    it('returns available statuses', async () => {
      const statuses = await backend.getStatuses();
      expect(statuses.length).toBeGreaterThan(0);
      // Agile process template always has "New"
      expect(statuses).toContain('New');
    });

    it('returns available work item types', async () => {
      const types = await backend.getWorkItemTypes();
      expect(types.length).toBeGreaterThan(0);
      // Agile process template always has these
      expect(types).toContain('Task');
      expect(types).toContain('Bug');
    });

    it('returns assignees', async () => {
      const assignees = await backend.getAssignees();
      // At minimum, the authenticated user should be a team member
      expect(assignees.length).toBeGreaterThan(0);
    });
  });
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test(e2e): add backend info tests for capabilities, statuses, types"
```

---

### Task 5: Add Item CRUD Tests

**Files:**
- Modify: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Add imports for CLI command runners**

Add at the top of the file with the other imports:

```typescript
import {
  runItemCreate,
  runItemList,
  runItemShow,
  runItemUpdate,
  runItemDelete,
  runItemComment,
} from '../../cli/commands/item.js';
import { runIterationList } from '../../cli/commands/iteration.js';
```

**Step 2: Add shared state variables**

Add these inside the `describeE2e` block, alongside the existing `let` declarations:

```typescript
  let createdItemId: string;
  let parentItemId: string;
  let childItemId: string;
  let depSourceId: string;
  let depTargetId: string;
```

**Step 3: Add the item CRUD describe block**

Insert after the `backend info` describe block:

```typescript
  describe('item CRUD', () => {
    it('creates a work item with defaults', async () => {
      const item = await runItemCreate(backend, 'E2E Test Item', {});
      expect(item.title).toBe('E2E Test Item');
      expect(item.id).toBeTruthy();
      expect(item.status).toBeTruthy();
      expect(item.type).toBeTruthy();
      createdItemId = item.id;
    });

    it('lists work items', async () => {
      const items = await runItemList(backend, { all: true });
      expect(items.length).toBeGreaterThanOrEqual(1);
      const found = items.find((i) => i.id === createdItemId);
      expect(found).toBeDefined();
      expect(found!.title).toBe('E2E Test Item');
    });

    it('shows a work item by ID', async () => {
      const item = await runItemShow(backend, createdItemId);
      expect(item.id).toBe(createdItemId);
      expect(item.title).toBe('E2E Test Item');
    });

    it('updates title, status, priority, assignee, labels', async () => {
      const statuses = await backend.getStatuses();
      // Pick a status different from the default if possible
      const newStatus =
        statuses.find((s) => s === 'Active') ?? statuses[1] ?? statuses[0]!;

      const updated = await runItemUpdate(backend, createdItemId, {
        title: 'Updated E2E Item',
        status: newStatus,
        priority: 'high',
        labels: 'e2e,test',
      });

      expect(updated.title).toBe('Updated E2E Item');
      expect(updated.status).toBe(newStatus);
      expect(updated.priority).toBe('high');
      expect(updated.labels).toContain('e2e');
      expect(updated.labels).toContain('test');
    });

    it('deletes a work item', async () => {
      await runItemDelete(backend, createdItemId);

      // Verify it's gone — listing should not include it
      const items = await runItemList(backend, { all: true });
      const found = items.find((i) => i.id === createdItemId);
      expect(found).toBeUndefined();
    });
  });
```

**Step 4: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test(e2e): add item CRUD tests (create, list, show, update, delete)"
```

---

### Task 6: Add Relationship Tests

**Files:**
- Modify: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Add the relationships describe block**

Insert after the `item CRUD` describe block:

```typescript
  describe('relationships', () => {
    it('creates parent and child items', async () => {
      const parent = await runItemCreate(backend, 'E2E Parent', {});
      parentItemId = parent.id;

      const child = await runItemCreate(backend, 'E2E Child', {
        parent: parentItemId,
      });
      childItemId = child.id;

      expect(child.parent).toBe(parentItemId);
    });

    it('retrieves children of parent', async () => {
      const children = await backend.getChildren(parentItemId);
      expect(children.length).toBe(1);
      expect(children[0]!.id).toBe(childItemId);
    });

    it('removes parent relationship', async () => {
      const updated = await runItemUpdate(backend, childItemId, {
        parent: '',
      });
      expect(updated.parent).toBeNull();

      const children = await backend.getChildren(parentItemId);
      expect(children.length).toBe(0);
    });

    it('sets parent on child via update', async () => {
      const updated = await runItemUpdate(backend, childItemId, {
        parent: parentItemId,
      });
      expect(updated.parent).toBe(parentItemId);
    });

    it('creates dependency between items', async () => {
      const source = await runItemCreate(backend, 'E2E Dep Source', {});
      depSourceId = source.id;

      const target = await runItemCreate(backend, 'E2E Dep Target', {});
      depTargetId = target.id;

      // source depends on target
      const updated = await runItemUpdate(backend, depSourceId, {
        dependsOn: depTargetId,
      });
      expect(updated.dependsOn).toContain(depTargetId);
    });

    it('retrieves dependents', async () => {
      // target should have source as a dependent
      const dependents = await backend.getDependents(depTargetId);
      expect(dependents.length).toBe(1);
      expect(dependents[0]!.id).toBe(depSourceId);
    });

    it('removes dependency relationship', async () => {
      const updated = await runItemUpdate(backend, depSourceId, {
        dependsOn: '',
      });
      expect(updated.dependsOn).toEqual([]);

      const dependents = await backend.getDependents(depTargetId);
      expect(dependents.length).toBe(0);
    });
  });
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test(e2e): add relationship tests (parent/child, dependencies)"
```

---

### Task 7: Add Comment Tests

**Files:**
- Modify: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Add the comments describe block**

Insert after the `relationships` describe block. Reuses `parentItemId` which still exists from relationships tests:

```typescript
  describe('comments', () => {
    it('adds a comment to a work item', async () => {
      const comment = await runItemComment(
        backend,
        parentItemId,
        'This is an E2E test comment',
        {},
      );
      expect(comment.body).toBe('This is an E2E test comment');
    });

    it('shows work item with comments included', async () => {
      const item = await runItemShow(backend, parentItemId);
      expect(item.comments.length).toBeGreaterThanOrEqual(1);
      const found = item.comments.find((c) =>
        c.body.includes('E2E test comment'),
      );
      expect(found).toBeDefined();
    });
  });
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test(e2e): add comment tests (add, show with comments)"
```

---

### Task 8: Add Iteration Tests

**Files:**
- Modify: `src/backends/ado/ado.e2e.test.ts`

**Step 1: Add the iterations describe block**

Insert after the `comments` describe block:

```typescript
  describe('iterations', () => {
    it('lists available iterations', async () => {
      const result = await runIterationList(backend);
      // New ADO projects have at least one default iteration
      expect(result.iterations.length).toBeGreaterThanOrEqual(1);
    });

    it('gets current iteration', async () => {
      const result = await runIterationList(backend);
      // current may be empty string if no iteration has current date range
      expect(typeof result.current).toBe('string');
    });
  });
```

**Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Commit**

```bash
git add src/backends/ado/ado.e2e.test.ts
git commit -m "test(e2e): add iteration tests (list, get current)"
```

---

### Task 9: Final Verification

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run default tests to confirm E2E is excluded**

Run: `npm test`
Expected: All tests pass, no E2E tests in output

**Step 3: Run lint**

Run: `npm run lint`
Expected: No lint errors (fix any if found)

**Step 4: Commit any lint fixes**

```bash
git add -A
git commit -m "chore: fix lint issues in E2E tests"
```
