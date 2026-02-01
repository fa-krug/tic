# Offline-First Sync Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Rework tic so all reads/writes go through LocalBackend, with remote backends becoming background sync targets.

**Architecture:** A new `SyncManager` class owns the sync queue and push/pull logic. The factory returns `{ backend: LocalBackend, syncManager: SyncManager | null }`. The TUI reads/writes from LocalBackend always, and SyncManager handles background push/pull to the remote. On first launch with no local data, block until initial pull completes; on subsequent launches, sync in background.

**Tech Stack:** TypeScript, Vitest, Ink/React, existing Backend interface

---

### Task 1: Sync Types

**Files:**
- Create: `src/sync/types.ts`
- Test: `src/sync/types.test.ts`

**Step 1: Write the failing test**

```typescript
// src/sync/types.test.ts
import { describe, it, expect } from 'vitest';
import type {
  QueueEntry,
  SyncQueue,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
} from './types.js';

describe('sync types', () => {
  it('QueueEntry has required shape', () => {
    const entry: QueueEntry = {
      action: 'create',
      itemId: 'local-abc',
      timestamp: new Date().toISOString(),
    };
    expect(entry.action).toBe('create');
    expect(entry.itemId).toBe('local-abc');
    expect(entry.timestamp).toBeDefined();
  });

  it('SyncQueue has pending array', () => {
    const queue: SyncQueue = { pending: [] };
    expect(queue.pending).toEqual([]);
  });

  it('SyncStatus has required fields', () => {
    const status: SyncStatus = {
      state: 'idle',
      pendingCount: 0,
      lastSyncTime: null,
      errors: [],
    };
    expect(status.state).toBe('idle');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/types.test.ts`
Expected: FAIL — module `./types.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/sync/types.ts
export type QueueAction = 'create' | 'update' | 'delete' | 'comment';

export interface QueueEntry {
  action: QueueAction;
  itemId: string;
  timestamp: string;
  /** For comments: the comment body and author */
  commentData?: { author: string; body: string };
}

export interface SyncQueue {
  pending: QueueEntry[];
}

export interface SyncError {
  entry: QueueEntry;
  message: string;
  timestamp: string;
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error';
  pendingCount: number;
  lastSyncTime: Date | null;
  errors: SyncError[];
}

export interface PushResult {
  pushed: number;
  failed: number;
  errors: SyncError[];
}

export interface SyncResult {
  push: PushResult;
  pullCount: number;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/types.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/sync/types.ts src/sync/types.test.ts
git commit -m "feat(sync): add sync queue and status types"
```

---

### Task 2: Sync Queue Persistence

**Files:**
- Create: `src/sync/queue.ts`
- Test: `src/sync/queue.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/sync/queue.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncQueueStore } from './queue.js';

describe('SyncQueueStore', () => {
  let tmpDir: string;
  let store: SyncQueueStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    store = new SyncQueueStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty queue when file does not exist', () => {
    const queue = store.read();
    expect(queue.pending).toEqual([]);
  });

  it('appends an entry', () => {
    store.append({ action: 'create', itemId: '1', timestamp: '2026-01-01T00:00:00Z' });
    const queue = store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.itemId).toBe('1');
  });

  it('collapses duplicate entries for same itemId and action', () => {
    store.append({ action: 'update', itemId: '1', timestamp: '2026-01-01T00:00:00Z' });
    store.append({ action: 'update', itemId: '1', timestamp: '2026-01-01T01:00:00Z' });
    const queue = store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.timestamp).toBe('2026-01-01T01:00:00Z');
  });

  it('does not collapse entries with different actions', () => {
    store.append({ action: 'create', itemId: '1', timestamp: '2026-01-01T00:00:00Z' });
    store.append({ action: 'update', itemId: '1', timestamp: '2026-01-01T01:00:00Z' });
    const queue = store.read();
    expect(queue.pending).toHaveLength(2);
  });

  it('removes an entry by itemId and action', () => {
    store.append({ action: 'create', itemId: '1', timestamp: '2026-01-01T00:00:00Z' });
    store.append({ action: 'update', itemId: '2', timestamp: '2026-01-01T00:00:00Z' });
    store.remove('1', 'create');
    const queue = store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.itemId).toBe('2');
  });

  it('clears all entries', () => {
    store.append({ action: 'create', itemId: '1', timestamp: '2026-01-01T00:00:00Z' });
    store.append({ action: 'update', itemId: '2', timestamp: '2026-01-01T00:00:00Z' });
    store.clear();
    const queue = store.read();
    expect(queue.pending).toEqual([]);
  });

  it('handles corrupt file gracefully', () => {
    fs.writeFileSync(path.join(tmpDir, '.tic', 'sync-queue.json'), 'not json');
    const queue = store.read();
    expect(queue.pending).toEqual([]);
  });

  it('renames an itemId across all pending entries', () => {
    store.append({ action: 'create', itemId: 'local-1', timestamp: '2026-01-01T00:00:00Z' });
    store.append({ action: 'update', itemId: 'local-1', timestamp: '2026-01-01T01:00:00Z' });
    store.renameItem('local-1', '42');
    const queue = store.read();
    expect(queue.pending.every((e) => e.itemId === '42')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/queue.test.ts`
