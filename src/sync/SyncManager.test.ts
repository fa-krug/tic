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
    getAssignees: () => [],
    getCurrentIteration: () => 'default',
    setCurrentIteration: vi.fn(),
    listWorkItems: () => [...store.values()],
    getWorkItem: (id: string) => {
      const item = store.get(id);
      if (!item) throw new Error(`Item #${id} not found`);
      return item;
    },
    createWorkItem: (data: NewWorkItem) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
      const id: string = (data as any).id ?? String(nextId++);
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
      const updated = {
        ...existing,
        ...data,
        id,
        updated: new Date().toISOString(),
      };
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
    // Simulate it already exists on remote
    // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-call, @typescript-eslint/no-unsafe-member-access
    (remote as any).createWorkItem({ ...item });

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
    expect(result.pushed).toBe(1);
    expect(queueStore.read().pending).toHaveLength(0);
  });

  it('keeps failed entries in queue', async () => {
    const failingRemote = createMockRemote();
    failingRemote.updateWorkItem = () => {
      throw new Error('Network error');
    };
    const failManager = new SyncManager(local, failingRemote, queueStore);

    // Item must exist locally so the push reaches the remote call
    local.createWorkItem({
      title: 'Existing',
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

    queueStore.append({
      action: 'update',
      itemId: '1',
      timestamp: new Date().toISOString(),
    });

    const result = await failManager.pushPending();
    expect(result.failed).toBe(1);
    expect(result.errors).toHaveLength(1);
    expect(queueStore.read().pending).toHaveLength(1);
  });

  it('drops queue entries for locally deleted items', async () => {
    const failManager = new SyncManager(local, remote, queueStore);

    queueStore.append({
      action: 'update',
      itemId: 'gone',
      timestamp: new Date().toISOString(),
    });

    const result = await failManager.pushPending();
    expect(result.failed).toBe(0);
    expect(queueStore.read().pending).toHaveLength(0);
  });

  it('processes queue in order, stops failed entry but continues others', async () => {
    const failingRemote = createMockRemote();
    let callCount = 0;
    failingRemote.deleteWorkItem = () => {
      callCount++;
      if (callCount === 1) throw new Error('fail first');
    };
    const failManager = new SyncManager(local, failingRemote, queueStore);

    queueStore.append({
      action: 'delete',
      itemId: 'a',
      timestamp: '2026-01-01T00:00:00Z',
    });
    queueStore.append({
      action: 'delete',
      itemId: 'b',
      timestamp: '2026-01-01T01:00:00Z',
    });

    const result = await failManager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(1);
    const remaining = queueStore.read().pending;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]!.itemId).toBe('a');
  });
});

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
    local.createWorkItem({
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

    queueStore.append({
      action: 'create',
      itemId: localItem.id,
      timestamp: new Date().toISOString(),
    });

    const remote = createMockRemote([]);
    remote.createWorkItem = () => {
      throw new Error('Network error');
    };
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();
    expect(local.listWorkItems()).toHaveLength(1);
  });

  it('overwrites local items with remote state', async () => {
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

    // Item must exist locally so the push reaches the remote call
    local.createWorkItem({
      title: 'Will fail on remote',
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

    queueStore.append({
      action: 'update',
      itemId: '1',
      timestamp: new Date().toISOString(),
    });

    const states: string[] = [];
    manager.onStatusChange((status) => {
      states.push(status.state);
    });

    await manager.sync();
    expect(states[states.length - 1]).toBe('error');
  });

  it('tracks pending count accurately', () => {
    const remote = createMockRemote([]);
    const manager = new SyncManager(local, remote, queueStore);

    expect(manager.getStatus().pendingCount).toBe(0);

    queueStore.append({
      action: 'delete',
      itemId: 'x',
      timestamp: new Date().toISOString(),
    });

    const manager2 = new SyncManager(local, remote, queueStore);
    expect(manager2.getStatus().pendingCount).toBe(1);
  });
});
