import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabBackend } from './index.js';

// Mock the glab wrapper
vi.mock('./glab.js', () => ({
  glab: vi.fn(),
  glabExec: vi.fn(),
}));

// Mock the group detection
vi.mock('./group.js', () => ({
  detectGroup: vi.fn().mockReturnValue('mygroup'),
}));

// Mock node:child_process for the direct execFileSync import in index.ts (used by openItem for epics)
vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
  execSync: vi.fn(),
}));

import { glab, glabExec } from './glab.js';
import { execFileSync } from 'node:child_process';

const mockGlab = vi.mocked(glab);
const mockGlabExec = vi.mocked(glabExec);
const mockExecFileSync = vi.mocked(execFileSync);

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
    // Constructor calls glabExec for auth check
    mockGlabExec.mockReturnValue('');
  });

  describe('constructor', () => {
    it('verifies glab auth on construction', () => {
      makeBackend();
      expect(mockGlabExec).toHaveBeenCalledWith(['auth', 'status'], '/repo');
    });

    it('throws when glab auth fails', () => {
      mockGlabExec.mockImplementation(() => {
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
    it('returns open and closed', () => {
      const backend = makeBackend();
      expect(backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns epic and issue', () => {
      const backend = makeBackend();
      expect(backend.getWorkItemTypes()).toEqual(['epic', 'issue']);
    });
  });

  describe('getIterations', () => {
    it('returns iteration titles', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce([
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
      expect(backend.getIterations()).toEqual(['Sprint 1', 'Sprint 2']);
    });

    it('returns empty array when no iterations', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce([]);
      expect(backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns iteration that spans today', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce([
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
      expect(backend.getCurrentIteration()).toBe('Current Sprint');
    });

    it('returns empty string when no current iteration', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce([
        {
          title: 'Past Sprint',
          start_date: '2020-01-01',
          due_date: '2020-01-14',
        },
      ]);
      expect(backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', () => {
      const backend = makeBackend();
      expect(() => backend.setCurrentIteration('Sprint 1')).not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('returns merged issues and epics sorted by updated desc', () => {
      const backend = makeBackend();

      // First call: issues
      mockGlab
        .mockReturnValueOnce([
          { ...sampleIssue, iid: 1, updated_at: '2026-01-20T00:00:00Z' },
          { ...sampleIssue, iid: 2, updated_at: '2026-01-18T00:00:00Z' },
        ])
        // Second call: epics
        .mockReturnValueOnce([
          { ...sampleEpic, iid: 1, updated_at: '2026-01-19T00:00:00Z' },
        ]);

      const items = backend.listWorkItems();
      expect(items).toHaveLength(3);
      // Sorted by updated descending
      expect(items[0]!.id).toBe('issue-1');
      expect(items[1]!.id).toBe('epic-1');
      expect(items[2]!.id).toBe('issue-2');
    });

    it('filters issues by iteration', () => {
      const backend = makeBackend();

      mockGlab
        .mockReturnValueOnce([
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
        .mockReturnValueOnce([]);

      const items = backend.listWorkItems('v1.0');
      const issueItems = items.filter((i) => i.type === 'issue');
      expect(issueItems).toHaveLength(1);
      expect(issueItems[0]!.iteration).toBe('v1.0');
    });
  });

  describe('getWorkItem', () => {
    it('returns an issue with comments', () => {
      const backend = makeBackend();

      mockGlab
        .mockReturnValueOnce(sampleIssue) // issue view
        .mockReturnValueOnce([sampleNote]); // notes

      const item = backend.getWorkItem('issue-42');
      expect(item.id).toBe('issue-42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('charlie');
    });

    it('returns an epic with comments', () => {
      const backend = makeBackend();

      mockGlab
        .mockReturnValueOnce(sampleEpic) // epic view
        .mockReturnValueOnce([sampleNote]); // notes

      const item = backend.getWorkItem('epic-5');
      expect(item.id).toBe('epic-5');
      expect(item.title).toBe('Big feature');
      expect(item.type).toBe('epic');
      expect(item.comments).toHaveLength(1);
    });

    it('throws on invalid ID format', () => {
      const backend = makeBackend();
      expect(() => backend.getWorkItem('42')).toThrow(
        'Invalid GitLab ID format',
      );
      expect(() => backend.getWorkItem('task-42')).toThrow(
        'Invalid GitLab ID format',
      );
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', () => {
      const backend = makeBackend();

      mockGlabExec.mockReturnValue(
        'https://gitlab.com/mygroup/project/-/issues/10\n',
      );
      mockGlab
        .mockReturnValueOnce({
          ...sampleIssue,
          iid: 10,
          title: 'New issue',
        })
        .mockReturnValueOnce([]); // notes

      const item = backend.createWorkItem({
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

    it('creates an epic via API', () => {
      const backend = makeBackend();

      mockGlab.mockReturnValueOnce({
        ...sampleEpic,
        iid: 8,
        title: 'New epic',
      });

      const item = backend.createWorkItem({
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
  });

  describe('updateWorkItem', () => {
    it('updates issue title and description', () => {
      const backend = makeBackend();

      mockGlabExec.mockReturnValue('');
      mockGlab
        .mockReturnValueOnce({
          ...sampleIssue,
          iid: 5,
          title: 'Updated title',
          description: 'Updated body',
        })
        .mockReturnValueOnce([]); // notes

      const item = backend.updateWorkItem('issue-5', {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
    });

    it('closes an issue when status changes to closed', () => {
      const backend = makeBackend();
      mockGlabExec.mockReturnValue('');
      mockGlab
        .mockReturnValueOnce({
          ...sampleIssue,
          iid: 5,
          state: 'closed',
        })
        .mockReturnValueOnce([]);

      backend.updateWorkItem('issue-5', { status: 'closed' });
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'close', '5'],
        '/repo',
      );
    });

    it('reopens an issue when status changes to open', () => {
      const backend = makeBackend();
      mockGlabExec.mockReturnValue('');
      mockGlab
        .mockReturnValueOnce({
          ...sampleIssue,
          iid: 5,
          state: 'opened',
        })
        .mockReturnValueOnce([]);

      backend.updateWorkItem('issue-5', { status: 'open' });
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'reopen', '5'],
        '/repo',
      );
    });

    it('updates epic via API with state_event', () => {
      const backend = makeBackend();

      // First glab call: PUT to update epic
      mockGlab.mockReturnValueOnce({ ...sampleEpic, state: 'closed' });
      // Second glab call: GET to fetch updated epic
      mockGlab.mockReturnValueOnce({ ...sampleEpic, state: 'closed' });
      // Third glab call: GET notes
      mockGlab.mockReturnValueOnce([]);

      backend.updateWorkItem('epic-5', { status: 'closed' });

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
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', () => {
      const backend = makeBackend();
      mockGlabExec.mockReturnValue('');
      backend.deleteWorkItem('issue-7');
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'delete', '7', '--yes'],
        '/repo',
      );
    });

    it('deletes an epic via API', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce({});
      backend.deleteWorkItem('epic-3');
      expect(mockGlab).toHaveBeenCalledWith(
        ['api', 'groups/mygroup/epics/3', '-X', 'DELETE'],
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment to an issue', () => {
      const backend = makeBackend();
      mockGlabExec.mockReturnValue('');

      const comment = backend.addComment('issue-3', {
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

    it('adds a comment to an epic via API', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce({});

      const comment = backend.addComment('epic-5', {
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
    it('returns empty array for issues', () => {
      const backend = makeBackend();
      expect(backend.getChildren('issue-42')).toEqual([]);
    });

    it('returns epic children as WorkItems', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce([
        { ...sampleIssue, iid: 10 },
        { ...sampleIssue, iid: 11 },
      ]);

      const children = backend.getChildren('epic-5');
      expect(children).toHaveLength(2);
      expect(children[0]!.id).toBe('issue-10');
      expect(children[1]!.id).toBe('issue-11');
    });
  });

  describe('getDependents', () => {
    it('returns empty array', () => {
      const backend = makeBackend();
      expect(backend.getDependents('issue-42')).toEqual([]);
      expect(backend.getDependents('epic-5')).toEqual([]);
    });
  });

  describe('getItemUrl', () => {
    it('returns the issue web_url from API', () => {
      const backend = makeBackend();
      mockGlab.mockReturnValueOnce({
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
    it('opens an issue in the browser via glab', () => {
      const backend = makeBackend();
      mockGlabExec.mockReturnValue('');

      backend.openItem('issue-5');
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });

    it('opens an epic URL via open command', () => {
      const backend = makeBackend();
      mockExecFileSync.mockReturnValue('');

      backend.openItem('epic-5');
      expect(mockExecFileSync).toHaveBeenCalledWith('open', [
        'https://gitlab.com/groups/mygroup/-/epics/5',
      ]);
    });
  });
});
