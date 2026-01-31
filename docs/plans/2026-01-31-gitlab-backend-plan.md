# GitLab Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Implement a GitLab backend using `glab` CLI that maps GitLab issues and epics to tic work items, plus migrate all IDs from `number` to `string` project-wide.

**Architecture:** Two-phase approach. Phase 1 migrates `WorkItem.id` from `number` to `string` across all existing code (types, backends, components, CLI, MCP, tests). Phase 2 builds the GitLab backend on top of the string ID foundation. The GitLab backend shells out to `glab` for issues and uses `glab api` for group-level resources (epics, iterations).

**Tech Stack:** TypeScript, `glab` CLI (execFileSync), `glab api` for REST calls, Vitest for testing.

---

## Phase 1: String ID Migration

### Task 1: Migrate Core Type Definitions

**Files:**
- Modify: `src/types.ts:8,20-21`
- Modify: `src/backends/types.ts:33-41,52-60`

**Step 1: Update `src/types.ts`**

Change three fields in the `WorkItem` interface:

```ts
// src/types.ts — change these three lines:
id: string;              // was: id: number;
parent: string | null;   // was: parent: number | null;
dependsOn: string[];     // was: dependsOn: number[];
```

**Step 2: Update `src/backends/types.ts`**

Change all `id: number` parameters to `id: string` in both the `Backend` interface (lines 33-41) and the `BaseBackend` abstract class (lines 52-60):

```ts
// In Backend interface and BaseBackend abstract class, change:
getWorkItem(id: string): WorkItem;
updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem;
deleteWorkItem(id: string): void;
addComment(workItemId: string, comment: NewComment): Comment;
getChildren(id: string): WorkItem[];
getDependents(id: string): WorkItem[];
getItemUrl(id: string): string;
openItem(id: string): void;
```

**Step 3: Run the TypeScript compiler to find all downstream breakages**

Run: `npx tsc --noEmit 2>&1 | head -100`
Expected: Multiple type errors across the codebase. This gives us the exact list of files to fix.

**Step 4: Commit**

```
feat: migrate WorkItem.id from number to string in type definitions
```

---

### Task 2: Migrate LocalBackend to String IDs

**Files:**
- Modify: `src/backends/local/items.ts:10-11,70,81,91-92,125,128`
- Modify: `src/backends/local/index.ts:77-78,82,86-89,93-95,101,117,125-126,134,141,152,159,162,177,191-193,197,200-202,211,224,229,234,238`

**Step 1: Update `src/backends/local/items.ts`**

Change `itemPath` to accept `string`:
```ts
function itemPath(root: string, id: string): string {
  return path.join(itemsDir(root), `${id}.md`);
}
```

Change `readWorkItem` signature:
```ts
export function readWorkItem(root: string, id: string): WorkItem {
```

Change `parseWorkItemFile` to stringify the ID fields:
```ts
// line 81: was `id: data['id'] as number`
id: String(data['id']),
// line 91: was `parent: (data['parent'] as number) ?? null`
parent: data['parent'] != null ? String(data['parent']) : null,
// line 92: was `dependsOn: (data['depends_on'] as number[]) ?? []`
dependsOn: ((data['depends_on'] as (number | string)[]) ?? []).map(String),
```

Change `deleteWorkItem` signature:
```ts
export function deleteWorkItem(root: string, id: string): void {
```

**Step 2: Update `src/backends/local/index.ts`**

Change `validateRelationships` to use `string`:
```ts
private validateRelationships(
  id: string,
  parent: string | null | undefined,
  dependsOn: string[] | undefined,
): void {
```

Inside `validateRelationships`, update all comparisons — change `current: number | null` to `current: string | null`, `visited = new Set<number>()` to `visited = new Set<string>()`, and `hasCycle` params from `number` to `string`.

Change `createWorkItem` to stringify the ID:
```ts
// line 162 area — change `id` assignment:
const id = String(this.config.next_id);
```

Change all method signatures from `id: number` to `id: string`:
- `getWorkItem(id: string)`
- `updateWorkItem(id: string, ...)`
- `deleteWorkItem(id: string)`
- `addComment(workItemId: string, ...)`
- `getChildren(id: string)`
- `getDependents(id: string)`
- `getItemUrl(id: string)`
- `openItem(id: string)`

**Step 3: Run `npx tsc --noEmit` to verify LocalBackend compiles**

Expected: Errors only in files not yet migrated (components, CLI, GitHub backend).

**Step 4: Commit**

```
feat: migrate LocalBackend to string IDs
```

---

### Task 3: Migrate GitHub Backend to String IDs

**Files:**
- Modify: `src/backends/github/mappers.ts:38`
- Modify: `src/backends/github/index.ts:84,115-116,119,167,170,174,186,188,191,193,196,204`

**Step 1: Update `src/backends/github/mappers.ts`**

```ts
// line 38: was `id: ghIssue.number`
id: String(ghIssue.number),
```

**Step 2: Update `src/backends/github/index.ts`**

