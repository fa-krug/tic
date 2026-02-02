# GitHub Sub-Issues Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Enable parent/child relationships in the GitHub backend using GitHub's sub-issues GraphQL API.

**Architecture:** Switch `listWorkItems` and `getWorkItem` from `gh issue list/view --json` (REST) to `gh api graphql` queries, which include the `parent { number }` field. Write operations (create, edit, close, delete, comment) stay REST-based via `gh` CLI. Parent set/remove uses `addSubIssue`/`removeSubIssue` GraphQL mutations. All GraphQL calls pass the `GraphQL-Features: sub_issues` preview header.

**Tech Stack:** TypeScript, `gh` CLI (`gh api graphql`), GitHub GraphQL API (sub_issues preview)

---

### Task 1: Add `ghGraphQL` helper to `gh.ts`

**Files:**
- Modify: `src/backends/github/gh.ts`

**Step 1: Add the `ghGraphQL` function**

Add below the existing `ghExec` function:

```typescript
export function ghGraphQL<T>(
  query: string,
  variables: Record<string, string | number | null>,
  cwd: string,
): T {
  const args = [
    'api',
    'graphql',
    '-H',
    'GraphQL-Features: sub_issues',
    '-f',
    `query=${query}`,
  ];
  for (const [key, value] of Object.entries(variables)) {
    if (value === null || value === undefined) continue;
    if (typeof value === 'number') {
      args.push('-F', `${key}=${value}`);
    } else {
      args.push('-f', `${key}=${value}`);
    }
  }
  const result = execFileSync('gh', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return (JSON.parse(result) as { data: T }).data;
}
```

`-f` passes string variables, `-F` passes non-string (number) variables. Null values are skipped (used for optional `cursor` in pagination).

**Step 2: Run build to verify**

Run: `npm run build`
Expected: PASS — no type errors

**Step 3: Commit**

```bash
git add src/backends/github/gh.ts
git commit -m "feat(github): add ghGraphQL helper for GraphQL API calls"
```

---

### Task 2: Update `GhIssue` interface and mapper for GraphQL response shape

**Files:**
- Modify: `src/backends/github/mappers.ts`

GraphQL returns a different shape than the REST CLI: `assignees` and `labels` are `{ nodes: [...] }` instead of flat arrays, `comments` is always `{ nodes: [...] }` (not optional), and there's a `parent` field.

**Step 1: Update the `GhIssue` interface and `mapIssueToWorkItem` function**

Replace the full content of `mappers.ts`:

```typescript
import type { WorkItem, Comment } from '../../types.js';

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  assignees: { nodes: { login: string }[] };
  labels: { nodes: { name: string }[] };
  milestone: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  comments: { nodes: GhComment[] };
  parent: { number: number } | null;
}

export interface GhComment {
  author: { login: string };
  createdAt: string;
  body: string;
}

export interface GhMilestone {
  title: string;
  state: string;
  due_on: string | null;
}

export function mapCommentToComment(ghComment: GhComment): Comment {
  return {
    author: ghComment.author.login,
    date: ghComment.createdAt,
    body: ghComment.body,
  };
}

export function mapIssueToWorkItem(ghIssue: GhIssue): WorkItem {
  return {
    id: String(ghIssue.number),
    title: ghIssue.title,
    description: ghIssue.body ?? '',
    status: ghIssue.state === 'OPEN' ? 'open' : 'closed',
    type: 'issue',
    assignee: ghIssue.assignees.nodes[0]?.login ?? '',
    labels: ghIssue.labels.nodes.map((l) => l.name),
    iteration: ghIssue.milestone?.title ?? '',
    priority: 'medium',
    created: ghIssue.createdAt,
    updated: ghIssue.updatedAt,
    parent: ghIssue.parent ? String(ghIssue.parent.number) : null,
    dependsOn: [],
    comments: ghIssue.comments.nodes.map(mapCommentToComment),
  };
}
```