Expected: FAIL — module `./queue.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/sync/queue.ts
import fs from 'node:fs';
import path from 'node:path';
import type { QueueAction, QueueEntry, SyncQueue } from './types.js';

export class SyncQueueStore {
  private filePath: string;

  constructor(root: string) {
    this.filePath = path.join(root, '.tic', 'sync-queue.json');
  }

  read(): SyncQueue {
    try {
      if (!fs.existsSync(this.filePath)) return { pending: [] };
      const raw = fs.readFileSync(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncQueue;
      if (!Array.isArray(data.pending)) return { pending: [] };
      return data;
    } catch {
      return { pending: [] };
    }
  }

  private write(queue: SyncQueue): void {
    const dir = path.dirname(this.filePath);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(this.filePath, JSON.stringify(queue, null, 2));
  }

  append(entry: QueueEntry): void {
    const queue = this.read();
    // Collapse: remove existing entry with same itemId + action
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === entry.itemId && e.action === entry.action),
    );
    queue.pending.push(entry);
    this.write(queue);
  }

  remove(itemId: string, action: QueueAction): void {
    const queue = this.read();
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === itemId && e.action === action),
    );
    this.write(queue);
  }

  clear(): void {
    this.write({ pending: [] });
  }

  renameItem(oldId: string, newId: string): void {
    const queue = this.read();
    for (const entry of queue.pending) {
      if (entry.itemId === oldId) {
        entry.itemId = newId;
      }
    }
    this.write(queue);
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/queue.test.ts`
Expected: PASS (8 tests)

**Step 5: Commit**

```bash
git add src/sync/queue.ts src/sync/queue.test.ts
git commit -m "feat(sync): add sync queue persistence with collapse and rename"
```

---

### Task 3: SyncManager — Push Phase

**Files:**
- Create: `src/sync/SyncManager.ts`
- Test: `src/sync/SyncManager.test.ts`

This task covers the push phase only. Pull phase is Task 4.

**Step 1: Write the failing tests**

```typescript
// src/sync/SyncManager.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncManager } from './SyncManager.js';
import { SyncQueueStore } from './queue.js';
import { LocalBackend } from '../backends/local/index.js';
import type { Backend } from '../backends/types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

function createMockRemote(items: WorkItem[] = []): Backend {
  const store = new Map(items.map((i) => [i.id, i]));
  let nextId = 100;
  return {
    getCapabilities: () => ({
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
    }),
    getStatuses: () => ['backlog', 'todo', 'in-progress', 'done'],
    getIterations: () => ['default'],
    getWorkItemTypes: () => ['epic', 'issue', 'task'],
    getCurrentIteration: () => 'default',
    setCurrentIteration: vi.fn(),
    listWorkItems: () => [...store.values()],
    getWorkItem: (id: string) => {
      const item = store.get(id);
      if (!item) throw new Error(`Item #${id} not found`);
      return item;
    },
    createWorkItem: (data: NewWorkItem) => {
      const id = String(nextId++);
      const item: WorkItem = {
        ...data,
        id,
        created: new Date().toISOString(),
        updated: new Date().toISOString(),
        comments: [],
      };
      store.set(id, item);
      return item;
    },
    updateWorkItem: (id: string, data: Partial<WorkItem>) => {
      const existing = store.get(id);
      if (!existing) throw new Error(`Item #${id} not found`);
      const updated = { ...existing, ...data, id, updated: new Date().toISOString() };
      store.set(id, updated);
      return updated;
    },
    deleteWorkItem: (id: string) => {
      store.delete(id);
    },
    addComment: (workItemId: string, comment: NewComment) => {
      const item = store.get(workItemId);
      if (!item) throw new Error(`Item #${workItemId} not found`);
      const c: Comment = {
        author: comment.author,
        date: new Date().toISOString(),
        body: comment.body,
      };
      item.comments.push(c);
      return c;
    },
    getChildren: () => [],
    getDependents: () => [],
    getItemUrl: (id: string) => `https://remote/${id}`,
    openItem: vi.fn(),
  };
}

