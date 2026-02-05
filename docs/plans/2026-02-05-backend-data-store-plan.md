# Backend Data Store Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `useBackendData` hook and its module-level cache with a Zustand vanilla store (`backendDataStore`), matching the pattern established by `configStore`.

**Architecture:** A singleton Zustand vanilla store holds all fetched backend data (items, statuses, types, etc.) and sync status. Components subscribe via `useBackendDataStore(selector)`. The backend instance and sync manager remain in AppContext as service objects. The store is initialized before React renders and destroyed on exit.

**Tech Stack:** Zustand (vanilla `createStore` + `useStore` hook wrapper), TypeScript, Vitest

---

### Task 1: Create the backendDataStore

**Files:**
- Create: `src/stores/backendDataStore.ts`

**Step 1: Write the failing test**

Create `src/stores/backendDataStore.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { backendDataStore } from './backendDataStore.js';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';

const allTrue: BackendCapabilities = {
  relationships: true,
  customTypes: true,
  customStatuses: true,
  iterations: true,
  comments: true,
  fields: {
    priority: true,
    assignee: true,
    labels: true,
    parent: true,
    dependsOn: true,
  },
  templates: true,
  templateFields: {
    type: true,
    status: true,
    priority: true,
    assignee: true,
    labels: true,
    iteration: true,
    parent: true,
    dependsOn: true,
    description: true,
  },
};

function mockBackend(items: WorkItem[] = []): Backend {
  return {
    getCapabilities: () => allTrue,
    getStatuses: async () => ['open', 'closed'],
    getIterations: async () => ['v1', 'v2'],
    getWorkItemTypes: async () => ['task', 'bug'],
    getAssignees: async () => ['alice', 'bob'],
    getLabels: async () => ['frontend', 'backend'],
    getCurrentIteration: async () => 'v1',
    listWorkItems: async () => items,
  } as unknown as Backend;
}

describe('backendDataStore', () => {
  afterEach(() => {
    backendDataStore.getState().destroy();
  });

  it('starts with default state', () => {
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual([]);
    expect(state.syncStatus).toBeNull();
  });

  it('loads data on init', async () => {
    const items: WorkItem[] = [
      {
        id: '1',
        title: 'Test',
        status: 'open',
        type: 'task',
        description: '',
        parent: null,
        dependsOn: [],
      },
    ];
    await backendDataStore.getState().init(mockBackend(items));
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(true);
    expect(state.loading).toBe(false);
    expect(state.items).toEqual(items);
    expect(state.statuses).toEqual(['open', 'closed']);
    expect(state.iterations).toEqual(['v1', 'v2']);
    expect(state.types).toEqual(['task', 'bug']);
    expect(state.assignees).toEqual(['alice', 'bob']);
    expect(state.labels).toEqual(['frontend', 'backend']);
    expect(state.currentIteration).toBe('v1');
    expect(state.capabilities).toBe(allTrue);
  });

  it('refresh reloads data silently', async () => {
    const backend = mockBackend();
    await backendDataStore.getState().init(backend);
    // Mutate the mock to return different data
    (backend as any).getStatuses = async () => ['open', 'closed', 'in-progress'];
    await backendDataStore.getState().refresh();
    expect(backendDataStore.getState().statuses).toEqual([
      'open',
      'closed',
      'in-progress',
    ]);
    // loading should NOT have been set to true during refresh
    expect(backendDataStore.getState().loading).toBe(false);
  });

  it('destroy resets state', async () => {
    await backendDataStore.getState().init(mockBackend());
    backendDataStore.getState().destroy();
    const state = backendDataStore.getState();
    expect(state.loaded).toBe(false);
    expect(state.items).toEqual([]);
  });

  it('sets sync status', async () => {
    await backendDataStore.getState().init(mockBackend());
    backendDataStore.getState().setSyncStatus({
      state: 'syncing',
      pendingCount: 3,
      lastSyncTime: null,
      errors: [],
    });
    expect(backendDataStore.getState().syncStatus?.state).toBe('syncing');
  });

  it('handles init error gracefully', async () => {
    const backend = mockBackend();
    (backend as any).getStatuses = async () => {
      throw new Error('network error');
    };
    await backendDataStore.getState().init(backend);
    expect(backendDataStore.getState().error).toBe('network error');
    expect(backendDataStore.getState().loading).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/backendDataStore.test.ts`
