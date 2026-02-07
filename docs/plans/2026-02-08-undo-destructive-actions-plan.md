# Undo for Destructive Actions Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an undo stack (depth 5) for delete, create, and update actions in the TUI, with soft-delete for reversible deletes and whole-item snapshots for reversible updates.

**Architecture:** New `undoStore` holds a stack of `UndoEntry` objects. Delete uses soft-delete (move to `.tic/trash/`). Create/update store snapshots in memory. The `u` keybinding in WorkItemList pops the stack and reverses the action. Sync queue entries are cancelled on undo via a new `removeByIds` method.

**Tech Stack:** TypeScript, Zustand (vanilla store), Node fs operations

---

### Task 1: Add `removeByIds` to SyncQueueStore

**Files:**
- Modify: `src/sync/queue.ts:39-45`
- Test: `src/sync/queue.test.ts`

**Step 1: Write the failing test**

In `src/sync/queue.test.ts`, add a test for the new method:

```typescript
it('removeByIds removes entries matching item IDs and action', async () => {
  await store.append({ action: 'update', itemId: 'a', timestamp: '1' });
  await store.append({ action: 'update', itemId: 'b', timestamp: '2' });
  await store.append({ action: 'delete', itemId: 'c', timestamp: '3' });
  await store.append({ action: 'update', itemId: 'd', timestamp: '4' });

  await store.removeByIds(['b', 'd'], 'update');

  const queue = await store.read();
  expect(queue.pending).toHaveLength(2);
  expect(queue.pending.map((e) => e.itemId)).toEqual(['a', 'c']);
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/queue.test.ts`
Expected: FAIL — `removeByIds` does not exist

**Step 3: Implement `removeByIds`**

In `src/sync/queue.ts`, add after the `remove` method (line 45):

```typescript
async removeByIds(itemIds: string[], action: QueueAction): Promise<void> {
  const queue = await this.read();
  const idSet = new Set(itemIds);
  queue.pending = queue.pending.filter(
    (e) => !(idSet.has(e.itemId) && e.action === action),
  );
  await this.write(queue);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/queue.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/sync/queue.ts src/sync/queue.test.ts
git commit -m "feat(sync): add removeByIds to SyncQueueStore"
```

---

### Task 2: Add soft-delete and restore to local backend

**Files:**
- Modify: `src/backends/local/items.ts:6-12,140-146`
- Test: `src/backends/local/items.test.ts`

**Step 1: Write the failing tests**

Add tests for `softDeleteWorkItem`, `restoreWorkItem`, and `permanentlyDeleteWorkItem`:

```typescript
describe('soft delete', () => {
  it('softDeleteWorkItem moves item to trash', async () => {
    const item = makeItem({ id: 'soft1' });
    await writeWorkItem(root, item);
    await softDeleteWorkItem(root, 'soft1');

    // Item should not be in items dir
    await expect(readWorkItem(root, 'soft1')).rejects.toThrow();
    // Item should be in trash dir
    const trashPath = path.join(root, '.tic', 'trash', 'soft1.md');
    const stat = await fs.stat(trashPath);
    expect(stat.isFile()).toBe(true);
  });

  it('restoreWorkItem moves item back from trash', async () => {
    const item = makeItem({ id: 'rest1' });
    await writeWorkItem(root, item);
    await softDeleteWorkItem(root, 'rest1');
    await restoreWorkItem(root, 'rest1');

    const restored = await readWorkItem(root, 'rest1');
    expect(restored.id).toBe('rest1');
    expect(restored.title).toBe(item.title);
  });

  it('permanentlyDeleteWorkItem removes from trash', async () => {
    const item = makeItem({ id: 'perm1' });
    await writeWorkItem(root, item);
    await softDeleteWorkItem(root, 'perm1');
    await permanentlyDeleteWorkItem(root, 'perm1');

    const trashPath = path.join(root, '.tic', 'trash', 'perm1.md');
    await expect(fs.stat(trashPath)).rejects.toThrow();
  });

  it('cleanupTrash removes all files in trash dir', async () => {
    const item1 = makeItem({ id: 'tr1' });
    const item2 = makeItem({ id: 'tr2' });
    await writeWorkItem(root, item1);
    await writeWorkItem(root, item2);
    await softDeleteWorkItem(root, 'tr1');
    await softDeleteWorkItem(root, 'tr2');
    await cleanupTrash(root);

    const trashDir = path.join(root, '.tic', 'trash');
    await expect(fs.readdir(trashDir)).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/items.test.ts`
