import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabBackend } from './index.js';

// Mock the glab wrapper
vi.mock('./glab.js', () => ({
  glab: vi.fn(),
  glabExec: vi.fn(),
  glabExecSync: vi.fn(),
  glabSync: vi.fn(),
}));

// Mock the group detection
vi.mock('./group.js', () => ({
  detectGroup: vi.fn().mockReturnValue('mygroup'),
}));

// Mock node:child_process for the direct execFile import in index.ts (used by openItem for epics)
const { mockExecFilePromisified } = vi.hoisted(() => {
  const mockExecFilePromisified = vi
    .fn()
    .mockResolvedValue({ stdout: '', stderr: '' });
  return { mockExecFilePromisified };
});
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  const mockExecFile = Object.assign(vi.fn(), {
    [Symbol.for('nodejs.util.promisify.custom')]: mockExecFilePromisified,
  });
  return {
    ...actual,
    execFileSync: vi.fn(),
    execFile: mockExecFile,
  };
});

import { glab, glabExec, glabExecSync, glabSync } from './glab.js';

const mockGlab = vi.mocked(glab);
const mockGlabExec = vi.mocked(glabExec);
const mockGlabExecSync = vi.mocked(glabExecSync);
const mockGlabSync = vi.mocked(glabSync);

function makeBackend(): GitLabBackend {
  return new GitLabBackend('/repo');
}

const sampleIssue = {
  iid: 42,
  title: 'Fix login bug',
  description: 'The login form breaks.',
  state: 'opened',
  assignees: [{ username: 'alice' }],
  labels: ['bug'],
  milestone: { title: 'v1.0' },
  epic: { iid: 5 },
  created_at: '2026-01-15T10:00:00Z',
  updated_at: '2026-01-20T14:30:00Z',
};

const sampleEpic = {
  iid: 5,
  title: 'Big feature',
  description: 'Epic description.',
  state: 'opened',
  labels: ['feature'],
  created_at: '2026-01-10T00:00:00Z',
  updated_at: '2026-01-18T00:00:00Z',
};

const sampleNote = {
  author: { username: 'charlie' },
  created_at: '2026-01-16T09:00:00Z',
  body: 'I can reproduce this.',
};

