# GitHub Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a GitHub backend that lets users interact with GitHub Issues through the tic TUI, shelling out to the `gh` CLI for every operation.

**Architecture:** `GitHubBackend` implements the `Backend` interface from `src/backends/types.ts`. A thin `gh` wrapper in `gh.ts` handles `execSync` calls and JSON parsing. Mappers in `mappers.ts` convert between `gh` JSON output and tic's `WorkItem`/`Comment` types. The factory in `src/backends/factory.ts` is updated to instantiate `GitHubBackend`.

**Tech Stack:** TypeScript, `execSync` (node:child_process), `gh` CLI (JSON output mode), Vitest for tests.

---

### Task 1: gh CLI Wrapper

**Files:**
- Create: `src/backends/github/gh.ts`
- Test: `src/backends/github/gh.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/github/gh.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { execSync } from 'node:child_process';
import { gh, ghExec } from './gh.js';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);

describe('gh', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('parses JSON output from gh command', () => {
    mockExecSync.mockReturnValue('{"number": 1, "title": "Test"}');
    const result = gh<{ number: number; title: string }>(
      ['issue', 'view', '1', '--json', 'number,title'],
      '/tmp',
    );
    expect(result).toEqual({ number: 1, title: 'Test' });
    expect(mockExecSync).toHaveBeenCalledWith(
      'gh issue view 1 --json number,title',
      { cwd: '/tmp', encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
    );
  });

  it('throws on gh command failure', () => {
    mockExecSync.mockImplementation(() => {
      throw new Error('gh: command failed');
    });
    expect(() => gh(['issue', 'view', '999'], '/tmp')).toThrow();
  });
});

describe('ghExec', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns raw string output', () => {
    mockExecSync.mockReturnValue('Closed issue #1\n');
    const result = ghExec(['issue', 'close', '1'], '/tmp');
    expect(result).toBe('Closed issue #1\n');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/gh.test.ts`
Expected: FAIL — module `./gh.js` not found.

**Step 3: Write the implementation**

Create `src/backends/github/gh.ts`:

```typescript
import { execSync } from 'node:child_process';

export function gh<T>(args: string[], cwd: string): T {
  const result = execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function ghExec(args: string[], cwd: string): string {
  return execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/gh.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/gh.ts src/backends/github/gh.test.ts
git commit -m "feat(github): add gh CLI wrapper"
```

---

### Task 2: Data Mappers

**Files:**
- Create: `src/backends/github/mappers.ts`
- Test: `src/backends/github/mappers.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/github/mappers.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { mapIssueToWorkItem, mapCommentToComment } from './mappers.js';

describe('mapIssueToWorkItem', () => {
  it('maps a full GitHub issue to a WorkItem', () => {
    const ghIssue = {
      number: 42,
      title: 'Fix login bug',
      body: 'The login form breaks on mobile.',
      state: 'OPEN',
      assignees: [{ login: 'alice' }, { login: 'bob' }],
      labels: [{ name: 'bug' }, { name: 'urgent' }],
      milestone: { title: 'v1.0' },
      createdAt: '2026-01-15T10:00:00Z',
      updatedAt: '2026-01-20T14:30:00Z',
      comments: [
        {
          author: { login: 'charlie' },
          createdAt: '2026-01-16T09:00:00Z',
          body: 'I can reproduce this.',
        },
      ],
    };

    const item = mapIssueToWorkItem(ghIssue);

    expect(item.id).toBe(42);
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toBe('The login form breaks on mobile.');
    expect(item.status).toBe('open');
    expect(item.type).toBe('issue');
    expect(item.assignee).toBe('alice');
    expect(item.labels).toEqual(['bug', 'urgent']);
    expect(item.iteration).toBe('v1.0');
    expect(item.priority).toBe('medium');
    expect(item.created).toBe('2026-01-15T10:00:00Z');
    expect(item.updated).toBe('2026-01-20T14:30:00Z');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.author).toBe('charlie');
  });

  it('handles null body', () => {
    const ghIssue = {
      number: 1,
      title: 'Empty',
      body: null,
      state: 'CLOSED',
      assignees: [],
      labels: [],
      milestone: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      comments: [],
    };

    const item = mapIssueToWorkItem(ghIssue);

    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.labels).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles missing comments array', () => {
    const ghIssue = {
      number: 1,
      title: 'No comments',
      body: 'Test',
      state: 'OPEN',
      assignees: [],
      labels: [],
      milestone: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    };

    const item = mapIssueToWorkItem(ghIssue);
    expect(item.comments).toEqual([]);
  });
});

describe('mapCommentToComment', () => {
  it('maps a GitHub comment to a tic Comment', () => {
    const ghComment = {
      author: { login: 'alice' },
      createdAt: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapCommentToComment(ghComment);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/mappers.test.ts`
