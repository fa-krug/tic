# Startup Performance Optimization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Cut startup time for both TUI and CLI with 200+ items by reducing DB queries, deferring unnecessary data, and lazy-loading heavy modules.

**Architecture:** Three layers — (1) optimize Storage queries (skip comments, use DISTINCT, add indexes), (2) derive assignee/label lists from loaded items instead of separate queries, (3) dynamic-import Ink/React so CLI never pays for them.

**Tech Stack:** TypeScript, Drizzle ORM, better-sqlite3, Zustand, Ink/React

---

### Task 1: Add `includeComments` option to `assembleWorkItems()`

**Files:**
- Modify: `src/storage/index.ts:409-459` (assembleWorkItems)
- Modify: `src/storage/index.ts:300-321` (listWorkItems)
- Modify: `src/storage/index.ts:361-376` (getChildren)
- Modify: `src/storage/index.ts:379-403` (getDependents)
- Test: `src/storage/index.test.ts`

**Step 1: Write the failing test**

In `src/storage/index.test.ts`, add a test that verifies `listWorkItems()` returns items without comments:

```typescript
it('listWorkItems omits comments by default', async () => {
  const item = await backend.createWorkItem(makeNewItem());
  await backend.addComment(item.id, { body: 'hello', author: 'me' });
  const items = await backend.listWorkItems();
  expect(items[0].comments).toEqual([]);
});

it('getWorkItem includes comments', async () => {
  const item = await backend.createWorkItem(makeNewItem());
  await backend.addComment(item.id, { body: 'hello', author: 'me' });
  const fetched = await backend.getWorkItem(item.id);
  expect(fetched.comments).toHaveLength(1);
  expect(fetched.comments[0].body).toBe('hello');
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/index.test.ts -t "listWorkItems omits comments"`
Expected: FAIL — currently `listWorkItems` includes comments

**Step 3: Implement**

In `src/storage/index.ts`, add an `includeComments` parameter to `assembleWorkItems()`:

```typescript
private assembleWorkItems(
  itemRows: WorkItemRow[],
  options?: { includeComments?: boolean },
): WorkItem[] {
  const itemIds = itemRows.map((r) => r.id);

  const labelRows = this.db
    .select()
    .from(schema.workItemLabels)
    .where(inArray(schema.workItemLabels.workItemId, itemIds))
    .all();

  const depRows = this.db
    .select()
    .from(schema.workItemDeps)
    .where(inArray(schema.workItemDeps.workItemId, itemIds))
    .all();

  let commentRows: CommentRow[] = [];
  if (options?.includeComments) {
    commentRows = this.db
      .select()
      .from(schema.comments)
      .where(inArray(schema.comments.workItemId, itemIds))
      .all();
  }
  // ... rest unchanged
```

All callers (`listWorkItems`, `getChildren`, `getDependents`) pass no options (default = no comments). `getWorkItem()` already fetches comments individually so it's unaffected.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/index.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts src/storage/index.test.ts
git commit -m "perf: skip comment loading in assembleWorkItems by default"
```

---

### Task 2: Use `SELECT DISTINCT` for `getAssignees()` and `getLabels()`

**Files:**
- Modify: `src/storage/index.ts:238-269` (getAssignees, getLabels)
- Test: `src/storage/index.test.ts`

**Step 1: Write the failing test**

These are behavior-preserving refactors, so existing tests should still pass. Add a performance-oriented test to verify dedup works at DB level:

```typescript
it('getAssignees returns distinct sorted assignees', async () => {
  await backend.createWorkItem(makeNewItem({ assignee: 'bob' }));
  await backend.createWorkItem(makeNewItem({ assignee: 'alice' }));
  await backend.createWorkItem(makeNewItem({ assignee: 'bob' }));
  await backend.createWorkItem(makeNewItem({ assignee: '' }));
  const assignees = await backend.getAssignees();
  expect(assignees).toEqual(['alice', 'bob']);
});

