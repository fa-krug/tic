# Backend Data Store Design

## Problem

Backend data (items, statuses, types, etc.) is currently managed through a `useBackendData` hook with a module-level cache. This creates several issues:

- **Inconsistency** — the config store uses Zustand, but backend data uses a hand-rolled cache
- **Poor reactivity** — components don't auto-update when data changes; they rely on manual `refreshData()` calls and module-level cache tricks
- **Shared state bugs** — multiple components reading from the same cache with no formal subscription model leads to stale reads

## Solution

A Zustand vanilla store (`backendDataStore`) that holds all fetched backend data and sync status. Follows the same singleton pattern established by `configStore`.

## Store Shape

```typescript
// src/stores/backendDataStore.ts

interface BackendDataStoreState {
  // Data
  items: WorkItem[];
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  currentIteration: string;

  // Status
  loaded: boolean;
  loading: boolean;       // true only during first load
  error: string | null;
  syncStatus: SyncStatus | null;

  // Actions
  init(backend: Backend, syncManager?: SyncManager | null): Promise<void>;
  refresh(): Promise<void>;
  setSyncStatus(status: SyncStatus): void;
  destroy(): void;
}
```

Backend and syncManager references are stored as module-level variables (not in Zustand state) — they're service objects, not reactive data. This mirrors how configStore stores its file watcher reference.

## Lifecycle

- **`init(backend, syncManager)`** — stores backend reference, registers `syncManager.onStatusChange` listener, calls `refresh()` for initial load. Sets `loading: true` only during this first load.
- **`refresh()`** — `Promise.all` to reload everything from backend (items, statuses, types, assignees, labels, iterations, capabilities, currentIteration). Updates store state silently — no loading spinner after first load.
- **`setSyncStatus(status)`** — called by the sync listener. When state becomes `idle`, triggers `refresh()` automatically.
- **`destroy()`** — unregisters sync listener, resets all state to defaults.

## What Lives Where

| Concern | Location | Rationale |
|---------|----------|-----------|
| Backend data (items, statuses, types, etc.) | `backendDataStore` | Reactive data that changes and components subscribe to |
| Sync status | `backendDataStore` | Tightly coupled with data — sync completing triggers refresh |
| Config (backend type, Jira settings, etc.) | `configStore` | Already migrated, file-watched |
| Backend instance | AppContext | Long-lived service object, not reactive state |
| SyncManager instance | AppContext | Service object, store consumes its output |
| UI state (screen, selection, navigation) | AppContext | React-specific, no need outside React tree |

## Component Migration

### WorkItemList & WorkItemForm

Replace `useBackendData(backend)` with store selectors:

```typescript
// Before
const { items, capabilities, statuses, refresh } = useBackendData(backend);

// After
const items = useBackendDataStore((s) => s.items);
const capabilities = useBackendDataStore((s) => s.capabilities);
const statuses = useBackendDataStore((s) => s.statuses);
const refresh = useBackendDataStore((s) => s.refresh);
```

### Mutation Pattern

After mutations, components call the store's `refresh()`:

```typescript
await backend.cachedUpdateWorkItem(id, { status });
await queueWrite('update', id);
backendDataStore.getState().refresh();
```

### Header & StatusScreen

Read sync status from the store instead of managing their own `onStatusChange` listeners:

```typescript
const syncStatus = useBackendDataStore((s) => s.syncStatus);
```

### Settings

Mostly uses `configStore` — no changes needed. Template list is local to that screen.

### What Gets Deleted

- `src/hooks/useBackendData.ts` — entirely replaced by the store
- Module-level `dataCache` — Zustand handles persistence across mounts
- Individual `onStatusChange` listeners in components — replaced by store subscription

## Entry Point

```typescript
// src/index.tsx
configStore.getState().init(process.cwd());
const { backend, syncManager } = await createBackendWithSync(process.cwd());
await backendDataStore.getState().init(backend, syncManager);
render(<App backend={backend} syncManager={syncManager} />);

// On exit:
backendDataStore.getState().destroy();
configStore.getState().destroy();
```

Store is initialized before React renders, so components never see empty state except during first load (`loading: true`).

## Refresh Triggers

All data refreshes go through one method — `backendDataStore.getState().refresh()`:

| Trigger | Caller |
|---------|--------|
| First load | `init()` |
| After mutation | Component after `backend.cachedXxx()` + `queueWrite()` |
| After sync completes | Sync status listener (when state becomes `idle`) |
| Explicit refresh (`r` key) | WorkItemList |
| Iteration change | IterationPicker after config update |

Single refresh reloads everything via `Promise.all`. No granular refresh — backend calls are cheap (local filesystem reads). Keeps the model simple.

## Loading Behavior

- **First load** — `loading: true`, components show spinner
- **All subsequent refreshes** — silent swap, data updates in place, no spinner
- **Sync indicator** — driven by `syncStatus` in the store, unchanged UX

## Iteration Filtering

The store reads `currentIteration` from the backend on each `refresh()`. When the user changes iteration via IterationPicker, the picker calls `refresh()` explicitly after updating config. No cross-store subscription needed.

## Testing

Mirrors configStore test pattern:

```typescript
afterEach(() => {
  backendDataStore.getState().destroy();
});
```

Testable without React — call `init()` with a mock backend, assert on `getState().items`.

## Migration Strategy

Incremental, component by component. Each step is independently committable:

1. Create the store — `src/stores/backendDataStore.ts`
2. Wire up entry point — add `init()` and `destroy()` in `src/index.tsx`
3. Migrate WorkItemList — replace `useBackendData` with store selectors
4. Migrate WorkItemForm — same pattern
5. Migrate Header — replace sync listener with store selector
6. Migrate StatusScreen — same pattern
7. Delete `useBackendData` — remove hook and module-level cache
8. Update tests — add store lifecycle to affected test files

## What Doesn't Change

- Backend interface and implementations — untouched
- BackendCache (internal per-backend cache) — still used by backends
- SyncManager / SyncQueueStore — work the same, store consumes their output
- AppContext — keeps UI state and service object references
- CLI / MCP — unaffected, don't use the store
