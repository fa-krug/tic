# MCP Server Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `tic mcp serve` command that starts an MCP server over stdio, exposing 14 tools for work item management.

**Architecture:** A new `src/cli/commands/mcp.ts` file exports testable handler functions and a `startMcpServer(backend)` function. Each handler takes a `Backend` instance and typed args, returns `{ content, isError? }`. The Commander subcommand in `src/cli/index.ts` wires it up. Two-step delete uses an in-memory `Set<number>` for previewed IDs.

**Tech Stack:** `@modelcontextprotocol/sdk` (McpServer + StdioServerTransport), `zod` (input schemas), existing `Backend` interface.

---

### Task 0: Install dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install packages**

Run:
```bash
cd /Users/skrug/PycharmProjects/tic && npm install @modelcontextprotocol/sdk zod
```

**Step 2: Verify installation**

Run:
```bash
cd /Users/skrug/PycharmProjects/tic && node -e "import('@modelcontextprotocol/sdk/server/mcp.js').then(() => console.log('SDK OK'))"
```
Expected: `SDK OK`

Run:
```bash
cd /Users/skrug/PycharmProjects/tic && node -e "import('zod').then(() => console.log('Zod OK'))"
```
Expected: `Zod OK`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add @modelcontextprotocol/sdk and zod dependencies"
```

---

### Task 1: Create MCP handler type and init_project handler with test

**Files:**
- Create: `src/cli/commands/mcp.ts`
- Create: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the test file with init_project tests**

Create `src/cli/__tests__/mcp.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { handleInitProject } from '../commands/mcp.js';