Expected: FAIL — functions don't exist

**Step 3: Implement soft-delete functions**

In `src/backends/local/items.ts`, add a `trashDir` and `trashPath` helper near lines 6-12:

```typescript
function trashDir(root: string): string {
  return path.join(root, '.tic', 'trash');
}

function trashPath(root: string, id: string): string {
  return path.join(trashDir(root), `${id}.md`);
}
```

Then add after `deleteWorkItem` (after line 146):

```typescript
export async function softDeleteWorkItem(
  root: string,
  id: string,
): Promise<void> {
  const src = itemPath(root, id);
  const dest = trashPath(root, id);
  await fs.mkdir(trashDir(root), { recursive: true });
  await fs.rename(src, dest);
}

export async function restoreWorkItem(
  root: string,
  id: string,
): Promise<void> {
  const src = trashPath(root, id);
  const dest = itemPath(root, id);
  await fs.mkdir(itemsDir(root), { recursive: true });
  await fs.rename(src, dest);
}

export async function permanentlyDeleteWorkItem(
  root: string,
  id: string,
): Promise<void> {
  try {
    await fs.unlink(trashPath(root, id));
  } catch {
    // Already gone
  }
}

export async function cleanupTrash(root: string): Promise<void> {
  try {
    await fs.rm(trashDir(root), { recursive: true, force: true });
  } catch {
    // No trash dir
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/items.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/items.ts src/backends/local/items.test.ts
git commit -m "feat(local): add soft-delete, restore, and trash cleanup"
```

---

### Task 3: Expose soft-delete on LocalBackend class

**Files:**
- Modify: `src/backends/local/index.ts`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write the failing tests**

Add tests for `softDeleteWorkItem`, `restoreWorkItem`, `permanentlyDeleteWorkItem`, and `cleanupTrash` on the `LocalBackend` class:

```typescript
describe('soft delete', () => {
  it('softDeleteWorkItem + restoreWorkItem round-trips', async () => {
    const item = await backend.createWorkItem({
      title: 'Soft test',
      status: 'todo',
      type: 'issue',
    });
    await backend.softDeleteWorkItem(item.id);
    await expect(backend.getWorkItem(item.id)).rejects.toThrow();

    await backend.restoreWorkItem(item.id);
    const restored = await backend.getWorkItem(item.id);
    expect(restored.title).toBe('Soft test');
  });

  it('permanentlyDeleteWorkItem removes from trash', async () => {
    const item = await backend.createWorkItem({
      title: 'Perm test',
      status: 'todo',
      type: 'issue',
    });
    await backend.softDeleteWorkItem(item.id);
    await backend.permanentlyDeleteWorkItem(item.id);
    // Restore should fail
    await expect(backend.restoreWorkItem(item.id)).rejects.toThrow();
  });

  it('cleanupTrash removes all trashed items', async () => {
    const item1 = await backend.createWorkItem({ title: 'T1', status: 'todo', type: 'issue' });
    const item2 = await backend.createWorkItem({ title: 'T2', status: 'todo', type: 'issue' });
    await backend.softDeleteWorkItem(item1.id);
    await backend.softDeleteWorkItem(item2.id);
    await backend.cleanupTrash();
    await expect(backend.restoreWorkItem(item1.id)).rejects.toThrow();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — methods don't exist on LocalBackend

**Step 3: Implement on LocalBackend**

In `src/backends/local/index.ts`, import the new functions and add methods:

```typescript
import {
  // ...existing imports...
  softDeleteWorkItem,
  restoreWorkItem,
  permanentlyDeleteWorkItem,
  cleanupTrash,
} from './items.js';
```

Add methods on the `LocalBackend` class:

```typescript
async softDeleteWorkItem(id: string): Promise<void> {
  await softDeleteWorkItem(this.root, id);
  this.invalidateCache();
}

