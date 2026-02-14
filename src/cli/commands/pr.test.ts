import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createDatabase, type TicDatabase } from '../../storage/db.js';
import { Storage } from '../../storage/index.js';
import type { Backend } from '../../backends/types.js';
import type { PullRequest } from '../../types.js';
import {
  runPrList,
  runPrShow,
  runPrCreate,
  runPrMerge,
  runPrClose,
  runPrLink,
  runPrUnlink,
} from './pr.js';

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

describe('pr commands', () => {
  let db: TicDatabase;
  let storage: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    storage = Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  describe('runPrList', () => {
    it('returns empty array when no PRs exist', async () => {
      const prs = await runPrList(storage, {});
      expect(prs).toEqual([]);
    });

    it('returns all PRs', async () => {
      await storage.importPullRequest(makePr({ id: 'pr-1', number: 1 }));
      await storage.importPullRequest(
        makePr({ id: 'pr-2', number: 2, title: 'Second PR' }),
      );
      const prs = await runPrList(storage, {});
      expect(prs).toHaveLength(2);
    });

    it('filters by status', async () => {
      await storage.importPullRequest(
        makePr({ id: 'pr-1', number: 1, status: 'open' }),
      );
      await storage.importPullRequest(
        makePr({ id: 'pr-2', number: 2, status: 'merged' }),
      );
      const prs = await runPrList(storage, { status: 'open' });
      expect(prs).toHaveLength(1);
      expect(prs[0]!.status).toBe('open');
    });
  });

  describe('runPrShow', () => {
    it('returns PR details', async () => {
      await storage.importPullRequest(makePr());
      const pr = await runPrShow(storage, 'pr-1');
      expect(pr.id).toBe('pr-1');
      expect(pr.title).toBe('Test PR');
      expect(pr.sourceBranch).toBe('feature/test');
      expect(pr.targetBranch).toBe('main');
    });

    it('throws for non-existent PR', async () => {
      await expect(runPrShow(storage, 'non-existent')).rejects.toThrow(
        'Pull request non-existent not found',
      );
    });
  });

  describe('runPrCreate', () => {
    it('throws because Storage does not support create', async () => {
      await expect(
        runPrCreate(storage, {
          title: 'New PR',
          source: 'feature/x',
        }),
      ).rejects.toThrow('does not support creating pull requests');
    });
  });

  describe('runPrMerge', () => {
    it('throws because Storage does not support merge', async () => {
      await expect(runPrMerge(storage, 'pr-1')).rejects.toThrow(
        'does not support merging pull requests',
      );
    });
  });

  describe('runPrClose', () => {
    it('throws because Storage does not support close', async () => {
      await storage.importPullRequest(makePr());
      await expect(runPrClose(storage, 'pr-1')).rejects.toThrow();
    });
  });

  describe('runPrLink and runPrUnlink', () => {
    it('links and unlinks a work item to a PR', async () => {
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

      await runPrLink(storage, 'pr-1', item.id);
      const pr = await runPrShow(storage, 'pr-1');
      expect(pr.linkedItems).toContain(item.id);

      await runPrUnlink(storage, 'pr-1', item.id);
      const pr2 = await runPrShow(storage, 'pr-1');
      expect(pr2.linkedItems).not.toContain(item.id);
    });
  });

  describe('non-PrBackend', () => {
    it('throws helpful error for non-PR-capable backend', async () => {
      const mockBackend = {
        getCapabilities: vi.fn(),
      } as unknown as Backend;

      await expect(runPrList(mockBackend, {})).rejects.toThrow(
        'Pull request operations require a PR-capable backend',
      );
    });
  });
});