Change all method signatures from `id: number` to `id: string`. Where `String(id)` was used to pass to the CLI, just use `id` directly (it's already a string). Where `parseInt` was used to parse from a URL, use the match directly:

```ts
// line 115: was `const id = parseInt(match[1]!, 10);`
const id = match[1]!;
```

For `getChildren`/`getDependents`, the comparison `item.parent === id` still works since both are now strings.

**Step 3: Run `npx tsc --noEmit` to verify GitHub backend compiles**

**Step 4: Commit**

```
feat: migrate GitHubBackend to string IDs
```

---

### Task 4: Migrate App State and Components to String IDs

**Files:**
- Modify: `src/app.tsx:13,17,29`
- Modify: `src/components/WorkItemList.tsx:15,26,323`
- Modify: `src/components/WorkItemForm.tsx:98,103`

**Step 1: Update `src/app.tsx`**

```ts
// line 13: was `selectedWorkItemId: number | null;`
selectedWorkItemId: string | null;
// line 17: was `selectWorkItem: (id: number | null) => void;`
selectWorkItem: (id: string | null) => void;
// line 29: was `useState<number | null>(null)`
useState<string | null>(null)
```

**Step 2: Update `src/components/WorkItemList.tsx`**

```ts
// line 15: was `Map<number | null, WorkItem[]>`
const childrenMap = new Map<string | null, WorkItem[]>();
// line 26: was `function walk(parentId: number | null, depth: number, parentPrefix: string)`
function walk(parentId: string | null, depth: number, parentPrefix: string) {
// line 323: was `const newParent = value.trim() === '' ? null : parseInt(value.trim(), 10);`
const newParent = value.trim() === '' ? null : value.trim();
```

**Step 3: Update `src/components/WorkItemForm.tsx`**

```ts
// line 98: was `const parsedParent = parentId.trim() === '' ? null : parseInt(parentId.trim(), 10);`
const parsedParent = parentId.trim() === '' ? null : parentId.trim();
// lines 99-103: was `.map((s) => parseInt(s, 10));`
const parsedDependsOn = dependsOn
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);
```

**Step 4: Run `npx tsc --noEmit` to verify components compile**

**Step 5: Commit**

```
feat: migrate components and app state to string IDs
```

---

### Task 5: Migrate CLI Commands to String IDs

**Files:**
- Modify: `src/cli/commands/item.ts:55,57,80,86,100,105,110,114,119`
- Modify: `src/cli/index.ts:204-205,216-217,221-222,274-275,297-298,300,302,304,322-323,349-350`

**Step 1: Update `src/cli/commands/item.ts`**

Change function signatures from `id: number` to `id: string`:
```ts
export function runItemShow(backend: Backend, id: string): WorkItem {
export function runItemUpdate(backend: Backend, id: string, ...): WorkItem {
export function runItemDelete(backend: Backend, id: string): void {
export function runItemOpen(backend: Backend, id: string): void {
export function runItemComment(backend: Backend, id: string, ...): Comment {
```

Change parent/dependsOn parsing to pass strings instead of numbers:
```ts
// line 55: was `parent: opts.parent ? Number(opts.parent) : null`
parent: opts.parent ? opts.parent : null,
// line 57: was `opts.dependsOn.split(',').map((d) => Number(d.trim()))`
opts.dependsOn.split(',').map((d) => d.trim()).filter((d) => d.length > 0)
// line 100: was `data.parent = opts.parent === '' ? null : Number(opts.parent);`
data.parent = opts.parent === '' ? null : opts.parent;
// line 105: was `opts.dependsOn.split(',').map((d) => Number(d.trim()))`
opts.dependsOn.split(',').map((d) => d.trim()).filter((d) => d.length > 0)
```

**Step 2: Update `src/cli/index.ts`**

Remove `Number()` parsing and `Number.isNaN` validation for IDs. The ID from the CLI argument is already a string — pass it directly:

```ts
// In show, open, update, delete, comment handlers:
// was: const id = Number(idStr); if (Number.isNaN(id)) throw new Error(...)
// now: const id = idStr; (just use idStr directly, or rename param)
const wi = runItemShow(backend, idStr);
```

Remove the `Number.isNaN` check entirely — any non-empty string is a valid ID now.

**Step 3: Run `npx tsc --noEmit` to verify CLI compiles**

**Step 4: Commit**

```
feat: migrate CLI commands to string IDs
```

---

### Task 6: Migrate MCP Server to String IDs

**Files:**
- Modify: `src/cli/commands/mcp.ts:119,139-140,144-145,153-154,170,196,208,211,216,247,267,326,339,351,372,388-389,433,451-455,467,475-483,495,506,517,556,567`

**Step 1: Update handler interfaces and function signatures**

Change all `id: number` to `id: string` in interfaces:
```ts
// handleShowItem: args: { id: string }
// CreateItemArgs: parent?: string; depends_on?: string[];
// UpdateItemArgs: id: string; parent?: string | null; depends_on?: string[];
// handleDeleteItem: args: { id: string }
// handleConfirmDelete: args: { id: string }
// handleAddComment: args: { id: string; ... }
// handleGetChildren: args: { id: string }
// handleGetDependents: args: { id: string }
// TreeNode: id: string;
```

**Step 2: Update DeleteTracker type**

```ts
// was: export type DeleteTracker = Set<number>;
export type DeleteTracker = Set<string>;
// was: return new Set<number>();
return new Set<string>();
```

**Step 3: Update nodeMap in handleGetItemTree**

```ts
// was: const nodeMap = new Map<number, TreeNode>();
const nodeMap = new Map<string, TreeNode>();
```

**Step 4: Update Zod schemas**

Change all `z.number()` for IDs to `z.string()`:
```ts
// show_item, delete_item, confirm_delete, add_comment, get_children, get_dependents:
id: z.string().describe('Work item ID'),

// create_item:
parent: z.string().optional().describe('Parent item ID'),
depends_on: z.array(z.string()).optional().describe('Dependency item IDs'),

// update_item:
id: z.string().describe('Work item ID'),
parent: z.string().nullable().optional().describe('Parent item ID (null to clear)'),
depends_on: z.array(z.string()).optional().describe('Dependency item IDs'),
```

**Step 5: Update handleCreateItem/handleUpdateItem**

Remove `String()` conversions for parent since args.parent is already a string:
```ts
// line 170: was `if (args.parent !== undefined) opts.parent = String(args.parent);`
if (args.parent !== undefined) opts.parent = args.parent;
// line 196: was `opts.parent = args.parent === null ? '' : String(args.parent);`
opts.parent = args.parent === null ? '' : args.parent;
```

**Step 6: Run `npx tsc --noEmit` — should be clean now**

Expected: No type errors.

**Step 7: Commit**

```
feat: migrate MCP server to string IDs
```

---

### Task 7: Fix All Tests for String IDs

**Files:**
- Modify: `src/backends/local/config.test.ts` — no changes needed (config.next_id stays number)
- Modify: `src/backends/local/items.test.ts` — update ID assertions from numbers to strings
- Modify: `src/backends/local/index.test.ts` — update ID arguments and assertions
- Modify: `src/backends/github/mappers.test.ts` — update `.id` assertions to strings
- Modify: `src/backends/github/github.test.ts` — update ID arguments and assertions
- Modify: `src/backends/factory.test.ts` — likely no changes
- Modify: `src/backends/base.test.ts` — update ID param types if applicable
- Modify: `src/cli/__tests__/item.test.ts` — update ID arguments
- Modify: `src/cli/__tests__/mcp.test.ts` — update ID arguments and assertions

**Step 1: Run `npm test` to see all failures**

Run: `npm test 2>&1 | tail -50`

**Step 2: Fix each test file**

For each file with failures, update:
- Numeric ID arguments to strings: `backend.getWorkItem(1)` → `backend.getWorkItem('1')`
- Numeric ID assertions: `expect(item.id).toBe(1)` → `expect(item.id).toBe('1')`
- Numeric parent assertions: `expect(item.parent).toBe(3)` → `expect(item.parent).toBe('3')`
- Numeric dependsOn assertions: `expect(item.dependsOn).toEqual([2])` → `expect(item.dependsOn).toEqual(['2'])`

For GitHub tests specifically:
- `expect(item.id).toBe(42)` → `expect(item.id).toBe('42')`
- `backend.getWorkItem(42)` → `backend.getWorkItem('42')`
- `backend.updateWorkItem(5, ...)` → `backend.updateWorkItem('5', ...)`
- `backend.deleteWorkItem(7)` → `backend.deleteWorkItem('7')`
- `backend.addComment(3, ...)` → `backend.addComment('3', ...)`
- `backend.getItemUrl(5)` → `backend.getItemUrl('5')`
- `backend.openItem(5)` → `backend.openItem('5')`
- `backend.getChildren(1)` → `backend.getChildren('1')`
- `backend.getDependents(1)` → `backend.getDependents('1')`

**Step 3: Run `npm test` — all tests should pass**

Run: `npm test`
Expected: All tests pass.

**Step 4: Run lint and format**

Run: `npm run lint && npm run format:check`

**Step 5: Commit**

```
test: update all tests for string ID migration
```

---

## Phase 2: GitLab Backend

### Task 8: Create `glab` CLI Wrapper

**Files:**
- Create: `src/backends/gitlab/glab.ts`

**Step 1: Write the test**

Create `src/backends/gitlab/glab.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { execFileSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

// Must import after mock
const { glab, glabExec } = await import('./glab.js');

describe('glab', () => {
  it('parses JSON output from glab', () => {
    mockExecFileSync.mockReturnValue('{"id": 1, "title": "Test"}');
    const result = glab<{ id: number; title: string }>(['issue', 'list'], '/repo');
    expect(result).toEqual({ id: 1, title: 'Test' });
    expect(mockExecFileSync).toHaveBeenCalledWith('glab', ['issue', 'list'], {
      cwd: '/repo',
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  });

  it('throws on invalid JSON', () => {
    mockExecFileSync.mockReturnValue('not json');
    expect(() => glab(['bad'], '/repo')).toThrow();
  });
});

describe('glabExec', () => {
  it('returns raw string output from glab', () => {
    mockExecFileSync.mockReturnValue('output text\n');
    const result = glabExec(['auth', 'status'], '/repo');
    expect(result).toBe('output text\n');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/gitlab/glab.test.ts`
Expected: FAIL (module not found)

**Step 3: Write `src/backends/gitlab/glab.ts`**

```ts
import { execFileSync } from 'node:child_process';

export function glab<T>(args: string[], cwd: string): T {
  const result = execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result) as T;
}

export function glabExec(args: string[], cwd: string): string {
  return execFileSync('glab', args, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/gitlab/glab.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(gitlab): add glab CLI wrapper
```

---

### Task 9: Create Group Detection

**Files:**
- Create: `src/backends/gitlab/group.ts`

**Step 1: Write the test**

Create `src/backends/gitlab/group.test.ts`:

```ts
import { describe, it, expect, vi } from 'vitest';
import { execSync } from 'node:child_process';

vi.mock('node:child_process', () => ({
  execSync: vi.fn(),
}));

const mockExecSync = vi.mocked(execSync);
const { detectGroup } = await import('./group.js');

describe('detectGroup', () => {
  it('detects group from SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:mygroup/project.git (fetch)\n' +
      'origin\tgit@gitlab.com:mygroup/project.git (push)\n'
    );
    expect(detectGroup('/repo')).toBe('mygroup');
  });

  it('detects group from HTTPS remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/mygroup/project.git (fetch)\n'
    );
    expect(detectGroup('/repo')).toBe('mygroup');
  });

  it('detects nested subgroup from SSH remote', () => {
    mockExecSync.mockReturnValue(
      'origin\tgit@gitlab.com:a/b/c/project.git (fetch)\n'
    );
    expect(detectGroup('/repo')).toBe('a/b/c');
  });

  it('detects nested subgroup from HTTPS remote', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/a/b/c/project.git (fetch)\n'
    );
    expect(detectGroup('/repo')).toBe('a/b/c');
  });

  it('handles HTTPS URL without .git suffix', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://gitlab.com/mygroup/project (fetch)\n'
    );
    expect(detectGroup('/repo')).toBe('mygroup');
  });

  it('throws when no gitlab remote found', () => {
    mockExecSync.mockReturnValue(
      'origin\thttps://github.com/user/repo.git (fetch)\n'
    );
    expect(() => detectGroup('/repo')).toThrow('Could not detect GitLab group');
  });

  it('throws when git remote fails', () => {
    mockExecSync.mockImplementation(() => { throw new Error('not a repo'); });
    expect(() => detectGroup('/repo')).toThrow('Could not detect GitLab group');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/gitlab/group.test.ts`
Expected: FAIL (module not found)

**Step 3: Write `src/backends/gitlab/group.ts`**

```ts
import { execSync } from 'node:child_process';

export function detectGroup(cwd: string): string {
  let remoteOutput: string;
  try {
    remoteOutput = execSync('git remote -v', {
      cwd,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } catch {
    throw new Error(
      'Could not detect GitLab group from git remote. Ensure the remote points to a GitLab repository.',
    );
  }

  // Match gitlab.com in either SSH or HTTPS format
  // SSH: git@gitlab.com:group/subgroup/project.git
  // HTTPS: https://gitlab.com/group/subgroup/project.git
  const sshMatch = remoteOutput.match(
    /git@gitlab\.com:(.+?)\.git\s/,
  );
  const httpsMatch = remoteOutput.match(
    /https?:\/\/gitlab\.com\/(.+?)(?:\.git)?\s/,
  );

  const fullPath = sshMatch?.[1] ?? httpsMatch?.[1];
  if (!fullPath) {
    throw new Error(
      'Could not detect GitLab group from git remote. Ensure the remote points to a GitLab repository.',
    );
  }

  // Full path is "group/subgroup/project" — group is everything except the last segment
  const segments = fullPath.split('/');
  if (segments.length < 2) {
    throw new Error(
      'Could not detect GitLab group from git remote. Ensure the remote points to a GitLab repository.',
    );
  }

  return segments.slice(0, -1).join('/');
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/gitlab/group.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(gitlab): add group detection from git remote
```

---

### Task 10: Create GitLab Data Mappers

**Files:**
- Create: `src/backends/gitlab/mappers.ts`

**Step 1: Write the test**

Create `src/backends/gitlab/mappers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  mapIssueToWorkItem,
  mapEpicToWorkItem,
  mapNoteToComment,
} from './mappers.js';

describe('mapIssueToWorkItem', () => {
  it('maps a full GitLab issue to a WorkItem', () => {
    const issue = {
      iid: 42,
      title: 'Fix login bug',
      description: 'The login form breaks on mobile.',
      state: 'opened',
      assignees: [{ username: 'alice' }, { username: 'bob' }],
      labels: ['bug', 'urgent'],
      milestone: { title: 'v1.0' },
      epic: { iid: 5 },
      created_at: '2026-01-15T10:00:00Z',
      updated_at: '2026-01-20T14:30:00Z',
    };

    const item = mapIssueToWorkItem(issue);

    expect(item.id).toBe('issue-42');
    expect(item.title).toBe('Fix login bug');
    expect(item.description).toBe('The login form breaks on mobile.');
    expect(item.status).toBe('open');
    expect(item.type).toBe('issue');
    expect(item.assignee).toBe('alice');
    expect(item.labels).toEqual(['bug', 'urgent']);
    expect(item.iteration).toBe('v1.0');
    expect(item.priority).toBe('medium');
    expect(item.parent).toBe('epic-5');
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles null description, no epic, no milestone, no assignees', () => {
    const issue = {
      iid: 1,
      title: 'Empty',
      description: null,
      state: 'closed',
      assignees: [],
      labels: [],
      milestone: null,
      epic: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const item = mapIssueToWorkItem(issue);

    expect(item.id).toBe('issue-1');
    expect(item.description).toBe('');
    expect(item.status).toBe('closed');
    expect(item.assignee).toBe('');
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
  });
});

describe('mapEpicToWorkItem', () => {
  it('maps a GitLab epic to a WorkItem', () => {
    const epic = {
      iid: 5,
      title: 'Q1 Goals',
      description: 'Goals for Q1',
      state: 'opened',
      labels: ['roadmap'],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-10T00:00:00Z',
    };

    const item = mapEpicToWorkItem(epic);

    expect(item.id).toBe('epic-5');
    expect(item.title).toBe('Q1 Goals');
    expect(item.description).toBe('Goals for Q1');
    expect(item.status).toBe('open');
    expect(item.type).toBe('epic');
    expect(item.assignee).toBe('');
    expect(item.labels).toEqual(['roadmap']);
    expect(item.iteration).toBe('');
    expect(item.parent).toBeNull();
    expect(item.dependsOn).toEqual([]);
    expect(item.comments).toEqual([]);
  });

  it('handles closed epic with null description', () => {
    const epic = {
      iid: 2,
      title: 'Done',
      description: null,
      state: 'closed',
      labels: [],
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    };

    const item = mapEpicToWorkItem(epic);
    expect(item.status).toBe('closed');
    expect(item.description).toBe('');
  });
});

describe('mapNoteToComment', () => {
  it('maps a GitLab note to a Comment', () => {
    const note = {
      author: { username: 'alice' },
      created_at: '2026-01-15T10:00:00Z',
      body: 'Looks good!',
    };

    const comment = mapNoteToComment(note);

    expect(comment.author).toBe('alice');
    expect(comment.date).toBe('2026-01-15T10:00:00Z');
    expect(comment.body).toBe('Looks good!');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/gitlab/mappers.test.ts`
Expected: FAIL (module not found)

**Step 3: Write `src/backends/gitlab/mappers.ts`**

```ts
import type { WorkItem, Comment } from '../../types.js';

export interface GlIssue {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  assignees: { username: string }[];
  labels: string[];
  milestone: { title: string } | null;
  epic: { iid: number } | null;
  created_at: string;
  updated_at: string;
}

export interface GlEpic {
  iid: number;
  title: string;
  description: string | null;
  state: string;
  labels: string[];
  created_at: string;
  updated_at: string;
}

export interface GlNote {
  author: { username: string };
  created_at: string;
  body: string;
}

export function mapNoteToComment(note: GlNote): Comment {
  return {
    author: note.author.username,
    date: note.created_at,
    body: note.body,
  };
}

export function mapIssueToWorkItem(issue: GlIssue): WorkItem {
  return {
    id: `issue-${issue.iid}`,
    title: issue.title,
    description: issue.description ?? '',
    status: issue.state === 'opened' ? 'open' : 'closed',
    type: 'issue',
    assignee: issue.assignees[0]?.username ?? '',
    labels: issue.labels,
    iteration: issue.milestone?.title ?? '',
    priority: 'medium',
    created: issue.created_at,
    updated: issue.updated_at,
    parent: issue.epic ? `epic-${issue.epic.iid}` : null,
    dependsOn: [],
    comments: [],
  };
}

export function mapEpicToWorkItem(epic: GlEpic): WorkItem {
  return {
    id: `epic-${epic.iid}`,
    title: epic.title,
    description: epic.description ?? '',
    status: epic.state === 'opened' ? 'open' : 'closed',
    type: 'epic',
    assignee: '',
    labels: epic.labels,
    iteration: '',
    priority: 'medium',
    created: epic.created_at,
    updated: epic.updated_at,
    parent: null,
    dependsOn: [],
    comments: [],
  };
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/gitlab/mappers.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(gitlab): add data mappers for issues, epics, and comments
```

---

### Task 11: Implement GitLabBackend Class

**Files:**
- Create: `src/backends/gitlab/index.ts`

**Step 1: Write the test**

Create `src/backends/gitlab/gitlab.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GitLabBackend } from './index.js';

vi.mock('./glab.js', () => ({
  glab: vi.fn(),
  glabExec: vi.fn(),
}));

vi.mock('./group.js', () => ({
  detectGroup: vi.fn().mockReturnValue('mygroup'),
}));

import { glab, glabExec } from './glab.js';

const mockGlab = vi.mocked(glab);
const mockGlabExec = vi.mocked(glabExec);

describe('GitLabBackend', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGlabExec.mockReturnValue('');
  });

  describe('constructor', () => {
    it('verifies glab auth on construction', () => {
      new GitLabBackend('/repo');
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
      const backend = new GitLabBackend('/repo');
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
      const backend = new GitLabBackend('/repo');
      expect(backend.getStatuses()).toEqual(['open', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns epic and issue', () => {
      const backend = new GitLabBackend('/repo');
      expect(backend.getWorkItemTypes()).toEqual(['epic', 'issue']);
    });
  });

  describe('listWorkItems', () => {
    it('combines issues and epics', () => {
      const backend = new GitLabBackend('/repo');

      // First call: issues
      mockGlab.mockReturnValueOnce([
        {
          iid: 1, title: 'Issue 1', description: 'desc',
          state: 'opened', assignees: [], labels: [],
          milestone: null, epic: null,
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-02T00:00:00Z',
        },
      ]);
      // Second call: epics
      mockGlab.mockReturnValueOnce([
        {
          iid: 1, title: 'Epic 1', description: 'epic desc',
          state: 'opened', labels: [],
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-03T00:00:00Z',
        },
      ]);

      const items = backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.id)).toContain('issue-1');
      expect(items.map((i) => i.id)).toContain('epic-1');
    });
  });

  describe('getWorkItem', () => {
    it('fetches an issue by prefixed ID', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce({
        iid: 42, title: 'The issue', description: 'Details',
        state: 'opened', assignees: [{ username: 'bob' }],
        labels: ['feature'], milestone: { title: 'v1.0' },
        epic: null,
        created_at: '2026-01-10T00:00:00Z',
        updated_at: '2026-01-11T00:00:00Z',
      });
      // Notes call
      mockGlab.mockReturnValueOnce([
        { author: { username: 'alice' }, created_at: '2026-01-10T12:00:00Z', body: 'On it.' },
      ]);

      const item = backend.getWorkItem('issue-42');
      expect(item.id).toBe('issue-42');
      expect(item.title).toBe('The issue');
      expect(item.comments).toHaveLength(1);
    });

    it('fetches an epic by prefixed ID', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce({
        iid: 5, title: 'Q1 Goals', description: 'Goals',
        state: 'opened', labels: ['roadmap'],
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-10T00:00:00Z',
      });

      const item = backend.getWorkItem('epic-5');
      expect(item.id).toBe('epic-5');
      expect(item.type).toBe('epic');
    });

    it('throws on invalid ID format', () => {
      const backend = new GitLabBackend('/repo');
      expect(() => backend.getWorkItem('invalid-id')).toThrow();
    });
  });

  describe('createWorkItem', () => {
    it('creates an issue via glab issue create', () => {
      const backend = new GitLabBackend('/repo');
      mockGlabExec.mockReturnValue(
        'https://gitlab.com/mygroup/project/-/issues/10\n'
      );
      mockGlab.mockReturnValueOnce({
        iid: 10, title: 'New issue', description: 'Description',
        state: 'opened', assignees: [{ username: 'alice' }],
        labels: ['bug'], milestone: { title: 'v1.0' },
        epic: null,
        created_at: '2026-01-20T00:00:00Z',
        updated_at: '2026-01-20T00:00:00Z',
      });
      mockGlab.mockReturnValueOnce([]); // notes

      const item = backend.createWorkItem({
        title: 'New issue', type: 'issue', status: 'open',
        iteration: 'v1.0', priority: 'medium',
        assignee: 'alice', labels: ['bug'],
        description: 'Description', parent: null, dependsOn: [],
      });

      expect(item.id).toBe('issue-10');
    });

    it('creates an epic via glab api', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce({
        iid: 3, title: 'New epic', description: 'Epic desc',
        state: 'opened', labels: [],
        created_at: '2026-01-20T00:00:00Z',
        updated_at: '2026-01-20T00:00:00Z',
      });

      const item = backend.createWorkItem({
        title: 'New epic', type: 'epic', status: 'open',
        iteration: '', priority: 'medium',
        assignee: '', labels: [],
        description: 'Epic desc', parent: null, dependsOn: [],
      });

      expect(item.id).toBe('epic-3');
      expect(item.type).toBe('epic');
    });
  });

  describe('deleteWorkItem', () => {
    it('deletes an issue', () => {
      const backend = new GitLabBackend('/repo');
      mockGlabExec.mockReturnValue('');
      backend.deleteWorkItem('issue-7');
      expect(mockGlabExec).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'delete', '7']),
        '/repo',
      );
    });
  });

  describe('addComment', () => {
    it('adds a comment to an issue', () => {
      const backend = new GitLabBackend('/repo');
      mockGlabExec.mockReturnValue('');

      const comment = backend.addComment('issue-3', {
        author: 'alice', body: 'This is a comment.',
      });

      expect(mockGlabExec).toHaveBeenCalledWith(
        expect.arrayContaining(['issue', 'note', '3', '-m', 'This is a comment.']),
        '/repo',
      );
      expect(comment.body).toBe('This is a comment.');
    });
  });

  describe('getChildren', () => {
    it('returns issues under an epic', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce([
        {
          iid: 10, title: 'Child 1', description: '',
          state: 'opened', assignees: [], labels: [],
          milestone: null, epic: { iid: 5 },
          created_at: '2026-01-01T00:00:00Z',
          updated_at: '2026-01-01T00:00:00Z',
        },
      ]);

      const children = backend.getChildren('epic-5');
      expect(children).toHaveLength(1);
      expect(children[0]!.id).toBe('issue-10');
    });

    it('returns empty array for an issue', () => {
      const backend = new GitLabBackend('/repo');
      expect(backend.getChildren('issue-1')).toEqual([]);
    });
  });

  describe('getItemUrl', () => {
    it('returns issue URL', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce({
        iid: 5, title: 'T', description: '', state: 'opened',
        assignees: [], labels: [], milestone: null, epic: null,
        web_url: 'https://gitlab.com/mygroup/project/-/issues/5',
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      });

      const url = backend.getItemUrl('issue-5');
      expect(url).toContain('/issues/5');
    });
  });

  describe('openItem', () => {
    it('opens an issue in the browser', () => {
      const backend = new GitLabBackend('/repo');
      mockGlabExec.mockReturnValue('');
      backend.openItem('issue-5');
      expect(mockGlabExec).toHaveBeenCalledWith(
        ['issue', 'view', '5', '--web'],
        '/repo',
      );
    });
  });

  describe('getIterations', () => {
    it('returns iteration titles', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce([
        { title: 'Sprint 1', start_date: '2026-01-01', due_date: '2026-01-14' },
        { title: 'Sprint 2', start_date: '2026-01-15', due_date: '2026-01-28' },
      ]);
      expect(backend.getIterations()).toEqual(['Sprint 1', 'Sprint 2']);
    });
  });

  describe('getCurrentIteration', () => {
    it('returns the iteration containing today', () => {
      const backend = new GitLabBackend('/repo');
      const today = new Date().toISOString().split('T')[0]!;
      const pastDate = '2020-01-01';
      const futureDate = '2030-12-31';
      mockGlab.mockReturnValueOnce([
        { title: 'Past Sprint', start_date: pastDate, due_date: pastDate },
        { title: 'Current', start_date: pastDate, due_date: futureDate },
      ]);
      expect(backend.getCurrentIteration()).toBe('Current');
    });

    it('returns empty string when no current iteration', () => {
      const backend = new GitLabBackend('/repo');
      mockGlab.mockReturnValueOnce([]);
      expect(backend.getCurrentIteration()).toBe('');
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/gitlab/gitlab.test.ts`
Expected: FAIL (module not found)

**Step 3: Write `src/backends/gitlab/index.ts`**

```ts
import { BaseBackend } from '../types.js';
import type { BackendCapabilities } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
} from '../../types.js';
import { glab, glabExec } from './glab.js';
import { detectGroup } from './group.js';
import {
  mapIssueToWorkItem,
  mapEpicToWorkItem,
  mapNoteToComment,
} from './mappers.js';
import type { GlIssue, GlEpic, GlNote } from './mappers.js';

interface GlIteration {
  title: string;
  start_date: string;
  due_date: string;
}

function parseId(id: string): { type: 'issue' | 'epic'; iid: string } {
  const match = id.match(/^(issue|epic)-(\d+)$/);
  if (!match) {
    throw new Error(
      `Invalid work item ID "${id}". Expected format: issue-N or epic-N`,
    );
  }
  return { type: match[1] as 'issue' | 'epic', iid: match[2]! };
}

export class GitLabBackend extends BaseBackend {
  private cwd: string;
  private group: string;

  constructor(cwd: string) {
    super();
    this.cwd = cwd;
    glabExec(['auth', 'status'], cwd);
    this.group = detectGroup(cwd);
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

  getStatuses(): string[] {
    return ['open', 'closed'];
  }

  getWorkItemTypes(): string[] {
    return ['epic', 'issue'];
  }

  getIterations(): string[] {
    const iterations = glab<GlIteration[]>(
      ['iteration', 'list', '-F', 'json'],
      this.cwd,
    );
    return iterations.map((i) => i.title);
  }

  getCurrentIteration(): string {
    const iterations = glab<GlIteration[]>(
      ['iteration', 'list', '-F', 'json'],
      this.cwd,
    );
    const today = new Date().toISOString().split('T')[0]!;
    const current = iterations.find(
      (i) => i.start_date <= today && i.due_date >= today,
    );
    return current?.title ?? '';
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setCurrentIteration(_name: string): void {
    // No-op — current iteration is derived from dates
  }

  listWorkItems(iteration?: string): WorkItem[] {
    // Fetch issues
    const issueArgs = [
      'issue', 'list', '-O', 'json', '--per-page', '100',
    ];
    if (iteration) {
      issueArgs.push('--milestone', iteration);
    }
    const issues = glab<GlIssue[]>(issueArgs, this.cwd);
    const issueItems = issues.map(mapIssueToWorkItem);

    // Fetch epics
    const groupPath = encodeURIComponent(this.group);
    const epics = glab<GlEpic[]>(
      ['api', `groups/${groupPath}/epics`, '--paginate'],
      this.cwd,
    );
    const epicItems = epics.map(mapEpicToWorkItem);

    // Merge and sort by updated descending
    const all = [...issueItems, ...epicItems];
    all.sort((a, b) => b.updated.localeCompare(a.updated));
    return all;
  }

  getWorkItem(id: string): WorkItem {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      const issue = glab<GlIssue>(
        ['issue', 'view', iid, '-F', 'json'],
        this.cwd,
      );
      const item = mapIssueToWorkItem(issue);
      // Fetch notes for comments
      const notes = glab<GlNote[]>(
        ['api', `projects/:id/issues/${iid}/notes`, '--paginate'],
        this.cwd,
      );
      item.comments = notes.map(mapNoteToComment);
      return item;
    }

    // Epic
    const groupPath = encodeURIComponent(this.group);
    const epic = glab<GlEpic>(
      ['api', `groups/${groupPath}/epics/${iid}`],
      this.cwd,
    );
    return mapEpicToWorkItem(epic);
  }

  createWorkItem(data: NewWorkItem): WorkItem {
    this.validateFields(data);

    if (data.type === 'epic') {
      const groupPath = encodeURIComponent(this.group);
      const epic = glab<GlEpic>(
        [
          'api', `groups/${groupPath}/epics`, '-X', 'POST',
          '-f', `title=${data.title}`,
          ...(data.description ? ['-f', `description=${data.description}`] : []),
          ...(data.labels.length > 0
            ? ['-f', `labels=${data.labels.join(',')}`]
            : []),
        ],
        this.cwd,
      );
      return mapEpicToWorkItem(epic);
    }

    // Issue
    const args = ['issue', 'create', '--title', data.title, '--yes'];
    if (data.description) args.push('--description', data.description);
    if (data.assignee) args.push('--assignee', data.assignee);
    if (data.iteration) args.push('--milestone', data.iteration);
    for (const label of data.labels) {
      args.push('--label', label);
    }
    if (data.parent) {
      const { type: parentType, iid: parentIid } = parseId(data.parent);
      if (parentType === 'epic') {
        args.push('--epic', parentIid);
      }
    }

    const output = glabExec(args, this.cwd);
    // glab issue create prints the URL
    const match = output.match(/issues\/(\d+)/);
    if (!match) {
      throw new Error('Failed to parse issue IID from glab output');
    }
    return this.getWorkItem(`issue-${match[1]}`);
  }

  updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem {
    this.validateFields(data);
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      // Handle status changes
      if (data.status === 'closed') {
        glabExec(['issue', 'close', iid], this.cwd);
      } else if (data.status === 'open') {
        glabExec(['issue', 'reopen', iid], this.cwd);
      }

      // Handle field edits
      const editArgs = ['issue', 'update', iid];
      let hasEdits = false;

      if (data.title !== undefined) {
        editArgs.push('--title', data.title);
        hasEdits = true;
      }
      if (data.description !== undefined) {
        editArgs.push('--description', data.description);
        hasEdits = true;
      }
      if (data.iteration !== undefined) {
        if (data.iteration) {
          editArgs.push('--milestone', data.iteration);
        } else {
          editArgs.push('--milestone', '0');
        }
        hasEdits = true;
      }
      if (data.assignee !== undefined) {
        if (data.assignee) {
          editArgs.push('--assignee', data.assignee);
        } else {
          editArgs.push('--unassign');
        }
        hasEdits = true;
      }
      if (data.labels !== undefined) {
        for (const label of data.labels) {
          editArgs.push('--label', label);
        }
        hasEdits = true;
      }

      if (hasEdits) {
        glabExec(editArgs, this.cwd);
      }

      return this.getWorkItem(id);
    }

    // Epic update via API
    const groupPath = encodeURIComponent(this.group);
    const apiArgs = ['api', `groups/${groupPath}/epics/${iid}`, '-X', 'PUT'];

    if (data.title !== undefined) apiArgs.push('-f', `title=${data.title}`);
    if (data.description !== undefined)
      apiArgs.push('-f', `description=${data.description}`);
    if (data.status === 'closed')
      apiArgs.push('-f', 'state_event=close');
    else if (data.status === 'open')
      apiArgs.push('-f', 'state_event=reopen');
    if (data.labels !== undefined)
      apiArgs.push('-f', `labels=${data.labels.join(',')}`);

    glab(apiArgs, this.cwd);
    return this.getWorkItem(id);
  }

  deleteWorkItem(id: string): void {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      glabExec(['issue', 'delete', iid], this.cwd);
    } else {
      const groupPath = encodeURIComponent(this.group);
      glab(['api', `groups/${groupPath}/epics/${iid}`, '-X', 'DELETE'], this.cwd);
    }
  }

  addComment(workItemId: string, comment: NewComment): Comment {
    const { type, iid } = parseId(workItemId);

    if (type === 'issue') {
      glabExec(['issue', 'note', iid, '-m', comment.body], this.cwd);
    } else {
      const groupPath = encodeURIComponent(this.group);
      glab(
        [
          'api', `groups/${groupPath}/epics/${iid}/notes`,
          '-X', 'POST', '-f', `body=${comment.body}`,
        ],
        this.cwd,
      );
    }

    return {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
  }

  getChildren(id: string): WorkItem[] {
    const { type, iid } = parseId(id);

    if (type === 'issue') return [];

    const groupPath = encodeURIComponent(this.group);
    const issues = glab<GlIssue[]>(
      ['api', `groups/${groupPath}/epics/${iid}/issues`],
      this.cwd,
    );
    return issues.map(mapIssueToWorkItem);
  }

  getDependents(id: string): WorkItem[] {
    // Not supported for GitLab
    void id;
    return [];
  }

  getItemUrl(id: string): string {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      const issue = glab<GlIssue & { web_url: string }>(
        ['issue', 'view', iid, '-F', 'json'],
        this.cwd,
      );
      return issue.web_url;
    }

    // Construct epic URL
    return `https://gitlab.com/groups/${this.group}/-/epics/${iid}`;
  }

  openItem(id: string): void {
    const { type, iid } = parseId(id);

    if (type === 'issue') {
      glabExec(['issue', 'view', iid, '--web'], this.cwd);
    } else {
      const url = this.getItemUrl(id);
      const { execSync } = require('node:child_process');
      execSync(`open "${url}"`, { stdio: 'ignore' });
    }
  }
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/gitlab/gitlab.test.ts`
Expected: PASS (after adjusting mocks/assertions as needed)

**Step 5: Commit**

```
feat(gitlab): implement GitLabBackend with full Backend interface
```

---

### Task 12: Wire Up Factory and Final Integration

**Files:**
- Modify: `src/backends/factory.ts:4,34-38`

**Step 1: Update `src/backends/factory.ts`**

Add import:
```ts
import { GitLabBackend } from './gitlab/index.js';
```

Update the switch case:
```ts
case 'gitlab':
  return new GitLabBackend(root);
```

**Step 2: Run `npx tsc --noEmit` — full project should compile**

Expected: No type errors.

**Step 3: Run `npm test` — all tests should pass**

Run: `npm test`
Expected: All tests pass.

**Step 4: Run lint and format**

Run: `npm run lint:fix && npm run format`

**Step 5: Commit**

```
feat(gitlab): wire up GitLabBackend in factory
```

---

### Task 13: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 3: Run format check**

Run: `npm run format:check`
Expected: All files formatted.

**Step 4: Run build**

Run: `npm run build`
Expected: Compiles without errors.

**Step 5: Verify the TUI starts**

Run: `npm start -- --help`
Expected: Shows help without errors.