async restoreWorkItem(id: string): Promise<void> {
  await restoreWorkItem(this.root, id);
  this.invalidateCache();
}

async permanentlyDeleteWorkItem(id: string): Promise<void> {
  await permanentlyDeleteWorkItem(this.root, id);
}

async cleanupTrash(): Promise<void> {
  await cleanupTrash(this.root);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat(local): expose soft-delete methods on LocalBackend"
```

---

### Task 4: Create undoStore

**Files:**
- Create: `src/stores/undoStore.ts`
- Create: `src/stores/undoStore.test.ts`

**Step 1: Write the failing tests**

Create `src/stores/undoStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { undoStore } from './undoStore.js';
import type { WorkItem } from '../types.js';

const makeSnapshot = (id: string): WorkItem => ({
  id,
  title: `Item ${id}`,
  type: 'issue',
  status: 'todo',
  iteration: '',
  priority: 'medium',
  assignee: '',
  labels: [],
  created: '2026-01-01',
  updated: '2026-01-01',
  parent: null,
  dependsOn: [],
  description: '',
  comments: [],
});

describe('undoStore', () => {
  beforeEach(() => {
    undoStore.getState().clear();
  });

  it('starts with empty stack', () => {
    expect(undoStore.getState().stack).toEqual([]);
  });

  it('pushUndo adds to front of stack', () => {
    undoStore.getState().pushUndo({
      type: 'delete',
      label: 'deleted #1',
      itemSnapshots: [makeSnapshot('1')],
      syncItemIds: ['1'],
      syncAction: 'delete',
    });
    undoStore.getState().pushUndo({
      type: 'update',
      label: 'status change',
      itemSnapshots: [makeSnapshot('2')],
      syncItemIds: ['2'],
      syncAction: 'update',
    });

    const { stack } = undoStore.getState();
    expect(stack).toHaveLength(2);
    expect(stack[0]!.label).toBe('status change');
    expect(stack[1]!.label).toBe('deleted #1');
  });

  it('popUndo returns most recent and removes it', () => {
    undoStore.getState().pushUndo({
      type: 'delete',
      label: 'deleted #1',
      itemSnapshots: [makeSnapshot('1')],
      syncItemIds: ['1'],
      syncAction: 'delete',
    });
    undoStore.getState().pushUndo({
      type: 'update',
      label: 'status change',
      itemSnapshots: [makeSnapshot('2')],
      syncItemIds: ['2'],
      syncAction: 'update',
    });

    const entry = undoStore.getState().popUndo();
    expect(entry?.label).toBe('status change');
    expect(undoStore.getState().stack).toHaveLength(1);
  });

  it('popUndo returns undefined when stack is empty', () => {
    expect(undoStore.getState().popUndo()).toBeUndefined();
  });

  it('enforces max depth of 5, returns evicted entry', () => {
    for (let i = 0; i < 5; i++) {
      undoStore.getState().pushUndo({
        type: 'update',
        label: `update #${i}`,
        itemSnapshots: [makeSnapshot(String(i))],
        syncItemIds: [String(i)],
        syncAction: 'update',
      });
    }
    expect(undoStore.getState().stack).toHaveLength(5);

    const evicted = undoStore.getState().pushUndo({
      type: 'update',
      label: 'update #5',
      itemSnapshots: [makeSnapshot('5')],
      syncItemIds: ['5'],
      syncAction: 'update',
    });

    expect(undoStore.getState().stack).toHaveLength(5);
    expect(undoStore.getState().stack[0]!.label).toBe('update #5');
    expect(evicted?.label).toBe('update #0');
  });

  it('clear empties the stack and returns all entries', () => {
    undoStore.getState().pushUndo({
      type: 'delete',
      label: 'deleted #1',
      itemSnapshots: [makeSnapshot('1')],
      syncItemIds: ['1'],
      syncAction: 'delete',
    });
    const cleared = undoStore.getState().clear();
    expect(undoStore.getState().stack).toEqual([]);
    expect(cleared).toHaveLength(1);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/undoStore.test.ts`
Expected: FAIL — module doesn't exist

**Step 3: Implement undoStore**

Create `src/stores/undoStore.ts`:

```typescript
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { WorkItem } from '../types.js';
import type { QueueAction } from '../sync/types.js';

export type UndoActionType = 'delete' | 'create' | 'update';

export interface UndoEntry {
  type: UndoActionType;
  label: string;
  itemSnapshots: WorkItem[];
  syncItemIds: string[];
  syncAction: QueueAction;
  createdIds?: string[];
}

const MAX_DEPTH = 5;

export interface UndoStoreState {
  stack: UndoEntry[];
  pushUndo: (entry: UndoEntry) => UndoEntry | undefined;
  popUndo: () => UndoEntry | undefined;
  clear: () => UndoEntry[];
}

export const undoStore = createStore<UndoStoreState>((set, get) => ({
  stack: [],

  pushUndo: (entry) => {
    const prev = get().stack;
    const next = [entry, ...prev];
    let evicted: UndoEntry | undefined;
    if (next.length > MAX_DEPTH) {
      evicted = next.pop();
    }
    set({ stack: next });
    return evicted;
  },

  popUndo: () => {
    const prev = get().stack;
    if (prev.length === 0) return undefined;
    const [first, ...rest] = prev;
    set({ stack: rest });
    return first;
  },

  clear: () => {
    const prev = get().stack;
    set({ stack: [] });
    return prev;
  },
}));

export function useUndoStore<T>(selector: (state: UndoStoreState) => T): T {
  return useStore(undoStore, selector);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/undoStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/undoStore.ts src/stores/undoStore.test.ts
git commit -m "feat(undo): create undoStore with stack, push, pop, clear"
```

---

### Task 5: Wire up undo for delete in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:1260-1280` (delete handler)
- Modify: `src/components/WorkItemList.tsx:197-206` (needs queueStore reference for undo)

**Step 1: Import undoStore and soft-delete**

At the top of `WorkItemList.tsx`, add imports:

```typescript
import { undoStore } from '../stores/undoStore.js';
```

**Step 2: Modify the delete confirmation handler**

Replace the delete handler at lines 1260-1280. The key changes are:
1. Snapshot items from `allItems` before delete
2. Use `softDeleteWorkItem` on LocalBackend (check via instanceof or duck-type)
3. Push to undo stack
4. Handle evicted entries by permanently deleting their trash files
5. Update toast to include undo hint

```typescript
onSelect={(item) => {
  if (item.value === 'yes') {
    const targetIds = activeOverlay.targetIds;
    if (!backend) return;
    void (async () => {
      // Snapshot items before delete
      const snapshots = targetIds
        .map((id) => allItems.find((i) => i.id === id))
        .filter((i): i is WorkItem => i !== undefined);

      for (const id of targetIds) {
        if ('softDeleteWorkItem' in backend) {
          await (backend as any).softDeleteWorkItem(id);
        } else {
          await backend.cachedDeleteWorkItem(id);
        }
        await queueWrite('delete', id);
      }

      // Push to undo stack
      const evicted = undoStore.getState().pushUndo({
        type: 'delete',
        label:
          targetIds.length === 1
            ? `deleted #${targetIds[0]}`
            : `deleted ${targetIds.length} items`,
        itemSnapshots: snapshots,
        syncItemIds: targetIds,
        syncAction: 'delete',
      });

      // Clean up evicted entry's trash files
      if (evicted?.type === 'delete' && 'permanentlyDeleteWorkItem' in backend) {
        for (const snap of evicted.itemSnapshots) {
          await (backend as any).permanentlyDeleteWorkItem(snap.id);
        }
      }

      closeOverlay();
      for (const id of targetIds) {
        removeDeletedItem(id);
      }
      setCursor(Math.max(0, cursor - 1));
      refreshData();
      setToast(
        targetIds.length === 1
          ? `Item #${targetIds[0]} deleted — press u to undo`
          : `${targetIds.length} items deleted — press u to undo`,
      );
    })();
  } else {
    closeOverlay();
  }
}}
```

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(undo): wire soft-delete and undo stack for delete action"
```