Expected: FAIL — module `./mappers.js` not found.

**Step 3: Write the implementation**

Create `src/backends/github/mappers.ts`:

```typescript
import type { WorkItem, Comment } from '../../types.js';

export interface GhIssue {
  number: number;
  title: string;
  body: string | null;
  state: string;
  assignees: { login: string }[];
  labels: { name: string }[];
  milestone: { title: string } | null;
  createdAt: string;
  updatedAt: string;
  comments?: GhComment[];
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
    id: ghIssue.number,
    title: ghIssue.title,
    description: ghIssue.body ?? '',
    status: ghIssue.state === 'OPEN' ? 'open' : 'closed',
    type: 'issue',
    assignee: ghIssue.assignees[0]?.login ?? '',
    labels: ghIssue.labels.map((l) => l.name),
    iteration: ghIssue.milestone?.title ?? '',
    priority: 'medium',
    created: ghIssue.createdAt,
    updated: ghIssue.updatedAt,
    parent: null,
    dependsOn: [],
    comments: (ghIssue.comments ?? []).map(mapCommentToComment),
  };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/mappers.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/mappers.ts src/backends/github/mappers.test.ts
git commit -m "feat(github): add data mappers for issues and comments"
```

---

### Task 3: GitHubBackend — Constructor and Config Methods

**Files:**
- Create: `src/backends/github/index.ts`
- Create: `src/backends/github/github.test.ts`

**Step 1: Write the failing tests**

Create `src/backends/github/github.test.ts`:

```typescript
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
      expect(mockGhExec).toHaveBeenCalledWith(
        ['auth', 'status'],
        '/repo',
      );
    });

    it('throws when gh auth fails', () => {
      mockGhExec.mockImplementation(() => {
        throw new Error('not logged in');
      });
      expect(() => new GitHubBackend('/repo')).toThrow();
    });
  });

  describe('getStatuses', () => {
    it('returns open and closed', () => {
      const backend = new GitHubBackend('/repo');
      expect(backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns issue', () => {
      const backend = new GitHubBackend('/repo');
      expect(backend.getWorkItemTypes()).toEqual(['issue']);
    });
  });

  describe('getIterations', () => {
    it('returns milestone titles', () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([
        { title: 'v1.0', state: 'open', due_on: null },
        { title: 'v2.0', state: 'open', due_on: null },
      ]);
      expect(backend.getIterations()).toEqual(['v1.0', 'v2.0']);
    });

    it('returns empty array when no milestones', () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([]);
      expect(backend.getIterations()).toEqual([]);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns first open milestone', () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([
        { title: 'v1.0', state: 'open', due_on: '2026-03-01T00:00:00Z' },
        { title: 'v2.0', state: 'open', due_on: '2026-06-01T00:00:00Z' },
      ]);
      expect(backend.getCurrentIteration()).toBe('v1.0');
    });

    it('returns empty string when no open milestones', () => {
      const backend = new GitHubBackend('/repo');
      mockGh.mockReturnValue([]);
      expect(backend.getCurrentIteration()).toBe('');
    });
  });

  describe('setCurrentIteration', () => {
    it('is a no-op', () => {
      const backend = new GitHubBackend('/repo');
      expect(() => backend.setCurrentIteration('v1.0')).not.toThrow();
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: FAIL — module `./index.js` not found.

**Step 3: Write the implementation**

Create `src/backends/github/index.ts`:

```typescript
import type { Backend } from '../types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../../types.js';
import { gh, ghExec } from './gh.js';
import { mapIssueToWorkItem, mapCommentToComment } from './mappers.js';
import type { GhIssue, GhComment, GhMilestone } from './mappers.js';

