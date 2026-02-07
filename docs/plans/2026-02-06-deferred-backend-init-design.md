# Deferred Backend Initialization Design

## Motivation

Startup profiling reveals that remote backend construction blocks the TUI from rendering. The `createBackendWithSync()` call in `index.tsx` is awaited before `render()`, and remote backend constructors make synchronous CLI calls for authentication checks:

| Backend | Constructor calls | Measured cost |
|---------|------------------|---------------|
| GitHub | `gh auth status` | ~370ms |
| GitLab | `glab auth status` + `git remote -v` | ~300-500ms |
| Azure DevOps | `az account show` + `git remote -v` + `az devops invoke` (types) | ~600ms+ |
| Local | none | ~0ms |

Current startup timeline (GitHub backend):

```
ink import ............... 184ms  (yoga-wasm, react-reconciler — unavoidable)
App + stores import ...... 35ms
configStore.init() ....... 4ms
createBackendWithSync() .. 398ms  ← blocks render
backendDataStore.init() .. 0ms
render() ................. first paint at ~621ms
```

Target timeline:

```
ink import ............... 184ms
App + stores import ...... 35ms
configStore.init() ....... 4ms
render() ................. first paint at ~223ms  (400ms faster)
backend construction ..... 398ms  (background, user sees spinner)
```

## Design

### Core Change: Move Backend Creation Into `backendDataStore.init()`

Instead of constructing the backend in `index.tsx` and passing it to the store, the store takes ownership of backend lifecycle. The store's `init()` signature changes from receiving a pre-built backend to receiving just the working directory:

```typescript
// Before
init(backend: Backend, syncManager?: SyncManager | null): void;

// After
init(cwd: string): void;
```

The store internally:

1. Sets `loading: true` immediately (UI renders with spinner)
2. Creates the `LocalBackend` synchronously (fast — no I/O in constructor)
3. Reads the backend type from `configStore`
4. If remote: dynamically imports and constructs the remote backend, creates `SyncManager`
5. Stores references and calls `refresh()`
6. If remote construction fails (CLI not authenticated), sets `error` state

### `index.tsx` Changes

Before:
```typescript
await configStore.getState().init(process.cwd());
const { backend, syncManager } = await createBackendWithSync(process.cwd());
backendDataStore.getState().init(backend, syncManager);
if (syncManager) syncManager.sync().catch(() => {});
const app = render(<App />);
```

After:
```typescript
await configStore.getState().init(process.cwd());
backendDataStore.getState().init(process.cwd());
const app = render(<App />);
```

`render()` happens immediately after config is loaded (~4ms). The store handles everything else asynchronously.

### `backendDataStore` Changes

The `init()` method becomes:

```typescript
init(cwd: string) {
  get().destroy();
  set({ loading: true });

  // Fire and forget — UI renders immediately
  void initBackend(cwd).then(({ local, remote, syncManager }) => {
    currentBackend = local;
    currentSyncManager = syncManager;

    set({ backend: local, syncManager });

    if (syncManager) {
      syncManager.onStatusChange((status: SyncStatus) => {
        get().setSyncStatus(status);
        if (status.state === 'idle') void get().refresh();
      });
      syncManager.sync().catch(() => {});
    }

    void get().refresh().finally(() => {
      set({ loaded: true, loading: false });
    });
  }).catch((err) => {
    set({
      error: err instanceof Error ? err.message : String(err),
      loaded: true,
      loading: false,
    });
  });
}
```

### New Helper: `initBackend()`

Extract backend construction into an async helper in the store module (or in `factory.ts`):

```typescript
async function initBackend(cwd: string): Promise<{
  local: LocalBackend;
  remote: Backend | null;
  syncManager: SyncManager | null;
}> {
  const backendType = configStore.getState().config.backend ?? 'local';
  const local = new LocalBackend(cwd, { tempIds: backendType !== 'local' });

  if (backendType === 'local') {
    return { local, remote: null, syncManager: null };
  }

  const remote = await createRemoteBackend(backendType, cwd);
  const queueStore = new SyncQueueStore(cwd);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { local, remote, syncManager };
}
```

### `LocalBackend.create()` Simplification

Currently `LocalBackend.create()` is async only because it checks `configStore.getState().loaded`. Since `configStore.init()` is always called before the store's `init()`, this guard is unnecessary in the TUI path. The constructor can be called directly:

```typescript
new LocalBackend(cwd, { tempIds: backendType !== 'local' });
```

The existing `LocalBackend.create()` static method remains for use by tests and CLI commands.

### `createBackendWithSync()` in `factory.ts`

This function is still used by CLI commands (`tic item list`, etc.) and MCP tools. It stays unchanged. Only the TUI path (`index.tsx`) changes.

### Component Impact

Components already handle `backend: null` gracefully:

- `WorkItemList`: guards with `&& backend` before calling methods (lines 145, 233)
- `WorkItemForm`, `Settings`, `IterationPicker`, `HelpScreen`, `StatusScreen`: all lazy-loaded via `Suspense`, only rendered after user navigates away from list

No component changes needed.

### Error Handling

If the remote backend constructor throws (e.g., `gh` not installed, not authenticated):

- `error` state is set on the store
- `Header` shows the error via its existing `syncStatus` display
- The user sees the TUI with the error message, not a crash
- Local items still load and display (since `LocalBackend` construction doesn't depend on remote)

This is a UX improvement over today's behavior, where a failed `gh auth status` crashes the process before rendering anything.

### Deferred `fs.watch` in `configStore`

Minor optimization (~2-3ms): split `configStore.init()` into two phases:

1. `init(root)` — reads config, sets `loaded: true` (needed before render)
2. `startWatching()` — sets up `fs.watch`, `mkdirSync`, `existsSync` (can happen after render)

Call `startWatching()` from `backendDataStore.init()` after the first `refresh()` completes.

## Testing Strategy

- **Existing `backendDataStore` tests**: Update to use new `init(cwd)` signature. Mock or use temp directories as before.
- **Existing backend tests**: Unchanged (they don't go through the store).
- **New test: init with unavailable remote**: Verify store sets `error` state instead of throwing when remote backend construction fails.
- **New test: init ordering**: Verify `loading` is `true` synchronously after `init()`, before backend construction completes.
- **Manual smoke test**: `npm start` in a GitHub repo should show the TUI header + spinner immediately, items populate after ~400ms.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Components call `backend.method()` before init completes | All call sites already guard `if (!backend)`. Store starts with `backend: null`. |
| Sync starts before UI is ready | Sync is fire-and-forget. Status updates flow through the store reactively. |
| Tests break due to async init | Tests can `await` the init promise or wait for `loaded: true`. |
| CLI/MCP path affected | They use `createBackendWithSync()` directly, unchanged. |
| `configStore` not loaded when store reads backend type | `configStore.init()` is still awaited before `backendDataStore.init()` in `index.tsx`. |

## Out of Scope

- Replacing Ink to reduce the 184ms import floor
- Parallelizing remote CLI calls within a single backend constructor
- Caching `gh auth status` results across runs
