/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-argument */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { JiraBackend, escapeJqlValue } from './index.js';

vi.mock('./api.js', () => ({
  JiraApiClient: vi.fn(),
}));

vi.mock('./config.js', () => ({
  readJiraConfig: vi.fn(),
}));

vi.mock('../../auth/jira.js', () => ({
  getJiraCredentials: vi.fn(),
}));

vi.mock('open', () => ({
  default: vi.fn(),
}));

import { JiraApiClient } from './api.js';
import { readJiraConfig } from './config.js';
import { getJiraCredentials } from '../../auth/jira.js';

const mockReadJiraConfig = vi.mocked(readJiraConfig);
const mockGetJiraCredentials = vi.mocked(getJiraCredentials);
const MockJiraApiClient = vi.mocked(JiraApiClient);

const mockApi = {
  rest: vi.fn(),
  paginate: vi.fn(),
};

function mockPaginate<T>(items: T[]) {
  // eslint-disable-next-line @typescript-eslint/require-await
  return async function* () {
    if (items.length > 0) yield items;
  };
}

function makeJiraIssue(overrides: {
  key: string;
  summary?: string;
  description?: unknown;
  status?: string;
  issuetype?: string;
  priority?: string | null;
  assignee?: { displayName: string; emailAddress: string } | null;
  labels?: string[];
  sprint?: { name: string } | null;
  created?: string;
  updated?: string;
  parent?: { key: string } | null;
  issuelinks?: {
    type: { name: string; inward: string; outward: string };
    inwardIssue?: { key: string };
    outwardIssue?: { key: string };
  }[];
}) {
  return {
    key: overrides.key,
    fields: {
      summary: overrides.summary ?? `Issue ${overrides.key}`,
      description: overrides.description ?? '',
      status: { name: overrides.status ?? 'To Do' },
      issuetype: { name: overrides.issuetype ?? 'Task' },
      priority:
        overrides.priority !== undefined
          ? overrides.priority
            ? { name: overrides.priority }
            : null
          : { name: 'Medium' },
      assignee: overrides.assignee ?? null,
      labels: overrides.labels ?? [],
      sprint: overrides.sprint ?? null,
      created: overrides.created ?? '2026-01-01T00:00:00.000+0000',
      updated: overrides.updated ?? '2026-01-02T00:00:00.000+0000',
      parent: overrides.parent ?? null,
      issuelinks: overrides.issuelinks ?? [],
    },
  };
}