const ISSUE_FIELDS =
  'number,title,body,state,assignees,labels,milestone,createdAt,updatedAt,comments';

export class GitHubBackend implements Backend {
  private cwd: string;

  constructor(cwd: string) {
    this.cwd = cwd;
    ghExec(['auth', 'status'], cwd);
  }

  getStatuses(): string[] {
    return ['open', 'closed'];
  }

  getWorkItemTypes(): string[] {
    return ['issue'];
  }

  getIterations(): string[] {
    const milestones = this.fetchMilestones();
    return milestones.map((m) => m.title);
  }

  getCurrentIteration(): string {
    const milestones = this.fetchOpenMilestones();
    if (milestones.length === 0) return '';
    return milestones[0]!.title;
  }

  setCurrentIteration(_name: string): void {
    // No-op — current iteration is always first open milestone
  }

  listWorkItems(_iteration?: string): WorkItem[] {
    throw new Error('Not yet implemented');
  }

  getWorkItem(_id: number): WorkItem {
    throw new Error('Not yet implemented');
  }

  createWorkItem(_data: NewWorkItem): WorkItem {
    throw new Error('Not yet implemented');
  }

  updateWorkItem(_id: number, _data: Partial<WorkItem>): WorkItem {
    throw new Error('Not yet implemented');
  }

  deleteWorkItem(_id: number): void {
    throw new Error('Not yet implemented');
  }

  addComment(_workItemId: number, _comment: NewComment): Comment {
    throw new Error('Not yet implemented');
  }

  getChildren(_id: number): WorkItem[] {
    return [];
  }

  getDependents(_id: number): WorkItem[] {
    return [];
  }

  getItemUrl(_id: number): string {
    throw new Error('Not yet implemented');
  }

  openItem(_id: number): void {
    throw new Error('Not yet implemented');
  }

