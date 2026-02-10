# Sync Progress Indicators Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add live push progress counts to the header and a scrollable sync log to the StatusScreen.

**Architecture:** Extend `SyncStatus` with `progress` and `syncLog` fields. SyncManager emits per-item progress during push and appends log entries. Existing `onStatusChange` pipeline carries data to the UI via `backendDataStore` with no new plumbing. Header reads `progress` for live counts; StatusScreen renders `syncLog` as a scrollable list.

**Tech Stack:** TypeScript, React/Ink, Vitest

**Design doc:** `docs/plans/2026-02-09-sync-progress-indicators-design.md`

---

### Task 1: Add new types to `src/sync/types.ts`

**Files:**
- Modify: `src/sync/types.ts`
- Test: `src/sync/types.test.ts` (existing — verify no breakage)

**Step 1: Add `SyncProgress` and `SyncLogEntry` interfaces**

Add after `SyncError` (line 28) and before `SyncStatus` (line 30):

```typescript
export interface SyncProgress {
  phase: 'push' | 'pull';
  current: number;
  total: number;
}

export interface SyncLogEntry {
  phase: 'push' | 'pull';
  action: QueueAction;
  itemId: string;
  result: 'success' | 'error';
  message?: string;
  timestamp: string;
}
```

**Step 2: Extend `SyncStatus` with two new fields**

Add to the `SyncStatus` interface (after `errors` on line 34):

```typescript
  progress: SyncProgress | null;
  syncLog: SyncLogEntry[];
```

**Step 3: Run existing type tests to verify no breakage**

Run: `npx vitest run src/sync/types.test.ts`
Expected: PASS

**Step 4: Run full build to verify type compatibility**

Run: `npx tsc --noEmit`
Expected: Compilation errors in SyncManager.ts and tests where `SyncStatus` objects are constructed without the new fields. That's expected — we fix those in subsequent tasks.

**Step 5: Commit**

```
feat(sync): add SyncProgress and SyncLogEntry types
```

---

### Task 2: Update SyncManager to emit progress and log entries

**Files:**
- Modify: `src/sync/SyncManager.ts`

**Step 1: Add a `syncLog` array and helper to the SyncManager class**

Add a private field after `private listeners` (line 28):

```typescript
private syncLog: SyncLogEntry[] = [];
```

Add a private helper method after `updateStatus()`:

```typescript
private appendLog(entry: SyncLogEntry): void {
  this.syncLog.push(entry);
  if (this.syncLog.length > 50) {
    this.syncLog = this.syncLog.slice(-50);
  }
}
```

**Step 2: Update initial status to include new fields**

In the constructor (line 34-39), add the new fields:

```typescript
this.status = {
  state: 'idle',
  pendingCount: 0,
  lastSyncTime: null,
  errors: [],
  progress: null,
  syncLog: [],
};
```

**Step 3: Update `pushPending()` to emit per-item progress**

In `pushPending()` (line 57-97):

After reading the queue (line 59), capture total:

```typescript
const total = pending.length;
let current = 0;
```

Inside the for loop, after the try/catch block for each entry (after the `pushed++` on line 71, and after the error handling closing brace on line 87), add progress updates. The revised loop body:

```typescript
for (const entry of pending) {
  current++;
  this.updateStatus({
    state: 'syncing',
    progress: { phase: 'push', current, total },
    syncLog: [...this.syncLog],
  });

  try {
    const resolvedId = await this.pushEntry(entry);
    await this.queue.remove(resolvedId, entry.action);
    if (resolvedId !== entry.itemId) {
      idMappings.set(entry.itemId, resolvedId);
    }
    pushed++;
    this.appendLog({
      phase: 'push',
      action: entry.action,
      itemId: entry.itemId,
      result: 'success',
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    const isLocalMissing =
      e instanceof Error &&
      'code' in e &&
      (e as NodeJS.ErrnoException).code === 'ENOENT';
    if (isLocalMissing) {
      await this.queue.remove(entry.itemId, entry.action);
    } else {
      errors.push({
        entry,
        message: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      });
      this.appendLog({
        phase: 'push',
        action: entry.action,
        itemId: entry.itemId,
        result: 'error',
        message: e instanceof Error ? e.message : String(e),
        timestamp: new Date().toISOString(),
      });
    }
  }
}
```