Key changes from previous version:
- `assignees` is now `{ nodes: { login: string }[] }` (was `{ login: string }[]`)
- `labels` is now `{ nodes: { name: string }[] }` (was `{ name: string }[]`)
- `comments` is now `{ nodes: GhComment[] }` (was `GhComment[] | undefined`)
- `parent` is now `{ number: number } | null` (new field)
- Mapper reads `.nodes` for assignees, labels, comments
- Mapper maps `parent.number` to string or null

**Step 2: Run build to verify**

Run: `npm run build`
Expected: FAIL — `index.ts` still constructs old-shape objects. That's expected; we fix it in Task 3.

**Step 3: Commit**

```bash
git add src/backends/github/mappers.ts
git commit -m "feat(github): update GhIssue interface for GraphQL response shape with parent"
```

---

### Task 3: Switch reads to GraphQL, enable capabilities

**Files:**
- Modify: `src/backends/github/index.ts`

This task replaces `listWorkItems` and `getWorkItem` with GraphQL, updates `getChildren`/`getDependents`, enables capabilities, and adds helpers.

**Step 1: Replace the full content of `index.ts`**

```typescript
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { gh, ghExec, ghGraphQL } from './gh.js';
import { mapIssueToWorkItem } from './mappers.js';
import type { GhIssue, GhMilestone } from './mappers.js';

const LIST_ISSUES_QUERY = `
  query($owner: String!, $repo: String!, $cursor: String) {
    repository(owner: $owner, name: $repo) {
      issues(first: 100, after: $cursor, states: [OPEN, CLOSED]) {
        nodes {
          number title body state
          assignees(first: 10) { nodes { login } }
          labels(first: 20) { nodes { name } }
          milestone { title }
          createdAt updatedAt
          comments(first: 100) { nodes { author { login } createdAt body } }
          parent { number }
        }
        pageInfo { hasNextPage endCursor }
      }
    }
  }
`;

const GET_ISSUE_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) {
        number title body state
        assignees(first: 10) { nodes { login } }
        labels(first: 20) { nodes { name } }
        milestone { title }
        createdAt updatedAt
        comments(first: 100) { nodes { author { login } createdAt body } }
        parent { number }
      }
    }
  }
`;

const GET_ISSUE_NODE_ID_QUERY = `
  query($owner: String!, $repo: String!, $number: Int!) {
    repository(owner: $owner, name: $repo) {
      issue(number: $number) { id }
    }
  }
`;

const ADD_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    addSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

const REMOVE_SUB_ISSUE_MUTATION = `
  mutation($parentId: ID!, $childId: ID!) {
    removeSubIssue(input: { issueId: $parentId, subIssueId: $childId }) {
      issue { title }
      subIssue { title }
    }
  }
`;