  private fetchMilestones(): GhMilestone[] {
    const owner = this.getRepoNwo();
    return gh<GhMilestone[]>(
      ['api', `repos/${owner}/milestones`, '--jq', '.'],
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

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/github.test.ts
git commit -m "feat(github): add GitHubBackend with constructor and config methods"
```

---

### Task 4: GitHubBackend — List and Get Work Items

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/github/github.test.ts`

**Step 1: Write the failing tests**

Append to the `describe('GitHubBackend', ...)` block in `src/backends/github/github.test.ts`:

```typescript
  describe('listWorkItems', () => {
    it('returns all issues mapped to WorkItems', () => {
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

      const items = backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items[0]!.id).toBe(1);
      expect(items[0]!.status).toBe('open');
      expect(items[1]!.id).toBe(2);
      expect(items[1]!.status).toBe('closed');
    });

    it('filters by iteration (milestone)', () => {
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
        {
          number: 2,
          title: 'In v2',
          body: '',
          state: 'OPEN',
          assignees: [],
          labels: [],
          milestone: { title: 'v2.0' },
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
          comments: [],
        },
      ]);

      const items = backend.listWorkItems('v1.0');
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('In v1');
    });
  });

  describe('getWorkItem', () => {
    it('returns a single issue as WorkItem', () => {
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

      const item = backend.getWorkItem(42);
      expect(item.id).toBe(42);
      expect(item.title).toBe('The issue');
      expect(item.assignee).toBe('bob');
      expect(item.comments).toHaveLength(1);
      expect(item.comments[0]!.author).toBe('alice');
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: FAIL — `listWorkItems` throws "Not yet implemented".

**Step 3: Write the implementation**

Replace the `listWorkItems` and `getWorkItem` stubs in `src/backends/github/index.ts`:

```typescript
  listWorkItems(iteration?: string): WorkItem[] {
    const args = [
      'issue',
      'list',
      '--state',
      'all',
      '--json',
      ISSUE_FIELDS,
      '--limit',
      '500',
    ];
    if (iteration) {
      args.push('--milestone', iteration);
    }
    const issues = gh<GhIssue[]>(args, this.cwd);
    return issues.map(mapIssueToWorkItem);
  }

  getWorkItem(id: number): WorkItem {
    const issue = gh<GhIssue>(
      ['issue', 'view', String(id), '--json', ISSUE_FIELDS],
      this.cwd,
    );
    return mapIssueToWorkItem(issue);
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/github.test.ts
git commit -m "feat(github): add listWorkItems and getWorkItem"
```

---

### Task 5: GitHubBackend — Create, Update, Delete

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/github/github.test.ts`

**Step 1: Write the failing tests**

Append to the test file:

```typescript
  describe('createWorkItem', () => {
    it('creates an issue and returns the WorkItem', () => {
      const backend = new GitHubBackend('/repo');

      // gh issue create returns the new issue URL, then we fetch it
      mockGhExec.mockReturnValue(
        'https://github.com/owner/repo/issues/10\n',
      );
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

      expect(item.id).toBe(10);
      expect(item.title).toBe('New issue');
    });
  });

  describe('updateWorkItem', () => {
    it('updates title and body', () => {
      const backend = new GitHubBackend('/repo');

      // First call: ghExec for the edit command
      // Then gh for fetching updated issue
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

      const item = backend.updateWorkItem(5, {
        title: 'Updated title',
        description: 'Updated body',
      });

      expect(item.title).toBe('Updated title');
      expect(item.description).toBe('Updated body');
    });

    it('closes an issue when status changes to closed', () => {
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

      const item = backend.updateWorkItem(5, { status: 'closed' });
      expect(item.status).toBe('closed');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'close', '5'],
        '/repo',
      );
    });

    it('reopens an issue when status changes to open', () => {
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

      const item = backend.updateWorkItem(5, { status: 'open' });
      expect(item.status).toBe('open');
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'reopen', '5'],
        '/repo',
      );
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');
      backend.deleteWorkItem(7);
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'delete', '7', '--yes'],
        '/repo',
      );
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: FAIL — methods throw "Not yet implemented".

**Step 3: Write the implementation**

Replace the `createWorkItem`, `updateWorkItem`, and `deleteWorkItem` stubs in `src/backends/github/index.ts`:

```typescript
  createWorkItem(data: NewWorkItem): WorkItem {
    const args = ['issue', 'create', '--title', data.title];

    if (data.description) {
      args.push('--body', data.description);
    }
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
    const id = parseInt(match[1]!, 10);
    return this.getWorkItem(id);
  }

  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem {
    const idStr = String(id);

    // Handle status changes via close/reopen
    if (data.status === 'closed') {
      ghExec(['issue', 'close', idStr], this.cwd);
    } else if (data.status === 'open') {
      ghExec(['issue', 'reopen', idStr], this.cwd);
    }

    // Handle field edits
    const editArgs = ['issue', 'edit', idStr];
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

  deleteWorkItem(id: number): void {
    ghExec(['issue', 'delete', String(id), '--yes'], this.cwd);
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/github.test.ts
git commit -m "feat(github): add create, update, and delete operations"
```

---

### Task 6: GitHubBackend — Comments, URL, and Open

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/github/github.test.ts`

**Step 1: Write the failing tests**

Append to the test file:

```typescript
  describe('addComment', () => {
    it('adds a comment and returns it', () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      const comment = backend.addComment(3, {
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
      mockGh.mockReturnValue({ url: 'https://github.com/owner/repo/issues/5' });

      const url = backend.getItemUrl(5);
      expect(url).toBe('https://github.com/owner/repo/issues/5');
    });
  });

  describe('openItem', () => {
    it('opens the issue in the browser', () => {
      const backend = new GitHubBackend('/repo');
      mockGhExec.mockReturnValue('');

      backend.openItem(5);
      expect(mockGhExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });
  });

  describe('getChildren', () => {
    it('returns empty array', () => {
      const backend = new GitHubBackend('/repo');
      expect(backend.getChildren(1)).toEqual([]);
    });
  });

  describe('getDependents', () => {
    it('returns empty array', () => {
      const backend = new GitHubBackend('/repo');
      expect(backend.getDependents(1)).toEqual([]);
    });
  });
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: FAIL — methods throw "Not yet implemented".

**Step 3: Write the implementation**

Replace the remaining stubs in `src/backends/github/index.ts`:

```typescript
  addComment(workItemId: number, comment: NewComment): Comment {
    ghExec(
      ['issue', 'comment', String(workItemId), '--body', comment.body],
      this.cwd,
    );
    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getItemUrl(id: number): string {
    const result = gh<{ url: string }>(
      ['issue', 'view', String(id), '--json', 'url'],
      this.cwd,
    );
    return result.url;
  }

  openItem(id: number): void {
    ghExec(['issue', 'view', String(id), '--web'], this.cwd);
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/github/github.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/github.test.ts
git commit -m "feat(github): add comments, URL, and open support"
```

---

### Task 7: Wire Up Factory

**Files:**
- Modify: `src/backends/factory.ts`
- Modify: `src/backends/factory.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/factory.test.ts`, in the `describe('createBackend', ...)` block, replace the existing "throws for unimplemented backends" test:

```typescript
  it('creates a GitHubBackend when backend is github', () => {
    writeConfig(tmpDir, { ...defaultConfig, backend: 'github' });
    // This will throw because gh auth will fail in test env,
    // but it should NOT throw "not yet implemented"
    expect(() => createBackend(tmpDir)).not.toThrow('not yet implemented');
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: FAIL — still throws "not yet implemented".

**Step 3: Write the implementation**

In `src/backends/factory.ts`, add the import and update the switch case:

Add import at top:
```typescript
import { GitHubBackend } from './github/index.js';
```

Update the switch statement — replace the `case 'github':` line (remove it from the combined github/gitlab/azure case):

```typescript
  switch (backend) {
    case 'local':
      return new LocalBackend(root);
    case 'github':
      return new GitHubBackend(root);
    case 'gitlab':
    case 'azure':
      throw new Error(
        `Backend "${backend}" is not yet implemented. Use "local" for now.`,
      );
    default:
      throw new Error(
        `Unknown backend "${backend}". Valid backends: ${VALID_BACKENDS.join(', ')}`,
      );
  }
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/factory.test.ts`
Expected: PASS (the test expects it to NOT throw "not yet implemented" — it will throw a gh auth error instead, which is correct).

**Step 5: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/backends/factory.ts src/backends/factory.test.ts
git commit -m "feat(github): wire GitHubBackend into factory"
```

---

### Task 8: Settings Screen — Enable GitHub Selection

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Read the current Settings component**

Read `src/components/Settings.tsx` to understand the current disabled-backend logic.

**Step 2: Update Settings to allow selecting github**

The Settings component currently prevents selecting any non-local backend. Update the condition so that `github` is also selectable (alongside `local`). The exact change depends on the current code, but it should be something like changing:

```typescript
if (selected !== 'local') {
  return;
}
```

to:

```typescript
if (selected !== 'local' && selected !== 'github') {
  return;
}
```

And update the display to not show "(not yet available)" for `github`.

**Step 3: Run the full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat(github): enable GitHub backend selection in Settings"
```

---

### Task 9: Final Verification

**Step 1: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 2: Run format check**

Run: `npm run format:check`
Expected: All files formatted.

**Step 3: Run format if needed**

Run: `npm run format` (only if format:check fails)

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Build**

Run: `npm run build`
Expected: Build succeeds.

**Step 7: Commit any formatting fixes**

If format or lint produced changes:

```bash
git add -A
git commit -m "style: format and lint fixes"
```