Expected: FAIL — module `./backendDataStore.js` not found

**Step 3: Write the store implementation**

Create `src/stores/backendDataStore.ts`:

```typescript
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';
import type { SyncStatus } from '../sync/types.js';
import type { SyncManager } from '../sync/SyncManager.js';

const defaultCapabilities: BackendCapabilities = {
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

  init(backend: Backend, syncManager?: SyncManager | null): Promise<void>;
  refresh(): Promise<void>;
  setSyncStatus(status: SyncStatus): void;
  destroy(): void;
}

// Module-level references (not reactive state)
let currentBackend: Backend | null = null;
let currentSyncManager: SyncManager | null = null;

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

    async init(backend: Backend, syncManager?: SyncManager | null) {
      get().destroy();

      currentBackend = backend;
      currentSyncManager = syncManager ?? null;

      set({ loading: true });

      if (currentSyncManager) {
        currentSyncManager.onStatusChange((status: SyncStatus) => {
          get().setSyncStatus(status);
          if (status.state === 'idle') {
            void get().refresh();
          }
        });
      }

      await get().refresh();
      set({ loaded: true, loading: false });
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

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/backendDataStore.test.ts`
Expected: ALL PASS

**Step 5: Commit**

```bash
git add src/stores/backendDataStore.ts src/stores/backendDataStore.test.ts
git commit -m "feat: add Zustand backend data store"
```

---

### Task 2: Wire up entry point

**Files:**
- Modify: `src/index.tsx:1-21`

**Step 1: Write the failing test**

No unit test — this is a wiring change. We'll verify by running the full test suite later.

**Step 2: Update index.tsx**

Add `backendDataStore` init between backend creation and render, and destroy on exit:

```typescript
#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';
import { configStore } from './stores/configStore.js';
import { backendDataStore } from './stores/backendDataStore.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  await configStore.getState().init(process.cwd());
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  await backendDataStore.getState().init(backend, syncManager);

  if (syncManager) {
    syncManager.sync().catch(() => {});
  }

  const app = render(<App backend={backend} syncManager={syncManager} />);
  await app.waitUntilExit();
  backendDataStore.getState().destroy();
  configStore.getState().destroy();
}
```

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "feat: wire up backendDataStore init/destroy in TUI entry point"
```

---

### Task 3: Migrate WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:13,87-112,125-134` (and all refreshData call sites)

This is the biggest migration. Replace `useBackendData` and the `onStatusChange` listener with store selectors.

**Step 1: Replace imports and hook usage**

In `src/components/WorkItemList.tsx`:

Remove:
```typescript
import { useBackendData } from '../hooks/useBackendData.js';
```

Add:
```typescript
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
```

Replace the `useBackendData` call (lines 91-101) with store selectors:

```typescript
const capabilities = useBackendDataStore((s) => s.capabilities);
const types = useBackendDataStore((s) => s.types);
const statuses = useBackendDataStore((s) => s.statuses);
const assignees = useBackendDataStore((s) => s.assignees);
const labelSuggestions = useBackendDataStore((s) => s.labels);
const iteration = useBackendDataStore((s) => s.currentIteration);
const allItems = useBackendDataStore((s) => s.items);
const loading = useBackendDataStore((s) => s.loading);
const syncStatus = useBackendDataStore((s) => s.syncStatus);
```

**Step 2: Replace refreshData and sync listener**

Remove the `refreshData` from destructuring. Define refresh as a simple store call:

```typescript
const refreshData = useCallback(() => {
  void backendDataStore.getState().refresh();
}, []);
```

Remove the entire `onStatusChange` useEffect (lines 103-112) — the store handles this in `init()`.

Replace the local `syncStatus` state and its `useState` — the store provides it now.

**Step 3: Replace all `refreshData()` call sites**

All existing `refreshData()` calls remain the same — the function reference just changed from `useBackendData`'s refresh to the store's refresh. No call site changes needed.

**Step 4: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor: migrate WorkItemList to use backendDataStore"
```

---

### Task 4: Migrate WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx:12,83-93`

**Step 1: Replace imports and hook usage**

Remove:
```typescript
import { useBackendData } from '../hooks/useBackendData.js';
```

Add:
```typescript
import { useBackendDataStore } from '../stores/backendDataStore.js';
```