Update the final `updateStatus` call at the end of `pushPending()` (line 90-94) to clear progress and include log:

```typescript
this.updateStatus({
  state: errors.length > 0 ? 'error' : 'idle',
  pendingCount: (await this.queue.read()).pending.length,
  errors,
  progress: null,
  syncLog: [...this.syncLog],
});
```

**Step 4: Update `pull()` to append a log entry**

At the end of `pull()`, before the `return remoteItems.length` (line 313), add:

```typescript
this.appendLog({
  phase: 'pull',
  action: 'update',
  itemId: '',
  result: 'success',
  message: `${remoteItems.length} items`,
  timestamp: new Date().toISOString(),
});
```

**Step 5: Update `sync()` to include syncLog in final status**

In `sync()` (line 249-253), add `syncLog` and clear `progress`:

```typescript
this.updateStatus({
  state: push.errors.length > 0 ? 'error' : 'idle',
  pendingCount: (await this.queue.read()).pending.length,
  lastSyncTime: new Date(),
  progress: null,
  syncLog: [...this.syncLog],
});
```

**Step 6: Add import for new types**

Update the import from `./types.js` (line 4-10) to include `SyncLogEntry`:

```typescript
import type {
  QueueEntry,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
  SyncLogEntry,
} from './types.js';
```

**Step 7: Run build to verify compilation**

Run: `npx tsc --noEmit`
Expected: Errors only in test files that construct SyncStatus without new fields. Core code should compile.

**Step 8: Commit**

```
feat(sync): emit per-item progress and sync log from SyncManager
```

---

### Task 3: Fix existing tests and add progress/log tests

**Files:**
- Modify: `src/sync/SyncManager.test.ts`

**Step 1: Run existing tests to see what breaks**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: Tests should still pass since they check specific fields and don't construct `SyncStatus` objects directly. If any fail, they'll need the new fields added.

**Step 2: Add test for push progress events**

Add a new describe block after the existing "SyncManager status callbacks" block (after line 723):

