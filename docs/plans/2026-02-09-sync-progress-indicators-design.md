# Sync Progress Indicators Design

**Issue:** #15 — Add sync progress indicators
**Date:** 2026-02-09

## Problem

Sync operations show a spinner but no progress information. Users don't know how long sync will take or how many items remain. There's no per-item feedback during push, no visibility into pull results, and no history of what was synced.

## Solution

Add live progress counts to the header during sync and a scrollable sync log to the StatusScreen.

### Header Progress

- **Push in progress:** `↑ 3/12` — live counter incrementing as each item is pushed
- **Pull in progress:** `↓ fetching...` — spinner only, since pull is a single `listItems()` call
- **Both complete:** `↑ 12/12 ↓ 20` — briefly shows both results while sync finalizes
- **Idle/pending/error:** unchanged from current behavior

### StatusScreen Sync Log

A scrollable log of recent sync operations (last 50 entries, FIFO):

```
── Sync Log ──────────────────────────────────────────────
  ✓ pushed   created  #15  "Add sync progress"    12:04:32
  ✓ pushed   updated  #8   "Fix login bug"        12:04:33
  ✗ pushed   update   #3   "Timeout"              12:04:35
  ✓ pulled   20 items                              12:04:36
  ✓ pushed   created  #22  "New feature"           12:08:01
```

- Green `✓` for success, red `✗` for errors
- Shows action type, item ID, truncated title (or error message for failures)
- Timestamp per entry
- History persists across syncs within the session (in-memory only, resets on app restart)

## Types

New types in `src/sync/types.ts`:

```typescript
interface SyncProgress {
  phase: 'push' | 'pull';
  current: number;
  total: number;
}

interface SyncLogEntry {
  phase: 'push' | 'pull';
  action: QueueEntry['action'];
  itemId: string;
  result: 'success' | 'error';
  message?: string;
  timestamp: string;
}
```

Extended `SyncStatus`:

```typescript
interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  pendingCount: number;
  lastSyncTime: Date | null;
  errors: SyncError[];
  progress: SyncProgress | null;   // null when idle
  syncLog: SyncLogEntry[];          // capped at 50, FIFO
}
```

## SyncManager Changes

In `pushPending()`:
1. Read queue length upfront as `total`
2. After each `pushEntry()` call, increment `current` and call `updateStatus()` with updated `progress` and a new `syncLog` entry
3. On completion, set `progress` to null

In `pull()`:
1. After items are fetched and written to local storage, append a single log entry: `{ phase: 'pull', action: 'update', itemId: '', result: 'success', message: '20 items' }`
2. No incremental progress for pull — it's a single fetch operation

Log management:
- Append new entries to `syncLog` array
- When length exceeds 50, drop oldest entries

Progress and log flow through the existing `onStatusChange` listener pipeline into `backendDataStore.syncStatus`, requiring no new store plumbing.

## Files Changed

| File | Change |
|------|--------|
| `src/sync/types.ts` | Add `SyncProgress`, `SyncLogEntry`; extend `SyncStatus` |
| `src/sync/SyncManager.ts` | Emit progress during push loop, append log entries, cap at 50 |
| `src/components/Header.tsx` | Read `progress`, show `↑ 3/12` / `↓ 20` |
| `src/components/StatusScreen.tsx` | Render scrollable sync log section |

## Files Unchanged

- `src/stores/backendDataStore.ts` — already subscribes to `onStatusChange`, picks up new fields
- `src/sync/queue.ts` — no changes
- CLI/MCP — don't display progress

## Testing

- SyncManager unit tests: progress events fire with correct `current/total` during push, log entries appended per item
- Log FIFO: 51st entry drops the 1st
- Existing sync tests pass unchanged (additive fields only)

## Out of Scope

- Persisted log (resets on app restart)
- Incremental pull progress
- Configurable log size
