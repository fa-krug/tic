/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/require-await, require-yield */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabBackend } from './index.js';
import type { GlWorkItem } from './mappers.js';

// Mock the auth module
vi.mock('../../auth/gitlab.js', () => ({
  getGitLabToken: vi.fn(),
  getGitLabPat: vi.fn(),
}));

// Mock the remote detection
vi.mock('./remote.js', () => ({
  parseGitLabRemote: vi.fn().mockReturnValue({
    host: 'gitlab.com',
    group: 'mygroup',
    project: 'myproject',
    fullPath: 'mygroup/myproject',
  }),
}));

// Mock the API client
const { mockGraphql, mockPaginate } = vi.hoisted(() => {
  const mockGraphql = vi.fn();
  const mockPaginate = vi.fn();
  return { mockGraphql, mockPaginate };
});

vi.mock('./api.js', () => ({
  GitLabApiClient: class {
    graphql = mockGraphql;
    paginate = mockPaginate;
  },
}));

// Mock the open module
vi.mock('open', () => ({
  default: vi.fn(),
}));

// Mock node:fs/promises
vi.mock('node:fs/promises', () => ({
  readdir: vi.fn(),
  readFile: vi.fn(),
  writeFile: vi.fn(),
  mkdir: vi.fn(),
  unlink: vi.fn(),
}));

import { getGitLabToken, getGitLabPat } from '../../auth/gitlab.js';
import * as fsPromises from 'node:fs/promises';

const mockGetToken = vi.mocked(getGitLabToken);
const mockGetPat = vi.mocked(getGitLabPat);
const mockReaddir = vi.mocked(fsPromises.readdir);
const mockReadFile = vi.mocked(fsPromises.readFile);
const mockWriteFile = vi.mocked(fsPromises.writeFile);
const mockMkdir = vi.mocked(fsPromises.mkdir);
const mockUnlink = vi.mocked(fsPromises.unlink);

function makeGlWorkItem(
  overrides: Partial<GlWorkItem> & { iid?: string } = {},
): GlWorkItem {
  return {
    id: 'gid://gitlab/WorkItem/100',
    iid: '42',
    title: 'Fix login bug',
    state: 'OPEN',
    workItemType: { name: 'Issue' },
    widgets: [
      {
        __typename: 'WorkItemWidgetDescription',
        description: 'The login form breaks.',
      },
      {
        __typename: 'WorkItemWidgetAssignees',
        assignees: { nodes: [{ username: 'alice' }] },
      },
      {
        __typename: 'WorkItemWidgetLabels',
        labels: { nodes: [{ title: 'bug' }] },
      },
      {
        __typename: 'WorkItemWidgetMilestone',
        milestone: { title: 'v1.0' },
      },
      {
        __typename: 'WorkItemWidgetHierarchy',
        parent: null,
      },
    ],
    createdAt: '2026-01-15T10:00:00Z',
    updatedAt: '2026-01-20T14:30:00Z',
    ...overrides,
  };
}

function makeEpicGlWorkItem(overrides: Partial<GlWorkItem> = {}): GlWorkItem {
  return {
    id: 'gid://gitlab/WorkItem/200',
    iid: '5',
    title: 'Big feature',
    state: 'OPEN',
    workItemType: { name: 'Epic' },
    widgets: [
      {
        __typename: 'WorkItemWidgetDescription',
        description: 'Epic description.',
      },
      {
        __typename: 'WorkItemWidgetLabels',
        labels: { nodes: [{ title: 'feature' }] },
      },
    ],
    createdAt: '2026-01-10T00:00:00Z',
    updatedAt: '2026-01-18T00:00:00Z',
    ...overrides,
  };
}

// Work item types response for create()
const workItemTypesResponse = {
  project: {
    workItemTypes: {
      nodes: [
        { id: 'gid://gitlab/WorkItems::Type/1', name: 'Issue' },
        { id: 'gid://gitlab/WorkItems::Type/2', name: 'Epic' },
        { id: 'gid://gitlab/WorkItems::Type/3', name: 'Task' },
      ],
    },
  },
};

async function makeBackend(): Promise<GitLabBackend> {
  mockGetToken.mockReturnValue('test-token');
  mockGraphql.mockResolvedValueOnce(workItemTypesResponse);
  return GitLabBackend.create('/repo');
}