it('getLabels returns distinct sorted labels', async () => {
  await backend.createWorkItem(makeNewItem({ labels: ['bug', 'ui'] }));
  await backend.createWorkItem(makeNewItem({ labels: ['bug', 'api'] }));
  const labels = await backend.getLabels();
  expect(labels).toEqual(['api', 'bug', 'ui']);
});
```

**Step 2: Run tests to verify they pass (baseline)**

Run: `npx vitest run src/storage/index.test.ts -t "getAssignees|getLabels"`

**Step 3: Implement**

Replace `getAssignees()` (line 238-250):

```typescript
async getAssignees(): Promise<string[]> {
  const rows = this.db
    .selectDistinct({ assignee: schema.workItems.assignee })
    .from(schema.workItems)
    .where(
      and(
        isNull(schema.workItems.deletedAt),
        isNotNull(schema.workItems.assignee),
      ),
    )
    .all();
  return rows
    .map((r) => r.assignee)
    .filter(Boolean)
    .sort();
}
```

Replace `getLabels()` (line 253-269):

```typescript
async getLabels(): Promise<string[]> {
  const rows = this.db
    .selectDistinct({ label: schema.workItemLabels.label })
    .from(schema.workItemLabels)
    .innerJoin(
      schema.workItems,
      eq(schema.workItemLabels.workItemId, schema.workItems.id),
    )
    .where(isNull(schema.workItems.deletedAt))
    .all();
  return rows.map((r) => r.label).sort();
}
```

**Step 4: Run tests**

Run: `npx vitest run src/storage/index.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts src/storage/index.test.ts
git commit -m "perf: use SELECT DISTINCT for getAssignees/getLabels"
```

---

### Task 3: Add compound indexes via Drizzle migration

**Files:**
- Modify: `src/storage/schema.ts:26-33` (workItems table indexes)
- Create: new migration file in `drizzle/`

**Step 1: Add compound indexes to schema**

In `src/storage/schema.ts`, update the workItems table indexes (line 26-33):

```typescript
(t) => [
  index('idx_status').on(t.status),
  index('idx_type').on(t.type),
  index('idx_assignee').on(t.assignee),
  index('idx_priority').on(t.priority),
  index('idx_iteration').on(t.iteration),
  index('idx_parent').on(t.parent),
  index('idx_deleted_iteration').on(t.deletedAt, t.iteration),
  index('idx_deleted_status').on(t.deletedAt, t.status),
  index('idx_deleted_assignee').on(t.deletedAt, t.assignee),
],
```

**Step 2: Generate migration**

Run: `npx drizzle-kit generate`

This creates a new SQL migration file in `drizzle/` with the CREATE INDEX statements.

**Step 3: Verify migration applies**

Run: `npx vitest run src/storage/db.test.ts`
Expected: PASS (migrations run in test DB setup)

**Step 4: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/storage/schema.ts drizzle/
git commit -m "perf: add compound indexes on (deleted_at, iteration/status/assignee)"
```

---

### Task 4: Derive assignees/labels from loaded items in backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts:218-247` (refresh)
- Modify: `src/stores/backendDataStore.ts:249-272` (reloadItem)
- Test: `src/stores/backendDataStore.test.ts`

**Step 1: Write the failing test**

```typescript
it('derives assignees and labels from loaded items', async () => {
  // Pre-create items with assignees and labels
  const storage = Storage.create(tmpDir);
  await storage.createWorkItem({
    title: 'A', type: 'task', status: 'todo', iteration: 'default',
    priority: '', assignee: 'alice', labels: ['bug'], description: '',
    parent: null, dependsOn: [],
  });
  await storage.createWorkItem({
    title: 'B', type: 'task', status: 'todo', iteration: 'default',
    priority: '', assignee: 'bob', labels: ['bug', 'ui'], description: '',
    parent: null, dependsOn: [],
  });
  storage.destroy();

  backendDataStore.getState().init(tmpDir);
  await waitForLoad();

  const state = backendDataStore.getState();
  expect(state.assignees).toEqual(['alice', 'bob']);
  expect(state.labels).toEqual(['bug', 'ui']);
});
```

**Step 2: Run test — should pass with current code (baseline)**

