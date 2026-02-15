import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';
import { UnsupportedOperationError } from '../backends/types.js';
import type { PullRequest } from '../types.js';

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
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    url: 'https://github.com/test/repo/pull/1',
    ...overrides,
  };
}

describe('PR Storage Methods', () => {
  let db: TicDatabase;
  let storage: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    storage = Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  it('listPullRequests returns empty array initially', async () => {
    const prs = await storage.listPullRequests();
    expect(prs).toEqual([]);
  });

  it('importPullRequest inserts a PR and getPullRequest retrieves it', async () => {
    const pr = makePr();
    await storage.importPullRequest(pr);

    const result = await storage.getPullRequest('pr-1');
    expect(result).not.toBeNull();
    expect(result!.id).toBe('pr-1');
    expect(result!.number).toBe(1);
    expect(result!.title).toBe('Test PR');
    expect(result!.description).toBe('A test pull request');
    expect(result!.status).toBe('open');
    expect(result!.sourceBranch).toBe('feature/test');
    expect(result!.targetBranch).toBe('main');
    expect(result!.author).toBe('testuser');
    expect(result!.url).toBe('https://github.com/test/repo/pull/1');
    expect(result!.linkedItems).toEqual([]);
  });

  it('importPullRequest with linkedItems creates join table entries', async () => {
    // Create work items to link against
    const item1 = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    const item2 = await storage.createWorkItem({
      title: 'Item 2',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr = makePr({ linkedItems: [item1.id, item2.id] });
    await storage.importPullRequest(pr);

    const result = await storage.getPullRequest('pr-1');
    expect(result).not.toBeNull();
    expect(result!.linkedItems).toHaveLength(2);
    expect(result!.linkedItems).toContain(item1.id);
    expect(result!.linkedItems).toContain(item2.id);
  });

  it('getLinkedPullRequests returns PRs linked to a work item', async () => {
    const item = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr1 = makePr({ id: 'pr-1', linkedItems: [item.id] });
    const pr2 = makePr({
      id: 'pr-2',
      number: 2,
      title: 'Second PR',
      linkedItems: [item.id],
    });
    await storage.importPullRequest(pr1);
    await storage.importPullRequest(pr2);

    const linked = await storage.getLinkedPullRequests(item.id);
    expect(linked).toHaveLength(2);
    const ids = linked.map((p) => p.id).sort();
    expect(ids).toEqual(['pr-1', 'pr-2']);
  });

  it('getLinkedItems returns item IDs linked to a PR', async () => {
    const item1 = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    const item2 = await storage.createWorkItem({
      title: 'Item 2',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr = makePr({ linkedItems: [item1.id, item2.id] });
    await storage.importPullRequest(pr);

    const linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toHaveLength(2);
    expect(linkedItems).toContain(item1.id);
    expect(linkedItems).toContain(item2.id);
  });

  it('linkItem adds a link and unlinkItem removes it', async () => {
    const item = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr = makePr();
    await storage.importPullRequest(pr);

    // Link
    await storage.linkItem('pr-1', item.id);
    let linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toContain(item.id);

    // Unlink
    await storage.unlinkItem('pr-1', item.id);
    linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toEqual([]);
  });

  it('createPullRequest throws UnsupportedOperationError', async () => {
    await expect(
      storage.createPullRequest({
        title: 'New PR',
        sourceBranch: 'feature/x',
      }),
    ).rejects.toThrow(UnsupportedOperationError);
  });

  it('deleting a work item cascades to remove prItemLinks entries', async () => {
    const item = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr = makePr({ linkedItems: [item.id] });
    await storage.importPullRequest(pr);

    // Verify link exists
    let linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toContain(item.id);

    // Delete the work item
    await storage.deleteWorkItem(item.id);

    // Link should be gone (cascade)
    linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toEqual([]);
  });

  it('importPullRequest upserts - calling twice updates the existing PR', async () => {
    const pr = makePr();
    await storage.importPullRequest(pr);

    const updatedPr = makePr({
      title: 'Updated PR Title',
      status: 'merged',
      updated: '2025-06-01T00:00:00.000Z',
    });
    await storage.importPullRequest(updatedPr);

    const result = await storage.getPullRequest('pr-1');
    expect(result).not.toBeNull();
    expect(result!.title).toBe('Updated PR Title');
    expect(result!.status).toBe('merged');
    expect(result!.updated).toBe('2025-06-01T00:00:00.000Z');

    // Should only be one PR total
    const all = await storage.listPullRequests();
    expect(all).toHaveLength(1);
  });

  it('getPrCapabilities returns expected values', () => {
    const caps = storage.getPrCapabilities();
    expect(caps).toEqual({
      pullRequests: true,
      merge: false,
      create: false,
    });
  });

  it('getPullRequest returns null for non-existent PR', async () => {
    const result = await storage.getPullRequest('non-existent');
    expect(result).toBeNull();
  });

  it('linkItem ignores duplicate links', async () => {
    const item = await storage.createWorkItem({
      title: 'Item 1',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });

    const pr = makePr();
    await storage.importPullRequest(pr);

    await storage.linkItem('pr-1', item.id);
    await storage.linkItem('pr-1', item.id); // duplicate — should not throw

    const linkedItems = await storage.getLinkedItems('pr-1');
    expect(linkedItems).toHaveLength(1);
  });
});
