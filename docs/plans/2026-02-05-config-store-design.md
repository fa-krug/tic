# Config Store Design

## Overview

Replace scattered `readConfig()`/`readConfigSync()` calls with a single Zustand store that serves both React components and non-React code. Config is read once at startup, kept in memory, and synced to/from disk reactively.

This is the first Zustand store in the project. It establishes the pattern for future stores (backend data, sync status, etc.).

## Problem

Config is read from `.tic/config.yml` independently in ~10 locations:

- `factory.ts` — reads to determine backend type
- `LocalBackend.create()` — reads again, stores private copy
- `app.tsx` — reads twice (defaultType, autoUpdate)
- `Header.tsx` — reads every render for backend label
- `WorkItemList.tsx` — reads on-demand for branchMode (2 places)
- `Settings.tsx` — reads on mount, holds full copy in local state

There is no reactivity — config changes in Settings don't update Header or WorkItemList. LocalBackend holds its own private copy that diverges from what's on disk when other code writes config.

## Design

### New dependency

Add `zustand` to `package.json`. Zustand provides:
- `create()` — creates a store with built-in React hook
- `getState()` — synchronous access for non-React code
- `subscribe()` — listener-based subscriptions
- Granular selectors — components re-render only when their slice changes

### Store definition

New file: `src/stores/configStore.ts`

```typescript
import { createStore, useStore } from 'zustand';

interface ConfigStoreState {
  config: Config;
  loaded: boolean;
  init(root: string): Promise<void>;
  update(partial: Partial<Config>): Promise<void>;
  destroy(): void;
}
```

### Behaviors

**`init(root)`**
1. Reads `config.yml` from disk (async)
2. Sets `config` and `loaded: true`
3. Starts `fs.watch()` on `.tic/config.yml`
4. On external file change: re-reads config, updates store state
5. Tracks a `writing` flag to ignore self-triggered watch events

**`update(partial)`**
1. Shallow-merges `partial` into current `config`
2. Sets `writing = true`
3. Writes merged config to disk via `writeConfig()`
4. Sets `writing = false` after write completes

**`destroy()`**
1. Closes the `fs.watch()` handle
2. Called on TUI exit

**File watcher debounce**: `fs.watch` can fire multiple events for a single write. Debounce with a 50ms window — ignore rapid successive events, only reload once.

### Access patterns

**React components** use a hook with selectors:
```typescript
// Granular — only re-renders when branchMode changes
const branchMode = useConfigStore(s => s.config.branchMode);

// Multiple fields
const { backend, defaultType } = useConfigStore(s => ({
  backend: s.config.backend,
  defaultType: s.config.defaultType,
}));
```

**Non-React code** uses `getState()`:
```typescript
const config = configStore.getState().config;
const backendType = config.backend ?? 'local';
```

### Singleton

The store is created at module scope as a vanilla Zustand store (`createStore`, not `create`). A `useConfigStore` hook wraps it for React:

```typescript
export const configStore = createStore<ConfigStoreState>(...);
export const useConfigStore = <T>(selector: (s: ConfigStoreState) => T) =>
  useStore(configStore, selector);
```

This allows both `configStore.getState()` (non-React) and `useConfigStore(selector)` (React).

## Migration

### 1. LocalBackend — drop private config

Remove:
- `private config: Config` field
- `private save()` method
- `readConfig()` call in `LocalBackend.create()`

Replace all `this.config.X` reads with `configStore.getState().config.X`.

Replace all `this.config.X = Y; this.save()` with `await configStore.update({ X: Y })`.

Affected methods:
- `getStatuses()` — reads `config.statuses`
- `getWorkItemTypes()` — reads `config.types`
- `getIterations()` — reads `config.iterations`
- `getCurrentIteration()` — reads `config.current_iteration`
- `setCurrentIteration()` — writes `current_iteration` + `iterations`
- `createWorkItem()` — reads/writes `next_id`
- `syncConfigFromRemote()` — writes iterations, statuses, types, current_iteration
- Constructor / `create()` — currently reads and stores config

### 2. app.tsx — drop config reads

Remove:
- `readConfigSync` import
- `defaultType` useState initializer that reads config
- `autoUpdate` useEffect that reads config

Replace with:
- `useConfigStore(s => s.config.defaultType)` for defaultType
- `useConfigStore(s => s.config.autoUpdate)` for autoUpdate

`defaultType` and `setDefaultType` move out of AppContext — components read directly from the config store. Settings calls `configStore.update({ defaultType })` which reactively updates all subscribers.

### 3. Header.tsx — drop config read

Remove `readConfigSync()` call on every render.

Replace with:
```typescript
const backend = useConfigStore(s => s.config.backend ?? 'local');
```

### 4. WorkItemList.tsx — drop config reads

Remove two `readConfigSync()` calls for `branchMode`.

Replace with:
```typescript
const branchMode = useConfigStore(s => s.config.branchMode ?? 'worktree');
```

### 5. Settings.tsx — use store instead of local state

Remove:
- `const [config, setConfig] = useState<Config | null>(null)`
- `useEffect` that reads config on mount

Replace with:
- `const config = useConfigStore(s => s.config)`
- All `writeConfig()` calls become `configStore.update({ ... })`
- No need to manage local config state — the store IS the state

### 6. factory.ts — read from store

Replace `readConfig(root)` with `configStore.getState().config`.

Since factory runs after `init()`, the store is already loaded.

### 7. CLI and MCP — no change

CLI commands and MCP handlers are short-lived. They continue using `readConfig()`/`writeConfig()` directly. The TUI file watcher picks up their writes automatically.

### 8. Startup sequence

In `src/index.tsx`, before rendering `<App>`:

```typescript
await configStore.getState().init(process.cwd());
const { backend, syncManager } = await createBackendWithSync(process.cwd());
// render <App>
```

On exit (Ink's `waitUntilExit`):
```typescript
configStore.getState().destroy();
```

## Files changed

| File | Change |
|------|--------|
| `package.json` | Add `zustand` dependency |
| `src/stores/configStore.ts` | **New** — Zustand store |
| `src/backends/local/index.ts` | Drop private config, read from store |
| `src/backends/local/config.ts` | Keep `readConfig`/`writeConfig` as I/O utilities |
| `src/app.tsx` | Drop `readConfigSync`, `defaultType` state; read from store |
| `src/components/Header.tsx` | Drop `readConfigSync`, use `useConfigStore` |
| `src/components/WorkItemList.tsx` | Drop `readConfigSync`, use `useConfigStore` |
| `src/components/Settings.tsx` | Drop local config state, use store for read + write |
| `src/index.tsx` | Add `init()` before render, `destroy()` on exit |
| `src/backends/factory.ts` | Read from store instead of `readConfig()` |

## Testing

- Unit test `configStore` in isolation: init, update, file watcher, destroy
- Test that file watcher picks up external writes (simulate CLI writing config)
- Test that `update()` doesn't double-trigger the watcher
- Test debounce behavior
- Existing backend and component tests continue to work (config store initialized in test setup)

## Future stores

This establishes the pattern: `createStore` + `useXStore` hook + `getState()` for non-React. Future stores (backend data, sync status, navigation) follow the same structure in `src/stores/`.
