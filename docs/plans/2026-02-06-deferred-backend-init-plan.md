# Deferred Backend Initialization — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Render the TUI immediately (~220ms) instead of blocking on remote backend construction (~620ms+ for GitHub, ~800ms+ for Azure DevOps).

**Architecture:** Move backend construction from `index.tsx` into `backendDataStore.init()`, which now accepts `cwd` instead of a pre-built backend. The store creates the `LocalBackend` and remote backend asynchronously, while the UI renders immediately with a loading spinner. All existing component null guards (`if (!backend)`) already handle this correctly.

**Tech Stack:** TypeScript, Zustand (vanilla store), dynamic imports for remote backends.

**Design doc:** `docs/plans/2026-02-06-deferred-backend-init-design.md`

**Worktree:** `.worktrees/deferred-backend-init` (branch `perf/deferred-backend-init`)

**Important context:**
- The working directory for all file paths is the worktree: `/Users/skrug/PycharmProjects/tic/.worktrees/deferred-backend-init`
- Run all commands from this directory
- `npm test` runs 620 tests — all should pass after each task

---

### Task 1: Split `configStore.init()` into load + watch phases

Currently `configStore.init()` reads the config AND sets up `fs.watch` with sync `mkdirSync`/`existsSync` calls. Split it so the config is available immediately, and watching starts later.

**Files:**
- Modify: `src/stores/configStore.ts`
- Test: `src/stores/configStore.test.ts`

**Step 1: Add `startWatching()` method to `ConfigStoreState` interface**

In `src/stores/configStore.ts`, add `startWatching` to the interface at line 17:

```typescript
export interface ConfigStoreState {
  config: Config;
  loaded: boolean;
  init(root: string): Promise<void>;
  startWatching(): void;
  update(partial: Partial<Config>): Promise<void>;
  destroy(): void;
}
```

**Step 2: Extract watch logic from `init()` into `startWatching()`**

Refactor `init()` (lines 33-70) to only read config and store the root. Move the `mkdirSync`, `existsSync`, `writeConfig`, and `fs.watch` setup into a new `startWatching()` method:

```typescript
async init(root: string) {
  get().destroy();
  currentRoot = root;
  const config = await readConfig(root);
  set({ config, loaded: true });
},

startWatching() {
  if (watcher) return; // Already watching
  if (!currentRoot) return;

  const ticDir = path.join(currentRoot, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });

  const configPath = path.join(ticDir, 'config.yml');

  if (!fs.existsSync(configPath)) {
    // Write synchronously since startWatching is sync and fire-and-forget
    fs.writeFileSync(configPath, '');
    void writeConfig(currentRoot, get().config);
  }

  watcher = fs.watch(configPath, () => {
    if (writing) return;
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      readConfig(currentRoot).then(
        (updated) => set({ config: updated }),
        () => {},
      );
    }, WATCH_DEBOUNCE_MS);
  });
  watcher.on('error', () => {
    watcher?.close();
    watcher = null;
  });
},
```

**Step 3: Update `init()` to call `startWatching()` at the end**

To maintain backwards compatibility (CLI, tests, MCP all call `init()` and expect watching to work), have `init()` call `startWatching()` at the end:

```typescript
async init(root: string) {
  get().destroy();
  currentRoot = root;
  const config = await readConfig(root);
  set({ config, loaded: true });
  get().startWatching();
},
```

This is a refactor — behavior is identical. The point is that `backendDataStore` can later call `init()` without watching, then call `startWatching()` after render.

**Step 4: Run tests**

Run: `npx vitest run src/stores/configStore.test.ts`

Expected: All 7 tests pass (no behavior change).

**Step 5: Run full test suite**

Run: `npm test`

Expected: All 620 tests pass.

**Step 6: Commit**

```bash
git add src/stores/configStore.ts
git commit -m "refactor(configStore): extract startWatching() from init()"
```

---

### Task 2: Change `backendDataStore.init()` to accept `cwd` and create backends internally

This is the core change. The store takes ownership of backend lifecycle.

**Files:**
- Modify: `src/stores/backendDataStore.ts`
- Modify: `src/stores/backendDataStore.test.ts`

**Step 1: Write tests for the new `init(cwd)` signature**

