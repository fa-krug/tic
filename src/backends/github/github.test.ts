import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubBackend } from './index.js';
import { AuthError } from '../shared/api-client.js';

const mockRest = vi.fn();
const mockGraphql = vi.fn();
const mockPaginateResults: unknown[][] = [];
// eslint-disable-next-line @typescript-eslint/require-await
const mockPaginate = vi.fn(async function* () {
  for (const page of mockPaginateResults) {
    yield page;
  }
});

vi.mock('./api.js', () => {
  return {
    GitHubApiClient: class MockGitHubApiClient {
      rest = mockRest;
      graphql = mockGraphql;
      paginate = mockPaginate;
    },
  };
});

vi.mock('../../auth/github.js', () => ({
  getGitHubToken: vi.fn().mockReturnValue('mock-token'),
  authenticateGitHub: vi.fn(),
}));

vi.mock('open', () => ({ default: vi.fn() }));

vi.mock('node:child_process', () => ({
  execSync: vi
    .fn()
    .mockReturnValue('origin\tgit@github.com:owner/repo.git (fetch)\n'),
}));

/** Helper to build a GhIssue in the GraphQL response shape */
function makeGhIssue(overrides: {
  number: number;
  title?: string;
  body?: string | null;
  state?: string;
  assignees?: string[];
  labels?: string[];
  milestone?: string | null;
  createdAt?: string;
  updatedAt?: string;
  comments?: { author: { login: string }; createdAt: string; body: string }[];
  parent?: { number: number } | null;
}) {
  return {
    number: overrides.number,
    title: overrides.title ?? `Issue ${overrides.number}`,
    body: overrides.body ?? '',
    state: overrides.state ?? 'OPEN',
    assignees: {
      nodes: (overrides.assignees ?? []).map((login) => ({ login })),
    },
    labels: {
      nodes: (overrides.labels ?? []).map((name) => ({ name })),
    },
    milestone: overrides.milestone ? { title: overrides.milestone } : null,
    createdAt: overrides.createdAt ?? '2026-01-01T00:00:00Z',
    updatedAt: overrides.updatedAt ?? '2026-01-02T00:00:00Z',
    comments: {
      nodes: overrides.comments ?? [],
    },
    parent: overrides.parent ?? null,
  };
}

/** Helper to wrap issues in a paginated GraphQL list response */
function makeListResponse(
  issues: ReturnType<typeof makeGhIssue>[],
  hasNextPage = false,
  endCursor: string | null = null,
) {
  return {
    repository: {
      issues: {
        nodes: issues,
        pageInfo: { hasNextPage, endCursor },
      },
    },
  };
}

/** Helper to wrap an issue in a GraphQL single-issue response */
function makeGetResponse(issue: ReturnType<typeof makeGhIssue>) {
  return {
    repository: { issue },
  };
}

async function createBackend(): Promise<GitHubBackend> {
  return GitHubBackend.create('/repo');
}

