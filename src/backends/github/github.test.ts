import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubBackend } from './index.js';

// Mock the gh wrapper
vi.mock('./gh.js', () => ({
  gh: vi.fn(),
  ghExec: vi.fn(),
}));

import { gh, ghExec } from './gh.js';

const mockGh = vi.mocked(gh);
const mockGhExec = vi.mocked(ghExec);

describe('GitHubBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor calls ghExec for auth check
    mockGhExec.mockReturnValue('');
  });

  describe('constructor', () => {
    it('verifies gh auth on construction', () => {
      new GitHubBackend('/repo');
      expect(mockGhExec).toHaveBeenCalledWith(['auth', 'status'], '/repo');
    });

    it('throws when gh auth fails', () => {
      mockGhExec.mockImplementation(() => {
        throw new Error('not logged in');
      });
      expect(() => new GitHubBackend('/repo')).toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns GitHub-specific capabilities', () => {
      const backend = new GitHubBackend('/repo');
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(false);
      expect(caps.customTypes).toBe(false);
      expect(caps.customStatuses).toBe(false);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(false);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(false);
      expect(caps.fields.dependsOn).toBe(false);
    });
  });

  describe('getStatuses', () => {
    it('returns open and closed', async () => {
      const backend = new GitHubBackend('/repo');
      expect(await backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue', async () => {
      const backend = new GitHubBackend('/repo');
      expect(await backend.getWorkItemTypes()).toEqual(['issue']);
    });
  });

  describe('getIterations', () => {
    it('returns milestone titles', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
        .mockReturnValueOnce([
          { title: 'v1.0', state: 'open', due_on: null },
          { title: 'v2.0', state: 'open', due_on: null },
        ]);
      expect(await backend.getIterations()).toEqual(['v1.0', 'v2.0']);
    });

    it('returns empty array when no milestones', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
        .mockReturnValueOnce([]);
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns first open milestone sorted by due date', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
        .mockReturnValueOnce([
          { title: 'v1.0', state: 'open', due_on: '2026-03-01T00:00:00Z' },
          { title: 'v2.0', state: 'open', due_on: '2026-06-01T00:00:00Z' },
        ]);
      expect(await backend.getCurrentIteration()).toBe('v1.0');
    });

    it('returns empty string when no open milestones', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
        .mockReturnValueOnce([]);
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = new GitHubBackend('/repo');
      await expect(backend.setCurrentIteration('v1.0')).resolves.not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([
        {
          number: 1,
          title: 'First',
          body: 'Body 1',
          state: 'OPEN',
          assignees: [{ login: 'alice' }],
          labels: [{ name: 'bug' }],
          milestone: { title: 'v1.0' },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-02T00:00:00Z',
          comments: [],
        },
        {
          number: 2,
          title: 'Second',
          body: null,
          state: 'CLOSED',
          assignees: [],
          labels: [],
          milestone: null,
          createdAt: '2026-01-03T00:00:00Z',
          updatedAt: '2026-01-04T00:00:00Z',
          comments: [],
        },
      ]);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('1');
      expect(items[0]!.status).toBe('open');
      expect(items[1]!.id).toBe('2');
      expect(items[1]!.status).toBe('closed');
    });

    it('passes milestone filter to gh when iteration provided', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([
        {
          number: 1,
          title: 'In v1',
          body: '',
          state: 'OPEN',
          assignees: [],
          labels: [],
          milestone: { title: 'v1.0' },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          comments: [],
        },
      ]);

      const items = await backend.listWorkItems('v1.0');
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('In v1');
      expect(mockGh).toHaveBeenCalledWith(
        expect.arrayContaining(['--milestone', 'v1.0']),
        '/repo',
      );
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue({
        number: 42,
        title: 'The issue',
        body: 'Details here',
        state: 'OPEN',
        assignees: [{ login: 'bob' }],
        labels: [{ name: 'feature' }],
        milestone: { title: 'v1.0' },
        createdAt: '2026-01-10T00:00:00Z',
        updatedAt: '2026-01-11T00:00:00Z',
        comments: [
          {
            author: { login: 'alice' },
            createdAt: '2026-01-10T12:00:00Z',
            body: 'On it.',
          },
        ],
      });

      const item = await backend.getWorkItem('42');
      expect(item.id).toBe('42');
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('alice');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = new GitHubBackend('/repo');

      // gh issue create returns the new issue URL, then we fetch it
      mockGhExec.mockReturnValue('https://github.com/owner/repo/issues/10\n');
      mockGh.mockReturnValue({
        number: 10,
        title: 'New issue',
        body: 'Description',
        state: 'OPEN',
        assignees: [{ login: 'alice' }],
        labels: [{ name: 'bug' }],
        milestone: { title: 'v1.0' },
        createdAt: '2026-01-20T00:00:00Z',
        updatedAt: '2026-01-20T00:00:00Z',
        comments: [],
      });

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: 'v1.0',
        priority: 'medium',
        assignee: 'alice',
        labels: ['bug'],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('10');
      expect(item.title).toBe('New issue');
    });
  });

  describe('updateWorkItem', () => {
    it('updates title and body', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockReturnValue('');
      mockGh.mockReturnValue({
        number: 5,
        title: 'Updated title',
        body: 'Updated body',
        state: 'OPEN',
        assignees: [],
        labels: [],
        milestone: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-21T00:00:00Z',
        comments: [],
      });

      const item = await backend.updateWorkItem('5', {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
      expect(item.description).toBe('Updated body');
    });

    it('closes an issue when status changes to closed', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');
      mockGh.mockReturnValue({
        number: 5,
        title: 'Issue',
        body: '',
        state: 'CLOSED',
        assignees: [],
        labels: [],
        milestone: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-21T00:00:00Z',
        comments: [],
      });

      const item = await backend.updateWorkItem('5', { status: 'closed' });
      expect(item.status).toBe('closed');
      expect(mockGhExec).toHaveBeenCalledWith(['issue', 'close', '5'], '/repo');
    });

    it('reopens an issue when status changes to open', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');
      mockGh.mockReturnValue({
        number: 5,
        title: 'Issue',
        body: '',
        state: 'OPEN',
        assignees: [],
        labels: [],
        milestone: null,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-21T00:00:00Z',
        comments: [],
      });

      const item = await backend.updateWorkItem('5', { status: 'open' });
      expect(item.status).toBe('open');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'reopen', '5'],
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');
      await backend.deleteWorkItem('7');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'delete', '7', '--yes'],
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      const comment = await backend.addComment('3', {
        author: 'alice',
        body: 'This is a comment.',
      });

      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'comment', '3', '--body', 'This is a comment.'],
        '/repo',
      );
      expect(comment.author).toBe('alice');
      expect(comment.body).toBe('This is a comment.');
      expect(comment.date).toBeDefined();
    });
  });

  describe('getItemUrl', () => {
    it('returns the GitHub issue URL', () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue({
        url: 'https://github.com/owner/repo/issues/5',
      });

      const url = backend.getItemUrl('5');
      expect(url).toBe('https://github.com/owner/repo/issues/5');
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      await backend.openItem('5');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });
  });

  describe('getChildren', () => {
    it('throws UnsupportedOperationError', async () => {
      const backend = new GitHubBackend('/repo');
      await expect(backend.getChildren('1')).rejects.toThrow(
        'relationships is not supported by the GitHubBackend backend',
      );
    });
  });

  describe('getDependents', () => {
    it('throws UnsupportedOperationError', async () => {
      const backend = new GitHubBackend('/repo');
      await expect(backend.getDependents('1')).rejects.toThrow(
        'relationships is not supported by the GitHubBackend backend',
      );
    });
  });

  describe('getAssignees', () => {
    it('returns collaborator logins', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockReturnValueOnce({ nameWithOwner: 'owner/repo' })
        .mockReturnValueOnce([
          { login: 'alice' },
          { login: 'bob' },
          { login: 'charlie' },
        ]);
      expect(await backend.getAssignees()).toEqual(['alice', 'bob', 'charlie']);
    });

    it('returns empty array on error', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValueOnce({ nameWithOwner: 'owner/repo' });
      mockGh.mockImplementationOnce(() => {
        throw new Error('API error');
      });
      expect(await backend.getAssignees()).toEqual([]);
    });
  });
});