describe('MCP handlers', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-mcp-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('handleInitProject', () => {
    it('initializes a new project', () => {
      const result = handleInitProject(tmpDir);
      expect(result.isError).toBeUndefined();
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.initialized).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
    });

    it('returns alreadyExists for existing project', () => {
      handleInitProject(tmpDir);
      const result = handleInitProject(tmpDir);
      const parsed = JSON.parse(result.content[0]!.text);
      expect(parsed.alreadyExists).toBe(true);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL — `handleInitProject` not found

**Step 3: Create mcp.ts with the ToolResult type and init_project handler**

Create `src/cli/commands/mcp.ts`:

```typescript
import type { Backend } from '../../backends/types.js';
import { runInit } from './init.js';

export interface ToolResult {
  content: { type: string; text: string }[];
  isError?: boolean;
}

function success(data: unknown): ToolResult {
  return { content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] };
}

function error(message: string): ToolResult {
  return { content: [{ type: 'text', text: message }], isError: true };
}

export function handleInitProject(root: string): ToolResult {
  try {
    const result = runInit(root);
    if (result.alreadyExists) {
      return success({ alreadyExists: true });
    }
    return success({ initialized: true });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add MCP handler scaffolding with init_project"
```

---

### Task 2: Add get_config handler with test

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing test**

Add to `src/cli/__tests__/mcp.test.ts`, inside the outer `describe`, after the `handleInitProject` describe block. Import `handleGetConfig` from `../commands/mcp.js`.

```typescript
describe('handleGetConfig', () => {
  it('returns statuses, types, iterations, and current iteration', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleGetConfig(backend);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.statuses).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
    expect(parsed.types).toEqual(['epic', 'issue', 'task']);
    expect(parsed.iterations).toEqual(['default']);
    expect(parsed.currentIteration).toBe('default');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL — `handleGetConfig` not found

**Step 3: Implement handleGetConfig**

Add to `src/cli/commands/mcp.ts`:

```typescript
export function handleGetConfig(backend: Backend): ToolResult {
  try {
    return success({
      statuses: backend.getStatuses(),
      types: backend.getWorkItemTypes(),
      iterations: backend.getIterations(),
      currentIteration: backend.getCurrentIteration(),
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add get_config MCP handler"
```

---

### Task 3: Add list_items and show_item handlers with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add imports: `handleListItems`, `handleShowItem` from `../commands/mcp.js`. Add to the test file inside the outer describe:

```typescript
describe('handleListItems', () => {
  it('lists items for current iteration', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'A', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'B', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleListItems(backend, {});
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(2);
  });

  it('filters by type and status', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Epic', type: 'epic', status: 'todo', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Task', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleListItems(backend, { type: 'epic' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Epic');
  });
});

describe('handleShowItem', () => {
  it('returns item details', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Bug', type: 'task', status: 'backlog', priority: 'high', assignee: 'alice', labels: ['auth'], iteration: 'default', parent: null, dependsOn: [], description: 'Fix it' });
    const result = handleShowItem(backend, { id: 1 });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.title).toBe('Bug');
    expect(parsed.priority).toBe('high');
    expect(parsed.description).toBe('Fix it');
  });

  it('returns error for non-existent item', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleShowItem(backend, { id: 999 });
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL — `handleListItems` and `handleShowItem` not found

**Step 3: Implement both handlers**

Add to `src/cli/commands/mcp.ts`. Import `runItemList` and `runItemShow` from `./item.js`, and import the `ItemListOptions` type:

```typescript
import { runItemList, runItemShow } from './item.js';
import type { ItemListOptions } from './item.js';

export interface ListItemsArgs {
  type?: string;
  status?: string;
  iteration?: string;
  all?: boolean;
}

export function handleListItems(backend: Backend, args: ListItemsArgs): ToolResult {
  try {
    const opts: ItemListOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.all) opts.all = args.all;
    const items = runItemList(backend, opts);
    return success(items);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleShowItem(backend: Backend, args: { id: number }): ToolResult {
  try {
    const item = runItemShow(backend, args.id);
    return success(item);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (7 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add list_items and show_item MCP handlers"
```

---

### Task 4: Add create_item and update_item handlers with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add imports: `handleCreateItem`, `handleUpdateItem`. Add:

```typescript
describe('handleCreateItem', () => {
  it('creates an item with defaults', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleCreateItem(backend, { title: 'New bug' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.title).toBe('New bug');
    expect(parsed.type).toBe('task');
    expect(parsed.status).toBe('backlog');
    expect(parsed.id).toBe(1);
  });

  it('creates an item with all options', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleCreateItem(backend, {
      title: 'Epic thing',
      type: 'epic',
      status: 'todo',
      priority: 'high',
      assignee: 'alice',
      labels: 'auth,backend',
      iteration: 'sprint-1',
      description: 'The details',
    });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.type).toBe('epic');
    expect(parsed.priority).toBe('high');
    expect(parsed.labels).toEqual(['auth', 'backend']);
    expect(parsed.description).toBe('The details');
  });
});

describe('handleUpdateItem', () => {
  it('updates specified fields', () => {
    const backend = new LocalBackend(tmpDir);
    handleCreateItem(backend, { title: 'Original' });
    const result = handleUpdateItem(backend, { id: 1, title: 'Updated', status: 'done' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.title).toBe('Updated');
    expect(parsed.status).toBe('done');
    expect(parsed.type).toBe('task');
  });

  it('returns error for non-existent item', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleUpdateItem(backend, { id: 999, title: 'Nope' });
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL

**Step 3: Implement both handlers**

Add to `src/cli/commands/mcp.ts`. Import `runItemCreate` and `runItemUpdate` from `./item.js`:

```typescript
import { runItemCreate, runItemUpdate, runItemList, runItemShow } from './item.js';
import type { ItemListOptions, ItemCreateOptions, ItemUpdateOptions } from './item.js';

export interface CreateItemArgs {
  title: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: number;
  depends_on?: number[];
  description?: string;
}

export interface UpdateItemArgs {
  id: number;
  title?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: number | null;
  depends_on?: number[];
  description?: string;
}

export function handleCreateItem(backend: Backend, args: CreateItemArgs): ToolResult {
  try {
    const opts: ItemCreateOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.priority) opts.priority = args.priority;
    if (args.assignee) opts.assignee = args.assignee;
    if (args.labels) opts.labels = args.labels;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.parent !== undefined) opts.parent = String(args.parent);
    if (args.depends_on) opts.dependsOn = args.depends_on.join(',');
    if (args.description) opts.description = args.description;
    const item = runItemCreate(backend, args.title, opts);
    return success(item);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleUpdateItem(backend: Backend, args: UpdateItemArgs): ToolResult {
  try {
    const opts: ItemUpdateOptions = {};
    if (args.title !== undefined) opts.title = args.title;
    if (args.type !== undefined) opts.type = args.type;
    if (args.status !== undefined) opts.status = args.status;
    if (args.priority !== undefined) opts.priority = args.priority;
    if (args.assignee !== undefined) opts.assignee = args.assignee;
    if (args.labels !== undefined) opts.labels = args.labels;
    if (args.iteration !== undefined) opts.iteration = args.iteration;
    if (args.parent !== undefined) opts.parent = args.parent === null ? '' : String(args.parent);
    if (args.depends_on !== undefined) opts.dependsOn = args.depends_on.join(',');
    if (args.description !== undefined) opts.description = args.description;
    const item = runItemUpdate(backend, args.id, opts);
    return success(item);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (11 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add create_item and update_item MCP handlers"
```

---

### Task 5: Add two-step delete handlers with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add imports: `handleDeleteItem`, `handleConfirmDelete`, `createDeleteTracker`. Add:

```typescript
describe('delete (two-step)', () => {
  it('delete_item returns preview without deleting', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Target', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const tracker = createDeleteTracker();
    const result = handleDeleteItem(backend, { id: 1 }, tracker);
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.item.title).toBe('Target');
    expect(parsed.preview).toBe(true);
    // Item still exists
    expect(backend.listWorkItems()).toHaveLength(1);
  });

  it('delete_item shows affected children and dependents', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Parent', type: 'epic', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Child', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: 1, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Dep', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [1], description: '' });
    const tracker = createDeleteTracker();
    const result = handleDeleteItem(backend, { id: 1 }, tracker);
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.affectedChildren).toHaveLength(1);
    expect(parsed.affectedChildren[0].title).toBe('Child');
    expect(parsed.affectedDependents).toHaveLength(1);
    expect(parsed.affectedDependents[0].title).toBe('Dep');
  });

  it('confirm_delete works after preview', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Target', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const tracker = createDeleteTracker();
    handleDeleteItem(backend, { id: 1 }, tracker);
    const result = handleConfirmDelete(backend, { id: 1 }, tracker);
    expect(result.isError).toBeUndefined();
    expect(backend.listWorkItems()).toHaveLength(0);
  });

  it('confirm_delete rejects without prior preview', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Target', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const tracker = createDeleteTracker();
    const result = handleConfirmDelete(backend, { id: 1 }, tracker);
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('No pending delete');
  });

  it('confirm_delete rejects second call for same id', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Target', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const tracker = createDeleteTracker();
    handleDeleteItem(backend, { id: 1 }, tracker);
    handleConfirmDelete(backend, { id: 1 }, tracker);
    const result = handleConfirmDelete(backend, { id: 1 }, tracker);
    expect(result.isError).toBe(true);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL

**Step 3: Implement delete handlers with tracker**

Add to `src/cli/commands/mcp.ts`. Import `runItemDelete` from `./item.js`:

```typescript
import { runItemCreate, runItemUpdate, runItemList, runItemShow, runItemDelete } from './item.js';

export type DeleteTracker = Set<number>;

export function createDeleteTracker(): DeleteTracker {
  return new Set<number>();
}

export function handleDeleteItem(
  backend: Backend,
  args: { id: number },
  pendingDeletes: DeleteTracker,
): ToolResult {
  try {
    const item = backend.getWorkItem(args.id);
    const children = backend.getChildren(args.id);
    const dependents = backend.getDependents(args.id);
    pendingDeletes.add(args.id);
    return success({
      preview: true,
      item: { id: item.id, title: item.title, type: item.type, status: item.status },
      affectedChildren: children.map((c) => ({ id: c.id, title: c.title })),
      affectedDependents: dependents.map((d) => ({ id: d.id, title: d.title })),
      message: 'Use confirm_delete to proceed with deletion.',
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleConfirmDelete(
  backend: Backend,
  args: { id: number },
  pendingDeletes: DeleteTracker,
): ToolResult {
  if (!pendingDeletes.has(args.id)) {
    return error(
      `No pending delete for item ${args.id}. Call delete_item first to preview.`,
    );
  }
  try {
    runItemDelete(backend, args.id);
    pendingDeletes.delete(args.id);
    return success({ deleted: args.id });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (16 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add two-step delete MCP handlers with preview"
```

---

### Task 6: Add add_comment and set_iteration handlers with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add imports: `handleAddComment`, `handleSetIteration`. Add:

```typescript
describe('handleAddComment', () => {
  it('adds a comment to an item', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Item', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleAddComment(backend, { id: 1, text: 'Looks good', author: 'alice' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.body).toBe('Looks good');
    expect(parsed.author).toBe('alice');
  });

  it('defaults author to anonymous', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Item', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleAddComment(backend, { id: 1, text: 'Note' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.author).toBe('anonymous');
  });

  it('returns error for non-existent item', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleAddComment(backend, { id: 999, text: 'Nope' });
    expect(result.isError).toBe(true);
  });
});

describe('handleSetIteration', () => {
  it('sets the current iteration', () => {
    const backend = new LocalBackend(tmpDir);
    const result = handleSetIteration(backend, { name: 'sprint-2' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed.currentIteration).toBe('sprint-2');
    expect(backend.getCurrentIteration()).toBe('sprint-2');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL

**Step 3: Implement both handlers**

Add to `src/cli/commands/mcp.ts`. Import `runItemComment` from `./item.js` and `runIterationSet` from `./iteration.js`:

```typescript
import { runItemComment } from './item.js';
import type { ItemCommentOptions } from './item.js';
import { runIterationSet } from './iteration.js';

export function handleAddComment(
  backend: Backend,
  args: { id: number; text: string; author?: string },
): ToolResult {
  try {
    const opts: ItemCommentOptions = {};
    if (args.author) opts.author = args.author;
    const comment = runItemComment(backend, args.id, args.text, opts);
    return success(comment);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleSetIteration(
  backend: Backend,
  args: { name: string },
): ToolResult {
  try {
    runIterationSet(backend, args.name);
    return success({ currentIteration: args.name });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (20 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add add_comment and set_iteration MCP handlers"
```

---

### Task 7: Add search_items handler with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add import: `handleSearchItems`. Add:

```typescript
describe('handleSearchItems', () => {
  it('finds items by title match', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Fix login bug', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Add search', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleSearchItems(backend, { query: 'login' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Fix login bug');
  });

  it('finds items by description match', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Bug', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: 'Authentication fails on refresh' });
    const result = handleSearchItems(backend, { query: 'authentication' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
  });

  it('is case-insensitive', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Fix Login', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleSearchItems(backend, { query: 'fix login' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
  });

  it('returns empty array for no matches', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Bug', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleSearchItems(backend, { query: 'nonexistent' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(0);
  });

  it('combines search with filters', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Login bug', type: 'task', status: 'todo', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Login epic', type: 'epic', status: 'todo', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleSearchItems(backend, { query: 'login', type: 'task' });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].type).toBe('task');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL

**Step 3: Implement handleSearchItems**

Add to `src/cli/commands/mcp.ts`:

```typescript
export interface SearchItemsArgs {
  query: string;
  type?: string;
  status?: string;
  iteration?: string;
  all?: boolean;
}

export function handleSearchItems(backend: Backend, args: SearchItemsArgs): ToolResult {
  try {
    const opts: ItemListOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.all) opts.all = args.all;
    const items = runItemList(backend, opts);
    const query = args.query.toLowerCase();
    const filtered = items.filter(
      (item) =>
        item.title.toLowerCase().includes(query) ||
        item.description.toLowerCase().includes(query),
    );
    return success(filtered);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (25 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add search_items MCP handler"
```

---

### Task 8: Add get_children, get_dependents, and get_item_tree handlers with tests

**Files:**
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/__tests__/mcp.test.ts`

**Step 1: Write the failing tests**

Add imports: `handleGetChildren`, `handleGetDependents`, `handleGetItemTree`. Add:

```typescript
describe('handleGetChildren', () => {
  it('returns children of an item', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Parent', type: 'epic', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Child', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: 1, dependsOn: [], description: '' });
    const result = handleGetChildren(backend, { id: 1 });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Child');
  });
});

describe('handleGetDependents', () => {
  it('returns items that depend on this item', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Blocker', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Blocked', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [1], description: '' });
    const result = handleGetDependents(backend, { id: 1 });
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].title).toBe('Blocked');
  });
});

describe('handleGetItemTree', () => {
  it('returns items nested under parents', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Epic', type: 'epic', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Task A', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: 1, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Standalone', type: 'issue', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    const result = handleGetItemTree(backend, {});
    const parsed = JSON.parse(result.content[0]!.text);
    // Two root nodes: Epic and Standalone
    expect(parsed).toHaveLength(2);
    const epic = parsed.find((n: { title: string }) => n.title === 'Epic');
    expect(epic.children).toHaveLength(1);
    expect(epic.children[0].title).toBe('Task A');
    const standalone = parsed.find((n: { title: string }) => n.title === 'Standalone');
    expect(standalone.children).toHaveLength(0);
  });

  it('handles deeply nested trees', () => {
    const backend = new LocalBackend(tmpDir);
    backend.createWorkItem({ title: 'Root', type: 'epic', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: null, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Mid', type: 'issue', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: 1, dependsOn: [], description: '' });
    backend.createWorkItem({ title: 'Leaf', type: 'task', status: 'backlog', priority: 'medium', assignee: '', labels: [], iteration: 'default', parent: 2, dependsOn: [], description: '' });
    const result = handleGetItemTree(backend, {});
    const parsed = JSON.parse(result.content[0]!.text);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].children[0].children[0].title).toBe('Leaf');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: FAIL

**Step 3: Implement all three handlers**

Add to `src/cli/commands/mcp.ts`:

```typescript
export function handleGetChildren(backend: Backend, args: { id: number }): ToolResult {
  try {
    const children = backend.getChildren(args.id);
    return success(children);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

export function handleGetDependents(backend: Backend, args: { id: number }): ToolResult {
  try {
    const dependents = backend.getDependents(args.id);
    return success(dependents);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}

interface TreeNode {
  id: number;
  title: string;
  type: string;
  status: string;
  priority: string;
  iteration: string;
  children: TreeNode[];
}

export function handleGetItemTree(backend: Backend, args: ListItemsArgs): ToolResult {
  try {
    const opts: ItemListOptions = {};
    if (args.type) opts.type = args.type;
    if (args.status) opts.status = args.status;
    if (args.iteration) opts.iteration = args.iteration;
    if (args.all) opts.all = args.all;
    const items = runItemList(backend, opts);

    const nodeMap = new Map<number, TreeNode>();
    for (const item of items) {
      nodeMap.set(item.id, {
        id: item.id,
        title: item.title,
        type: item.type,
        status: item.status,
        priority: item.priority,
        iteration: item.iteration,
        children: [],
      });
    }

    const roots: TreeNode[] = [];
    for (const item of items) {
      const node = nodeMap.get(item.id)!;
      if (item.parent !== null && nodeMap.has(item.parent)) {
        nodeMap.get(item.parent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return success(roots);
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 4: Run test to verify it passes**

Run: `cd /Users/skrug/PycharmProjects/tic && npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: PASS (29 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/__tests__/mcp.test.ts
git commit -m "feat: add get_children, get_dependents, and get_item_tree MCP handlers"
```

---

### Task 9: Wire up McpServer with all tool registrations

**Files:**
- Modify: `src/cli/commands/mcp.ts`

**Step 1: Add the MCP server wiring function**

Add to `src/cli/commands/mcp.ts`:

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { LocalBackend } from '../../backends/local/index.js';
import fs from 'node:fs';
import path from 'node:path';

export function registerTools(server: McpServer, backend: Backend, pendingDeletes: DeleteTracker, root: string): void {
  server.tool('init_project', 'Initialize a new .tic project in the current directory', {}, async () => {
    return handleInitProject(root);
  });

  server.tool('get_config', 'Get project config: valid types, statuses, iterations, and current iteration', {}, async () => {
    return handleGetConfig(backend);
  });

  server.tool('list_items', 'List work items with optional filters', {
    type: z.string().optional().describe('Filter by work item type'),
    status: z.string().optional().describe('Filter by status'),
    iteration: z.string().optional().describe('Filter by iteration'),
    all: z.boolean().optional().describe('Show all iterations'),
  }, async (args) => {
    return handleListItems(backend, args);
  });

  server.tool('show_item', 'Get full details of a work item by ID', {
    id: z.number().describe('Work item ID'),
  }, async (args) => {
    return handleShowItem(backend, args);
  });

  server.tool('create_item', 'Create a new work item', {
    title: z.string().describe('Title of the work item'),
    type: z.string().optional().describe('Work item type (e.g. epic, issue, task)'),
    status: z.string().optional().describe('Initial status'),
    priority: z.string().optional().describe('Priority: low, medium, high, critical'),
    assignee: z.string().optional().describe('Assignee name'),
    labels: z.string().optional().describe('Comma-separated labels'),
    iteration: z.string().optional().describe('Iteration name'),
    parent: z.number().optional().describe('Parent work item ID'),
    depends_on: z.array(z.number()).optional().describe('IDs of items this depends on'),
    description: z.string().optional().describe('Description body in markdown'),
  }, async (args) => {
    return handleCreateItem(backend, args);
  });

  server.tool('update_item', 'Update fields on an existing work item', {
    id: z.number().describe('Work item ID'),
    title: z.string().optional().describe('New title'),
    type: z.string().optional().describe('Work item type'),
    status: z.string().optional().describe('New status'),
    priority: z.string().optional().describe('Priority: low, medium, high, critical'),
    assignee: z.string().optional().describe('Assignee name'),
    labels: z.string().optional().describe('Comma-separated labels'),
    iteration: z.string().optional().describe('Iteration name'),
    parent: z.number().nullable().optional().describe('Parent item ID (null to remove)'),
    depends_on: z.array(z.number()).optional().describe('Dependency IDs (replaces existing)'),
    description: z.string().optional().describe('New description body'),
  }, async (args) => {
    return handleUpdateItem(backend, args);
  });

  server.tool('delete_item', 'Preview deletion of a work item (does NOT delete — use confirm_delete after)', {
    id: z.number().describe('Work item ID to preview deletion for'),
  }, async (args) => {
    return handleDeleteItem(backend, args, pendingDeletes);
  });

  server.tool('confirm_delete', 'Confirm and execute a previously previewed deletion', {
    id: z.number().describe('Work item ID to delete (must have called delete_item first)'),
  }, async (args) => {
    return handleConfirmDelete(backend, args, pendingDeletes);
  });

  server.tool('add_comment', 'Add a comment to a work item', {
    id: z.number().describe('Work item ID'),
    text: z.string().describe('Comment text'),
    author: z.string().optional().describe('Comment author (defaults to anonymous)'),
  }, async (args) => {
    return handleAddComment(backend, args);
  });

  server.tool('set_iteration', 'Set the current iteration', {
    name: z.string().describe('Iteration name'),
  }, async (args) => {
    return handleSetIteration(backend, args);
  });

  server.tool('search_items', 'Search work items by text in titles and descriptions', {
    query: z.string().describe('Search text (case-insensitive substring match)'),
    type: z.string().optional().describe('Filter by work item type'),
    status: z.string().optional().describe('Filter by status'),
    iteration: z.string().optional().describe('Filter by iteration'),
    all: z.boolean().optional().describe('Search all iterations'),
  }, async (args) => {
    return handleSearchItems(backend, args);
  });

  server.tool('get_children', 'Get child items of a work item', {
    id: z.number().describe('Parent work item ID'),
  }, async (args) => {
    return handleGetChildren(backend, args);
  });

  server.tool('get_dependents', 'Get items that depend on a given work item', {
    id: z.number().describe('Work item ID'),
  }, async (args) => {
    return handleGetDependents(backend, args);
  });

  server.tool('get_item_tree', 'Get work items as a nested parent-child tree', {
    type: z.string().optional().describe('Filter by work item type'),
    status: z.string().optional().describe('Filter by status'),
    iteration: z.string().optional().describe('Filter by iteration'),
    all: z.boolean().optional().describe('Show all iterations'),
  }, async (args) => {
    return handleGetItemTree(backend, args);
  });
}

function isTicProject(root: string): boolean {
  return fs.existsSync(path.join(root, '.tic'));
}

export async function startMcpServer(): Promise<void> {
  const root = process.cwd();
  const server = new McpServer({
    name: 'tic',
    version: '0.1.0',
  });

  // Create backend only if project exists; init_project works without one
  const backend = isTicProject(root) ? new LocalBackend(root) : null;
  const pendingDeletes = createDeleteTracker();

  // Wrap backend access — tools other than init_project will error if no project
  const guardedBackend = new Proxy({} as Backend, {
    get(_target, prop) {
      if (!backend) {
        throw new Error('Not a tic project. Use the init_project tool first.');
      }
      return (backend as Record<string | symbol, unknown>)[prop];
    },
  });

  registerTools(server, guardedBackend, pendingDeletes, root);

  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('tic MCP server running on stdio');
}
```

**Step 2: Verify the build compiles**

Run: `cd /Users/skrug/PycharmProjects/tic && npm run build`
Expected: No errors

**Step 3: Run all tests**

Run: `cd /Users/skrug/PycharmProjects/tic && npm test`
Expected: All tests pass (existing 56 + new ~29 = ~85)

**Step 4: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat: wire up McpServer with all 14 tool registrations"
```

---

### Task 10: Add `tic mcp serve` subcommand to Commander

**Files:**
- Modify: `src/cli/index.ts:102-341`

**Step 1: Add the mcp subcommand**

In `src/cli/index.ts`, after the iteration subcommand block (around line 334) and before the global options (line 337), add:

```typescript
import { startMcpServer } from './commands/mcp.js';

// tic mcp ...
const mcp = program.command('mcp').description('MCP server');

mcp
  .command('serve')
  .description('Start MCP server on stdio')
  .action(async () => {
    await startMcpServer();
  });
```

**Step 2: Verify the build compiles**

Run: `cd /Users/skrug/PycharmProjects/tic && npm run build`
Expected: No errors

**Step 3: Verify the command shows up in help**

Run: `cd /Users/skrug/PycharmProjects/tic && node dist/index.js mcp --help`
Expected: Shows `serve` subcommand

**Step 4: Run all tests**

Run: `cd /Users/skrug/PycharmProjects/tic && npm test`
Expected: All tests pass

**Step 5: Run lint and format check**

Run: `cd /Users/skrug/PycharmProjects/tic && npm run lint && npm run format:check`
Expected: No errors. If format issues, run `npm run format` first.

**Step 6: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: wire up tic mcp serve subcommand"
```

---

### Task 11: Manual integration test with MCP Inspector

**Step 1: Initialize a test project**

```bash
cd /tmp && mkdir tic-mcp-test && cd tic-mcp-test
node /Users/skrug/PycharmProjects/tic/dist/index.js init
```
Expected: `Initialized .tic/`

**Step 2: Launch MCP Inspector**

```bash
npx @modelcontextprotocol/inspector node /Users/skrug/PycharmProjects/tic/dist/index.js mcp serve
```
Expected: Opens browser at `http://127.0.0.1:6274`

**Step 3: Verify tools in inspector**

In the browser UI:
1. Click "List Tools" — verify all 14 tools appear
2. Call `init_project` — verify `{ "alreadyExists": true }`
3. Call `get_config` — verify statuses, types, iterations, currentIteration
4. Call `create_item` with `{ "title": "Test item" }` — verify item created
5. Call `list_items` — verify item appears
6. Call `show_item` with `{ "id": 1 }` — verify details
7. Call `search_items` with `{ "query": "test" }` — verify match
8. Call `delete_item` with `{ "id": 1 }` — verify preview
9. Call `confirm_delete` with `{ "id": 1 }` — verify deletion

**Step 4: Clean up**

```bash
rm -rf /tmp/tic-mcp-test
```

---

### Task 12: Update CLAUDE.md and commit final docs

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add MCP section to CLAUDE.md**

Add after the Commands section:

```markdown
### MCP Server

`tic mcp serve` starts an MCP server on stdio. It exposes 14 tools for work item management. Connect it to Claude Code with:

```bash
claude mcp add --scope project --transport stdio tic -- npx tic mcp serve
```

Or add `.mcp.json` to the project root:

```json
{
  "mcpServers": {
    "tic": {
      "type": "stdio",
      "command": "npx",
      "args": ["tic", "mcp", "serve"]
    }
  }
}
```
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add MCP server section to CLAUDE.md"
```
