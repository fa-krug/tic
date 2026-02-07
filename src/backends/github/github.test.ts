import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubBackend } from './index.js';

// Mock the gh wrapper
vi.mock('./gh.js', () => ({
  gh: vi.fn(),
  ghExec: vi.fn(),
  ghExecSync: vi.fn(),
  ghGraphQL: vi.fn(),
  ghSync: vi.fn(),
}));

import { gh, ghExec, ghExecSync, ghGraphQL, ghSync } from './gh.js';

const mockGh = vi.mocked(gh);
const mockGhExec = vi.mocked(ghExec);
const mockGhExecSync = vi.mocked(ghExecSync);
const mockGhGraphQL = vi.mocked(ghGraphQL);
const mockGhSync = vi.mocked(ghSync);

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

describe('GitHubBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Constructor calls ghExecSync for auth check
    mockGhExecSync.mockReturnValue('');
    // Most methods call getOwnerRepo -> getRepoNwo, so set a default
    mockGh.mockResolvedValue({ nameWithOwner: 'owner/repo' });
  });

  describe('constructor', () => {
    it('verifies gh auth on construction', () => {
      new GitHubBackend('/repo');
      expect(mockGhExecSync).toHaveBeenCalledWith(['auth', 'status'], '/repo');
    });

    it('throws when gh auth fails', () => {
      mockGhExecSync.mockImplementation(() => {
        throw new Error('not logged in');
      });
      expect(() => new GitHubBackend('/repo')).toThrow();
    });
  });

  describe('getCapabilities', () => {
    it('returns GitHub-specific capabilities', () => {
      const backend = new GitHubBackend('/repo');
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
        .mockResolvedValueOnce({ nameWithOwner: 'owner/repo' })
        .mockResolvedValueOnce([
          { title: 'v1.0', state: 'open', due_on: null },
          { title: 'v2.0', state: 'open', due_on: null },
        ]);
      expect(await backend.getIterations()).toEqual(['v1.0', 'v2.0']);
    });

    it('returns empty array when no milestones', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockResolvedValueOnce({ nameWithOwner: 'owner/repo' })
        .mockResolvedValueOnce([]);
      expect(await backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns first open milestone sorted by due date', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockResolvedValueOnce({ nameWithOwner: 'owner/repo' })
        .mockResolvedValueOnce([
          { title: 'v1.0', state: 'open', due_on: '2026-03-01T00:00:00Z' },
          { title: 'v2.0', state: 'open', due_on: '2026-06-01T00:00:00Z' },
        ]);
      expect(await backend.getCurrentIteration()).toBe('v1.0');
    });

    it('returns empty string when no open milestones', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockResolvedValueOnce({ nameWithOwner: 'owner/repo' })
        .mockResolvedValueOnce([]);
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
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL
        .mockResolvedValueOnce(
          makeListResponse([makeGhIssue({ number: 1 })], true, 'cursor1'),
        )
        .mockResolvedValueOnce(makeListResponse([makeGhIssue({ number: 2 })]));

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(mockGhGraphQL).toHaveBeenCalledTimes(2);
    });

    it('includes parent info from GraphQL response', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
        makeListResponse([
          makeGhIssue({ number: 2, parent: { number: 1 } }),
          makeGhIssue({ number: 1, parent: null }),
        ]),
      );

      const items = await backend.listWorkItems();
      expect(items.find((i) => i.id === '2')!.parent).toBe('1');
      expect(items.find((i) => i.id === '1')!.parent).toBeNull();
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, parent: { number: 3 } })),
      );

      const item = await backend.getWorkItem('5');
      expect(item.parent).toBe('3');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      mockGhGraphQL.mockResolvedValue(
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

    it('adds sub-issue relationship when parent is specified', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      // getIssueNodeId for parent #5, then for child #10, then addSubIssue, then getWorkItem
      mockGhGraphQL
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
        parent: '5',
        dependsOn: [],
      });

      expect(item.parent).toBe('5');
      expect(mockGhGraphQL).toHaveBeenCalledTimes(4);
    });

    it('ensures labels exist before creating an issue', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      mockGhGraphQL.mockResolvedValue(
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

      expect(mockGhExec).toHaveBeenCalledWith(
        ['label', 'create', 'bug'],
        '/repo',
      );
      expect(mockGhExec).toHaveBeenCalledWith(
        ['label', 'create', 'ux'],
        '/repo',
      );
    });

    it('ignores errors when ensuring labels that already exist', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec
        .mockRejectedValueOnce(new Error('label already exists'))
        .mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      // addSubIssue calls: getIssueNodeId(parent), getIssueNodeId(child), then mutation
      mockGhGraphQL
        .mockResolvedValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockRejectedValueOnce(new Error('GraphQL error: parent not found'));

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
          parent: '5',
          dependsOn: [],
        }),
      ).rejects.toThrow('issue was rolled back');

      // Verify delete was called to rollback
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'delete', '10', '--yes'],
        '/repo',
      );
    });

    it('skips ensureLabels when no labels provided', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('https://github.com/owner/repo/issues/10\n');
      mockGhGraphQL.mockResolvedValue(
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
      expect(mockGhExec).not.toHaveBeenCalledWith(
        expect.arrayContaining(['label', 'create']),
        expect.anything(),
      );
    });
  });

  describe('updateWorkItem', () => {
    it('updates title and body', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockResolvedValue('');
      mockGhGraphQL.mockResolvedValue(
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
    });

    it('closes an issue when status changes to closed', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');
      mockGhGraphQL.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, state: 'CLOSED' })),
      );

      const item = await backend.updateWorkItem('5', { status: 'closed' });
      expect(item.status).toBe('closed');
      expect(mockGhExec).toHaveBeenCalledWith(['issue', 'close', '5'], '/repo');
    });

    it('reopens an issue when status changes to open', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');
      mockGhGraphQL.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5 })),
      );

      const item = await backend.updateWorkItem('5', { status: 'open' });
      expect(item.status).toBe('open');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'reopen', '5'],
        '/repo',
      );
    });

    it('sets parent via addSubIssue when parent is added', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');

      // getWorkItem (current, no parent), getIssueNodeId x2, addSubIssue, getWorkItem (final)
      mockGhGraphQL
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

      const item = await backend.updateWorkItem('5', { parent: '3' });
      expect(item.parent).toBe('3');
    });

    it('removes parent via removeSubIssue when parent is cleared', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');

      // getWorkItem (current, has parent #3), getIssueNodeId x2, removeSubIssue, getWorkItem (final)
      mockGhGraphQL
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
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');

      // getWorkItem (current, parent #3), remove(#3,#5), add(#7,#5), getWorkItem (final)
      mockGhGraphQL
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

      const item = await backend.updateWorkItem('5', { parent: '7' });
      expect(item.parent).toBe('7');
    });

    it('ensures labels exist before updating', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');
      mockGhGraphQL.mockResolvedValue(
        makeGetResponse(makeGhIssue({ number: 5, labels: ['new-label'] })),
      );

      await backend.updateWorkItem('5', { labels: ['new-label'] });

      expect(mockGhExec).toHaveBeenCalledWith(
        ['label', 'create', 'new-label'],
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');
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
      mockGhExec.mockResolvedValue('');

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
      mockGhSync.mockReturnValue({
        url: 'https://github.com/owner/repo/issues/5',
      });

      const url = backend.getItemUrl('5');
      expect(url).toBe('https://github.com/owner/repo/issues/5');
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockResolvedValue('');

      await backend.openItem('5');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });
  });

  describe('getChildren', () => {
    it('returns items whose parent matches the given id', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockResolvedValue(
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
      const backend = new GitHubBackend('/repo');
      mockGh
        .mockResolvedValueOnce({ nameWithOwner: 'owner/repo' })
        .mockResolvedValueOnce([
          { login: 'alice' },
          { login: 'bob' },
          { login: 'charlie' },
        ]);
      expect(await backend.getAssignees()).toEqual(['alice', 'bob', 'charlie']);
    });

    it('returns empty array on error', async () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockResolvedValueOnce({ nameWithOwner: 'owner/repo' });
      mockGh.mockRejectedValueOnce(new Error('API error'));
      expect(await backend.getAssignees()).toEqual([]);
    });
  });
});