---

### Task 6: Wire up undo for inline updates in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:974-991` (status picker)
- Modify: `src/components/WorkItemList.tsx:1003-1020` (type picker)
- Modify: `src/components/WorkItemList.tsx:1033-1053` (priority picker)
- Modify: `src/components/WorkItemList.tsx:1091-1117,1119-1148` (parent input — both onSelect and onSubmitFreeform)
- Modify: `src/components/WorkItemList.tsx:1159-1176,1178-1195` (assignee input — both handlers)
- Modify: `src/components/WorkItemList.tsx:1211-1227,1229-1248` (labels input — both handlers)

**Step 1: Create a helper function for snapshotting + undo push**

Add near the `queueWrite` helper (around line 206) in `WorkItemList.tsx`:

```typescript
const pushUpdateUndo = (targetIds: string[], label: string) => {
  const snapshots = targetIds
    .map((id) => allItems.find((i) => i.id === id))
    .filter((i): i is WorkItem => i !== undefined);
  undoStore.getState().pushUndo({
    type: 'update',
    label,
    itemSnapshots: snapshots,
    syncItemIds: targetIds,
    syncAction: 'update',
  });
};
```

**Step 2: Add snapshot + undo push before each inline update**

For each picker handler, add a `pushUpdateUndo(targetIds, label)` call **before** the update loop, and append ` — press u to undo` to the toast message. The pattern for each:

