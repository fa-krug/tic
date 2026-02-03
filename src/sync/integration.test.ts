import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { LocalBackend } from '../backends/local/index.js';
import { SyncManager } from './SyncManager.js';
import { SyncQueueStore } from './queue.js';
import type { Backend } from '../backends/types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

function createMockRemote(items: WorkItem[] = []): Backend {
  const store = new Map(items.map((i) => [i.id, i]));
  let nextId = 100;
  /* eslint-disable @typescript-eslint/require-await */
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
    getStatuses: async () => ['backlog', 'todo', 'in-progress', 'done'],
    getIterations: async () => ['default'],
    getWorkItemTypes: async () => ['epic', 'issue', 'task'],
    getAssignees: async () => [],
    getLabels: async () => [],
    getCurrentIteration: async () => 'default',
    setCurrentIteration: vi.fn(async () => {}),
    listWorkItems: async () => [...store.values()],
    getWorkItem: async (id: string) => {
      const item = store.get(id);
      if (!item) throw new Error(`Item #${id} not found`);
      return item;
    },
    createWorkItem: async (data: NewWorkItem) => {
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
    updateWorkItem: async (id: string, data: Partial<WorkItem>) => {
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
    deleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    addComment: async (workItemId: string, comment: NewComment) => {
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
    getChildren: async () => [],
    getDependents: async () => [],
    cachedCreateWorkItem: async (data: NewWorkItem) => {
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
    cachedUpdateWorkItem: async (id: string, data: Partial<WorkItem>) => {
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
    cachedDeleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    getItemUrl: (id: string) => `https://remote/${id}`,
    openItem: vi.fn(async () => {}),
  };
  /* eslint-enable @typescript-eslint/require-await */
}

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
    const local = await LocalBackend.create(tmpDir, { tempIds: true });
    const remote = createMockRemote([]);
    const queue = new SyncQueueStore(tmpDir);
    const manager = new SyncManager(local, remote, queue);

    const item = await local.createWorkItem({
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

    await queue.append({
      action: 'create',
      itemId: item.id,
      timestamp: new Date().toISOString(),
    });

    const result = await manager.sync();
    expect(result.push.pushed).toBe(1);
    expect(result.push.failed).toBe(0);

    const localItems = await local.listWorkItems();
    expect(localItems).toHaveLength(1);
    expect(localItems[0]!.id.startsWith('local-')).toBe(false);
    expect(localItems[0]!.title).toBe('E2E Test');
    expect(localItems[0]!.description).toBe('Testing full cycle');
  });

  it('remote changes overwrite local on pull', async () => {
    const local = await LocalBackend.create(tmpDir);
    const queue = new SyncQueueStore(tmpDir);

    await local.createWorkItem({
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

    const item = await local.getWorkItem('1');
    expect(item.title).toBe('Remote Version');
    expect(item.status).toBe('done');
    expect(item.priority).toBe('high');
    expect(item.assignee).toBe('bob');
    expect(item.labels).toEqual(['urgent']);
    expect(item.description).toBe('From remote');
  });
});