describe('SyncManager push phase', () => {
  let tmpDir: string;
  let local: LocalBackend;
  let remote: Backend;
  let manager: SyncManager;
  let queueStore: SyncQueueStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    local = new LocalBackend(tmpDir);
    remote = createMockRemote();
    queueStore = new SyncQueueStore(tmpDir);
    manager = new SyncManager(local, remote, queueStore);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('pushes a create and renames local temp ID to remote ID', async () => {
    // Create item locally with temp ID
    const item = local.createWorkItem({
      title: 'Test',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });
    // Manually set temp ID and re-queue (simulating offline create)
    queueStore.append({
      action: 'create',
      itemId: item.id,
      timestamp: new Date().toISOString(),
    });

    const result = await manager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(queueStore.read().pending).toHaveLength(0);
  });

  it('pushes an update to remote', async () => {
    // Create item on both sides with same ID
    const item = local.createWorkItem({
      title: 'Original',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });
    // Simulate it already exists on remote by creating there too
    (remote as any).createWorkItem({
      ...item,
    });

    // Update locally
    local.updateWorkItem(item.id, { title: 'Updated' });
    queueStore.append({
      action: 'update',
      itemId: item.id,
      timestamp: new Date().toISOString(),
    });

    const result = await manager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
  });

  it('pushes a delete to remote', async () => {
    queueStore.append({
      action: 'delete',
      itemId: '99',
      timestamp: new Date().toISOString(),
    });

    const result = await manager.pushPending();
    // Delete of non-existent item on remote should succeed (idempotent)
    expect(result.pushed).toBe(1);
    expect(queueStore.read().pending).toHaveLength(0);
  });

  it('keeps failed entries in queue', async () => {
    const failingRemote = createMockRemote();
    failingRemote.updateWorkItem = () => {
      throw new Error('Network error');
    };
    const failManager = new SyncManager(local, failingRemote, queueStore);

    queueStore.append({
      action: 'update',
      itemId: '999',
      timestamp: new Date().toISOString(),
    });

    const result = await failManager.pushPending();
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(queueStore.read().pending).toHaveLength(1);
  });

  it('processes queue in order, stops failed entry but continues others', async () => {
    const failingRemote = createMockRemote();
    let callCount = 0;
    failingRemote.deleteWorkItem = () => {
      callCount++;
      if (callCount === 1) throw new Error('fail first');
    };
    const failManager = new SyncManager(local, failingRemote, queueStore);

    queueStore.append({ action: 'delete', itemId: 'a', timestamp: '2026-01-01T00:00:00Z' });
    queueStore.append({ action: 'delete', itemId: 'b', timestamp: '2026-01-01T01:00:00Z' });

    const result = await failManager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    // Failed entry stays, successful entry removed
    const remaining = queueStore.read().pending;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.itemId).toBe('a');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: FAIL — module `./SyncManager.js` not found

**Step 3: Write minimal implementation**

```typescript
// src/sync/SyncManager.ts
import type { Backend } from '../backends/types.js';
import type { LocalBackend } from '../backends/local/index.js';
import type { SyncQueueStore } from './queue.js';
import type {
  QueueEntry,
  SyncStatus,
  SyncResult,
  PushResult,
  SyncError,
} from './types.js';
import {
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
  readWorkItem,
} from '../backends/local/items.js';

type StatusListener = (status: SyncStatus) => void;

export class SyncManager {
  private local: LocalBackend;
  private remote: Backend;
  private queue: SyncQueueStore;
  private status: SyncStatus;
  private listeners: StatusListener[] = [];

  constructor(local: LocalBackend, remote: Backend, queue: SyncQueueStore) {
    this.local = local;
    this.remote = remote;
    this.queue = queue;
    this.status = {
      state: 'idle',
      pendingCount: queue.read().pending.length,
      lastSyncTime: null,
      errors: [],
    };
  }

  getStatus(): SyncStatus {
    return { ...this.status };
  }

  onStatusChange(cb: StatusListener): void {
    this.listeners.push(cb);
  }

  private updateStatus(partial: Partial<SyncStatus>): void {
    this.status = { ...this.status, ...partial };
    for (const cb of this.listeners) {
      cb(this.getStatus());
    }
  }

  async pushPending(): Promise<PushResult> {
    const { pending } = this.queue.read();
    let pushed = 0;
    const errors: SyncError[] = [];

    for (const entry of pending) {
      try {
        await this.pushEntry(entry);
        this.queue.remove(entry.itemId, entry.action);
        pushed++;
      } catch (e) {
        errors.push({
          entry,
          message: e instanceof Error ? e.message : String(e),
          timestamp: new Date().toISOString(),
        });
      }
    }

    this.updateStatus({
      pendingCount: this.queue.read().pending.length,
      errors,
    });

    return { pushed, failed: errors.length, errors };
  }

  private async pushEntry(entry: QueueEntry): Promise<void> {
    switch (entry.action) {
      case 'create': {
        const localItem = this.local.getWorkItem(entry.itemId);
        const remoteItem = this.remote.createWorkItem({
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent: localItem.parent,
          dependsOn: localItem.dependsOn,
        });
        // Rename local item to remote ID if different
        if (remoteItem.id !== entry.itemId) {
          this.renameLocalItem(entry.itemId, remoteItem.id);
          this.queue.renameItem(entry.itemId, remoteItem.id);
        }
        break;
      }
      case 'update': {
        const localItem = this.local.getWorkItem(entry.itemId);
        this.remote.updateWorkItem(entry.itemId, {
          title: localItem.title,
          type: localItem.type,
          status: localItem.status,
          priority: localItem.priority,
          assignee: localItem.assignee,
          labels: localItem.labels,
          iteration: localItem.iteration,
          description: localItem.description,
          parent: localItem.parent,
          dependsOn: localItem.dependsOn,
        });
        break;
      }
      case 'delete': {
        try {
          this.remote.deleteWorkItem(entry.itemId);
        } catch {
          // Idempotent: if item doesn't exist on remote, that's fine
        }
        break;
      }
      case 'comment': {
        if (entry.commentData) {
          this.remote.addComment(entry.itemId, {
            author: entry.commentData.author,
            body: entry.commentData.body,
          });
        }
        break;
      }
    }
  }

  private renameLocalItem(oldId: string, newId: string): void {
    // Read old item, write with new ID, delete old file
    const item = this.local.getWorkItem(oldId);
    const root = (this.local as any).root as string;
    const renamedItem = { ...item, id: newId };
    writeWorkItem(root, renamedItem);
    removeWorkItemFile(root, oldId);
    // Update references in other items
    const allItems = this.local.listWorkItems();
    for (const other of allItems) {
      let changed = false;
      if (other.parent === oldId) {
        other.parent = newId;
        changed = true;
      }
      if (other.dependsOn.includes(oldId)) {
        other.dependsOn = other.dependsOn.map((d) => (d === oldId ? newId : d));
        changed = true;
      }
      if (changed) {
        writeWorkItem(root, other);
      }
    }
  }

  async sync(): Promise<SyncResult> {
    this.updateStatus({ state: 'syncing' });

    const push = await this.pushPending();
    const pullCount = await this.pull();

    this.updateStatus({
      state: push.errors.length > 0 ? 'error' : 'idle',
      pendingCount: this.queue.read().pending.length,
      lastSyncTime: new Date(),
    });

    return { push, pullCount };
  }

  private async pull(): Promise<number> {
    const remoteItems = this.remote.listWorkItems();
    const root = (this.local as any).root as string;
    const pendingIds = new Set(
      this.queue.read().pending.map((e) => e.itemId),
    );

    // Overwrite local with remote state
    const localItems = this.local.listWorkItems();
    const localIds = new Set(localItems.map((i) => i.id));
    const remoteIds = new Set(remoteItems.map((i) => i.id));

    // Write/overwrite remote items locally
    for (const item of remoteItems) {
      writeWorkItem(root, item);
    }

    // Delete local items that don't exist remotely (and aren't pending)
    for (const localId of localIds) {
      if (!remoteIds.has(localId) && !pendingIds.has(localId)) {
        removeWorkItemFile(root, localId);
      }
    }

    return remoteItems.length;
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: PASS (5 tests)

**Step 5: Commit**

```bash
git add src/sync/SyncManager.ts src/sync/SyncManager.test.ts
git commit -m "feat(sync): implement SyncManager push phase with ID rename"
```

---

### Task 4: SyncManager — Pull Phase

**Files:**
- Modify: `src/sync/SyncManager.test.ts`

**Step 1: Write the failing tests**

Add to the existing test file:

```typescript
describe('SyncManager pull phase (via sync)', () => {
  let tmpDir: string;
  let local: LocalBackend;
  let queueStore: SyncQueueStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    local = new LocalBackend(tmpDir);
    queueStore = new SyncQueueStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('pulls remote items into local storage', async () => {
    const remoteItem: WorkItem = {
      id: '10',
      title: 'Remote Task',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T00:00:00Z',
      description: 'From remote',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    const remote = createMockRemote([remoteItem]);
    const manager = new SyncManager(local, remote, queueStore);

    const result = await manager.sync();
    expect(result.pullCount).toBe(1);

    const localItem = local.getWorkItem('10');
    expect(localItem.title).toBe('Remote Task');
  });

  it('deletes local items not on remote (unless pending)', async () => {
    // Create a local item
    const localItem = local.createWorkItem({
      title: 'Local Only',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });

    // Remote has no items
    const remote = createMockRemote([]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();
    expect(local.listWorkItems()).toHaveLength(0);
  });

  it('preserves local items that are in the pending queue', async () => {
    const localItem = local.createWorkItem({
      title: 'Pending',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });

    // Queue has a pending create for this item
    queueStore.append({
      action: 'create',
      itemId: localItem.id,
      timestamp: new Date().toISOString(),
    });

    // Remote has no items, but push will fail
    const remote = createMockRemote([]);
    remote.createWorkItem = () => {
      throw new Error('Network error');
    };
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();
    // Item should still exist locally because it's in the pending queue
    expect(local.listWorkItems()).toHaveLength(1);
  });

  it('overwrites local items with remote state', async () => {
    // Create item locally
    local.createWorkItem({
      title: 'Old Title',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });

    // Remote has same ID but different title
    const remoteItem: WorkItem = {
      id: '1',
      title: 'New Title From Remote',
      type: 'task',
      status: 'done',
      iteration: 'default',
      priority: 'high',
      assignee: 'alice',
      labels: [],
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T12:00:00Z',
      description: 'Updated remotely',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    const remote = createMockRemote([remoteItem]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();
    const item = local.getWorkItem('1');
    expect(item.title).toBe('New Title From Remote');
    expect(item.status).toBe('done');
  });
});
```

**Step 2: Run test to verify it passes** (pull logic was implemented in Task 3)

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: PASS (9 tests)

If any fail, debug and fix the pull implementation in `SyncManager.ts`.

**Step 3: Commit**

```bash
git add src/sync/SyncManager.test.ts
git commit -m "test(sync): add pull phase tests for SyncManager"
```

---

### Task 5: SyncManager — Status Callbacks

**Files:**
- Modify: `src/sync/SyncManager.test.ts`

**Step 1: Write the failing tests**

Add to the test file:

```typescript
describe('SyncManager status callbacks', () => {
  let tmpDir: string;
  let local: LocalBackend;
  let queueStore: SyncQueueStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    local = new LocalBackend(tmpDir);
    queueStore = new SyncQueueStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('fires status change callbacks during sync', async () => {
    const remote = createMockRemote([]);
    const manager = new SyncManager(local, remote, queueStore);
    const states: string[] = [];

    manager.onStatusChange((status) => {
      states.push(status.state);
    });

    await manager.sync();
    expect(states).toContain('syncing');
    expect(states[states.length - 1]).toBe('idle');
  });

  it('reports error state when push fails', async () => {
    const remote = createMockRemote([]);
    remote.updateWorkItem = () => {
      throw new Error('fail');
    };
    const manager = new SyncManager(local, remote, queueStore);

    queueStore.append({
      action: 'update',
      itemId: 'nonexistent',
      timestamp: new Date().toISOString(),
    });

    const states: string[] = [];
    manager.onStatusChange((status) => {
      states.push(status.state);
    });

    await manager.sync();
    expect(states[states.length - 1]).toBe('error');
  });

  it('tracks pending count accurately', async () => {
    const remote = createMockRemote([]);
    const manager = new SyncManager(local, remote, queueStore);

    expect(manager.getStatus().pendingCount).toBe(0);

    queueStore.append({
      action: 'delete',
      itemId: 'x',
      timestamp: new Date().toISOString(),
    });

    // Re-create manager to pick up queue
    const manager2 = new SyncManager(local, remote, queueStore);
    expect(manager2.getStatus().pendingCount).toBe(1);
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: PASS (12 tests). If any fail, fix the status update logic.

**Step 3: Commit**

```bash
git add src/sync/SyncManager.test.ts
git commit -m "test(sync): add status callback tests for SyncManager"
```

---

### Task 6: Factory Changes

**Files:**
- Modify: `src/backends/factory.ts`
- Test: `src/backends/factory.test.ts` (existing, add tests)

**Step 1: Write the failing test**

Add to the existing `factory.test.ts`:

```typescript
import { createBackendWithSync } from './factory.js';

describe('createBackendWithSync', () => {
  it('returns LocalBackend and null syncManager for local backend', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    const config = { ...defaultConfig, backend: 'local' };
    writeConfig(tmpDir, config);

    const { backend, syncManager } = createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(LocalBackend);
    expect(syncManager).toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns LocalBackend and SyncManager for github backend', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-factory-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    const config = { ...defaultConfig, backend: 'github' };
    writeConfig(tmpDir, config);

    const { backend, syncManager } = createBackendWithSync(tmpDir);
    expect(backend).toBeInstanceOf(LocalBackend);
    expect(syncManager).not.toBeNull();

    fs.rmSync(tmpDir, { recursive: true });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: FAIL — `createBackendWithSync` is not exported

**Step 3: Modify `src/backends/factory.ts`**

Add the new function. Keep `createBackend()` unchanged for backward compatibility during migration:

```typescript
import { SyncManager } from '../sync/SyncManager.js';
import { SyncQueueStore } from '../sync/queue.js';

export interface BackendSetup {
  backend: LocalBackend;
  syncManager: SyncManager | null;
}

export function createBackendWithSync(root: string): BackendSetup {
  const config = readConfig(root);
  const backendType = config.backend ?? 'local';

  const local = new LocalBackend(root);

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  let remote: Backend;
  switch (backendType) {
    case 'github':
      remote = new GitHubBackend(root);
      break;
    case 'gitlab':
      remote = new GitLabBackend(root);
      break;
    case 'azure':
      remote = new AzureDevOpsBackend(root);
      break;
    default:
      throw new Error(
        `Unknown backend "${backendType}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }

  const queueStore = new SyncQueueStore(root);
  const syncManager = new SyncManager(local, remote, queueStore);

  return { backend: local, syncManager };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/factory.ts src/backends/factory.test.ts
git commit -m "feat(sync): add createBackendWithSync factory function"
```

---

### Task 7: Wire Up Entry Point (TUI)

**Files:**
- Modify: `src/index.tsx`
- Modify: `src/app.tsx`

**Step 1: Update `src/app.tsx` to accept `syncManager` in context**

Add `syncManager` to `AppState`:

```typescript
// In AppState interface, add:
import type { SyncManager } from './sync/SyncManager.js';

interface AppState {
  screen: Screen;
  selectedWorkItemId: string | null;
  activeType: string | null;
  backend: Backend;
  syncManager: SyncManager | null;
  navigate: (screen: Screen) => void;
  selectWorkItem: (id: string | null) => void;
  setActiveType: (type: string | null) => void;
}
```

Update `App` component props and state:

```typescript
export function App({
  backend,
  syncManager,
}: {
  backend: Backend;
  syncManager: SyncManager | null;
}) {
  // ... existing state ...

  const state: AppState = {
    screen,
    selectedWorkItemId,
    activeType,
    backend,
    syncManager,
    navigate: setScreen,
    selectWorkItem: setSelectedWorkItemId,
    setActiveType,
  };

  // ... rest unchanged ...
}
```

**Step 2: Update `src/index.tsx`**

```typescript
#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { createBackendWithSync } from './backends/factory.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const { backend, syncManager } = createBackendWithSync(process.cwd());

  // First launch: block until initial sync completes
  if (syncManager) {
    const items = backend.listWorkItems();
    if (items.length === 0) {
      // No local data — block on first sync
      process.stderr.write('Syncing...\n');
      await syncManager.sync();
    } else {
      // Background sync — don't block
      syncManager.sync().catch(() => {});
    }
  }

  render(<App backend={backend} syncManager={syncManager} />);
}
```

**Step 3: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/index.tsx src/app.tsx
git commit -m "feat(sync): wire SyncManager into entry point and app context"
```

---

### Task 8: Sync Status Indicator & Keybinding in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add sync status display and `r` keybinding**

In `WorkItemList`, read `syncManager` from `AppContext`:

```typescript
const { backend, syncManager, navigate, selectWorkItem, activeType, setActiveType } =
  useAppState();
```

Add sync state:

```typescript
const [syncStatus, setSyncStatus] = useState(
  syncManager?.getStatus() ?? null,
);

useEffect(() => {
  if (!syncManager) return;
  const cb = (status: SyncStatus) => setSyncStatus(status);
  syncManager.onStatusChange(cb);
}, [syncManager]);
```

Add `r` keybinding in the `useInput` handler (after existing keybindings, before the closing of `useInput`):

```typescript
if (input === 'r' && syncManager) {
  syncManager.sync().then(() => {
    setRefresh((r) => r + 1);
  });
}
```

Add status indicator to the render, after the header `<Box>`:

```tsx
{syncStatus && (
  <Box>
    <Text dimColor>
      {syncStatus.state === 'syncing'
        ? '⟳ Syncing...'
        : syncStatus.state === 'error'
          ? `⚠ Sync failed (${syncStatus.errors.length} errors)`
          : syncStatus.pendingCount > 0
            ? `↑ ${syncStatus.pendingCount} pending`
            : '✓ Synced'}
    </Text>
  </Box>
)}
```

Add `r: sync` to helpParts (conditionally):

```typescript
if (syncManager) helpParts.push('r: sync');
```

Import `SyncStatus` type:

```typescript
import type { SyncStatus } from '../sync/types.js';
```

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(sync): add sync status indicator and r keybinding to WorkItemList"
```

---

### Task 9: Queue Writes in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

All write operations in `WorkItemList` need to also append to the sync queue when a `syncManager` is present. There are three write sites:

1. **Delete** (line 95): `backend.deleteWorkItem(id)` — append `delete` entry
2. **Cycle status** (line 165): `backend.updateWorkItem(id, { status })` — append `update` entry
3. **Set parent** (line 353): `backend.updateWorkItem(id, { parent })` — append `update` entry

**Step 1: Create a helper and update write sites**

Add a `queueWrite` helper inside the component:

```typescript
const queueStore = useMemo(() => {
  if (!syncManager) return null;
  // Access queue from SyncManager (need to expose it or create new store)
  return new SyncQueueStore(process.cwd());
}, [syncManager]);

const queueWrite = (action: QueueAction, itemId: string) => {
  if (queueStore) {
    queueStore.append({ action, itemId, timestamp: new Date().toISOString() });
    // Debounced background push
    syncManager?.pushPending().then(() => setRefresh((r) => r + 1));
  }
};
```

Then after each write call:
- After `backend.deleteWorkItem(...)`: add `queueWrite('delete', id)`
- After `backend.updateWorkItem(... { status })`: add `queueWrite('update', id)`
- After `backend.updateWorkItem(... { parent })`: add `queueWrite('update', id)`

Import the needed types:

```typescript
import { SyncQueueStore } from '../sync/queue.js';
import type { QueueAction } from '../sync/types.js';
```

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(sync): queue writes from WorkItemList for background push"
```

---

### Task 10: Queue Writes in WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add queue logic to the save handler**

The form's save logic is around lines 91-146. After `backend.createWorkItem()` or `backend.updateWorkItem()`, append to queue.

Read the form file, then add similar `queueStore` and `queueWrite` logic as Task 9. The two write sites:

1. **Update** (around line 117): `backend.updateWorkItem(...)` — append `update`
2. **Create** (around line 130): `backend.createWorkItem(...)` — append `create`
3. **Comment** (around lines 121, 134): `backend.addComment(...)` — append `comment` with `commentData`

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(sync): queue writes from WorkItemForm for background push"
```

---

### Task 11: Queue Writes in CLI Commands

**Files:**
- Modify: `src/cli/index.ts`

**Step 1: Update CLI write commands to use sync queue**

The CLI currently calls `createBackend()` at `src/cli/index.ts`. Change it to use `createBackendWithSync()` and queue writes.

The write commands are: `item create`, `item update`, `item delete`, `item comment`, `iteration set`.

After each backend write call in the CLI action handlers, append to the sync queue and call `pushPending()`. Since CLI is a one-shot process (not long-running), call `await syncManager.pushPending()` synchronously before exiting so changes are pushed immediately.

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 3: Run existing CLI tests**

Run: `npx vitest run src/cli/__tests__/`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat(sync): queue and push writes from CLI commands"
```

---

### Task 12: Queue Writes in MCP Server

**Files:**
- Modify: `src/cli/commands/mcp.ts`

**Step 1: Update MCP server to use sync**

The MCP server at `src/cli/commands/mcp.ts` creates a backend via a lazy Proxy. Change it to use `createBackendWithSync()`. After each write tool (`create_item`, `update_item`, `confirm_delete`, `add_comment`, `set_iteration`), append to sync queue and push.

**Step 2: Build to verify no type errors**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat(sync): queue and push writes from MCP server tools"
```

---

### Task 13: Temp ID Generation for Offline Creates

**Files:**
- Modify: `src/backends/local/index.ts`
- Test: `src/backends/local/index.test.ts`

Currently `LocalBackend.createWorkItem()` uses sequential numeric IDs from `config.next_id`. For sync to work, we need to detect when we're in "sync mode" (remote backend configured) and generate temp IDs with a `local-` prefix for creates. This way the push phase knows which items are new.

**Step 1: Write the failing test**

```typescript
describe('LocalBackend temp IDs', () => {
  it('generates local- prefixed IDs when tempIds option is set', () => {
    const backend = new LocalBackend(tmpDir, { tempIds: true });
    const item = backend.createWorkItem({
      title: 'Temp',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });
    expect(item.id.startsWith('local-')).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `LocalBackend` constructor doesn't accept options

**Step 3: Add `tempIds` option to LocalBackend constructor**

Modify the constructor:

```typescript
interface LocalBackendOptions {
  tempIds?: boolean;
}

export class LocalBackend extends BaseBackend {
  private root: string;
  private config: Config;
  private tempIds: boolean;

  constructor(root: string, options?: LocalBackendOptions) {
    super();
    this.root = root;
    this.config = readConfig(root);
    this.tempIds = options?.tempIds ?? false;
  }

  // In createWorkItem:
  createWorkItem(data: NewWorkItem): WorkItem {
    this.validateFields(data);
    const now = new Date().toISOString();
    const id = this.tempIds
      ? `local-${this.config.next_id}`
      : String(this.config.next_id);
    // ... rest unchanged
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: PASS

**Step 5: Update factory to pass `tempIds: true` when remote backend is configured**

In `createBackendWithSync()`:

```typescript
const local = new LocalBackend(root, { tempIds: backendType !== 'local' });
```

**Step 6: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts src/backends/factory.ts
git commit -m "feat(sync): add temp ID generation for offline creates"
```

---

### Task 14: Expose `root` on LocalBackend

**Files:**
- Modify: `src/backends/local/index.ts`

The `SyncManager` currently accesses `(this.local as any).root` which is fragile. Add a public getter.

**Step 1: Add getter**

```typescript
// In LocalBackend class
getRoot(): string {
  return this.root;
}
```

**Step 2: Update SyncManager to use it**

Replace all `(this.local as any).root` with `this.local.getRoot()`. Update the type from `LocalBackend` import.

**Step 3: Build to verify**

Run: `npm run build`
Expected: No errors

**Step 4: Run all tests**

Run: `npm test`
Expected: All pass

**Step 5: Commit**

```bash
git add src/backends/local/index.ts src/sync/SyncManager.ts
git commit -m "refactor(sync): expose root via getter instead of casting"
```

---

### Task 15: End-to-End Integration Test

**Files:**
- Create: `src/sync/integration.test.ts`

**Step 1: Write the integration test**

```typescript
// src/sync/integration.test.ts
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalBackend } from '../backends/local/index.js';
import { SyncManager } from './SyncManager.js';
import { SyncQueueStore } from './queue.js';
import type { Backend } from '../backends/types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

// Reuse createMockRemote from SyncManager.test.ts or extract to a shared test helper

describe('end-to-end sync', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-e2e-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('full cycle: create locally, push, pull, verify', async () => {
    const local = new LocalBackend(tmpDir, { tempIds: true });
    const remote = createMockRemote([]);
    const queue = new SyncQueueStore(tmpDir);
    const manager = new SyncManager(local, remote, queue);

    // 1. Create item locally
    const item = local.createWorkItem({
      title: 'E2E Test',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: 'Testing full cycle',
      parent: null,
      dependsOn: [],
    });
    expect(item.id.startsWith('local-')).toBe(true);

    // 2. Queue the create
    queue.append({
      action: 'create',
      itemId: item.id,
      timestamp: new Date().toISOString(),
    });

    // 3. Full sync
    const result = await manager.sync();
    expect(result.push.pushed).toBe(1);
    expect(result.push.failed).toBe(0);

    // 4. Verify local item was renamed to remote ID
    const localItems = local.listWorkItems();
    expect(localItems).toHaveLength(1);
    expect(localItems[0]!.id.startsWith('local-')).toBe(false);
    expect(localItems[0]!.title).toBe('E2E Test');
  });

  it('remote changes overwrite local on pull', async () => {
    const local = new LocalBackend(tmpDir);
    const queue = new SyncQueueStore(tmpDir);

    // Create local item
    local.createWorkItem({
      title: 'Will be overwritten',
      type: 'task',
      status: 'backlog',
      priority: 'medium',
      assignee: '',
      labels: [],
      iteration: 'default',
      description: '',
      parent: null,
      dependsOn: [],
    });

    // Remote has different data for same ID
    const remoteItem: WorkItem = {
      id: '1',
      title: 'Remote Version',
      type: 'task',
      status: 'done',
      iteration: 'default',
      priority: 'high',
      assignee: 'bob',
      labels: ['urgent'],
      created: '2026-01-01T00:00:00Z',
      updated: '2026-01-01T12:00:00Z',
      description: 'From remote',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    const remote = createMockRemote([remoteItem]);
    const manager = new SyncManager(local, remote, queue);

    await manager.sync();

    const item = local.getWorkItem('1');
    expect(item.title).toBe('Remote Version');
    expect(item.assignee).toBe('bob');
  });
});
```

**Step 2: Run test**

Run: `npx vitest run src/sync/integration.test.ts`
Expected: PASS

**Step 3: Commit**

```bash
git add src/sync/integration.test.ts
git commit -m "test(sync): add end-to-end integration tests"
```

---

### Task 16: Run Full Test Suite & Fix Issues

**Step 1: Run all tests**

Run: `npm test`
Expected: All 300+ tests pass, plus ~25 new sync tests

**Step 2: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: Clean

**Step 3: Fix any issues found**

**Step 4: Commit any fixes**

```bash
git commit -m "fix(sync): address issues from full test suite run"
```

---

### Task 17: Final Build Verification

**Step 1: Clean build**

```bash
rm -rf dist && npm run build
```

Expected: No errors

**Step 2: Run all tests one more time**

Run: `npm test`
Expected: All pass

**Step 3: Commit if any final changes**

---

## Summary of New Files

| File | Purpose |
|------|---------|
| `src/sync/types.ts` | Queue entry, sync status, result types |
| `src/sync/types.test.ts` | Type shape tests |
| `src/sync/queue.ts` | Queue persistence (read/write/append/remove/collapse/rename) |
| `src/sync/queue.test.ts` | Queue persistence tests |
| `src/sync/SyncManager.ts` | Push/pull logic, status callbacks |
| `src/sync/SyncManager.test.ts` | Push, pull, status callback tests |
| `src/sync/integration.test.ts` | End-to-end sync cycle tests |

## Summary of Modified Files

| File | Change |
|------|--------|
| `src/backends/factory.ts` | Add `createBackendWithSync()` |
| `src/backends/factory.test.ts` | Tests for new factory function |
| `src/backends/local/index.ts` | Add `tempIds` option, `getRoot()` getter |
| `src/backends/local/index.test.ts` | Test temp ID generation |
| `src/index.tsx` | Use `createBackendWithSync()`, first-launch blocking sync |
| `src/app.tsx` | Add `syncManager` to `AppState` |
| `src/components/WorkItemList.tsx` | Sync status indicator, `r` keybinding, queue writes |
| `src/components/WorkItemForm.tsx` | Queue writes on save |
| `src/cli/index.ts` | Use sync-aware factory, queue + push on CLI writes |
| `src/cli/commands/mcp.ts` | Use sync-aware factory, queue + push on MCP tool writes |