```typescript
describe('SyncManager progress reporting', () => {
  let tmpDir: string;
  let local: LocalBackend;
  let queueStore: SyncQueueStore;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    local = await LocalBackend.create(tmpDir);
    queueStore = new SyncQueueStore(tmpDir);
  });

  afterEach(() => {
    configStore.getState().destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('emits push progress with correct current/total', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    // Queue two deletes (don't need local items)
    await queueStore.append({ action: 'delete', itemId: 'a', timestamp: new Date().toISOString() });
    await queueStore.append({ action: 'delete', itemId: 'b', timestamp: new Date().toISOString() });

    const progressUpdates: { current: number; total: number }[] = [];
    manager.onStatusChange((status) => {
      if (status.progress?.phase === 'push') {
        progressUpdates.push({ current: status.progress.current, total: status.progress.total });
      }
    });

    await manager.pushPending();
    expect(progressUpdates).toEqual([
      { current: 1, total: 2 },
      { current: 2, total: 2 },
    ]);
  });

  it('clears progress to null after push completes', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    await queueStore.append({ action: 'delete', itemId: 'x', timestamp: new Date().toISOString() });
    await manager.pushPending();
    expect(manager.getStatus().progress).toBeNull();
  });

  it('appends success entries to syncLog during push', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    await queueStore.append({ action: 'delete', itemId: 'a', timestamp: new Date().toISOString() });
    await queueStore.append({ action: 'delete', itemId: 'b', timestamp: new Date().toISOString() });
    await manager.pushPending();

    const log = manager.getStatus().syncLog;
    expect(log).toHaveLength(2);
    expect(log[0]!.action).toBe('delete');
    expect(log[0]!.itemId).toBe('a');
    expect(log[0]!.result).toBe('success');
    expect(log[1]!.itemId).toBe('b');
  });

  it('appends error entries to syncLog on push failure', async () => {
    const remote = createMockRemote();
    // eslint-disable-next-line @typescript-eslint/require-await
    remote.updateWorkItem = async () => { throw new Error('Network error'); };
    const manager = new SyncManager(local, remote, queueStore);

    await local.createWorkItem({
      title: 'Fail', type: 'task', status: 'backlog', priority: 'medium',
      assignee: '', labels: [], iteration: 'default', description: '',
      parent: null, dependsOn: [],
    });

    await queueStore.append({ action: 'update', itemId: '1', timestamp: new Date().toISOString() });
    await manager.pushPending();

    const log = manager.getStatus().syncLog;
    expect(log).toHaveLength(1);
    expect(log[0]!.result).toBe('error');
    expect(log[0]!.message).toBe('Network error');
  });

  it('appends pull log entry during sync', async () => {
    const remoteItem: WorkItem = {
      id: '10', title: 'Remote', type: 'task', status: 'todo',
      iteration: 'default', priority: 'medium', assignee: '', labels: [],
      created: '2026-01-01T00:00:00Z', updated: '2026-01-01T00:00:00Z',
      description: '', comments: [], parent: null, dependsOn: [],
    };
    const remote = createMockRemote([remoteItem]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    const log = manager.getStatus().syncLog;
    const pullEntry = log.find((e) => e.phase === 'pull');
    expect(pullEntry).toBeDefined();
    expect(pullEntry!.message).toBe('1 items');
  });

  it('caps syncLog at 50 entries (FIFO)', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    // Push 55 deletes (one at a time to avoid queue dedup)
    for (let i = 0; i < 55; i++) {
      await queueStore.append({ action: 'delete', itemId: `item-${i}`, timestamp: new Date().toISOString() });
    }
    await manager.pushPending();

    const log = manager.getStatus().syncLog;
    expect(log).toHaveLength(50);
    // Oldest entries should be dropped — first entry should be item-5
    expect(log[0]!.itemId).toBe('item-5');
    expect(log[49]!.itemId).toBe('item-54');
  });
});
```

**Step 3: Run all sync tests**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: All tests PASS (existing + new)

**Step 4: Commit**

```
test(sync): add progress reporting and sync log tests
```

---

### Task 4: Update Header to show push progress

**Files:**
- Modify: `src/components/Header.tsx`

**Step 1: Update `getStatusDisplay` to handle progress**

Replace the `syncStatus` parameter type (line 30-34) and the syncing case (line 42-43):

The `syncStatus` parameter type becomes:

```typescript
syncStatus: {
  state: string;
  pendingCount: number;
  errors: { message: string }[];
  progress: { phase: string; current: number; total: number } | null;
} | null,
```

Replace the syncing case (line 42-43):

```typescript
if (syncStatus?.state === 'syncing') {
  if (syncStatus.progress?.phase === 'push') {
    return { showSpinner: true, text: `↑ ${syncStatus.progress.current}/${syncStatus.progress.total}` };
  }
  return { showSpinner: true, text: 'Syncing...' };
}
```

**Step 2: Show pull count briefly after sync**

After the error case (line 45-50) and before the pending case (line 51), add:

This is tricky — the pull count is in the syncLog, not in progress. The simplest approach: check if the last syncLog entry is a pull, and show it alongside the idle state briefly. However, this adds complexity for marginal value. **Skip this** — the pull count shows in the StatusScreen log. Keep the header simple.

**Step 3: Run build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```
feat(header): show live push progress counts during sync
```

---

### Task 5: Update StatusScreen to show sync log

