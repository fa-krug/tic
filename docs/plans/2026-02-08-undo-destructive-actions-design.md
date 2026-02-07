# Undo for Destructive Actions — Design

**Issue:** #16
**Date:** 2026-02-08

## Overview

Add an undo stack for destructive actions in the TUI. Press `u` to undo the most recent action. Covers delete, create, and update operations. Stack depth of 5, persists until app exit.

## Decisions

- **Soft delete** approach: deleted items move to `.tic/trash/` instead of being unlinked. Undo moves them back.
- **Whole-item snapshots**: before any mutation, capture the full `WorkItem`. Undo restores the snapshot.
- **Stack depth 5**: oldest entry gets permanently cleaned up when a 6th is pushed.
- **Toast shows most recent action only**: no stack depth indicator.
- **Undo keybinding in WorkItemList only**: `u` key, same level as other shortcuts.
- **Stack clears on app exit only**: persists across screen changes.
- **Sync queue integration**: undo cancels/reverses pending sync entries.

## Undo Store

New Zustand store at `src/stores/undoStore.ts`:

```typescript
type UndoActionType = 'delete' | 'create' | 'update';

interface UndoEntry {
  type: UndoActionType;
  label: string;              // e.g. "deleted #5", "created #12", "status change"
  itemSnapshots: WorkItem[];  // item state before the action
  syncEntriesToRemove: number; // count of sync queue entries to cancel
  createdIds?: string[];      // for undo-create: IDs to delete
}

interface UndoStoreState {
  stack: UndoEntry[];          // max depth 5, index 0 = most recent
  pushUndo: (entry: UndoEntry) => void;
  popUndo: () => UndoEntry | undefined;
  clear: () => void;
  destroy: () => void;
}
```

**Behaviors:**

- `pushUndo`: prepends to stack. If stack exceeds 5, pops oldest and runs cleanup (permanently delete trashed files for delete entries).
- `popUndo`: removes and returns the most recent entry.
- `clear`: flushes stack, runs cleanup on all remaining entries.
- `destroy`: calls `clear()`. Called on app exit.

## Soft Delete Mechanics

**Trash directory:** `.tic/trash/` — mirrors `.tic/items/` structure.

**New methods on `LocalBackend`:**

- `softDeleteWorkItem(id)`: moves `.tic/items/{id}.md` to `.tic/trash/{id}.md`
- `restoreWorkItem(id)`: moves `.tic/trash/{id}.md` back to `.tic/items/{id}.md`
- `permanentlyDeleteWorkItem(id)`: unlinks `.tic/trash/{id}.md`

Existing `deleteWorkItem` stays unchanged for CLI/MCP (no undo in those contexts).

**TUI delete flow changes from:**
1. `backend.cachedDeleteWorkItem(id)` — permanent

**To:**
1. Snapshot items via `backend.getWorkItem(id)`
2. `backend.softDeleteWorkItem(id)` — move to trash
3. `undoStore.pushUndo(...)` — capture snapshot
4. If entry pushed off stack → `backend.permanentlyDeleteWorkItem(id)`

**Startup cleanup:** On startup, if `.tic/trash/` has leftover files (from crash/force-quit), permanently delete them.

## Undo Execution

When user presses `u`, pop the top entry and reverse by type:

### Delete Undo
1. `backend.restoreWorkItem(id)` for each snapshot
2. Remove last N entries from sync queue
3. `refreshData()`
4. Toast: "Restored #5" or "Restored 3 items"

### Create Undo
1. `backend.softDeleteWorkItem(id)` then `backend.permanentlyDeleteWorkItem(id)` for each `createdIds` entry (no trash needed — undoing a create)
2. Remove sync queue entries
3. `refreshData()`
4. Toast: "Undid create #12"

### Update Undo
1. `backend.cachedUpdateWorkItem(id, snapshotData)` for each snapshot
2. Remove sync queue entries, then queue new updates for reverted state
3. `refreshData()`
4. Toast: "Undid status change" or "Undid update to 3 items"

**Guard:** If stack is empty and user presses `u`, do nothing.

## Integration Points

### 1. WorkItemList — Delete Confirmation (~line 1253)
- Before delete loop: snapshot all target items
- After delete loop: `pushUndo({ type: 'delete', label, itemSnapshots, syncEntriesToRemove })`

### 2. WorkItemList — Inline Pickers (status, priority, type, assignee, labels)
- Before update: snapshot item(s)
- After update: `pushUndo({ type: 'update', label, itemSnapshots, syncEntriesToRemove })`
- Bulk operations: one undo entry covers all affected items

### 3. WorkItemForm — Save Handler
- **Create:** after `cachedCreateWorkItem()` returns new ID: `pushUndo({ type: 'create', label, itemSnapshots: [], createdIds: [newId], syncEntriesToRemove: 1 })`
- **Edit:** before save: snapshot item. After save: `pushUndo({ type: 'update', label, itemSnapshots: [snapshot], syncEntriesToRemove: 1 })`

### 4. `u` Keybinding — WorkItemList `useInput`
- Registered alongside other single-key shortcuts
- Calls `popUndo()`, executes the reversal, shows toast

## Toast Messages

**After undoable action:**
- "Item #5 deleted — press u to undo"
- "3 items deleted — press u to undo"
- "Status updated — press u to undo"
- "Item #12 created — press u to undo"

**After pressing `u`:**
- "Restored #5"
- "Restored 3 items"
- "Undid create #12"
- "Undid status change"

Toast auto-clears after 3 seconds (existing behavior). The `u` keybinding reads from the undo stack, not the toast.

## Sync Queue Integration

- `syncEntriesToRemove` on each undo entry tracks how many sync queue entries to cancel.
- Works because undo entries are LIFO — most recent sync queue entries correspond to the most recent undo entry.
- New method on sync queue: `removeLastN(n: number)` to pop entries from the tail.
- For update undo: after removing old entries, queue new update entries for the reverted state.

## Edge Cases

**Stack overflow:** 6th action pops oldest. If oldest was a delete, permanently delete the trashed files.

**Undo after further modifications:** Works naturally. Each action snapshots current state. Pressing `u` repeatedly walks back through states correctly.

**Bulk operations:** One undo entry with multiple snapshots. One `u` press reverts all items in the batch.

**Form save + navigation:** Undo entry pushed before navigation back to list. `u` works immediately on list screen.

**App exit:** `undoStore.destroy()` permanently deletes all remaining trashed files and clears the stack.

**Crash recovery:** On startup, wipe any files in `.tic/trash/`.

## Files to Create/Modify

**New:**
- `src/stores/undoStore.ts` — undo store
- `src/stores/undoStore.test.ts` — store tests

**Modify:**
- `src/backends/local/items.ts` — add `softDeleteWorkItem`, `restoreWorkItem`, `permanentlyDeleteWorkItem`
- `src/backends/types.ts` — add soft delete methods to interface (or just on LocalBackend)
- `src/sync/queue.ts` — add `removeLastN` method
- `src/components/WorkItemList.tsx` — wire up undo push on delete/update, add `u` handler
- `src/components/WorkItemForm.tsx` — wire up undo push on create/edit save
- `src/app.tsx` — call `undoStore.destroy()` on exit
- `src/index.tsx` — startup trash cleanup