Replace the entire `src/stores/backendDataStore.test.ts` with tests that use `cwd` instead of passing a mock backend. Since the store now creates `LocalBackend` internally, tests must set up a real `.tic/` directory:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { backendDataStore } from './backendDataStore.js';
import { configStore } from './configStore.js';
import { defaultConfig, writeConfig } from '../backends/local/config.js';
import { writeWorkItem } from '../backends/local/items.js';
import type { WorkItem } from '../types.js';

function makeItem(id: string, overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id,
    title: `Item ${id}`,
    status: 'todo',
    type: 'task',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00Z',
    updated: '2025-01-01T00:00:00Z',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

/** Wait for backendDataStore to finish loading after init */
async function waitForLoad(): Promise<void> {
  await new Promise<void>((resolve) => {
    const check = () => {
      const state = backendDataStore.getState();
      if (state.loaded || state.error) {
        resolve();
      } else {
        setTimeout(check, 5);
      }
    };
    check();
  });
}

describe('backendDataStore', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-bds-'));
    await writeConfig(tmpDir, { ...defaultConfig });
    await configStore.getState().init(tmpDir);
  });

  afterEach(() => {
    backendDataStore.getState().destroy();
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('starts with default state', () => {
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.syncStatus).toBeNull();
  });

  it('sets loading synchronously on init', () => {
    backendDataStore.getState().init(tmpDir);
    expect(backendDataStore.getState().loading).toBe(true);
  });

  it('loads data from local backend', async () => {
    const item = makeItem('1');
    await writeWorkItem(tmpDir, item);

    backendDataStore.getState().init(tmpDir);
    await waitForLoad();

    const state = backendDataStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.items).toHaveLength(1);
    expect(state.items[0]!.id).toBe('1');
    expect(state.statuses).toEqual(defaultConfig.statuses);
    expect(state.types).toEqual(defaultConfig.types);
    expect(state.backend).not.toBeNull();
  });

  it('refresh reloads data silently', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    expect(backendDataStore.getState().items).toHaveLength(0);

    // Write an item and refresh
    await writeWorkItem(tmpDir, makeItem('1'));
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().items).toHaveLength(1);
    expect(backendDataStore.getState().loading).toBe(false);
  });

  it('destroy resets state', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    backendDataStore.getState().destroy();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.backend).toBeNull();
  });

  it('sets sync status', async () => {
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    backendDataStore.getState().setSyncStatus({
      state: 'syncing',
      pendingCount: 3,
      lastSyncTime: null,
      errors: [],
    });
    expect(backendDataStore.getState().syncStatus?.state).toBe('syncing');
  });

  it('handles remote backend init failure gracefully', async () => {
    // Configure a remote backend that will fail (no gh CLI auth in test env)
    await configStore.getState().update({ backend: 'github' });
    backendDataStore.getState().init(tmpDir);
    await waitForLoad();
    // Should have an error but not throw
    expect(backendDataStore.getState().error).toBeTruthy();
    expect(backendDataStore.getState().loaded).toBe(true);
    expect(backendDataStore.getState().loading).toBe(false);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/backendDataStore.test.ts`

Expected: FAIL — `init()` still expects a `Backend` argument, not `cwd`.

**Step 3: Implement the new `init(cwd)` in `backendDataStore.ts`**

Replace the full file content:

```typescript
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';
import type { SyncStatus } from '../sync/types.js';
import type { SyncManager } from '../sync/SyncManager.js';
import { configStore } from './configStore.js';

export const defaultCapabilities: BackendCapabilities = {
  relationships: false,
  customTypes: false,
  customStatuses: false,
  iterations: false,
  comments: false,
  fields: {
    priority: false,
    assignee: false,
    labels: false,
    parent: false,
    dependsOn: false,
  },
  templates: false,
  templateFields: {
    type: false,
    status: false,
    priority: false,
    assignee: false,
    labels: false,
    iteration: false,
    parent: false,
    dependsOn: false,
    description: false,
  },
};

export interface BackendDataStoreState {
  items: WorkItem[];
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  currentIteration: string;

  loaded: boolean;
  loading: boolean;
  error: string | null;
  syncStatus: SyncStatus | null;

  // Backend references
  backend: Backend | null;
  syncManager: SyncManager | null;

  init(cwd: string): void;
  refresh(): Promise<void>;
  setSyncStatus(status: SyncStatus): void;
  destroy(): void;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let currentSyncManager: SyncManager | null = null;

async function createBackendAndSync(cwd: string): Promise<{
  backend: Backend;
  syncManager: SyncManager | null;
}> {
  const { LocalBackend } = await import('../backends/local/index.js');
  const backendType = configStore.getState().config.backend ?? 'local';

  const local = await LocalBackend.create(cwd, {
    tempIds: backendType !== 'local',
  });

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  // Dynamic import of remote backend — this is the expensive part
  let remote: Backend;
  switch (backendType) {
    case 'github': {
      const { GitHubBackend } = await import('../backends/github/index.js');
      remote = new GitHubBackend(cwd);
      break;
    }
    case 'gitlab': {
      const { GitLabBackend } = await import('../backends/gitlab/index.js');
      remote = new GitLabBackend(cwd);
      break;
    }
    case 'azure': {
      const { AzureDevOpsBackend } = await import('../backends/ado/index.js');
      remote = new AzureDevOpsBackend(cwd);
      break;
    }
    case 'jira': {
      const { JiraBackend } = await import('../backends/jira/index.js');
      remote = await JiraBackend.create(cwd);
      break;
    }
    default:
      throw new Error(`Unknown backend "${backendType}"`);
  }

  const { SyncQueueStore } = await import('../sync/queue.js');
  const { SyncManager } = await import('../sync/SyncManager.js');
  const queueStore = new SyncQueueStore(cwd);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { backend: local, syncManager };
}

export const backendDataStore = createStore<BackendDataStoreState>(
  (set, get) => ({
    items: [],
    capabilities: { ...defaultCapabilities },
    statuses: [],
    iterations: [],
    types: [],
    assignees: [],
    labels: [],
    currentIteration: '',

    loaded: false,
    loading: false,
    error: null,
    syncStatus: null,

    backend: null,
    syncManager: null,

    init(cwd: string) {
      get().destroy();
      set({ loading: true });

      void createBackendAndSync(cwd)
        .then(({ backend, syncManager }) => {
          currentBackend = backend;
          currentSyncManager = syncManager;
          set({ backend, syncManager });

          if (syncManager) {
            syncManager.onStatusChange((status: SyncStatus) => {
              get().setSyncStatus(status);
              if (status.state === 'idle') {
                void get().refresh();
              }
            });
            syncManager.sync().catch(() => {});
          }

          return get().refresh();
        })
        .then(() => {
          set({ loaded: true, loading: false });
        })
        .catch((err: unknown) => {
          set({
            error: err instanceof Error ? err.message : String(err),
            loaded: true,
            loading: false,
          });
        });
    },

    async refresh() {
      if (!currentBackend) return;

      try {
        const iter = await currentBackend.getCurrentIteration();
        const [statuses, iterations, types, assignees, labels, items] =
          await Promise.all([
            currentBackend.getStatuses(),
            currentBackend.getIterations(),
            currentBackend.getWorkItemTypes(),
            currentBackend.getAssignees().catch(() => [] as string[]),
            currentBackend.getLabels().catch(() => [] as string[]),
            currentBackend.listWorkItems(iter),
          ]);

        set({
          capabilities: currentBackend.getCapabilities(),
          statuses,
          iterations,
          types,
          assignees,
          labels,
          currentIteration: iter,
          items,
          error: null,
        });
      } catch (e) {
        set({ error: e instanceof Error ? e.message : String(e) });
      }
    },

    setSyncStatus(status: SyncStatus) {
      set({ syncStatus: status });
    },

    destroy() {
      currentBackend = null;
      currentSyncManager = null;
      set({
        items: [],
        capabilities: { ...defaultCapabilities },
        statuses: [],
        iterations: [],
        types: [],
        assignees: [],
        labels: [],
        currentIteration: '',
        loaded: false,
        loading: false,
        error: null,
        syncStatus: null,
        backend: null,
        syncManager: null,
      });
    },
  }),
);

export function useBackendDataStore<T>(
  selector: (state: BackendDataStoreState) => T,
): T {
  return useStore(backendDataStore, selector);
}
```

**Step 4: Run the backendDataStore tests**

Run: `npx vitest run src/stores/backendDataStore.test.ts`

Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/stores/backendDataStore.ts src/stores/backendDataStore.test.ts
git commit -m "feat(backendDataStore): init accepts cwd, creates backends asynchronously"
```

---

### Task 3: Update `index.tsx` to render before backend init

**Files:**
- Modify: `src/index.tsx`

**Step 1: Simplify the TUI startup path**

Replace lines 14-29 in `src/index.tsx`:

```typescript
} else {
  await configStore.getState().init(process.cwd());

  // Render immediately — backend init happens asynchronously in the store
  backendDataStore.getState().init(process.cwd());

  const app = render(<App />);
  await app.waitUntilExit();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();
}
```

This removes:
- The `createBackendWithSync()` import and call
- The `syncManager.sync()` call (now handled inside the store)

**Step 2: Remove unused import**

Remove the `createBackendWithSync` import from line 7.

**Step 3: Run full test suite**

Run: `npm test`

Expected: All tests pass. The factory tests are unaffected (they test `createBackendWithSync` directly, not through the store).

**Step 4: Run the build**

Run: `npm run build`

Expected: Clean build, no type errors.

**Step 5: Commit**

```bash
git add src/index.tsx
git commit -m "perf(startup): render TUI before backend construction

Backend creation now happens asynchronously inside backendDataStore.
The UI renders immediately with a loading spinner instead of blocking
on remote CLI auth checks (gh auth status, glab auth status, etc.).

Saves ~400ms for GitHub, ~600ms+ for Azure DevOps."
```

---

### Task 4: Defer `configStore.startWatching()` to after first render

Now that `startWatching()` is separate from `init()`, we can defer it.

**Files:**
- Modify: `src/stores/configStore.ts` (remove `startWatching()` call from `init()`)
- Modify: `src/stores/backendDataStore.ts` (call `configStore.startWatching()` after refresh)
- Modify: `src/stores/configStore.test.ts` (update tests to call `startWatching()` explicitly)

**Step 1: Remove `startWatching()` call from `configStore.init()`**

In `src/stores/configStore.ts`, change `init()` to:

```typescript
async init(root: string) {
  get().destroy();
  currentRoot = root;
  const config = await readConfig(root);
  set({ config, loaded: true });
},
```

**Step 2: Call `configStore.startWatching()` from `backendDataStore` after first refresh**

In `src/stores/backendDataStore.ts`, inside the `.then()` chain of `init()`, after `refresh()` completes and before setting `loaded: true`:

```typescript
.then(() => {
  configStore.getState().startWatching();
  set({ loaded: true, loading: false });
})
```

**Step 3: Update configStore tests that depend on watching**

In `src/stores/configStore.test.ts`, the tests "picks up external file changes", "does not double-trigger on self-writes", and "destroy stops the file watcher" rely on `init()` starting the watcher. Add an explicit `configStore.getState().startWatching()` call after `init()` in those tests:

```typescript
it('picks up external file changes', async () => {
  await configStore.getState().init(tmpDir);
  configStore.getState().startWatching();
  // ... rest unchanged
});

it('does not double-trigger on self-writes', async () => {
  await configStore.getState().init(tmpDir);
  configStore.getState().startWatching();
  // ... rest unchanged
});

it('destroy stops the file watcher', async () => {
  await configStore.getState().init(tmpDir);
  configStore.getState().startWatching();
  // ... rest unchanged
});
```

**Step 4: Run configStore tests**

Run: `npx vitest run src/stores/configStore.test.ts`

Expected: All 7 tests pass.

**Step 5: Run full test suite**

Run: `npm test`

Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/stores/configStore.ts src/stores/configStore.test.ts src/stores/backendDataStore.ts
git commit -m "perf(configStore): defer fs.watch setup to after first render"
```

---

### Task 5: Verify build, lint, and format

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run lint**

Run: `npm run lint`

Fix any issues.

**Step 3: Run type check**

Run: `npx tsc --noEmit`

Expected: No type errors.

**Step 4: Run full test suite**

Run: `npm test`

Expected: All tests pass.

**Step 5: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```

(Skip if no changes.)

---

### Task 6: Manual smoke test and measure improvement

**Step 1: Build**

Run: `npm run build`

**Step 2: Measure new startup time**

Run this from the worktree directory:

```bash
node -e "
const t0 = Date.now();
const {render} = await import('ink');
const {App} = await import('./dist/app.js');
const {configStore} = await import('./dist/stores/configStore.js');
const {backendDataStore} = await import('./dist/stores/backendDataStore.js');
await configStore.getState().init(process.cwd());
backendDataStore.getState().init(process.cwd());
console.log('--- time to render-ready:', Date.now()-t0, 'ms');
backendDataStore.getState().destroy();
configStore.getState().destroy();
process.exit();
" 2>&1
```

Expected: ~220ms (down from ~620ms).

**Step 3: Report findings**

Report the before/after measurement. No commit needed for this task.