Run: `npx vitest run src/stores/backendDataStore.test.ts -t "derives assignees"`

**Step 3: Implement**

In `backendDataStore.ts`, modify `refresh()` to derive assignees/labels from items:

```typescript
async refresh() {
  if (!currentBackend) return;

  try {
    const iter = await currentBackend.getCurrentIteration();
    const [statuses, iterations, types, items] = await Promise.all([
      currentBackend.getStatuses(),
      currentBackend.getIterations(),
      currentBackend.getWorkItemTypes(),
      currentBackend.listWorkItems(iter),
    ]);

    // Derive assignees and labels from loaded items
    const assigneeSet = new Set<string>();
    const labelSet = new Set<string>();
    for (const item of items) {
      if (item.assignee) assigneeSet.add(item.assignee);
      for (const label of item.labels) labelSet.add(label);
    }

    set({
      capabilities: currentBackend.getCapabilities(),
      statuses,
      iterations,
      types,
      assignees: [...assigneeSet].sort(),
      labels: [...labelSet].sort(),
      currentIteration: iter,
      items,
      error: null,
    });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
},
```

Also update `reloadItem()` to derive from the full items list instead of separate queries:

```typescript
async reloadItem(id: string) {
  if (!currentBackend) return;
  try {
    const item = await currentBackend.getWorkItem(id);
    set((state) => {
      const idx = state.items.findIndex((i) => i.id === id);
      const items = [...state.items];
      if (idx >= 0) {
        items[idx] = item;
      } else {
        items.push(item);
      }

      // Re-derive assignees and labels from updated items list
      const assigneeSet = new Set<string>();
      const labelSet = new Set<string>();
      for (const i of items) {
        if (i.assignee) assigneeSet.add(i.assignee);
        for (const label of i.labels) labelSet.add(label);
      }

      return {
        items,
        assignees: [...assigneeSet].sort(),
        labels: [...labelSet].sort(),
      };
    });
  } catch (e) {
    set({ error: e instanceof Error ? e.message : String(e) });
  }
},
```

**Step 4: Run tests**

Run: `npx vitest run src/stores/backendDataStore.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/stores/backendDataStore.ts src/stores/backendDataStore.test.ts
git commit -m "perf: derive assignees/labels from loaded items, skip separate queries"
```

---

### Task 5: Dynamic import for Ink/React in TUI entry point

**Files:**
- Modify: `src/index.tsx:1-16` (imports)

**Step 1: Refactor to dynamic imports**

Replace the top of `src/index.tsx`:

```typescript
#!/usr/bin/env node
import module from 'node:module';
module.enableCompileCache?.();

import fs from 'node:fs';
import path from 'node:path';

if (process.argv.length > 2) {
  const { runCli } = await import('./cli/index.js');
  await runCli(process.argv);
} else {
  // Lazy-load Ink/React only for TUI mode
  const { render } = await import('ink');
  const { App } = await import('./app.js');
  const { ErrorBoundary } = await import('./components/ErrorBoundary.js');
  const { configStore } = await import('./stores/configStore.js');
  const { backendDataStore } = await import('./stores/backendDataStore.js');
  const { undoStore } = await import('./stores/undoStore.js');
  const { recentCommandsStore } = await import('./stores/recentCommandsStore.js');
  const { isSoftDeleteBackend } = await import('./backends/types.js');
  const { initThemeFromConfig } = await import('./stores/themeStore.js');

  const cwd = process.cwd();

  // Auto-init on first run
  const dbPath = path.join(cwd, '.tic', 'tic.db');
  if (!fs.existsSync(dbPath)) {
    const { detectBackend } = await import('./backends/factory.js');
    const { runInit } = await import('./cli/commands/init.js');
    await runInit(cwd, detectBackend(cwd));
  }

  await configStore.getState().init(cwd);
  initThemeFromConfig();
  backendDataStore.getState().init(cwd);
  await recentCommandsStore.getState().init(cwd);

  console.clear();
  const app = render(
    <ErrorBoundary>
      <App />
    </ErrorBoundary>,
  );
  await app.waitUntilExit();

  // Clean up undo stack
  const backend = backendDataStore.getState().backend;
  if (backend && isSoftDeleteBackend(backend)) {
    const remaining = undoStore.getState().clear();
    for (const entry of remaining) {
      if (entry.type === 'delete') {
        for (const snap of entry.itemSnapshots) {
          await backend.permanentlyDeleteWorkItem(snap.id);
        }
      }
    }
    await backend.cleanupTrash();
  }

  recentCommandsStore.getState().destroy();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();

  const { isUpdateRequested, runUpdate } = await import('./updater.js');
  if (isUpdateRequested()) {
    runUpdate([]);
  }
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No TypeScript errors

**Step 3: Verify TUI still works**

Run: `npm start` (manual check — opens TUI, shows items)

**Step 4: Verify CLI doesn't load Ink**

Run: `time npx tic item list`
Expected: Noticeably faster than before (no React/Ink overhead)

**Step 5: Commit**

```bash
git add src/index.tsx
git commit -m "perf: dynamic import Ink/React only for TUI mode"
```

---

### Task 6: Dynamic imports in `factory.ts` for CLI path

**Files:**
- Modify: `src/backends/factory.ts:1-8` (static imports)
- Modify: `src/backends/factory.ts:44-51` (createBackend)
- Modify: `src/backends/factory.ts:92-118` (createBackendWithSync)

**Step 1: Refactor static imports to dynamic**

Replace the top of `factory.ts` — remove static imports of `Storage`, `SyncQueue`, `configStore`, `SyncManager`. Use dynamic imports inside the functions:

```typescript
import { execSync } from 'node:child_process';
import type { Backend } from './types.js';
import type { SyncQueueAdapter } from '../sync/types.js';

export const VALID_BACKENDS = [
  'none', 'filesystem', 'github', 'gitlab', 'azure', 'jira',
] as const;
export type BackendType = (typeof VALID_BACKENDS)[number];

export interface RemoteBackendOptions {
  skipAuth?: boolean;
}

// detectBackend stays unchanged (no heavy imports)

export async function createBackend(root: string): Promise<Backend> {
  const { Storage } = await import('../storage/index.js');
  const { configStore } = await import('../stores/configStore.js');
  const primary = Storage.create(root);
  configStore.getState().setDatabase(primary.getDatabase());
  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }
  return primary;
}

// createRemoteBackend stays unchanged (already uses dynamic imports)

export async function createBackendWithSync(
  root: string,
  options?: RemoteBackendOptions,
): Promise<BackendSetup> {
  const { Storage } = await import('../storage/index.js');
  const { configStore } = await import('../stores/configStore.js');
  const primary = Storage.create(root);
  configStore.getState().setDatabase(primary.getDatabase());

  if (!configStore.getState().loaded) {
    await configStore.getState().init(root);
  }

  const config = configStore.getState().config;
  const remote = await createRemoteBackend(
    root,
    config.backend ?? 'none',
    options,
  );

  let syncManager: SyncManager | null = null;
  let queue: SyncQueueAdapter | null = null;
  if (remote) {
    const { SyncQueue } = await import('../storage/syncQueue.js');
    const { SyncManager: SM } = await import('../sync/SyncManager.js');
    queue = new SyncQueue(primary.getDatabase());
    syncManager = new SM(primary, remote, queue);
  }

  return { backend: primary, syncManager, queue };
}
```

Note: `SyncManager` type import for `BackendSetup` needs to become `import type`.

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 4: Verify CLI works**

Run: `npx tic item list`
Expected: Lists items correctly

**Step 5: Commit**

```bash
git add src/backends/factory.ts
git commit -m "perf: dynamic imports in factory.ts to avoid loading unused modules"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Clean build

**Step 4: Manual smoke test**

- `npx tic item list` — should be noticeably faster
- `npm start` — TUI should load, show items, pickers work (assignees/labels populated)
- Open detail panel (`v`) — comments should load
- Open form — assignee/label autocomplete should work

**Step 5: Commit any final fixes if needed**