**Status picker** (lines 978-990):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'status change');`
- Toast: `'Status updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Type picker** (lines 1007-1019):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'type change');`
- Toast: `'Type updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Priority picker** (lines 1042-1052):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'priority change');`
- Toast: `'Priority updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Parent input** (both `onSelect` at line 1100 and `onSubmitFreeform` at line 1130):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'parent change');`
- Toast: `'Parent updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Assignee input** (both handlers at lines 1163 and 1182):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'assignee change');`
- Toast: `'Assignee updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Labels input** (both `onConfirm` at line 1216 and `onSubmitFreeform` at line 1237):
- Before the `for` loop: `pushUpdateUndo(targetIds, 'labels change');`
- Toast: `'Labels updated — press u to undo'` / `'${n} items updated — press u to undo'`

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(undo): wire undo stack for all inline update pickers"
```

---

### Task 7: Wire up undo for create and edit in WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx:516-568`

**Step 1: Import undoStore**

Add at the top of `WorkItemForm.tsx`:

```typescript
import { undoStore } from '../stores/undoStore.js';
```

**Step 2: Add undo push for edit (update) path**

At line 516, before `cachedUpdateWorkItem` is called, snapshot the current item. The form already has `selectedWorkItemId` and access to the backend. We need to read the current item before overwriting:

```typescript
// Before the existing update call
const snapshot = await backend.getWorkItem(selectedWorkItemId);
// ...existing cachedUpdateWorkItem call...
// After the update:
undoStore.getState().pushUndo({
  type: 'update',
  label: `edited #${selectedWorkItemId}`,
  itemSnapshots: [snapshot],
  syncItemIds: [selectedWorkItemId],
  syncAction: 'update',
});
```

Update the toast (line 542) to: ``uiStore.getState().setToast(`Item #${selectedWorkItemId} updated — press u to undo`)``

**Step 3: Add undo push for create path**

After `cachedCreateWorkItem` returns (line 544-556), push to undo:

```typescript
// After the existing create + queueWrite calls:
undoStore.getState().pushUndo({
  type: 'create',
  label: `created #${created.id}`,
  itemSnapshots: [],
  syncItemIds: [created.id],
  syncAction: 'create',
  createdIds: [created.id],
});
```

Update the toast (line 567) to: ``uiStore.getState().setToast(`Item #${created.id} created — press u to undo`)``

