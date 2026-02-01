# Offline-First Sync Architecture

## Summary

Rework tic's loading mechanics so the TUI always reads from and writes to `LocalBackend`. Remote backends (GitHub, GitLab, Azure DevOps) become sync targets rather than direct data sources. Writes go to local storage immediately, then get pushed to the remote in the background. A manual sync keybinding (`r`) triggers a full push-then-pull cycle.

## Motivation

Currently the TUI calls remote backends directly for every operation. This means:

- Every action blocks on network I/O
- The app is unusable without connectivity
- Latency varies depending on the remote API

With an offline-first approach, the TUI is always responsive. Network operations happen in the background, and the user gets immediate feedback on all actions.

## Architecture

### Data Flow

```
Before:  TUI -> RemoteBackend -> Remote API
After:   TUI -> LocalBackend -> .tic/items/
                SyncManager <-> RemoteBackend (background)
```

`LocalBackend` is the universal read/write layer for the TUI. The remote backend is the source of truth for data correctness — when conflicts arise, remote wins (after attempting to push local changes first).

When using pure `LocalBackend` (no remote), `SyncManager` is not instantiated. No behavior change from today.

### SyncManager

New class responsible for all sync logic.

```typescript
class SyncManager {
  constructor(local: LocalBackend, remote: Backend, queuePath: string)

  // Full sync: push pending local changes, then pull remote state
  sync(): Promise<SyncResult>

  // Push-only (kicked off after local writes)
  pushPending(): Promise<PushResult>

  // Current status for TUI observation
  getStatus(): SyncStatus

  // Subscribe to status changes for reactive TUI updates
  onStatusChange(cb: (status: SyncStatus) => void): void
}

type SyncStatus = {
  state: 'idle' | 'syncing' | 'error'
  pendingCount: number
  lastSyncTime: Date | null
  errors: SyncError[]
}
```

### Factory Changes

`createBackend()` changes from returning a single backend to returning a setup object:

```typescript
// Before:
const backend = await createBackend()

// After:
const { backend, syncManager } = await createBackend()
// backend is always LocalBackend
// syncManager is null when using pure local (no remote)
```

The app passes `syncManager` into the TUI via `AppContext` so components can read status and trigger syncs.

## Sync Queue

### Storage

A file at `.tic/sync-queue.json` tracks unpushed changes:

```json
{
  "pending": [
    { "action": "create", "itemId": "abc123", "timestamp": "2026-02-01T..." },
    { "action": "update", "itemId": "def456", "timestamp": "2026-02-01T..." },
    { "action": "delete", "itemId": "ghi789", "timestamp": "2026-02-01T..." }
  ]
}
```

Each write operation (`createItem`, `updateItem`, `deleteItem`, `addComment`) appends to the queue after writing to `LocalBackend`. Duplicate entries for the same item and action get collapsed — only the latest matters.

### Sync Cycle (Push Then Pull)

1. **Push phase:** Process the queue in order. For each entry, call the corresponding remote backend method. On success, remove the entry from the queue. On failure, leave it in the queue and log the error.
2. **Pull phase:** Call `remote.listItems()`, then overwrite local `.tic/items/` with remote state. Items that exist locally but not remotely (and aren't in the pending queue) get deleted locally.

## Temporary IDs

When creating an item offline, a temporary local ID with a `local-` prefix is assigned (e.g., `local-abc123`). The item is written to local storage and the create is queued.

When the push succeeds, the remote returns the real ID (e.g., a GitHub issue number). The local file is renamed to the real ID, and any references to the temp ID in other items (`parent`, `dependsOn`) are updated.

If the rename fails for any reason, the pull phase will bring the item back with the correct remote ID. The orphaned temp-ID file gets cleaned up during pull since it won't exist remotely.

## TUI Integration

### Startup Flow

1. App boots, checks if `.tic/items/` has any files
2. **First launch (empty):** Show "Syncing..." indicator, block until initial pull completes, then render the list
3. **Subsequent launches:** Render immediately from local data, kick off background sync

### Sync Status Indicator

A status widget in the TUI (bottom bar or top-right) showing:

- `Synced` — no pending changes, last sync succeeded
- `3 pending` — unpushed local changes queued
- `Syncing...` — sync in progress
- `Sync failed` — last push/pull had errors

### Keybinding

`r` triggers a full sync (push then pull). The list refreshes automatically when the pull completes.

### Write Operations

When the user creates/updates/deletes via the TUI:

1. Write to `LocalBackend` immediately
2. Append to sync queue
3. Kick off a background push (debounced)
4. Update status indicator

## Error Handling

### Push Failures

Network errors, auth failures, rate limits: item stays in queue, status shows sync failed. The queue retries on next sync (manual `r` or next app launch). No automatic retry loop to avoid hammering a down API.

### Pull Failures

If pull fails after a successful push, local data is stale but consistent. Status shows the error. Next sync will pull again.

### Partial Push Failures

Queue processes in order. If item 3 of 5 fails, items 1-2 are removed from queue, items 3-5 remain pending. Next sync retries from item 3.

### Concurrent Edits

User edits an item locally while a sync is in progress. The write goes to local + queue as normal. If the ongoing pull overwrites the edit, the queued change will push it back on next sync. Worst case: one extra sync cycle to converge.

### Deleted Remotely, Edited Locally

User edits item X locally. Remote sync reveals X was deleted by someone else. Push phase tries to update X remotely — fails (404). Pull phase removes X locally since it's not on remote. The local edit is lost. This matches "remote is always right."

### App Crashes Mid-Sync

Queue file is only modified after confirmed push success (entries removed one by one). Incomplete pull doesn't corrupt local data — worst case, some items are stale until next sync.

## Scope of Changes

### New files:

- `src/sync/SyncManager.ts` — sync logic, queue management, status
- `src/sync/SyncManager.test.ts` — unit and integration tests
- `src/sync/types.ts` — `SyncStatus`, `SyncResult`, `SyncError`, `QueueEntry` types

### Modified files:

- `src/backends/factory.ts` — return `{ backend, syncManager }` instead of single backend
- `src/app.tsx` — add `syncManager` to `AppContext`, handle first-launch blocking sync
- `src/components/WorkItemList.tsx` — add sync status indicator, `r` keybinding
- `src/components/WorkItemForm.tsx` — write to local + queue on save
- `src/cli/commands/` — CLI write commands also use local + queue pattern
- `src/cli/commands/mcp.ts` — MCP server write tools use local + queue pattern

### Unchanged:

- `Backend` interface — no modifications needed
- `LocalBackend` internals — already handles all read/write operations
- Remote backend implementations — still used as-is by `SyncManager`

## Testing Strategy

### Unit tests (SyncManager):

- Push phase processes queue in order, removes on success
- Pull phase overwrites local with remote state
- Temp ID rename and reference updates after create push
- Queue persistence (read/write `.tic/sync-queue.json`)
- Status change callbacks fire with correct states
- Duplicate queue entries collapsed

### Error scenario tests:

- Push failure leaves item in queue
- Partial push failure (some succeed, some fail)
- Pull failure after successful push preserves local state
- Network timeout handling
- Corrupt/missing queue file recovery (treat as empty queue)

### Integration tests:

- Full sync cycle with mock remote: write locally, push, pull, verify consistency
- First-launch blocking sync path
- Subsequent-launch background sync path
- Create with temp ID, push, rename, verify references updated

### Existing tests unaffected:

- `LocalBackend` read/write tests remain valid
- Remote backend API tests remain valid
- TUI component tests still apply (components still talk to `LocalBackend`)