interface ListIssuesResponse {
  repository: {
    issues: {
      nodes: GhIssue[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
}

interface GetIssueResponse {
  repository: {
    issue: GhIssue;
  };
}

interface GetIssueNodeIdResponse {
  repository: {
    issue: { id: string };
  };
}

export class GitHubBackend extends BaseBackend {
  private cwd: string;
  private ownerRepo: { owner: string; repo: string } | null = null;

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    ghExec(['auth', 'status'], cwd);
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: false,
      customStatuses: false,
      iterations: true,
      comments: true,
      fields: {
        priority: false,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: false,
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    return ['open', 'closed'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    return ['issue'];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    try {
      const { owner, repo } = this.getOwnerRepo();
      const collaborators = gh<{ login: string }[]>(
        ['api', `repos/${owner}/${repo}/collaborators`, '--jq', '.'],
        this.cwd,
      );
      return collaborators.map((c) => c.login);
    } catch {
      return [];
    }
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    const milestones = this.fetchMilestones();
    return milestones.map((m) => m.title);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    const milestones = this.fetchOpenMilestones();
    if (milestones.length === 0) return '';
    return milestones[0]!.title;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  async setCurrentIteration(_name: string): Promise<void> {
    // No-op — current iteration is always first open milestone
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const { owner, repo } = this.getOwnerRepo();
    const allIssues: GhIssue[] = [];
    let cursor: string | null = null;

    do {
      const data = ghGraphQL<ListIssuesResponse>(
        LIST_ISSUES_QUERY,
        { owner, repo, cursor },
        this.cwd,
      );
      allIssues.push(...data.repository.issues.nodes);
      cursor = data.repository.issues.pageInfo.hasNextPage
        ? data.repository.issues.pageInfo.endCursor
        : null;
    } while (cursor !== null);

    let items = allIssues.map(mapIssueToWorkItem);
    if (iteration) {
      items = items.filter((i) => i.iteration === iteration);
    }
    return items;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const { owner, repo } = this.getOwnerRepo();
    const data = ghGraphQL<GetIssueResponse>(
      GET_ISSUE_QUERY,
      { owner, repo, number: Number(id) },
      this.cwd,
    );
    return mapIssueToWorkItem(data.repository.issue);
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const args = [
      'issue',
      'create',
      '--title',
      data.title,
      '--body',
      data.description || '',
    ];
    if (data.assignee) {
      args.push('--assignee', data.assignee);
    }
    if (data.iteration) {
      args.push('--milestone', data.iteration);
    }
    for (const label of data.labels) {
      args.push('--label', label);
    }

    const output = ghExec(args, this.cwd);
    // gh issue create prints the URL: https://github.com/owner/repo/issues/123
    const match = output.match(/\/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue number from gh output');
    }
    const id = match[1]!;

    if (data.parent) {
      this.addSubIssue(data.parent, id);
    }

    return this.getWorkItem(id);
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // Handle parent changes via sub-issue mutations
    if (data.parent !== undefined) {
      const current = await this.getWorkItem(id);
      if (current.parent && current.parent !== data.parent) {
        this.removeSubIssue(current.parent, id);
      }
      if (data.parent && data.parent !== current.parent) {
        this.addSubIssue(data.parent, id);
      }
    }

    // Handle status changes via close/reopen
    if (data.status === 'closed') {
      ghExec(['issue', 'close', id], this.cwd);
    } else if (data.status === 'open') {
      ghExec(['issue', 'reopen', id], this.cwd);
    }

    // Handle field edits
    const editArgs = ['issue', 'edit', id];
    let hasEdits = false;

    if (data.title !== undefined) {
      editArgs.push('--title', data.title);
      hasEdits = true;
    }
    if (data.description !== undefined) {
      editArgs.push('--body', data.description);
      hasEdits = true;
    }
    if (data.iteration !== undefined) {
      if (data.iteration) {
        editArgs.push('--milestone', data.iteration);
      } else {
        editArgs.push('--remove-milestone');
      }
      hasEdits = true;
    }
    if (data.assignee !== undefined) {
      if (data.assignee) {
        editArgs.push('--add-assignee', data.assignee);
      }
      hasEdits = true;
    }
    if (data.labels !== undefined) {
      for (const label of data.labels) {
        editArgs.push('--add-label', label);
      }
      hasEdits = true;
    }

    if (hasEdits) {
      ghExec(editArgs, this.cwd);
    }

    return this.getWorkItem(id);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    ghExec(['issue', 'delete', id, '--yes'], this.cwd);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    ghExec(['issue', 'comment', workItemId, '--body', comment.body], this.cwd);
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  async getChildren(id: string): Promise<WorkItem[]> {
    return (await this.listWorkItems()).filter((item) => item.parent === id);
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    this.assertSupported(this.getCapabilities().fields.dependsOn, 'dependsOn');
    return (await this.listWorkItems()).filter((item) =>
      item.dependsOn.includes(id),
    );
  }

  getItemUrl(id: string): string {
    const result = gh<{ url: string }>(
      ['issue', 'view', id, '--json', 'url'],
      this.cwd,
    );
    return result.url;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async openItem(id: string): Promise<void> {
    ghExec(['issue', 'view', id, '--web'], this.cwd);
  }

  private getIssueNodeId(issueNumber: number): string {
    const { owner, repo } = this.getOwnerRepo();
    const data = ghGraphQL<GetIssueNodeIdResponse>(
      GET_ISSUE_NODE_ID_QUERY,
      { owner, repo, number: issueNumber },
      this.cwd,
    );
    return data.repository.issue.id;
  }

  private addSubIssue(parentNumber: string, childNumber: string): void {
    const parentId = this.getIssueNodeId(Number(parentNumber));
    const childId = this.getIssueNodeId(Number(childNumber));
    ghGraphQL(
      ADD_SUB_ISSUE_MUTATION,
      { parentId, childId },
      this.cwd,
    );
  }

  private removeSubIssue(parentNumber: string, childNumber: string): void {
    const parentId = this.getIssueNodeId(Number(parentNumber));
    const childId = this.getIssueNodeId(Number(childNumber));
    ghGraphQL(
      REMOVE_SUB_ISSUE_MUTATION,
      { parentId, childId },
      this.cwd,
    );
  }

  private getOwnerRepo(): { owner: string; repo: string } {
    if (!this.ownerRepo) {
      const nwo = this.getRepoNwo();
      const [owner, repo] = nwo.split('/');
      this.ownerRepo = { owner: owner!, repo: repo! };
    }
    return this.ownerRepo;
  }

  private fetchMilestones(): GhMilestone[] {
    const { owner, repo } = this.getOwnerRepo();
    return gh<GhMilestone[]>(
      ['api', `repos/${owner}/${repo}/milestones`, '--jq', '.'],
      this.cwd,
    );
  }

  private fetchOpenMilestones(): GhMilestone[] {
    const milestones = this.fetchMilestones();
    return milestones
      .filter((m) => m.state === 'open')
      .sort((a, b) => {
        if (!a.due_on && !b.due_on) return 0;
        if (!a.due_on) return 1;
        if (!b.due_on) return -1;
        return a.due_on.localeCompare(b.due_on);
      });
  }

  private getRepoNwo(): string {
    const result = gh<{ nameWithOwner: string }>(
      ['repo', 'view', '--json', 'nameWithOwner'],
      this.cwd,
    );
    return result.nameWithOwner;
  }
}
```

Key changes from previous version:
- `ISSUE_FIELDS` removed — no longer needed
- `getCapabilities()` returns `relationships: true`, `parent: true`
- `listWorkItems()` uses paginated `ghGraphQL` with `LIST_ISSUES_QUERY`, filters iteration client-side
- `getWorkItem()` uses `ghGraphQL` with `GET_ISSUE_QUERY`
- `createWorkItem()` calls `addSubIssue()` after creating if `data.parent` set
- `updateWorkItem()` handles parent changes: removes old parent, adds new parent
- `getChildren()` filters `listWorkItems()` by parent — no `assertSupported` guard
- `getDependents()` guards on `fields.dependsOn` (still unsupported), message changes to `'dependsOn is not supported...'`
- `getAssignees()` uses `getOwnerRepo()` instead of `getRepoNwo()` for the API path
- `fetchMilestones()` uses `getOwnerRepo()` for the API path
- Added: `getOwnerRepo()` (cached), `getIssueNodeId()`, `addSubIssue()`, `removeSubIssue()`
- Added: GraphQL query/mutation constants and response type interfaces

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/backends/github/index.ts
git commit -m "feat(github): switch to GraphQL reads and enable parent/sub-issues support"
```

---

### Task 4: Update tests

**Files:**
- Modify: `src/backends/github/github.test.ts`

Tests need to mock `ghGraphQL` instead of `gh` for list/get operations, and mock GraphQL responses in the new shape. The `gh` mock is still used for `getRepoNwo`, milestones, `getItemUrl`, and `getAssignees`.

**Step 1: Replace the full content of `github.test.ts`**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitHubBackend } from './index.js';

// Mock the gh wrapper
vi.mock('./gh.js', () => ({
  gh: vi.fn(),
  ghExec: vi.fn(),
  ghGraphQL: vi.fn(),
}));

import { gh, ghExec, ghGraphQL } from './gh.js';

const mockGh = vi.mocked(gh);
const mockGhExec = vi.mocked(ghExec);
const mockGhGraphQL = vi.mocked(ghGraphQL);

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
    // Constructor calls ghExec for auth check
    mockGhExec.mockReturnValue('');
    // Most methods call getOwnerRepo -> getRepoNwo, so set a default
    mockGh.mockReturnValue({ nameWithOwner: 'owner/repo' });
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
      await expect(
        backend.setCurrentIteration('v1.0'),
      ).resolves.not.toThrow();
    });
  });

  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockReturnValue(
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
      mockGhGraphQL.mockReturnValue(
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
        .mockReturnValueOnce(
          makeListResponse(
            [makeGhIssue({ number: 1 })],
            true,
            'cursor1',
          ),
        )
        .mockReturnValueOnce(
          makeListResponse([makeGhIssue({ number: 2 })]),
        );

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(mockGhGraphQL).toHaveBeenCalledTimes(2);
    });

    it('includes parent info from GraphQL response', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockReturnValue(
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
      mockGhGraphQL.mockReturnValue(
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
      mockGhGraphQL.mockReturnValue(
        makeGetResponse(
          makeGhIssue({ number: 5, parent: { number: 3 } }),
        ),
      );

      const item = await backend.getWorkItem('5');
      expect(item.parent).toBe('3');
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockReturnValue(
        'https://github.com/owner/repo/issues/10\n',
      );
      mockGhGraphQL.mockReturnValue(
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

      mockGhExec.mockReturnValue(
        'https://github.com/owner/repo/issues/10\n',
      );
      // getIssueNodeId for parent #5, then for child #10, then addSubIssue, then getWorkItem
      mockGhGraphQL
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_10' } },
        })
        .mockReturnValueOnce({
          addSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'New issue' },
          },
        })
        .mockReturnValueOnce(
          makeGetResponse(
            makeGhIssue({ number: 10, parent: { number: 5 } }),
          ),
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
  });