**Step 4: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(undo): wire undo stack for form create and edit"
```

---

### Task 8: Implement the `u` keybinding (undo execution)

**Files:**
- Modify: `src/components/WorkItemList.tsx` (main `useInput` handler, around line 447)

**Step 1: Add the undo handler**

In the main `useInput` handler (lines 353-577), add near the other single-key handlers (e.g., after the `d` handler at line 452):

```typescript
if (input === 'u') {
  const entry = undoStore.getState().popUndo();
  if (!entry || !backend) return;
  void (async () => {
    if (entry.type === 'delete') {
      // Restore from trash
      if ('restoreWorkItem' in backend) {
        for (const snap of entry.itemSnapshots) {
          await (backend as any).restoreWorkItem(snap.id);
        }
      }
      // Cancel sync queue entries
      if (queueStore) {
        await queueStore.removeByIds(entry.syncItemIds, 'delete');
      }
      refreshData();
      setToast(
        entry.itemSnapshots.length === 1
          ? `Restored #${entry.itemSnapshots[0]!.id}`
          : `Restored ${entry.itemSnapshots.length} items`,
      );
    } else if (entry.type === 'create') {
      // Undo create = delete the created items
      for (const id of entry.createdIds ?? []) {
        await backend.cachedDeleteWorkItem(id);
      }
      if (queueStore) {
        await queueStore.removeByIds(entry.syncItemIds, 'create');
      }
      refreshData();
      setToast(
        entry.createdIds?.length === 1
          ? `Undid create #${entry.createdIds[0]}`
          : `Undid create of ${entry.createdIds?.length} items`,
      );
    } else if (entry.type === 'update') {
      // Restore snapshots
      for (const snap of entry.itemSnapshots) {
        await backend.cachedUpdateWorkItem(snap.id, snap);
        await queueWrite('update', snap.id);
      }
      if (queueStore) {
        await queueStore.removeByIds(entry.syncItemIds, 'update');
      }
      refreshData();
      setToast(
        entry.itemSnapshots.length === 1
          ? `Undid ${entry.label}`
          : `Undid ${entry.label}`,
      );
    }
  })();
}
```

**Step 2: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(undo): implement u keybinding to reverse delete/create/update"
```

---

### Task 9: App lifecycle — cleanup on exit and startup

**Files:**
- Modify: `src/index.tsx:22-24`

**Step 1: Import undoStore and cleanupTrash**

Add imports to `src/index.tsx`:

```typescript
import { undoStore } from './stores/undoStore.js';
import { cleanupTrash } from './backends/local/items.js';
```

**Step 2: Add startup trash cleanup**

Before `render(<App />)` (around line 20), add:

```typescript
await cleanupTrash(cwd);
```

**Step 3: Add exit cleanup**

After `await app.waitUntilExit()` (line 22), add undo cleanup before the existing store destroys:

```typescript
// Clean up undo stack — permanently delete any remaining trashed files
const remaining = undoStore.getState().clear();
for (const entry of remaining) {
  if (entry.type === 'delete') {
    for (const snap of entry.itemSnapshots) {
      await permanentlyDeleteWorkItem(cwd, snap.id);
    }
  }
}
```

Also import `permanentlyDeleteWorkItem`:

```typescript
import { cleanupTrash, permanentlyDeleteWorkItem } from './backends/local/items.js';
```

**Step 4: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/index.tsx
git commit -m "feat(undo): add startup trash cleanup and exit stack cleanup"
```

---

### Task 10: Add `u` to help text

**Files:**
- Modify: `src/components/WorkItemList.tsx:54-73` (buildHelpText)
- Modify: `src/components/HelpScreen.tsx` (help screen keybinding reference)

**Step 1: Add `u undo` to the shortcuts array**

In `buildHelpText` (line 55-64), add after the `d delete` entry:

```typescript
{ key: 'u', label: 'undo' },
```

**Step 2: Add to HelpScreen**

Find the keybinding list in `HelpScreen.tsx` and add `u` → `Undo last action` in the appropriate section (List view shortcuts).

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/HelpScreen.tsx
git commit -m "feat(undo): add u shortcut to help text and help screen"
```

---

### Task 11: Full test pass and format

**Step 1: Run formatter**

Run: `npm run format`

**Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 3: Run lint and type check**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

**Step 4: Fix any issues found**

Address any test failures, lint errors, or type errors.

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "chore: format and fix lint/type issues"
```