describe('GitLabBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('create()', () => {
    it('creates backend with OAuth token', async () => {
      mockGetToken.mockReturnValue('oauth-token');
      mockGraphql.mockResolvedValueOnce(workItemTypesResponse);

      const backend = await GitLabBackend.create('/repo');
      expect(backend).toBeInstanceOf(GitLabBackend);
    });

    it('creates backend with PAT when no OAuth token', async () => {
      mockGetToken.mockReturnValue(null);
      mockGetPat.mockReturnValue('pat-token');
      mockGraphql.mockResolvedValueOnce(workItemTypesResponse);

      const backend = await GitLabBackend.create('/repo');
      expect(backend).toBeInstanceOf(GitLabBackend);
    });

    it('throws AuthError with skipAuth when no token', async () => {
      mockGetToken.mockReturnValue(null);
      mockGetPat.mockReturnValue(null);

      await expect(
        GitLabBackend.create('/repo', { skipAuth: true }),
      ).rejects.toThrow('GitLab authentication required');
    });

    it('throws AuthError without skipAuth when no token', async () => {
      mockGetToken.mockReturnValue(null);
      mockGetPat.mockReturnValue(null);

      await expect(GitLabBackend.create('/repo')).rejects.toThrow(
        'GitLab authentication required',
      );
    });
  });

  describe('getCapabilities', () => {
    it('returns GitLab-specific capabilities', async () => {
      const backend = await makeBackend();
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
      expect(caps.templates).toBe(true);
    });
  });

  describe('getStatuses', () => {
    it('returns open and closed', async () => {
      const backend = await makeBackend();
      expect(await backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns epic and issue', async () => {
      const backend = await makeBackend();
      expect(await backend.getWorkItemTypes()).toEqual(['epic', 'issue']);
    });
  });

  describe('listWorkItems', () => {
    it('returns merged issues and epics sorted by updated desc', async () => {
      const backend = await makeBackend();

      const issue1 = makeGlWorkItem({
        id: 'gid://gitlab/WorkItem/1',
        iid: '1',
        updatedAt: '2026-01-20T00:00:00Z',
      });
      const issue2 = makeGlWorkItem({
        id: 'gid://gitlab/WorkItem/2',
        iid: '2',
        updatedAt: '2026-01-18T00:00:00Z',
      });
      const epic1 = makeEpicGlWorkItem({
        id: 'gid://gitlab/WorkItem/3',
        iid: '1',
        updatedAt: '2026-01-19T00:00:00Z',
      });

      // paginate returns async generators
      mockPaginate
        .mockReturnValueOnce(
          (async function* () {
            yield [issue1, issue2];
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield [epic1];
          })(),
        );

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(3);
      expect(items[0]!.id).toBe('issue-1');
      expect(items[1]!.id).toBe('epic-1');
      expect(items[2]!.id).toBe('issue-2');
    });

    it('filters issues by iteration', async () => {
      const backend = await makeBackend();

      const issue1 = makeGlWorkItem({
        id: 'gid://gitlab/WorkItem/1',
        iid: '1',
        widgets: [
          {
            __typename: 'WorkItemWidgetMilestone',
            milestone: { title: 'v1.0' },
          },
        ],
        updatedAt: '2026-01-20T00:00:00Z',
      });
      const issue2 = makeGlWorkItem({
        id: 'gid://gitlab/WorkItem/2',
        iid: '2',
        widgets: [
          {
            __typename: 'WorkItemWidgetMilestone',
            milestone: { title: 'v2.0' },
          },
        ],
        updatedAt: '2026-01-18T00:00:00Z',
      });

      mockPaginate
        .mockReturnValueOnce(
          (async function* () {
            yield [issue1, issue2];
          })(),
        )
        .mockReturnValueOnce(
          (async function* () {
            yield [];
          })(),
        );

      const items = await backend.listWorkItems('v1.0');
      expect(items).toHaveLength(1);
      expect(items[0]!.iteration).toBe('v1.0');
    });
  });

  describe('getWorkItem', () => {
    it('returns an issue with comments', async () => {
      const backend = await makeBackend();

      const glItem = makeGlWorkItem({
        widgets: [
          ...makeGlWorkItem().widgets,
          {
            __typename: 'WorkItemWidgetNotes',
            discussions: {
              nodes: [
                {
                  notes: {
                    nodes: [
                      {
                        author: { username: 'charlie' },
                        createdAt: '2026-01-16T09:00:00Z',
                        body: 'I can reproduce this.',
                      },
                    ],
                  },
                },
              ],
            },
          },
        ],
      });

      // First call: lookup GID
      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/100',
                iid: '42',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      // Second call: get work item
      mockGraphql.mockResolvedValueOnce({ workItem: glItem });

      const item = await backend.getWorkItem('issue-42');
      expect(item.id).toBe('issue-42');
      expect(item.title).toBe('Fix login bug');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('charlie');
    });

    it('returns an epic', async () => {
      const backend = await makeBackend();

      const glItem = makeEpicGlWorkItem();

      // Lookup GID at group level
      mockGraphql.mockResolvedValueOnce({
        group: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/200',
                iid: '5',
                workItemType: { name: 'Epic' },
              },
            ],
          },
        },
      });
      // Get work item
      mockGraphql.mockResolvedValueOnce({ workItem: glItem });

      const item = await backend.getWorkItem('epic-5');
      expect(item.id).toBe('epic-5');
      expect(item.title).toBe('Big feature');
      expect(item.type).toBe('epic');
    });

    it('throws on invalid ID format', async () => {
      const backend = await makeBackend();
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
      const backend = await makeBackend();

      const createdGl = makeGlWorkItem({
        id: 'gid://gitlab/WorkItem/300',
        iid: '10',
        title: 'New issue',
      });

      // Create mutation
      mockGraphql.mockResolvedValueOnce({
        workItemCreate: { workItem: createdGl, errors: [] },
      });
      // Update mutation for assignee/labels
      const updatedGl = makeGlWorkItem({
        ...createdGl,
        widgets: [...createdGl.widgets],
      });
      mockGraphql.mockResolvedValueOnce({
        workItemUpdate: { workItem: updatedGl, errors: [] },
      });

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: 'alice',
        labels: ['bug'],
        description: 'Description',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('issue-10');
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemCreate'),
        expect.objectContaining({
          input: expect.objectContaining({
            title: 'New issue',
            namespacePath: 'mygroup/myproject',
          }),
        }),
      );
    });

    it('creates an epic via API', async () => {
      const backend = await makeBackend();

      const createdGl = makeEpicGlWorkItem({
        id: 'gid://gitlab/WorkItem/400',
        iid: '8',
        title: 'New epic',
      });

      mockGraphql.mockResolvedValueOnce({
        workItemCreate: { workItem: createdGl, errors: [] },
      });

      const item = await backend.createWorkItem({
        title: 'New epic',
        type: 'epic',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: 'Epic desc',
        parent: null,
        dependsOn: [],
      });

      expect(item.id).toBe('epic-8');
      expect(item.type).toBe('epic');
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemCreate'),
        expect.objectContaining({
          input: expect.objectContaining({
            namespacePath: 'mygroup',
          }),
        }),
      );
    });

    it('throws when create returns errors', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        workItemCreate: {
          workItem: null,
          errors: ['Title too short'],
        },
      });

      await expect(
        backend.createWorkItem({
          title: '',
          type: 'issue',
          status: 'open',
          iteration: '',
          priority: 'medium',
          assignee: '',
          labels: [],
          description: '',
          parent: null,
          dependsOn: [],
        }),
      ).rejects.toThrow('Failed to create work item: Title too short');
    });
  });

  describe('updateWorkItem', () => {
    it('updates issue title and description', async () => {
      const backend = await makeBackend();

      const updatedGl = makeGlWorkItem({
        iid: '5',
        title: 'Updated title',
      });

      // Lookup GID
      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/500',
                iid: '5',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      // Update mutation
      mockGraphql.mockResolvedValueOnce({
        workItemUpdate: { workItem: updatedGl, errors: [] },
      });

      const item = await backend.updateWorkItem('issue-5', {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
    });

    it('closes an issue with stateEvent CLOSE', async () => {
      const backend = await makeBackend();

      const closedGl = makeGlWorkItem({
        iid: '5',
        state: 'CLOSED',
      });

      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/500',
                iid: '5',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        workItemUpdate: { workItem: closedGl, errors: [] },
      });

      const item = await backend.updateWorkItem('issue-5', {
        status: 'closed',
      });
      expect(item.status).toBe('closed');
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemUpdate'),
        expect.objectContaining({
          input: expect.objectContaining({
            stateEvent: 'CLOSE',
          }),
        }),
      );
    });

    it('reopens an issue with stateEvent REOPEN', async () => {
      const backend = await makeBackend();

      const openGl = makeGlWorkItem({ iid: '5', state: 'OPEN' });

      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/500',
                iid: '5',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        workItemUpdate: { workItem: openGl, errors: [] },
      });

      await backend.updateWorkItem('issue-5', { status: 'open' });
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemUpdate'),
        expect.objectContaining({
          input: expect.objectContaining({
            stateEvent: 'REOPEN',
          }),
        }),
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/700',
                iid: '7',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        workItemDelete: { errors: [] },
      });

      await backend.deleteWorkItem('issue-7');
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemDelete'),
        expect.objectContaining({
          input: { id: 'gid://gitlab/WorkItem/700' },
        }),
      );
    });

    it('deletes an epic', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        group: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/300',
                iid: '3',
                workItemType: { name: 'Epic' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        workItemDelete: { errors: [] },
      });

      await backend.deleteWorkItem('epic-3');
      expect(mockGraphql).toHaveBeenCalledWith(
        expect.stringContaining('workItemDelete'),
        expect.objectContaining({
          input: { id: 'gid://gitlab/WorkItem/300' },
        }),
      );
    });

    it('throws when delete returns errors', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/700',
                iid: '7',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        workItemDelete: { errors: ['Not authorized'] },
      });

      await expect(backend.deleteWorkItem('issue-7')).rejects.toThrow(
        'Failed to delete work item: Not authorized',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment to an issue', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        project: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/300',
                iid: '3',
                workItemType: { name: 'Issue' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        createNote: {
          note: {
            id: 'gid://gitlab/Note/1',
            body: 'This is a comment.',
            author: { username: 'alice' },
            createdAt: '2026-01-20T00:00:00Z',
          },
          errors: [],
        },
      });

      const comment = await backend.addComment('issue-3', {
        author: 'alice',
        body: 'This is a comment.',
      });

      expect(comment.author).toBe('alice');
      expect(comment.body).toBe('This is a comment.');
      expect(comment.date).toBeDefined();
    });

    it('adds a comment to an epic', async () => {
      const backend = await makeBackend();

      mockGraphql.mockResolvedValueOnce({
        group: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/200',
                iid: '5',
                workItemType: { name: 'Epic' },
              },
            ],
          },
        },
      });
      mockGraphql.mockResolvedValueOnce({
        createNote: {
          note: {
            id: 'gid://gitlab/Note/2',
            body: 'Epic comment.',
            author: { username: 'bob' },
            createdAt: '2026-01-20T00:00:00Z',
          },
          errors: [],
        },
      });

      const comment = await backend.addComment('epic-5', {
        author: 'bob',
        body: 'Epic comment.',
      });

      expect(comment.author).toBe('bob');
      expect(comment.body).toBe('Epic comment.');
    });
  });

  describe('getChildren', () => {
    it('returns empty array for issues', async () => {
      const backend = await makeBackend();
      expect(await backend.getChildren('issue-42')).toEqual([]);
    });

    it('returns epic children as WorkItems', async () => {
      const backend = await makeBackend();

      // Lookup GID
      mockGraphql.mockResolvedValueOnce({
        group: {
          workItems: {
            nodes: [
              {
                id: 'gid://gitlab/WorkItem/200',
                iid: '5',
                workItemType: { name: 'Epic' },
              },
            ],
          },
        },
      });
      // Get work item with children
      mockGraphql.mockResolvedValueOnce({
        workItem: {
          ...makeEpicGlWorkItem(),
          widgets: [
            ...makeEpicGlWorkItem().widgets,
            {
              __typename: 'WorkItemWidgetHierarchy',
              parent: null,
              children: {
                nodes: [
                  {
                    id: 'gid://gitlab/WorkItem/10',
                    iid: '10',
                    title: 'Child 1',
                    state: 'OPEN',
                    workItemType: { name: 'Issue' },
                  },
                  {
                    id: 'gid://gitlab/WorkItem/11',
                    iid: '11',
                    title: 'Child 2',
                    state: 'CLOSED',
                    workItemType: { name: 'Issue' },
                  },
                ],
              },
            },
          ],
        },
      });

      const children = await backend.getChildren('epic-5');
      expect(children).toHaveLength(2);
      expect(children[0]!.id).toBe('issue-10');
      expect(children[0]!.status).toBe('open');
      expect(children[1]!.id).toBe('issue-11');
      expect(children[1]!.status).toBe('closed');
    });
  });

  describe('getDependents', () => {
    it('returns empty array', async () => {
      const backend = await makeBackend();
      expect(await backend.getDependents('issue-42')).toEqual([]);
      expect(await backend.getDependents('epic-5')).toEqual([]);
    });
  });

  describe('getAssignees', () => {
    it('returns project member usernames', async () => {
      const backend = await makeBackend();
      mockPaginate.mockReturnValueOnce(
        (async function* () {
          yield [
            { user: { username: 'alice' } },
            { user: { username: 'bob' } },
          ];
        })(),
      );
      expect(await backend.getAssignees()).toEqual(['alice', 'bob']);
    });

    it('returns empty array on error', async () => {
      const backend = await makeBackend();
      mockPaginate.mockReturnValueOnce(
        (async function* () {
          throw new Error('API error');
        })(),
      );
      expect(await backend.getAssignees()).toEqual([]);
    });
  });

  describe('getIterations', () => {
    it('returns milestone titles', async () => {
      const backend = await makeBackend();
      mockPaginate.mockReturnValueOnce(
        (async function* () {
          yield [
            {
              title: 'Sprint 1',
              startDate: '2026-01-01',
              dueDate: '2026-01-14',
            },
            {
              title: 'Sprint 2',
              startDate: '2026-01-15',
              dueDate: '2026-01-28',
            },
          ];
        })(),
      );
      expect(await backend.getIterations()).toEqual(['Sprint 1', 'Sprint 2']);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns iteration that spans today', async () => {
      const backend = await makeBackend();
      mockPaginate.mockReturnValueOnce(
        (async function* () {
          yield [
            {
              title: 'Past Sprint',
              startDate: '2020-01-01',
              dueDate: '2020-01-14',
            },
            {
              title: 'Current Sprint',
              startDate: '2020-01-01',
              dueDate: '2030-12-31',
            },
          ];
        })(),
      );
      expect(await backend.getCurrentIteration()).toBe('Current Sprint');
    });

    it('returns empty string when no current iteration', async () => {
      const backend = await makeBackend();
      mockPaginate.mockReturnValueOnce(
        (async function* () {
          yield [
            {
              title: 'Past Sprint',
              startDate: '2020-01-01',
              dueDate: '2020-01-14',
            },
          ];
        })(),
      );
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = await makeBackend();
      await expect(
        backend.setCurrentIteration('Sprint 1'),
      ).resolves.not.toThrow();
    });
  });

  describe('getItemUrl', () => {
    it('returns the issue URL', async () => {
      const backend = await makeBackend();
      const url = backend.getItemUrl('issue-5');
      expect(url).toBe('https://gitlab.com/mygroup/myproject/-/issues/5');
    });

    it('returns the epic URL', async () => {
      const backend = await makeBackend();
      const url = backend.getItemUrl('epic-5');
      expect(url).toBe('https://gitlab.com/groups/mygroup/-/epics/5');
    });
  });

  describe('openItem', () => {
    it('opens an issue URL in the browser', async () => {
      const backend = await makeBackend();
      const openMod = await import('open');
      await backend.openItem('issue-5');
      expect(openMod.default).toHaveBeenCalledWith(
        'https://gitlab.com/mygroup/myproject/-/issues/5',
      );
    });
  });

  describe('templates (local filesystem)', () => {
    it('lists templates from filesystem', async () => {
      const backend = await makeBackend();
      mockReaddir.mockResolvedValueOnce([
        'Bug Report.md',
        'Feature Request.md',
        'not-a-template.txt',
      ] as unknown as never);
      mockReadFile
        .mockResolvedValueOnce('Bug report body')
        .mockResolvedValueOnce('Feature request body');

      const templates = await backend.listTemplates();
      expect(templates).toHaveLength(2);
      expect(templates[0]!.name).toBe('Bug Report');
      expect(templates[0]!.description).toBe('Bug report body');
      expect(templates[1]!.name).toBe('Feature Request');
    });

    it('returns empty array when templates dir does not exist', async () => {
      const backend = await makeBackend();
      mockReaddir.mockRejectedValueOnce(
        new Error('ENOENT: no such file or directory'),
      );
      expect(await backend.listTemplates()).toEqual([]);
    });

    it('creates a template', async () => {
      const backend = await makeBackend();
      mockMkdir.mockResolvedValueOnce(undefined);
      mockWriteFile.mockResolvedValueOnce(undefined);

      const result = await backend.createTemplate({
        slug: 'bug-report',
        name: 'Bug Report',
        description: 'Template body',
      });

      expect(result.name).toBe('Bug Report');
      expect(result.description).toBe('Template body');
      expect(mockWriteFile).toHaveBeenCalledWith(
        expect.stringContaining('Bug Report.md'),
        'Template body',
        'utf-8',
      );
    });

    it('deletes a template', async () => {
      const backend = await makeBackend();
      // getTemplate calls listTemplates
      mockReaddir.mockResolvedValueOnce(['Bug Report.md'] as unknown as never);
      mockReadFile.mockResolvedValueOnce('body');
      mockUnlink.mockResolvedValueOnce(undefined);

      await backend.deleteTemplate('bug-report');
      expect(mockUnlink).toHaveBeenCalledWith(
        expect.stringContaining('Bug Report.md'),
      );
    });
  });
});
