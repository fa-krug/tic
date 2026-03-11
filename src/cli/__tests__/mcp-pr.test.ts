import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from '../../storage/db.js';
import { Storage } from '../../storage/index.js';
import type { PullRequest } from '../../types.js';

interface LinkedResult {
  linked: { prId: string; itemId: string };
}
import {
  handleListPrs,
  handleShowPr,
  handleCreatePr,
  handleMergePr,
  handleClosePr,
  handleLinkPr,
  handleUnlinkPr,
  handleGetLinkedPrs,
} from '../commands/mcp.js';

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

describe('MCP PR handlers', () => {
  let db: TicDatabase;
  let storage: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    storage = Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('handleListPrs', () => {
    it('returns empty list when no PRs exist', async () => {
      const result = await handleListPrs(storage, {});
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as PullRequest[];
      expect(data).toEqual([]);
    });

    it('returns PRs with status filter', async () => {
      await storage.importPullRequest(makePr({ id: 'pr-1', status: 'open' }));
      await storage.importPullRequest(
        makePr({ id: 'pr-2', number: 2, status: 'merged' }),
      );
      const result = await handleListPrs(storage, { status: 'open' });
      const data = JSON.parse(result.content[0]!.text) as PullRequest[];
      expect(data).toHaveLength(1);
      expect(data[0]!.status).toBe('open');
    });
  });

  describe('handleShowPr', () => {
    it('returns PR details', async () => {
      await storage.importPullRequest(makePr());
      const result = await handleShowPr(storage, { id: 'pr-1' });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as PullRequest;
      expect(data.id).toBe('pr-1');
      expect(data.title).toBe('Test PR');
    });

    it('returns error for non-existent PR', async () => {
      const result = await handleShowPr(storage, { id: 'nope' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain('not found');
    });
  });

  describe('handleCreatePr', () => {
    it('returns error because Storage does not support create', async () => {
      const result = await handleCreatePr(storage, {
        title: 'New PR',
        sourceBranch: 'feature/x',
      });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'does not support creating pull requests',
      );
    });
  });

  describe('handleMergePr', () => {
    it('returns error because Storage does not support merge', async () => {
      const result = await handleMergePr(storage, { id: 'pr-1' });
      expect(result.isError).toBe(true);
      expect(result.content[0]!.text).toContain(
        'does not support merging pull requests',
      );
    });
  });

  describe('handleClosePr', () => {
    it('returns error because Storage does not support close', async () => {
      const result = await handleClosePr(storage, { id: 'pr-1' });
      expect(result.isError).toBe(true);
    });
  });

  describe('handleLinkPr', () => {
    it('links a PR to a work item', async () => {
      await storage.importPullRequest(makePr());
      const item = await storage.createWorkItem({
        title: 'Test item',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: '',
        parent: null,
        dependsOn: [],
        description: '',
      });

      const result = await handleLinkPr(storage, {
        prId: 'pr-1',
        itemId: item.id!,
      });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as LinkedResult;
      expect(data.linked.prId).toBe('pr-1');
      expect(data.linked.itemId).toBe(item.id!);
    });
  });

  describe('handleUnlinkPr', () => {
    it('unlinks a PR from a work item', async () => {
      await storage.importPullRequest(makePr());
      const item = await storage.createWorkItem({
        title: 'Test item',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: '',
        parent: null,
        dependsOn: [],
        description: '',
      });

      await storage.linkItem('pr-1', item.id!);
      const result = await handleUnlinkPr(storage, {
        prId: 'pr-1',
        itemId: item.id!,
      });
      expect(result.isError).toBeUndefined();
    });
  });

  describe('handleGetLinkedPrs', () => {
    it('returns PRs linked to a work item', async () => {
      await storage.importPullRequest(makePr());
      const item = await storage.createWorkItem({
        title: 'Test item',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: '',
        parent: null,
        dependsOn: [],
        description: '',
      });

      await storage.linkItem('pr-1', item.id!);
      const result = await handleGetLinkedPrs(storage, { itemId: item.id! });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as PullRequest[];
      expect(data).toHaveLength(1);
      expect(data[0]!.id).toBe('pr-1');
    });

    it('returns empty array when no PRs linked', async () => {
      const item = await storage.createWorkItem({
        title: 'Test item',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: '',
        parent: null,
        dependsOn: [],
        description: '',
      });

      const result = await handleGetLinkedPrs(storage, { itemId: item.id! });
      expect(result.isError).toBeUndefined();
      const data = JSON.parse(result.content[0]!.text) as PullRequest[];
      expect(data).toEqual([]);
    });
  });
});