describe('JiraBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    MockJiraApiClient.mockImplementation(function (this: any) {
      Object.assign(this, mockApi);
    } as any);
    mockGetJiraCredentials.mockReturnValue({
      email: 'user@example.com',
      token: 'test-token',
    });
    mockReadJiraConfig.mockResolvedValue({
      site: 'https://mycompany.atlassian.net',
      project: 'TEAM',
      boardId: 6,
    });
    mockApi.rest.mockResolvedValue({});
  });

  describe('create', () => {
    it('gets credentials and validates auth via REST', async () => {
      await JiraBackend.create('/repo');
      expect(mockGetJiraCredentials).toHaveBeenCalledWith(
        'mycompany.atlassian.net',
      );
      expect(MockJiraApiClient).toHaveBeenCalledWith(
        'user@example.com',
        'test-token',
        'mycompany.atlassian.net',
      );
      expect(mockApi.rest).toHaveBeenCalledWith('GET', '/api/3/myself');
    });

    it('throws when no credentials found', async () => {
      mockGetJiraCredentials.mockReturnValue(null);
      await expect(JiraBackend.create('/repo')).rejects.toThrow(
        /No Jira credentials found/,
      );
    });

    it('skips auth validation when skipAuth is true', async () => {
      await JiraBackend.create('/repo', { skipAuth: true });
      expect(mockApi.rest).not.toHaveBeenCalledWith('GET', '/api/3/myself');
    });
  });

  describe('getCapabilities', () => {
    it('returns Jira-specific capabilities', async () => {
      const backend = await JiraBackend.create('/repo');
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.customTypes).toBe(false);
      expect(caps.customStatuses).toBe(false);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.fields.priority).toBe(true);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(true);
    });

    it('disables iterations when boardId not configured', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(backend.getCapabilities().iterations).toBe(false);
    });
  });

  describe('getStatuses', () => {
    it('returns statuses from project workflow (grouped format)', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue([
        {
          statuses: [{ name: 'To Do' }, { name: 'In Progress' }],
        },
        {
          statuses: [{ name: 'Done' }, { name: 'To Do' }],
        },
      ]);
      const statuses = await backend.getStatuses();
      expect(statuses).toEqual(['to do', 'in progress', 'done']);
    });
  });

  describe('getClosedStatuses', () => {
    it('returns statuses with done statusCategory', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue([
        {
          statuses: [
            {
              name: 'To Do',
              statusCategory: { key: 'new' },
            },
            {
              name: 'In Progress',
              statusCategory: { key: 'indeterminate' },
            },
          ],
        },
        {
          statuses: [
            {
              name: 'Done',
              statusCategory: { key: 'done' },
            },
            {
              name: 'Closed',
              statusCategory: { key: 'done' },
            },
          ],
        },
      ]);
      const closed = await backend.getClosedStatuses();
      expect(closed).toContain('done');
      expect(closed).toContain('closed');
      expect(closed).not.toContain('to do');
      expect(closed).not.toContain('in progress');
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue types from project config', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue({
        issueTypes: [
          { name: 'Epic' },
          { name: 'Story' },
          { name: 'Task' },
          { name: 'Bug' },
        ],
      });
      const types = await backend.getWorkItemTypes();
      expect(types).toEqual(['epic', 'story', 'task', 'bug']);
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.paginate.mockImplementation(
        mockPaginate([
          makeJiraIssue({
            key: 'TEAM-1',
            summary: 'First',
            status: 'To Do',
            assignee: {
              displayName: 'Alice',
              emailAddress: 'alice@example.com',
            },
            labels: ['bug'],
          }),
          makeJiraIssue({
            key: 'TEAM-2',
            summary: 'Second',
            status: 'Done',
          }),
        ]),
      );

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('TEAM-1');
      expect(items[0]!.status).toBe('to do');
      expect(items[0]!.assignee).toBe('alice@example.com');
      expect(items[1]!.id).toBe('TEAM-2');
      expect(items[1]!.status).toBe('done');
    });

    it('filters by sprint when iteration provided', async () => {
      const backend = await JiraBackend.create('/repo');
      // First call: fetchSprints
      mockApi.rest.mockResolvedValueOnce({
        values: [{ id: 42, name: 'Sprint 5', state: 'active' }],
      });
      // Then paginate for search
      mockApi.paginate.mockImplementation(
        mockPaginate([
          makeJiraIssue({ key: 'TEAM-1', sprint: { name: 'Sprint 5' } }),
        ]),
      );

      const items = await backend.listWorkItems('Sprint 5');
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('TEAM-1');
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce(
          makeJiraIssue({
            key: 'TEAM-42',
            summary: 'The issue',
            assignee: {
              displayName: 'Bob',
              emailAddress: 'bob@example.com',
            },
            labels: ['feature'],
          }),
        )
        .mockResolvedValueOnce({ comments: [] });

      const item = await backend.getWorkItem('TEAM-42');
      expect(item.id).toBe('TEAM-42');
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob@example.com');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce({ key: 'TEAM-10' })
        .mockResolvedValueOnce(
          makeJiraIssue({
            key: 'TEAM-10',
            summary: 'New issue',
            issuetype: 'Task',
          }),
        )
        .mockResolvedValueOnce({ comments: [] });

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('TEAM-10');
    });

    it('sets parent when specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce({ key: 'TEAM-11' })
        .mockResolvedValueOnce(
          makeJiraIssue({ key: 'TEAM-11', parent: { key: 'TEAM-5' } }),
        )
        .mockResolvedValueOnce({ comments: [] });

      await backend.createWorkItem({
        title: 'Child issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: 'TEAM-5',
        dependsOn: [],
      });

      expect(mockApi.rest).toHaveBeenCalledWith(
        'POST',
        '/api/3/issue',
        expect.objectContaining({
          fields: expect.objectContaining({
            parent: { key: 'TEAM-5' },
          }),
        }),
      );
    });

    it('creates dependency links when dependsOn specified', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce({ key: 'TEAM-12' }) // create issue
        .mockResolvedValueOnce(undefined) // create issueLink
        .mockResolvedValueOnce(
          makeJiraIssue({
            key: 'TEAM-12',
            issuelinks: [
              {
                type: {
                  name: 'Blocks',
                  inward: 'is blocked by',
                  outward: 'blocks',
                },
                inwardIssue: { key: 'TEAM-3' },
              },
            ],
          }),
        ) // getWorkItem
        .mockResolvedValueOnce({ comments: [] }); // comments

      await backend.createWorkItem({
        title: 'Blocked issue',
        type: 'task',
        status: 'to do',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: ['TEAM-3'],
      });

      expect(mockApi.rest).toHaveBeenCalledWith('POST', '/api/3/issueLink', {
        type: { name: 'Blocks' },
        inwardIssue: { key: 'TEAM-12' },
        outwardIssue: { key: 'TEAM-3' },
      });
    });

    it('rolls back created issue when dependency link creation fails', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce({ key: 'TEAM-42' }) // create issue
        .mockRejectedValueOnce(new Error('link creation failed')) // create issueLink
        .mockResolvedValueOnce(undefined); // delete (rollback)

      await expect(
        backend.createWorkItem({
          title: 'Issue with deps',
          type: 'task',
          status: 'to do',
          iteration: '',
          priority: 'medium',
          assignee: '',
          labels: [],
          description: '',
          parent: null,
          dependsOn: ['TEAM-1'],
        }),
      ).rejects.toThrow('Failed to create dependency links');

      expect(mockApi.rest).toHaveBeenCalledWith(
        'DELETE',
        '/api/3/issue/TEAM-42',
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates title via PUT', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce(undefined) // PUT fields
        .mockResolvedValueOnce(
          makeJiraIssue({ key: 'TEAM-5', summary: 'Updated title' }),
        )
        .mockResolvedValueOnce({ comments: [] });

      const item = await backend.updateWorkItem('TEAM-5', {
        title: 'Updated title',
      });

      expect(item.title).toBe('Updated title');
      expect(mockApi.rest).toHaveBeenCalledWith(
        'PUT',
        '/api/3/issue/TEAM-5',
        expect.objectContaining({
          fields: expect.objectContaining({
            summary: 'Updated title',
          }),
        }),
      );
    });

    it('transitions status via transition lookup', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce({
          transitions: [
            { id: '31', name: 'Done' },
            { id: '21', name: 'In Progress' },
          ],
        }) // GET transitions
        .mockResolvedValueOnce(undefined) // POST transition
        .mockResolvedValueOnce(makeJiraIssue({ key: 'TEAM-5', status: 'Done' }))
        .mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('TEAM-5', { status: 'done' });

      expect(mockApi.rest).toHaveBeenCalledWith(
        'POST',
        '/api/3/issue/TEAM-5/transitions',
        { transition: { id: '31' } },
      );
    });

    it('updates priority via PUT', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce(undefined) // PUT
        .mockResolvedValueOnce(
          makeJiraIssue({ key: 'TEAM-5', priority: 'High' }),
        )
        .mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('TEAM-5', { priority: 'high' });

      expect(mockApi.rest).toHaveBeenCalledWith(
        'PUT',
        '/api/3/issue/TEAM-5',
        expect.objectContaining({
          fields: expect.objectContaining({
            priority: { name: 'High' },
          }),
        }),
      );
    });

    it('assigns via PUT fields', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest
        .mockResolvedValueOnce(undefined) // PUT fields
        .mockResolvedValueOnce(
          makeJiraIssue({
            key: 'TEAM-5',
            assignee: {
              displayName: 'Alice',
              emailAddress: 'alice@example.com',
            },
          }),
        )
        .mockResolvedValueOnce({ comments: [] });

      await backend.updateWorkItem('TEAM-5', {
        assignee: 'alice@example.com',
      });

      expect(mockApi.rest).toHaveBeenCalledWith(
        'PUT',
        '/api/3/issue/TEAM-5',
        expect.objectContaining({
          fields: expect.objectContaining({
            assignee: { id: 'alice@example.com' },
          }),
        }),
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes a work item', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue(undefined);
      await backend.deleteWorkItem('TEAM-7');
      expect(mockApi.rest).toHaveBeenCalledWith(
        'DELETE',
        '/api/3/issue/TEAM-7',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue(undefined);

      const comment = await backend.addComment('TEAM-3', {
        author: 'alice@example.com',
        body: 'This is a comment.',
      });

      expect(mockApi.rest).toHaveBeenCalledWith(
        'POST',
        '/api/3/issue/TEAM-3/comment',
        {
          body: {
            type: 'doc',
            version: 1,
            content: [
              {
                type: 'paragraph',
                content: [{ type: 'text', text: 'This is a comment.' }],
              },
            ],
          },
        },
      );
      expect(comment.author).toBe('alice@example.com');
      expect(comment.body).toBe('This is a comment.');
    });
  });

  describe('getChildren', () => {
    it('returns items whose parent matches the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.paginate.mockImplementation(
        mockPaginate([
          makeJiraIssue({ key: 'TEAM-2', parent: { key: 'TEAM-1' } }),
          makeJiraIssue({ key: 'TEAM-3', parent: { key: 'TEAM-1' } }),
        ]),
      );

      const children = await backend.getChildren('TEAM-1');
      expect(children).toHaveLength(2);
    });
  });

  describe('getDependents', () => {
    it('returns items that depend on the given id', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.paginate.mockImplementation(
        mockPaginate([
          makeJiraIssue({
            key: 'TEAM-5',
            issuelinks: [
              {
                type: {
                  name: 'Blocks',
                  inward: 'is blocked by',
                  outward: 'blocks',
                },
                inwardIssue: { key: 'TEAM-3' },
              },
            ],
          }),
        ]),
      );

      const dependents = await backend.getDependents('TEAM-3');
      expect(dependents).toHaveLength(1);
      expect(dependents[0]!.id).toBe('TEAM-5');
    });
  });

  describe('getItemUrl', () => {
    it('returns the Jira browse URL', async () => {
      const backend = await JiraBackend.create('/repo');
      expect(backend.getItemUrl('TEAM-42')).toBe(
        'https://mycompany.atlassian.net/browse/TEAM-42',
      );
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = await JiraBackend.create('/repo');
      const openModule = await import('open');
      const mockOpen = vi.mocked(openModule.default);
      mockOpen.mockResolvedValue(undefined as never);

      await backend.openItem('TEAM-5');
      expect(mockOpen).toHaveBeenCalledWith(
        'https://mycompany.atlassian.net/browse/TEAM-5',
      );
    });
  });

  describe('getIterations', () => {
    it('returns sprint names from board', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue({
        values: [
          { id: 1, name: 'Sprint 1', state: 'closed' },
          { id: 2, name: 'Sprint 2', state: 'active' },
          { id: 3, name: 'Sprint 3', state: 'future' },
        ],
      });
      const iterations = await backend.getIterations();
      expect(iterations).toEqual([
        { name: 'Sprint 1', startDate: null, endDate: null },
        { name: 'Sprint 2', startDate: null, endDate: null },
        { name: 'Sprint 3', startDate: null, endDate: null },
      ]);
    });

    it('returns empty array when no boardId', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: 'TEAM',
      });
      const backend = await JiraBackend.create('/repo');
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getAssignees', () => {
    it('returns unique assignee emails', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue([
        { displayName: 'Alice', emailAddress: 'alice@example.com' },
        { displayName: 'Bob', emailAddress: 'bob@example.com' },
      ]);
      const assignees = await backend.getAssignees();
      expect(assignees).toContain('alice@example.com');
      expect(assignees).toContain('bob@example.com');
    });

    it('returns empty array on error', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockRejectedValue(new Error('API error'));
      expect(await backend.getAssignees()).toEqual([]);
    });
  });

  describe('escapeJqlValue', () => {
    it('wraps a simple value in single quotes', () => {
      expect(escapeJqlValue('TEAM')).toBe("'TEAM'");
    });

    it('doubles embedded single quotes', () => {
      expect(escapeJqlValue("My Project' OR 1=1 --")).toBe(
        "'My Project'' OR 1=1 --'",
      );
    });

    it('handles multiple embedded quotes', () => {
      expect(escapeJqlValue("it's a 'test'")).toBe("'it''s a ''test'''");
    });
  });

  describe('JQL injection prevention', () => {
    it('escapes project names with JQL special characters in listWorkItems', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: "My Project' OR 1=1 --",
        boardId: 6,
      });
      const backend = await JiraBackend.create('/repo');
      mockApi.paginate.mockImplementation(mockPaginate([]));

      await backend.listWorkItems();

      expect(mockApi.paginate).toHaveBeenCalledWith(
        expect.stringContaining(
          encodeURIComponent("project = 'My Project'' OR 1=1 --'"),
        ),
      );
    });

    it('escapes project names in sprint-filtered listWorkItems', async () => {
      mockReadJiraConfig.mockResolvedValue({
        site: 'https://mycompany.atlassian.net',
        project: "My Project' OR 1=1 --",
        boardId: 6,
      });
      const backend = await JiraBackend.create('/repo');
      // fetchSprints
      mockApi.rest.mockResolvedValueOnce({
        values: [{ id: 42, name: 'Sprint 5', state: 'active' }],
      });
      mockApi.paginate.mockImplementation(mockPaginate([]));

      await backend.listWorkItems('Sprint 5');

      expect(mockApi.paginate).toHaveBeenCalledWith(
        expect.stringContaining(
          encodeURIComponent("project = 'My Project'' OR 1=1 --'"),
        ),
      );
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = await JiraBackend.create('/repo');
      await expect(
        backend.setCurrentIteration('Sprint 5'),
      ).resolves.not.toThrow();
    });
  });

  describe('getCurrentIteration', () => {
    it('returns active sprint name', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue({
        values: [{ id: 2, name: 'Sprint 2', state: 'active' }],
      });
      expect(await backend.getCurrentIteration()).toBe('Sprint 2');
    });

    it('returns empty string when no active sprint', async () => {
      const backend = await JiraBackend.create('/repo');
      mockApi.rest.mockResolvedValue({ values: [] });
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });
});