describe('GitHubBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPaginateResults.length = 0;
  });

  describe('create', () => {
    it('creates a backend with token from keychain', async () => {
      const backend = await createBackend();
      expect(backend).toBeInstanceOf(GitHubBackend);
    });

    it('triggers auth flow when no token is stored', async () => {
      const { getGitHubToken } = await import('../../auth/github.js');
      const { authenticateGitHub } = await import('../../auth/github.js');
      vi.mocked(getGitHubToken).mockReturnValueOnce(null);
      vi.mocked(authenticateGitHub).mockResolvedValueOnce('new-token');

      const backend = await createBackend();
      expect(backend).toBeInstanceOf(GitHubBackend);
      expect(authenticateGitHub).toHaveBeenCalled();
    });

    it('throws AuthError when skipAuth is true and no token is stored', async () => {
      const { getGitHubToken } = await import('../../auth/github.js');
      const { authenticateGitHub } = await import('../../auth/github.js');
      vi.mocked(getGitHubToken).mockReturnValueOnce(null);

      const promise = GitHubBackend.create('/repo', { skipAuth: true });
      await expect(promise).rejects.toThrow(AuthError);
      expect(authenticateGitHub).not.toHaveBeenCalled();
    });

    it('includes helpful message in AuthError when skipAuth is true', async () => {
      const { getGitHubToken } = await import('../../auth/github.js');
      vi.mocked(getGitHubToken).mockReturnValueOnce(null);

      await expect(
        GitHubBackend.create('/repo', { skipAuth: true }),
      ).rejects.toThrow('Run "tic auth login github" to authenticate');
    });

    it('throws when git remotes do not contain github.com', async () => {
      const { execSync } = await import('node:child_process');
      vi.mocked(execSync).mockReturnValueOnce(
        'origin\tgit@gitlab.com:owner/repo.git (fetch)\n',
      );

      await expect(createBackend()).rejects.toThrow(
        'Could not detect GitHub owner/repo',
      );
    });
  });

  describe('getCapabilities', () => {
    it('returns GitHub-specific capabilities', async () => {
      const backend = await createBackend();
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
      const backend = await createBackend();
      expect(await backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue', async () => {
      const backend = await createBackend();
      expect(await backend.getWorkItemTypes()).toEqual(['issue']);
    });
  });

  describe('getIterations', () => {
    it('returns milestone titles', async () => {
      const backend = await createBackend();
      mockPaginateResults.push([
        { number: 1, title: 'v1.0', state: 'open', due_on: null },
        { number: 2, title: 'v2.0', state: 'open', due_on: null },
      ]);
      expect(await backend.getIterations()).toEqual([
        { name: 'v1.0', startDate: null, endDate: null },
        { name: 'v2.0', startDate: null, endDate: null },
      ]);
    });

    it('returns empty array when no milestones', async () => {
      const backend = await createBackend();
      // No pages pushed to mockPaginateResults means empty
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns first open milestone sorted by due date', async () => {
      const backend = await createBackend();
      mockPaginateResults.push([
        {
          number: 1,
          title: 'v1.0',
          state: 'open',
          due_on: '2026-03-01T00:00:00Z',
        },
        {
          number: 2,
          title: 'v2.0',
          state: 'open',
          due_on: '2026-06-01T00:00:00Z',
        },
      ]);
      expect(await backend.getCurrentIteration()).toBe('v1.0');
    });

    it('returns empty string when no open milestones', async () => {
      const backend = await createBackend();
      // No pages
      expect(await backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', async () => {
      const backend = await createBackend();
      await expect(backend.setCurrentIteration('v1.0')).resolves.not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeListResponse([
          makeGhIssue({
            number: 1,
            title: 'First',
            body: 'Body 1',
            state: 'OPEN',
            assignees: ['alice'],
            labels: ['bug'],
            milestone: 'v1.0',
          }),
          makeGhIssue({
            number: 2,
            title: 'Second',
            body: null,
            state: 'CLOSED',
          }),
        ]),
      );

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe('1');
      expect(items[0]!.status).toBe('open');
      expect(items[0]!.assignee).toBe('alice');
      expect(items[0]!.labels).toEqual(['bug']);
      expect(items[1]!.id).toBe('2');
      expect(items[1]!.status).toBe('closed');
    });

    it('filters by iteration client-side', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeListResponse([
          makeGhIssue({ number: 1, milestone: 'v1.0' }),
          makeGhIssue({ number: 2, milestone: 'v2.0' }),
        ]),
      );

      const items = await backend.listWorkItems('v1.0');
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe('1');
    });

    it('paginates through multiple pages', async () => {
      const backend = await createBackend();
      mockGraphql
        .mockResolvedValueOnce(
          makeListResponse([makeGhIssue({ number: 1 })], true, 'cursor1'),
        )
        .mockResolvedValueOnce(makeListResponse([makeGhIssue({ number: 2 })]));

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(mockGraphql).toHaveBeenCalledTimes(2);
    });

    it('includes parent info from GraphQL response', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeListResponse([
          makeGhIssue({ number: 2, parent: { number: 1 } }),
          makeGhIssue({ number: 1, parent: null }),
        ]),
      );

      const items = await backend.listWorkItems();
      expect(items.find((i) => i.id === '2')!.parent).toBe(1);
      expect(items.find((i) => i.id === '1')!.parent).toBeNull();
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeGetResponse(
          makeGhIssue({
            number: 42,
            title: 'The issue',
            body: 'Details here',
            assignees: ['bob'],
            labels: ['feature'],
            milestone: 'v1.0',
            comments: [
              {
                author: { login: 'alice' },
                createdAt: '2026-01-10T12:00:00Z',
                body: 'On it.',
              },
            ],
          }),
        ),
      );

      const item = await backend.getWorkItem('42');
      expect(item.id).toBe('42');
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('alice');
    });

    it('returns parent info', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, parent: { number: 3 } })),
      );

      const item = await backend.getWorkItem('5');
      expect(item.parent).toBe(3);
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = await createBackend();

      // ensureLabels REST call, then issue create REST call
      mockRest
        .mockResolvedValueOnce({}) // label create 'bug'
        .mockResolvedValueOnce({ number: 10 }); // issue create
      // GraphQL getWorkItem
      mockGraphql.mockResolvedValue(
        makeGetResponse(
          makeGhIssue({
            number: 10,
            title: 'New issue',
            assignees: ['alice'],
            labels: ['bug'],
            milestone: 'v1.0',
          }),
        ),
      );

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

      expect(item.id).toBe('10');
      expect(item.title).toBe('New issue');
    });

    it('resolves milestone title to number when iteration is set', async () => {
      const backend = await createBackend();

      // fetchMilestones via paginate
      mockPaginateResults.push([
        { number: 3, title: 'v1.0', state: 'open', due_on: null },
      ]);
      // REST create
      mockRest.mockResolvedValueOnce({ number: 10 });
      // GraphQL getWorkItem
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 10, milestone: 'v1.0' })),
      );

      await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: 'v1.0',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: [],
      });

      // Verify milestone number was passed in the REST body
      expect(mockRest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/issues',
        expect.objectContaining({ milestone: 3 }),
      );
    });

    it('adds sub-issue relationship when parent is specified', async () => {
      const backend = await createBackend();

      // REST create
      mockRest.mockResolvedValueOnce({ number: 10 });
      // getIssueNodeId for parent #5, then for child #10, then addSubIssue, then getWorkItem
      mockGraphql
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_10' } },
        })
        .mockResolvedValueOnce({
          addSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'New issue' },
          },
        })
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 10, parent: { number: 5 } })),
        );

      const item = await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: 5,
        dependsOn: [],
      });

      expect(item.parent).toBe(5);
      expect(mockGraphql).toHaveBeenCalledTimes(4);
    });

    it('ensures labels exist before creating an issue', async () => {
      const backend = await createBackend();

      // ensureLabels (2 REST calls), then create (1 REST call)
      mockRest
        .mockResolvedValueOnce({}) // label create 'bug'
        .mockResolvedValueOnce({}) // label create 'ux'
        .mockResolvedValueOnce({ number: 10 }); // issue create
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 10, labels: ['bug', 'ux'] })),
      );

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

      expect(mockRest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/labels',
        { name: 'bug' },
      );
      expect(mockRest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/labels',
        { name: 'ux' },
      );
    });

    it('ignores errors when ensuring labels that already exist', async () => {
      const backend = await createBackend();

      mockRest
        .mockRejectedValueOnce(new Error('label already exists')) // label create fails
        .mockResolvedValueOnce({ number: 10 }); // issue create succeeds
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 10, labels: ['bug'] })),
      );

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

      expect(item.id).toBe('10');
    });

    it('rolls back created issue when parent linking fails', async () => {
      const backend = await createBackend();

      // REST create succeeds
      mockRest.mockResolvedValueOnce({ number: 10 });
      // addSubIssue: getIssueNodeId(parent=5) succeeds, getIssueNodeId(child=10) fails
      mockGraphql
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockRejectedValueOnce(new Error('GraphQL error: parent not found'))
        // deleteWorkItem rollback: getIssueNodeId(10), deleteIssue mutation
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_10' } },
        })
        .mockResolvedValueOnce({
          deleteIssue: { repository: { name: 'repo' } },
        });

      await expect(
        backend.createWorkItem({
          title: 'New issue',
          type: 'issue',
          status: 'open',
          iteration: '',
          priority: 'medium',
          assignee: '',
          labels: [],
          description: '',
          parent: 5,
          dependsOn: [],
        }),
      ).rejects.toThrow('issue was rolled back');
    });

    it('skips ensureLabels when no labels provided', async () => {
      const backend = await createBackend();

      mockRest.mockResolvedValueOnce({ number: 10 });
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 10 })),
      );

      await backend.createWorkItem({
        title: 'New issue',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: [],
      });

      // Only the issue create call, no label create calls
      expect(mockRest).not.toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/labels',
        expect.anything(),
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates title and body via PATCH', async () => {
      const backend = await createBackend();

      mockRest.mockResolvedValue({});
      mockGraphql.mockResolvedValue(
        makeGetResponse(
          makeGhIssue({
            number: 5,
            title: 'Updated title',
            body: 'Updated body',
          }),
        ),
      );

      const item = await backend.updateWorkItem('5', {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
      expect(item.description).toBe('Updated body');
      expect(mockRest).toHaveBeenCalledWith(
        'PATCH',
        '/repos/owner/repo/issues/5',
        expect.objectContaining({
          title: 'Updated title',
          body: 'Updated body',
        }),
      );
    });

    it('closes an issue when status changes to closed', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, state: 'CLOSED' })),
      );

      const item = await backend.updateWorkItem('5', { status: 'closed' });
      expect(item.status).toBe('closed');
      expect(mockRest).toHaveBeenCalledWith(
        'PATCH',
        '/repos/owner/repo/issues/5',
        expect.objectContaining({ state: 'closed' }),
      );
    });

    it('reopens an issue when status changes to open', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5 })),
      );

      const item = await backend.updateWorkItem('5', { status: 'open' });
      expect(item.status).toBe('open');
      expect(mockRest).toHaveBeenCalledWith(
        'PATCH',
        '/repos/owner/repo/issues/5',
        expect.objectContaining({ state: 'open' }),
      );
    });

    it('sets parent via addSubIssue when parent is added', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});

      // getWorkItem (current, no parent), getIssueNodeId x2, addSubIssue, getWorkItem (final)
      mockGraphql
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: null })),
        )
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockResolvedValueOnce({
          addSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'Child' },
          },
        })
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: { number: 3 } })),
        );

      const item = await backend.updateWorkItem('5', { parent: 3 });
      expect(item.parent).toBe(3);
    });

    it('removes parent via removeSubIssue when parent is cleared', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});

      // getWorkItem (current, has parent #3), getIssueNodeId x2, removeSubIssue, getWorkItem (final)
      mockGraphql
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: { number: 3 } })),
        )
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockResolvedValueOnce({
          removeSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'Child' },
          },
        })
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: null })),
        );

      const item = await backend.updateWorkItem('5', { parent: null });
      expect(item.parent).toBeNull();
    });

    it('changes parent by removing old and adding new', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});

      // getWorkItem (current, parent #3), remove(#3,#5), add(#7,#5), getWorkItem (final)
      mockGraphql
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: { number: 3 } })),
        )
        // removeSubIssue: getIssueNodeId(3), getIssueNodeId(5), mutation
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockResolvedValueOnce({
          removeSubIssue: {
            issue: { title: 'Old' },
            subIssue: { title: 'Child' },
          },
        })
        // addSubIssue: getIssueNodeId(7), getIssueNodeId(5), mutation
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_7' } },
        })
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockResolvedValueOnce({
          addSubIssue: {
            issue: { title: 'New' },
            subIssue: { title: 'Child' },
          },
        })
        // final getWorkItem
        .mockResolvedValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: { number: 7 } })),
        );

      const item = await backend.updateWorkItem('5', { parent: 7 });
      expect(item.parent).toBe(7);
    });

    it('ensures labels exist before updating', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});
      mockGraphql.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, labels: ['new-label'] })),
      );

      await backend.updateWorkItem('5', { labels: ['new-label'] });

      expect(mockRest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/labels',
        { name: 'new-label' },
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue via GraphQL mutation', async () => {
      const backend = await createBackend();
      // getIssueNodeId, then deleteIssue mutation
      mockGraphql
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_7' } },
        })
        .mockResolvedValueOnce({
          deleteIssue: { repository: { name: 'repo' } },
        });

      await backend.deleteWorkItem('7');
      expect(mockGraphql).toHaveBeenCalledTimes(2);
    });
  });

  describe('addComment', () => {
    it('adds a comment and returns it', async () => {
      const backend = await createBackend();
      mockRest.mockResolvedValue({});

      const comment = await backend.addComment('3', {
        author: 'alice',
        body: 'This is a comment.',
      });

      expect(mockRest).toHaveBeenCalledWith(
        'POST',
        '/repos/owner/repo/issues/3/comments',
        { body: 'This is a comment.' },
      );
      expect(comment.author).toBe('alice');
      expect(comment.body).toBe('This is a comment.');
      expect(comment.date).toBeDefined();
    });
  });

  describe('getItemUrl', () => {
    it('returns the GitHub issue URL', async () => {
      const backend = await createBackend();
      const url = backend.getItemUrl('5');
      expect(url).toBe('https://github.com/owner/repo/issues/5');
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = await createBackend();
      const openMod = await import('open');

      await backend.openItem('5');
      expect(openMod.default).toHaveBeenCalledWith(
        'https://github.com/owner/repo/issues/5',
      );
    });
  });

  describe('getChildren', () => {
    it('returns items whose parent matches the given id', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeListResponse([
          makeGhIssue({ number: 1, parent: null }),
          makeGhIssue({ number: 2, parent: { number: 1 } }),
          makeGhIssue({ number: 3, parent: { number: 1 } }),
          makeGhIssue({ number: 4, parent: { number: 2 } }),
        ]),
      );

      const children = await backend.getChildren('1');
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.id).sort()).toEqual(['2', '3']);
    });
  });

  describe('getDependents', () => {
    it('returns empty array (dependsOn not supported)', async () => {
      const backend = await createBackend();
      mockGraphql.mockResolvedValue(
        makeListResponse([
          makeGhIssue({ number: 1 }),
          makeGhIssue({ number: 2 }),
        ]),
      );

      const dependents = await backend.getDependents('1');
      expect(dependents).toEqual([]);
    });
  });

  describe('getAssignees', () => {
    it('returns collaborator logins', async () => {
      const backend = await createBackend();
      mockPaginateResults.push([
        { login: 'alice' },
        { login: 'bob' },
        { login: 'charlie' },
      ]);
      expect(await backend.getAssignees()).toEqual(['alice', 'bob', 'charlie']);
    });

    it('returns empty array on error', async () => {
      const backend = await createBackend();
      // eslint-disable-next-line @typescript-eslint/require-await, require-yield
      mockPaginate.mockImplementationOnce(async function* () {
        throw new Error('API error');
      });
      expect(await backend.getAssignees()).toEqual([]);
    });
  });
});