Replace the `useBackendData` call (lines 83-93) with store selectors:

```typescript
const capabilities = useBackendDataStore((s) => s.capabilities);
const statuses = useBackendDataStore((s) => s.statuses);
const iterations = useBackendDataStore((s) => s.iterations);
const types = useBackendDataStore((s) => s.types);
const assignees = useBackendDataStore((s) => s.assignees);
const labelSuggestions = useBackendDataStore((s) => s.labels);
const currentIteration = useBackendDataStore((s) => s.currentIteration);
const allItems = useBackendDataStore((s) => s.items);
const configLoading = useBackendDataStore((s) => s.loading);
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "refactor: migrate WorkItemForm to use backendDataStore"
```

---

### Task 5: Migrate IterationPicker

**Files:**
- Modify: `src/components/IterationPicker.tsx:4,8-12`

**Step 1: Replace imports and hook usage**

Remove:
```typescript
import { useBackendData } from '../hooks/useBackendData.js';
```

Add:
```typescript
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';
```

Replace the `useBackendData` call (lines 8-12) with store selectors:

```typescript
const iterations = useBackendDataStore((s) => s.iterations);
const current = useBackendDataStore((s) => s.currentIteration);
const loading = useBackendDataStore((s) => s.loading);
```

In the `onSelect` handler, call `backendDataStore.getState().refresh()` after `setCurrentIteration`:

```typescript
onSelect={(item) => {
  void (async () => {
    await backend.setCurrentIteration(item.value);
    await backendDataStore.getState().refresh();
    navigate('list');
  })();
}}
```

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "refactor: migrate IterationPicker to use backendDataStore"
```

---

### Task 6: Migrate StatusScreen sync status

**Files:**
- Modify: `src/components/StatusScreen.tsx:25-28,32-40`

**Step 1: Replace sync status management**

Add import:
```typescript
import { useBackendDataStore } from '../stores/backendDataStore.js';
```

Replace the local `syncStatus` state and `onStatusChange` useEffect with a store selector:

```typescript
const syncStatus = useBackendDataStore((s) => s.syncStatus);
```

Remove:
- The `useState` for syncStatus (line 32-34)
- The `useEffect` registering `onStatusChange` (lines 36-40)

Keep the `useMemo` for capabilities (line 25-28) — StatusScreen reads capabilities directly from the backend, not from the store. This is fine since capabilities don't change during a session.

**Step 2: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/StatusScreen.tsx
git commit -m "refactor: migrate StatusScreen sync status to backendDataStore"
```

---

### Task 7: Delete useBackendData hook

**Files:**
- Delete: `src/hooks/useBackendData.ts`

**Step 1: Verify no remaining imports**

Search for any remaining references to `useBackendData`:

Run: `grep -r "useBackendData" src/`
Expected: No results (or only the file itself)

**Step 2: Delete the file**

Delete `src/hooks/useBackendData.ts`.

**Step 3: Verify build succeeds**

Run: `npm run build`
Expected: No errors

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git rm src/hooks/useBackendData.ts
git commit -m "refactor: remove useBackendData hook (replaced by backendDataStore)"
```

---

### Task 8: Update affected test files

**Files:**
- Modify: Any test files that use `useBackendData` or create backends that now need store lifecycle

**Step 1: Find affected tests**

Search for test files importing `useBackendData` or `clearBackendDataCache`:

Run: `grep -r "useBackendData\|clearBackendDataCache" src/ --include="*.test.*"`

**Step 2: Update each test file**

For any test that imported `clearBackendDataCache` — remove the import and the call. The store's `destroy()` in `afterEach` handles cleanup.

For any test that directly uses the backend data store, add the standard lifecycle:

```typescript
import { backendDataStore } from '../stores/backendDataStore.js';

afterEach(() => {
  backendDataStore.getState().destroy();
});
```

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: No errors. If format issues, run `npm run format` first.

**Step 5: Commit**

```bash
git add -A
git commit -m "test: update tests for backendDataStore migration"
```

---

### Task 9: Final verification

**Step 1: Run full build + test + lint + format check**

Run: `npm run build && npm test && npm run lint && npm run format:check`
Expected: All pass, no errors

**Step 2: Manual smoke test (optional)**

Run: `npm start`
Expected: TUI launches, items load, sync indicators work, navigation between screens works, iteration switching refreshes data.