describe('GitLabBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor calls glabExecSync for auth check
    mockGlabExecSync.mockReturnValue('');
  });

  describe('constructor', () => {
    it('verifies glab auth on construction', () => {
      makeBackend();
      expect(mockGlabExecSync).toHaveBeenCalledWith(
        ['auth', 'status'],
        '/repo',
      );
    });

    it('throws when glab auth fails', () => {
      mockGlabExecSync.mockImplementation(() => {
        throw new Error('not logged in');
      });
      expect(() => new GitLabBackend('/repo')).toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns GitLab-specific capabilities', () => {
      const backend = makeBackend();
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.customTypes).toBe(false);
      expect(caps.customStatuses).toBe(false);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(false);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(false);
    });
  });

  describe('getStatuses', () => {
    it('returns open and closed', async () => {
      const backend = makeBackend();
      expect(await backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns epic and issue', async () => {
      const backend = makeBackend();
      expect(await backend.getWorkItemTypes()).toEqual(['epic', 'issue']);
    });
  });

  describe('getIterations', () => {
    it('returns iteration titles', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([
        {
          title: 'Sprint 1',
          start_date: '2026-01-01',
          due_date: '2026-01-14',
        },
        {
          title: 'Sprint 2',
          start_date: '2026-01-15',
          due_date: '2026-01-28',
        },
      ]);
      expect(await backend.getIterations()).toEqual(['Sprint 1', 'Sprint 2']);
    });

    it('returns empty array when no iterations', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([]);
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns iteration that spans today', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([
        {
          title: 'Past Sprint',
          start_date: '2020-01-01',
          due_date: '2020-01-14',
        },
        {
          title: 'Current Sprint',
          start_date: '2020-01-01',
          due_date: '2030-12-31',
        },
      ]);
      expect(await backend.getCurrentIteration()).toBe('Current Sprint');
    });

    it('returns empty string when no current iteration', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([
        {
          title: 'Past Sprint',
          start_date: '2020-01-01',
          due_date: '2020-01-14',
        },
      ]);
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = makeBackend();
      await expect(
        backend.setCurrentIteration('Sprint 1'),
      ).resolves.not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('returns merged issues and epics sorted by updated desc', async () => {
      const backend = makeBackend();

      // First call: issues
      mockGlab
        .mockResolvedValueOnce([
          { ...sampleIssue, iid: 1, updated_at: '2026-01-20T00:00:00Z' },
          { ...sampleIssue, iid: 2, updated_at: '2026-01-18T00:00:00Z' },
        ])
        // Second call: epics
        .mockResolvedValueOnce([
          { ...sampleEpic, iid: 1, updated_at: '2026-01-19T00:00:00Z' },
        ]);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(3);
      // Sorted by updated descending
      expect(items[0]!.id).toBe('issue-1');
      expect(items[1]!.id).toBe('epic-1');
      expect(items[2]!.id).toBe('issue-2');
    });

    it('filters issues by iteration', async () => {
      const backend = makeBackend();

      mockGlab
        .mockResolvedValueOnce([
          {
            ...sampleIssue,
            iid: 1,
            milestone: { title: 'v1.0' },
            updated_at: '2026-01-20T00:00:00Z',
          },
          {
            ...sampleIssue,
            iid: 2,
            milestone: { title: 'v2.0' },
            updated_at: '2026-01-18T00:00:00Z',
          },
        ])
        .mockResolvedValueOnce([]);

      const items = await backend.listWorkItems('v1.0');
      const issueItems = items.filter((i) => i.type === 'issue');
      expect(issueItems).toHaveLength(1);
      expect(issueItems[0]!.iteration).toBe('v1.0');
    });
  });

  describe('getWorkItem', () => {
    it('returns an issue with comments', async () => {
      const backend = makeBackend();

      mockGlab
        .mockResolvedValueOnce(sampleIssue) // issue view
        .mockResolvedValueOnce([sampleNote]); // notes

      const item = await backend.getWorkItem('issue-42');
      expect(item.id).toBe('issue-42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('charlie');
    });

    it('returns an epic with comments', async () => {
      const backend = makeBackend();

      mockGlab
        .mockResolvedValueOnce(sampleEpic) // epic view
        .mockResolvedValueOnce([sampleNote]); // notes

      const item = await backend.getWorkItem('epic-5');
      expect(item.id).toBe('epic-5');
      expect(item.title).toBe('Big feature');
      expect(item.type).toBe('epic');
      expect(item.comments).toHaveLength(1);
    });

    it('throws on invalid ID format', async () => {
      const backend = makeBackend();
      await expect(backend.getWorkItem('42')).rejects.toThrow(
        'Invalid GitLab ID format',
      );
      await expect(backend.getWorkItem('task-42')).rejects.toThrow(
        'Invalid GitLab ID format',
      );
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = makeBackend();

      mockGlabExec.mockResolvedValue(
        'https://gitlab.com/mygroup/project/-/issues/10\n',
      );
      mockGlab
        .mockResolvedValueOnce({
          ...sampleIssue,
          iid: 10,
          title: 'New issue',
        })
        .mockResolvedValueOnce([]); // notes

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

      expect(item.id).toBe('issue-10');
      expect(mockGlabExec).toHaveBeenCalledWith(
        expect.arrayContaining([
          'issue',
          'create',
          '--title',
          'New issue',
          '--yes',
        ]),
        '/repo',
      );
    });

    it('creates an epic via API', async () => {
      const backend = makeBackend();

      mockGlab.mockResolvedValueOnce({
        ...sampleEpic,
        iid: 8,
        title: 'New epic',
      });

      const item = await backend.createWorkItem({
        title: 'New epic',
        type: 'epic',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: ['feature'],
        description: 'Epic desc',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('epic-8');
      expect(item.type).toBe('epic');
    });

    it('ensures labels exist before creating an issue', async () => {
      const backend = makeBackend();

      mockGlabExec.mockResolvedValue(
        'https://gitlab.com/mygroup/project/-/issues/10\n',
      );
      mockGlab
        .mockResolvedValueOnce({ ...sampleIssue, iid: 10 })
        .mockResolvedValueOnce([]); // notes

      await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: ['bug', 'ux'],
        description: '',
        parent: null,
        dependsOn: [],
      });

      expect(mockGlabExec).toHaveBeenCalledWith(
        ['label', 'create', 'bug'],
        '/repo',
      );
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['label', 'create', 'ux'],
        '/repo',
      );
    });

    it('ensures labels exist before creating an epic', async () => {
      const backend = makeBackend();

      mockGlabExec.mockResolvedValue('');
      mockGlab.mockResolvedValueOnce({ ...sampleEpic, iid: 8 });

      await backend.createWorkItem({
        title: 'New epic',
        type: 'epic',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: ['feature'],
        description: '',
        parent: null,
        dependsOn: [],
      });

      expect(mockGlabExec).toHaveBeenCalledWith(
        ['label', 'create', 'feature'],
        '/repo',
      );
    });

    it('ignores errors when ensuring labels that already exist', async () => {
      const backend = makeBackend();

      mockGlabExec
        .mockRejectedValueOnce(new Error('label already exists'))
        .mockResolvedValue('https://gitlab.com/mygroup/project/-/issues/10\n');
      mockGlab
        .mockResolvedValueOnce({ ...sampleIssue, iid: 10 })
        .mockResolvedValueOnce([]); // notes

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: ['bug'],
        description: '',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('issue-10');
    });
  });

  describe('updateWorkItem', () => {
    it('updates issue title and description', async () => {
      const backend = makeBackend();

      mockGlabExec.mockResolvedValue('');
      mockGlab
        .mockResolvedValueOnce({
          ...sampleIssue,
          iid: 5,
          title: 'Updated title',
          description: 'Updated body',
        })
        .mockResolvedValueOnce([]); // notes

      const item = await backend.updateWorkItem('issue-5', {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
    });

    it('closes an issue when status changes to closed', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');
      mockGlab
        .mockResolvedValueOnce({
          ...sampleIssue,
          iid: 5,
          state: 'closed',
        })
        .mockResolvedValueOnce([]);

      await backend.updateWorkItem('issue-5', { status: 'closed' });
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'close', '5'],
        '/repo',
      );
    });

    it('reopens an issue when status changes to open', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');
      mockGlab
        .mockResolvedValueOnce({
          ...sampleIssue,
          iid: 5,
          state: 'opened',
        })
        .mockResolvedValueOnce([]);

      await backend.updateWorkItem('issue-5', { status: 'open' });
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'reopen', '5'],
        '/repo',
      );
    });

    it('updates epic via API with state_event', async () => {
      const backend = makeBackend();

      // First glab call: PUT to update epic
      mockGlab.mockResolvedValueOnce({ ...sampleEpic, state: 'closed' });
      // Second glab call: GET to fetch updated epic
      mockGlab.mockResolvedValueOnce({ ...sampleEpic, state: 'closed' });
      // Third glab call: GET notes
      mockGlab.mockResolvedValueOnce([]);

      await backend.updateWorkItem('epic-5', { status: 'closed' });

      expect(mockGlab).toHaveBeenCalledWith(
        expect.arrayContaining([
          'api',
          'groups/mygroup/epics/5',
          '-X',
          'PUT',
          '-f',
          'state_event=close',
        ]),
        '/repo',
      );
    });

    it('ensures labels exist before updating an issue', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');
      mockGlab
        .mockResolvedValueOnce({
          ...sampleIssue,
          iid: 5,
          labels: ['new-label'],
        })
        .mockResolvedValueOnce([]); // notes

      await backend.updateWorkItem('issue-5', { labels: ['new-label'] });

      expect(mockGlabExec).toHaveBeenCalledWith(
        ['label', 'create', 'new-label'],
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');
      await backend.deleteWorkItem('issue-7');
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'delete', '7', '--yes'],
        '/repo',
      );
    });

    it('deletes an epic via API', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce({});
      await backend.deleteWorkItem('epic-3');
      expect(mockGlab).toHaveBeenCalledWith(
        ['api', 'groups/mygroup/epics/3', '-X', 'DELETE'],
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment to an issue', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');

      const comment = await backend.addComment('issue-3', {
        author: 'alice',
        body: 'This is a comment.',
      });

      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'note', '3', '-m', 'This is a comment.'],
        '/repo',
      );
      expect(comment.author).toBe('alice');
      expect(comment.body).toBe('This is a comment.');
      expect(comment.date).toBeDefined();
    });

    it('adds a comment to an epic via API', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce({});

      const comment = await backend.addComment('epic-5', {
        author: 'bob',
        body: 'Epic comment.',
      });

      expect(mockGlab).toHaveBeenCalledWith(
        [
          'api',
          'groups/mygroup/epics/5/notes',
          '-X',
          'POST',
          '-f',
          'body=Epic comment.',
        ],
        '/repo',
      );
      expect(comment.author).toBe('bob');
      expect(comment.body).toBe('Epic comment.');
    });
  });

  describe('getChildren', () => {
    it('returns empty array for issues', async () => {
      const backend = makeBackend();
      expect(await backend.getChildren('issue-42')).toEqual([]);
    });

    it('returns epic children as WorkItems', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([
        { ...sampleIssue, iid: 10 },
        { ...sampleIssue, iid: 11 },
      ]);

      const children = await backend.getChildren('epic-5');
      expect(children).toHaveLength(2);
      expect(children[0]!.id).toBe('issue-10');
      expect(children[1]!.id).toBe('issue-11');
    });
  });

  describe('getDependents', () => {
    it('returns empty array', async () => {
      const backend = makeBackend();
      expect(await backend.getDependents('issue-42')).toEqual([]);
      expect(await backend.getDependents('epic-5')).toEqual([]);
    });
  });

  describe('getItemUrl', () => {
    it('returns the issue web_url from API', () => {
      const backend = makeBackend();
      mockGlabSync.mockReturnValueOnce({
        web_url: 'https://gitlab.com/mygroup/project/-/issues/5',
      });

      const url = backend.getItemUrl('issue-5');
      expect(url).toBe('https://gitlab.com/mygroup/project/-/issues/5');
    });

    it('returns the epic URL constructed from group path', () => {
      const backend = makeBackend();
      const url = backend.getItemUrl('epic-5');
      expect(url).toBe('https://gitlab.com/groups/mygroup/-/epics/5');
    });
  });

  describe('openItem', () => {
    it('opens an issue in the browser via glab', async () => {
      const backend = makeBackend();
      mockGlabExec.mockResolvedValue('');

      await backend.openItem('issue-5');
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });

    it('opens an epic URL via open command', async () => {
      const backend = makeBackend();

      await backend.openItem('epic-5');
      expect(mockExecFilePromisified).toHaveBeenCalledWith('open', [
        'https://gitlab.com/groups/mygroup/-/epics/5',
      ]);
    });
  });

  describe('getAssignees', () => {
    it('returns project member usernames', async () => {
      const backend = makeBackend();
      mockGlab.mockResolvedValueOnce([
        { username: 'alice' },
        { username: 'bob' },
      ]);
      expect(await backend.getAssignees()).toEqual(['alice', 'bob']);
    });

    it('returns empty array on error', async () => {
      const backend = makeBackend();
      mockGlab.mockRejectedValueOnce(new Error('API error'));
      expect(await backend.getAssignees()).toEqual([]);
    });
  });
});