  describe('updateWorkItem', () => {
    it('updates title and body', async () => {
      const backend = new GitHubBackend('/repo');

      mockGhExec.mockReturnValue('');
      mockGhGraphQL.mockReturnValue(
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
      mockGhExec.mockReturnValue('');
      mockGhGraphQL.mockReturnValue(
        makeGetResponse(
          makeGhIssue({ number: 5, state: 'CLOSED' }),
        ),
      );

      const item = await backend.updateWorkItem('5', { status: 'closed' });
      expect(item.status).toBe('closed');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'close', '5'],
        '/repo',
      );
    });

    it('reopens an issue when status changes to open', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');
      mockGhGraphQL.mockReturnValue(
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
      mockGhExec.mockReturnValue('');

      // getWorkItem (current, no parent), getIssueNodeId x2, addSubIssue, getWorkItem (final)
      mockGhGraphQL
        .mockReturnValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: null })),
        )
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockReturnValueOnce({
          addSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'Child' },
          },
        })
        .mockReturnValueOnce(
          makeGetResponse(
            makeGhIssue({ number: 5, parent: { number: 3 } }),
          ),
        );

      const item = await backend.updateWorkItem('5', { parent: '3' });
      expect(item.parent).toBe('3');
    });

    it('removes parent via removeSubIssue when parent is cleared', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      // getWorkItem (current, has parent #3), getIssueNodeId x2, removeSubIssue, getWorkItem (final)
      mockGhGraphQL
        .mockReturnValueOnce(
          makeGetResponse(
            makeGhIssue({ number: 5, parent: { number: 3 } }),
          ),
        )
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockReturnValueOnce({
          removeSubIssue: {
            issue: { title: 'Parent' },
            subIssue: { title: 'Child' },
          },
        })
        .mockReturnValueOnce(
          makeGetResponse(makeGhIssue({ number: 5, parent: null })),
        );

      const item = await backend.updateWorkItem('5', { parent: null });
      expect(item.parent).toBeNull();
    });

    it('changes parent by removing old and adding new', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      // getWorkItem (current, parent #3), remove(#3,#5), add(#7,#5), getWorkItem (final)
      mockGhGraphQL
        .mockReturnValueOnce(
          makeGetResponse(
            makeGhIssue({ number: 5, parent: { number: 3 } }),
          ),
        )
        // removeSubIssue: getIssueNodeId(3), getIssueNodeId(5), mutation
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_3' } },
        })
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockReturnValueOnce({
          removeSubIssue: {
            issue: { title: 'Old' },
            subIssue: { title: 'Child' },
          },
        })
        // addSubIssue: getIssueNodeId(7), getIssueNodeId(5), mutation
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_7' } },
        })
        .mockReturnValueOnce({
          repository: { issue: { id: 'NODE_5' } },
        })
        .mockReturnValueOnce({
          addSubIssue: {
            issue: { title: 'New' },
            subIssue: { title: 'Child' },
          },
        })
        // final getWorkItem
        .mockReturnValueOnce(
          makeGetResponse(
            makeGhIssue({ number: 5, parent: { number: 7 } }),
          ),
        );

      const item = await backend.updateWorkItem('5', { parent: '7' });
      expect(item.parent).toBe('7');
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
    it('returns items whose parent matches the given id', async () => {
      const backend = new GitHubBackend('/repo');
      mockGhGraphQL.mockReturnValue(
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
    it('throws UnsupportedOperationError', async () => {
      const backend = new GitHubBackend('/repo');
      await expect(backend.getDependents('1')).rejects.toThrow(
        'dependsOn is not supported by the GitHubBackend backend',
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
      expect(await backend.getAssignees()).toEqual([
        'alice',
        'bob',
        'charlie',
      ]);
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
```

Key changes from previous test file:
- Added `ghGraphQL` to mock setup
- Added `makeGhIssue`, `makeListResponse`, `makeGetResponse` test helpers for GraphQL response shapes
- Default `mockGh` returns `{ nameWithOwner: 'owner/repo' }` in `beforeEach` (for `getOwnerRepo` caching)
- `listWorkItems` tests mock `mockGhGraphQL` instead of `mockGh`
- `getWorkItem` tests mock `mockGhGraphQL` instead of `mockGh`
- `createWorkItem` test with parent verifies 4 `ghGraphQL` calls (nodeId x2, mutation, getWorkItem)
- Added tests for `updateWorkItem` parent operations: set, clear, change
- `getChildren` test verifies filtering by parent from list
- `getDependents` error message updated to `'dependsOn is not supported...'`
- Capability assertions updated: `relationships: true`, `parent: true`

**Step 2: Run tests**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: ALL PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: ALL PASS — no regressions in other backends or components

**Step 4: Run lint and type check**

Run: `npm run lint && npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/github.test.ts
git commit -m "test(github): update tests for GraphQL reads and parent/sub-issues support"
```

---

### Task 5: Final verification

**Step 1: Run full build + test + lint**

Run: `npm run build && npm test && npm run lint`
Expected: ALL PASS

**Step 2: Verify sync manager compatibility**

The sync manager (`src/sync/SyncManager.ts:93-105`) passes `parent: localItem.parent` and `dependsOn: localItem.dependsOn` to `remote.createWorkItem()`. With the GitHub backend now supporting `parent: true`, `validateFields` will no longer throw for non-null parent values. The `dependsOn` field still throws if non-empty, which is correct — local items syncing to GitHub should have empty `dependsOn`.

No code changes needed; just verify conceptually that the sync error from the session start ("parent is not supported by the GitHubBackend backend") would now be resolved.
