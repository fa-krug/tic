import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncManager } from './SyncManager.js';
import { Storage } from '../storage/index.js';
import { SyncQueue } from '../storage/syncQueue.js';
import type { Backend } from '../backends/types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';
import type { PullRequest } from '../types.js';
import type { QueueAction } from './types.js';

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
      templates: false,
      templateFields: {
        type: false,
        status: false,
        priority: false,
        assignee: false,
        labels: false,
        iteration: false,
        parent: false,
        dependsOn: false,
        description: false,
      },
    }),
    // eslint-disable-next-line @typescript-eslint/require-await
    getStatuses: async () => ['backlog', 'todo', 'in-progress', 'done'],
    // eslint-disable-next-line @typescript-eslint/require-await
    getIterations: async () => ['default'],
    // eslint-disable-next-line @typescript-eslint/require-await
    getWorkItemTypes: async () => ['epic', 'issue', 'task'],
    // eslint-disable-next-line @typescript-eslint/require-await
    getAssignees: async () => [],
    // eslint-disable-next-line @typescript-eslint/require-await
    getLabels: async () => [],
    // eslint-disable-next-line @typescript-eslint/require-await
    getCurrentIteration: async () => 'default',
    setCurrentIteration: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/require-await
    listWorkItems: async () => [...store.values()],
    // eslint-disable-next-line @typescript-eslint/require-await
    getWorkItem: async (id: string) => {
      const item = store.get(id);
      if (!item) throw new Error(`Item #${id} not found`);
      return item;
    },
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
    deleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
    getChildren: async () => [],
    // eslint-disable-next-line @typescript-eslint/require-await
    getDependents: async () => [],
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
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
    // eslint-disable-next-line @typescript-eslint/require-await
    cachedDeleteWorkItem: async (id: string) => {
      store.delete(id);
    },
    getItemUrl: (id: string) => `https://remote/${id}`,
    openItem: vi.fn(async () => {}),
    // eslint-disable-next-line @typescript-eslint/require-await
    listTemplates: async () => [],
    // eslint-disable-next-line @typescript-eslint/require-await
    getTemplate: async () => {
      throw new Error('not supported');
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    createTemplate: async () => {
      throw new Error('not supported');
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    updateTemplate: async () => {
      throw new Error('not supported');
    },
    // eslint-disable-next-line @typescript-eslint/require-await
    deleteTemplate: async () => {
      throw new Error('not supported');
    },
  };
}

function createMockPrRemote(
  prs: PullRequest[],
  items: WorkItem[] = [],
): Backend & { listPullRequests: () => Promise<PullRequest[]> } {
  const base = createMockRemote(items);
  return {
    ...base,
    // eslint-disable-next-line @typescript-eslint/require-await
    listPullRequests: async () => prs,
  };
}

function makePr(overrides: Partial<PullRequest> = {}): PullRequest {
  return {
    id: 'pr-1',
    number: 1,
    title: 'Test PR',
    description: 'A test pull request',
    status: 'open',
    sourceBranch: 'feature/test',
    targetBranch: 'main',
    author: 'testuser',
    linkedItems: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

describe('PR queue action types', () => {
  it('pr-create is a valid QueueAction', () => {
    const action: QueueAction = 'pr-create';
    expect(action).toBe('pr-create');
  });

  it('pr-update is a valid QueueAction', () => {
    const action: QueueAction = 'pr-update';
    expect(action).toBe('pr-update');
  });

  it('pr-link is a valid QueueAction', () => {
    const action: QueueAction = 'pr-link';
    expect(action).toBe('pr-link');
  });

  it('pr-unlink is a valid QueueAction', () => {
    const action: QueueAction = 'pr-unlink';
    expect(action).toBe('pr-unlink');
  });
});

describe('SyncManager PR pull', () => {
  let tmpDir: string;
  let local: Storage;
  let queueStore: SyncQueue;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-pr-test-'));
    local = Storage.create(tmpDir);
    queueStore = new SyncQueue(local.getDatabase());
  });

  afterEach(() => {
    local.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('imports PRs from remote during pull when remote supports PRs', async () => {
    const pr = makePr();
    const remote = createMockPrRemote([pr]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    const storedPr = await local.getPullRequest('pr-1');
    expect(storedPr).not.toBeNull();
    expect(storedPr!.title).toBe('Test PR');
    expect(storedPr!.author).toBe('testuser');
  });

  it('imports multiple PRs from remote during pull', async () => {
    const pr1 = makePr({ id: 'pr-1', number: 1, title: 'First PR' });
    const pr2 = makePr({ id: 'pr-2', number: 2, title: 'Second PR' });
    const remote = createMockPrRemote([pr1, pr2]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    const stored1 = await local.getPullRequest('pr-1');
    const stored2 = await local.getPullRequest('pr-2');
    expect(stored1).not.toBeNull();
    expect(stored1!.title).toBe('First PR');
    expect(stored2).not.toBeNull();
    expect(stored2!.title).toBe('Second PR');
  });

  it('does not attempt PR pull when remote does not support PRs', async () => {
    const remote = createMockRemote(); // no listPullRequests method
    const importSpy = vi.spyOn(local, 'importPullRequest');
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    expect(importSpy).not.toHaveBeenCalled();
  });

  it('upserts PRs on repeated pull (updates existing)', async () => {
    const pr = makePr({ title: 'Original Title' });
    const remote = createMockPrRemote([pr]);
    const manager = new SyncManager(local, remote, queueStore);

    await manager.sync();

    // Update the PR title for second sync
    const updatedPr = makePr({ title: 'Updated Title', status: 'merged' });
    const remote2 = createMockPrRemote([updatedPr]);
    const manager2 = new SyncManager(local, remote2, queueStore);

    await manager2.sync();

    const storedPr = await local.getPullRequest('pr-1');
    expect(storedPr).not.toBeNull();
    expect(storedPr!.title).toBe('Updated Title');
    expect(storedPr!.status).toBe('merged');
  });

  it('handles pr-* queue actions via default case in pushEntry (no-op)', async () => {
    const remote = createMockRemote();
    const manager = new SyncManager(local, remote, queueStore);

    queueStore.append({
      action: 'pr-create',
      itemId: 'pr-1',
      timestamp: new Date().toISOString(),
    });

    const result = await manager.pushPending();
    expect(result.pushed).toBe(1);
    expect(result.failed).toBe(0);
    expect(queueStore.read().pending).toHaveLength(0);
  });
});