**Files:**
- Modify: `src/components/StatusScreen.tsx`

**Step 1: Update the scrollable area to show syncLog instead of only errors**

The StatusScreen currently scrolls only errors. We'll add a Sync Log section that shows `syncLog` entries from `syncStatus`. The error section stays as-is for expanded error detail.

After the existing sync status lines (after line 185, the "Last sync" text), add the sync log section:

```tsx
{syncStatus.syncLog.length > 0 && (
  <Box marginTop={1} flexDirection="column">
    <Text bold>Sync Log:</Text>
    {visibleLogEntries.map((entry, idx) => (
      <Box key={logScrollOffset + idx} marginLeft={2}>
        <Text color={entry.result === 'success' ? 'green' : 'red'}>
          {entry.result === 'success' ? '✓' : '✗'}
        </Text>
        <Text>
          {' '}
          {entry.phase === 'pull'
            ? `pulled ${entry.message ?? ''}`
            : `${entry.action} #${entry.itemId}`}
          {entry.result === 'error' && entry.message
            ? ` — ${entry.message}`
            : ''}
        </Text>
        <Text dimColor> {new Date(entry.timestamp).toLocaleTimeString()}</Text>
      </Box>
    ))}
    {syncStatus.syncLog.length > logViewport.maxVisible && (
      <Text dimColor>
        {' '}
        ↑↓ scroll ({logScrollOffset + 1}-
        {Math.min(logScrollOffset + logViewport.maxVisible, syncStatus.syncLog.length)}{' '}
        of {syncStatus.syncLog.length})
      </Text>
    )}
  </Box>
)}
```

**Step 2: Add scroll state and viewport for the log**

The StatusScreen already has scroll state for errors. We need to decide: share scroll state between errors and log, or have separate scroll. Since the log replaces errors as the primary scrollable content, **repurpose the existing scroll** to scroll the log instead. Errors still show in the existing section but the log is the main scrollable list.

Add a separate `logScrollOffset` state and viewport, similar to the existing error scroll. Use `useScrollViewport` with `syncStatus.syncLog.length` as `totalItems`.

Alternatively, keep it simpler: use the **existing** `scrollOffset` for the log (since the log subsumes the error list — errors appear as red entries in the log). Update `fixedLines` to account for the log section.

The simplest approach: add state for log scrolling near the existing scroll state:

```typescript
const syncLog = syncStatus?.syncLog ?? [];
const [logScrollOffset, setLogScrollOffset] = useState(0);
const logFixedLines = syncManager ? 27 : 17; // account for log header
const logViewport = useScrollViewport({
  totalItems: syncLog.length,
  cursor: logScrollOffset,
  chromeLines: logFixedLines,
  linesPerItem: 1,
});
const maxLogScroll = Math.max(0, syncLog.length - logViewport.maxVisible);
```

Update the `useInput` up/down handlers to scroll the log:

```typescript
if (key.upArrow) {
  setLogScrollOffset((o) => Math.max(0, o - 1));
}
if (key.downArrow) {
  setLogScrollOffset((o) => Math.min(maxLogScroll, o + 1));
}
```

Compute `visibleLogEntries`:

```typescript
const visibleLogEntries = syncLog.slice(
  logScrollOffset,
  logScrollOffset + logViewport.maxVisible,
);
```

**Step 3: Run build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 5: Commit**

```
feat(status): add scrollable sync log to StatusScreen
```

---

### Task 6: Final verification and formatting

**Files:** None (verification only)

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run lint**

Run: `npm run lint`

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 4: Run build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit any formatting fixes**

```
style: format sync progress indicator changes
```

**Step 6: Manual smoke test**

Run `npm start` in a project with a remote backend configured. Verify:
- Header shows `↑ N/M` during push
- Header shows `↓ fetching...` then returns to idle
- StatusScreen (`S`) shows sync log entries with ✓/✗, action, ID, timestamps
- Scrolling works in the log
- Existing error display still works
