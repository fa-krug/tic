# CLI Commands Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a scriptable CLI interface (`tic item list`, `tic item create`, etc.) for shell scripting and automation, while preserving the existing TUI as the default.

**Architecture:** Commander.js handles argument parsing and subcommand routing. CLI command handlers live in `src/cli/` and reuse the existing `LocalBackend` directly. A shared formatter module outputs TSV (default) or JSON (`--json`). The entry point (`src/index.tsx`) delegates to CLI when subcommands are present, otherwise launches the TUI.

**Tech Stack:** Commander.js (new dependency), existing LocalBackend, Vitest for tests.

**Design doc:** `docs/plans/2026-01-31-cli-commands-design.md`

---

### Task 1: Install Commander.js

**Files:**
- Modify: `package.json`

**Step 1: Install commander**

Run: `cd /Users/skrug/PycharmProjects/tic && npm install commander`

**Step 2: Verify installation**

Run: `npm ls commander`
Expected: `commander@X.X.X`

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "feat: add commander.js dependency for CLI"
```

---

### Task 2: Create the output formatter module

**Files:**
- Create: `src/cli/format.ts`
- Test: `src/cli/__tests__/format.test.ts`

**Step 1: Write failing tests for TSV and JSON formatters**

Create `src/cli/__tests__/format.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatTsvRow, formatTsvKeyValue, formatJson } from '../format.js';

describe('formatTsvRow', () => {
  it('joins fields with tabs', () => {
    expect(formatTsvRow(['a', 'b', 'c'])).toBe('a\tb\tc');
  });

  it('handles empty strings', () => {
    expect(formatTsvRow(['a', '', 'c'])).toBe('a\t\tc');
  });
});

describe('formatTsvKeyValue', () => {
  it('formats key-value pairs one per line', () => {
    const pairs: [string, string][] = [
      ['id', '1'],
      ['title', 'Bug'],
    ];
    expect(formatTsvKeyValue(pairs)).toBe('id\t1\ntitle\tBug');
  });
});

describe('formatJson', () => {
  it('serializes data as indented JSON', () => {
    const data = { id: 1, title: 'Bug' };
    expect(formatJson(data)).toBe(JSON.stringify(data, null, 2));
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/__tests__/format.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the formatter**

Create `src/cli/format.ts`:

```typescript
export function formatTsvRow(fields: string[]): string {
  return fields.join('\t');
}

export function formatTsvKeyValue(pairs: [string, string][]): string {
  return pairs.map(([k, v]) => `${k}\t${v}`).join('\n');
}

export function formatJson(data: unknown): string {
  return JSON.stringify(data, null, 2);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/format.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/cli/format.ts src/cli/__tests__/format.test.ts
git commit -m "feat: add TSV and JSON output formatters for CLI"
```

---

### Task 3: Create the `init` command

**Files:**
- Create: `src/cli/commands/init.ts`
- Test: `src/cli/__tests__/init.test.ts`

**Step 1: Write failing tests for init command**

Create `src/cli/__tests__/init.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { runInit } from '../commands/init.js';

describe('tic init', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates .tic directory with config.yml', () => {
    const result = runInit(tmpDir);
    expect(result.success).toBe(true);
    expect(fs.existsSync(path.join(tmpDir, '.tic', 'config.yml'))).toBe(true);
  });

  it('returns already-initialized message if .tic exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    fs.writeFileSync(path.join(tmpDir, '.tic', 'config.yml'), 'next_id: 1\n');
    const result = runInit(tmpDir);
    expect(result.alreadyExists).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the init command**

Create `src/cli/commands/init.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import { writeConfig, defaultConfig } from '../../backends/local/config.js';

interface InitResult {
  success: boolean;
  alreadyExists: boolean;
}

export function runInit(root: string): InitResult {
  const configPath = path.join(root, '.tic', 'config.yml');
  if (fs.existsSync(configPath)) {
    return { success: true, alreadyExists: true };
  }
  writeConfig(root, { ...defaultConfig });
  return { success: true, alreadyExists: false };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: PASS (2 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/init.ts src/cli/__tests__/init.test.ts
git commit -m "feat: add tic init command"
```

---

### Task 4: Create the `item` commands

**Files:**
- Create: `src/cli/commands/item.ts`
- Test: `src/cli/__tests__/item.test.ts`

This is the largest task. The command handlers are pure functions that take a backend and options, return structured results. The Commander wiring comes in Task 6.

**Step 1: Write failing tests for item commands**

Create `src/cli/__tests__/item.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { runItemList, runItemShow, runItemCreate, runItemUpdate, runItemDelete, runItemComment } from '../commands/item.js';

describe('item commands', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('runItemCreate', () => {
    it('creates an item with title and defaults', () => {
      const item = runItemCreate(backend, 'Fix bug', {});
      expect(item.title).toBe('Fix bug');
      expect(item.type).toBe('task');
      expect(item.status).toBe('backlog');
      expect(item.id).toBe(1);
    });

    it('creates an item with all options', () => {
      const item = runItemCreate(backend, 'Epic thing', {
        type: 'epic',
        status: 'todo',
        priority: 'high',
        assignee: 'alice',
        labels: 'auth,backend',
        iteration: 'sprint-1',
      });
      expect(item.type).toBe('epic');
      expect(item.status).toBe('todo');
      expect(item.priority).toBe('high');
      expect(item.assignee).toBe('alice');
      expect(item.labels).toEqual(['auth', 'backend']);
      expect(item.iteration).toBe('sprint-1');
    });

    it('accepts description option', () => {
      const item = runItemCreate(backend, 'Bug', { description: 'Details here' });
      expect(item.description).toBe('Details here');
    });
  });

  describe('runItemList', () => {
    it('lists items for current iteration', () => {
      runItemCreate(backend, 'A', {});
      runItemCreate(backend, 'B', {});
      const items = runItemList(backend, {});
      expect(items).toHaveLength(2);
    });

    it('filters by status', () => {
      runItemCreate(backend, 'A', { status: 'todo' });
      runItemCreate(backend, 'B', { status: 'done' });
      const items = runItemList(backend, { status: 'todo' });
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('A');
    });

    it('filters by type', () => {
      runItemCreate(backend, 'A', { type: 'epic' });
      runItemCreate(backend, 'B', { type: 'task' });
      const items = runItemList(backend, { type: 'epic' });
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('A');
    });

    it('shows all iterations with --all', () => {
      runItemCreate(backend, 'A', { iteration: 'v1' });
      runItemCreate(backend, 'B', { iteration: 'v2' });
      const items = runItemList(backend, { all: true });
      expect(items).toHaveLength(2);
    });
  });

  describe('runItemShow', () => {
    it('returns a single item by id', () => {
      runItemCreate(backend, 'Bug', {});
      const item = runItemShow(backend, 1);
      expect(item.title).toBe('Bug');
      expect(item.id).toBe(1);
    });

    it('throws for non-existent id', () => {
      expect(() => runItemShow(backend, 999)).toThrow();
    });
  });

  describe('runItemUpdate', () => {
    it('updates specified fields only', () => {
      runItemCreate(backend, 'Original', {});
      const item = runItemUpdate(backend, 1, { title: 'Updated', status: 'done' });
      expect(item.title).toBe('Updated');
      expect(item.status).toBe('done');
      expect(item.type).toBe('task'); // unchanged
    });
  });

  describe('runItemDelete', () => {
    it('deletes an item', () => {
      runItemCreate(backend, 'Delete me', {});
      runItemDelete(backend, 1);
      const items = runItemList(backend, { all: true });
      expect(items).toHaveLength(0);
    });
  });

  describe('runItemComment', () => {
    it('adds a comment to an item', () => {
      runItemCreate(backend, 'Commentable', {});
      const comment = runItemComment(backend, 1, 'Looks good', { author: 'alice' });
      expect(comment.body).toBe('Looks good');
      expect(comment.author).toBe('alice');
    });

    it('defaults author to anonymous', () => {
      runItemCreate(backend, 'Commentable', {});
      const comment = runItemComment(backend, 1, 'Note', {});
      expect(comment.author).toBe('anonymous');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/__tests__/item.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the item commands**

Create `src/cli/commands/item.ts`:

```typescript
import type { Backend } from '../../backends/types.js';
import type { WorkItem, Comment } from '../../types.js';

export interface ItemCreateOptions {
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: string;
  dependsOn?: string;
  description?: string;
}

export interface ItemListOptions {
  status?: string;
  type?: string;
  iteration?: string;
  all?: boolean;
}

export interface ItemUpdateOptions {
  title?: string;
  type?: string;
  status?: string;
  priority?: string;
  assignee?: string;
  labels?: string;
  iteration?: string;
  parent?: string;
  dependsOn?: string;
  description?: string;
}

export interface ItemCommentOptions {
  author?: string;
}

export function runItemCreate(
  backend: Backend,
  title: string,
  opts: ItemCreateOptions,
): WorkItem {
  const statuses = backend.getStatuses();
  const types = backend.getWorkItemTypes();
  return backend.createWorkItem({
    title,
    type: opts.type ?? types[0]!,
    status: opts.status ?? statuses[0]!,
    priority: (opts.priority as WorkItem['priority']) ?? 'medium',
    assignee: opts.assignee ?? '',
    labels: opts.labels ? opts.labels.split(',').map((l) => l.trim()) : [],
    iteration: opts.iteration ?? backend.getCurrentIteration(),
    parent: opts.parent ? Number(opts.parent) : null,
    dependsOn: opts.dependsOn
      ? opts.dependsOn.split(',').map((d) => Number(d.trim()))
      : [],
    description: opts.description ?? '',
  });
}

export function runItemList(
  backend: Backend,
  opts: ItemListOptions,
): WorkItem[] {
  const iteration = opts.all
    ? undefined
    : (opts.iteration ?? backend.getCurrentIteration());
  let items = backend.listWorkItems(iteration);
  if (opts.status) {
    items = items.filter((i) => i.status === opts.status);
  }
  if (opts.type) {
    items = items.filter((i) => i.type === opts.type);
  }
  return items;
}

export function runItemShow(backend: Backend, id: number): WorkItem {
  return backend.getWorkItem(id);
}

export function runItemUpdate(
  backend: Backend,
  id: number,
  opts: ItemUpdateOptions,
): WorkItem {
  const data: Partial<WorkItem> = {};
  if (opts.title !== undefined) data.title = opts.title;
  if (opts.type !== undefined) data.type = opts.type;
  if (opts.status !== undefined) data.status = opts.status;
  if (opts.priority !== undefined)
    data.priority = opts.priority as WorkItem['priority'];
  if (opts.assignee !== undefined) data.assignee = opts.assignee;
  if (opts.labels !== undefined)
    data.labels = opts.labels.split(',').map((l) => l.trim());
  if (opts.iteration !== undefined) data.iteration = opts.iteration;
  if (opts.parent !== undefined)
    data.parent = opts.parent === '' ? null : Number(opts.parent);
  if (opts.dependsOn !== undefined)
    data.dependsOn =
      opts.dependsOn === ''
        ? []
        : opts.dependsOn.split(',').map((d) => Number(d.trim()));
  if (opts.description !== undefined) data.description = opts.description;
  return backend.updateWorkItem(id, data);
}

export function runItemDelete(backend: Backend, id: number): void {
  backend.deleteWorkItem(id);
}

export function runItemComment(
  backend: Backend,
  id: number,
  text: string,
  opts: ItemCommentOptions,
): Comment {
  return backend.addComment(id, {
    author: opts.author ?? 'anonymous',
    body: text,
  });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/item.test.ts`
Expected: PASS (10 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/item.ts src/cli/__tests__/item.test.ts
git commit -m "feat: add item command handlers (list, show, create, update, delete, comment)"
```

---

### Task 5: Create the `iteration` commands

**Files:**
- Create: `src/cli/commands/iteration.ts`
- Test: `src/cli/__tests__/iteration.test.ts`

**Step 1: Write failing tests for iteration commands**

Create `src/cli/__tests__/iteration.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import { runIterationList, runIterationSet } from '../commands/iteration.js';

describe('iteration commands', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('runIterationList', () => {
    it('returns default iterations', () => {
      const result = runIterationList(backend);
      expect(result.iterations).toEqual(['default']);
      expect(result.current).toBe('default');
    });
  });

  describe('runIterationSet', () => {
    it('sets current iteration', () => {
      runIterationSet(backend, 'sprint-1');
      expect(backend.getCurrentIteration()).toBe('sprint-1');
    });

    it('adds new iteration if it does not exist', () => {
      runIterationSet(backend, 'sprint-2');
      expect(backend.getIterations()).toContain('sprint-2');
    });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/cli/__tests__/iteration.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the iteration commands**

Create `src/cli/commands/iteration.ts`:

```typescript
import type { Backend } from '../../backends/types.js';

export interface IterationListResult {
  iterations: string[];
  current: string;
}

export function runIterationList(backend: Backend): IterationListResult {
  return {
    iterations: backend.getIterations(),
    current: backend.getCurrentIteration(),
  };
}

export function runIterationSet(backend: Backend, name: string): void {
  backend.setCurrentIteration(name);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/iteration.test.ts`
Expected: PASS (3 tests)

**Step 5: Commit**

```bash
git add src/cli/commands/iteration.ts src/cli/__tests__/iteration.test.ts
git commit -m "feat: add iteration command handlers (list, set)"
```

---

### Task 6: Wire up Commander.js and the CLI entry point

**Files:**
- Create: `src/cli/index.ts`
- Modify: `src/index.tsx`

This task wires everything together: Commander program, subcommands, output formatting, `--json`/`--quiet` flags, error handling, and stdin reading.

**Step 1: Create `src/cli/index.ts`**

```typescript
import { Command } from 'commander';
import { LocalBackend } from '../backends/local/index.js';
import { formatTsvRow, formatTsvKeyValue, formatJson } from './format.js';
import { runInit } from './commands/init.js';
import {
  runItemList,
  runItemShow,
  runItemCreate,
  runItemUpdate,
  runItemDelete,
  runItemComment,
} from './commands/item.js';
import { runIterationList, runIterationSet } from './commands/iteration.js';
import type { WorkItem } from '../types.js';
import fs from 'node:fs';

function itemToTsvRow(item: WorkItem): string {
  return formatTsvRow([
    String(item.id),
    item.type,
    item.status,
    item.priority,
    item.title,
    item.iteration,
  ]);
}

function itemToTsvDetail(item: WorkItem): string {
  const pairs: [string, string][] = [
    ['id', String(item.id)],
    ['title', item.title],
    ['type', item.type],
    ['status', item.status],
    ['priority', item.priority],
    ['iteration', item.iteration],
    ['assignee', item.assignee],
    ['labels', item.labels.join(',')],
    ['parent', item.parent !== null ? String(item.parent) : ''],
    ['depends_on', item.dependsOn.join(',')],
    ['created', item.created],
    ['updated', item.updated],
  ];
  let output = formatTsvKeyValue(pairs);
  if (item.description) {
    output += '\n\n' + item.description;
  }
  return output;
}

function readStdin(): string {
  if (process.stdin.isTTY) return '';
  return fs.readFileSync(0, 'utf-8').trim();
}

function createBackend(): LocalBackend {
  return new LocalBackend(process.cwd());
}

function output(
  data: unknown,
  tsvFn: () => string,
  opts: { json?: boolean; quiet?: boolean },
): void {
  if (opts.quiet) return;
  if (opts.json) {
    console.log(formatJson(data));
  } else {
    console.log(tsvFn());
  }
}

function handleError(err: unknown, json?: boolean): never {
  const message = err instanceof Error ? err.message : String(err);
  if (json) {
    console.error(formatJson({ error: message }));
  } else {
    console.error(`Error: ${message}`);
  }
  process.exit(1);
}

export function createProgram(): Command {
  const program = new Command();
  program.name('tic').version('0.1.0').description('Terminal issue tracker');

  // tic init
  program
    .command('init')
    .description('Initialize a new .tic project')
    .action(() => {
      const parentOpts = program.opts();
      try {
        const result = runInit(process.cwd());
        if (result.alreadyExists) {
          console.log('Already initialized in .tic/');
        } else {
          output(
            { initialized: true },
            () => 'Initialized .tic/',
            parentOpts,
          );
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // tic item ...
  const item = program
    .command('item')
    .description('Manage work items');

  item
    .command('list')
    .description('List work items')
    .option('--status <status>', 'Filter by status')
    .option('--type <type>', 'Filter by work item type')
    .option('--iteration <name>', 'Filter by iteration')
    .option('--all', 'Show all iterations')
    .option('--headers', 'Include column headers')
    .action((opts) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const items = runItemList(backend, opts);
        if (parentOpts.quiet) return;
        if (parentOpts.json) {
          console.log(formatJson(items));
        } else {
          if (opts.headers) {
            console.log(formatTsvRow(['id', 'type', 'status', 'priority', 'title', 'iteration']));
          }
          for (const i of items) {
            console.log(itemToTsvRow(i));
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('show')
    .description('Show work item details')
    .argument('<id>', 'Work item ID')
    .action((idStr) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const wi = runItemShow(backend, id);
        output(wi, () => itemToTsvDetail(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('create')
    .description('Create a new work item')
    .argument('<title>', 'Work item title')
    .option('--type <type>', 'Work item type')
    .option('--status <status>', 'Initial status')
    .option('--priority <priority>', 'Priority level')
    .option('--assignee <name>', 'Assignee')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--iteration <name>', 'Iteration')
    .option('--parent <id>', 'Parent item ID')
    .option('--depends-on <ids>', 'Comma-separated dependency IDs')
    .action((title, opts) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const description = readStdin();
        const wi = runItemCreate(backend, title, {
          ...opts,
          dependsOn: opts.dependsOn,
          description,
        });
        output(wi, () => itemToTsvRow(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('update')
    .description('Update a work item')
    .argument('<id>', 'Work item ID')
    .option('--title <title>', 'New title')
    .option('--type <type>', 'Work item type')
    .option('--status <status>', 'Status')
    .option('--priority <priority>', 'Priority level')
    .option('--assignee <name>', 'Assignee')
    .option('--labels <labels>', 'Comma-separated labels')
    .option('--iteration <name>', 'Iteration')
    .option('--parent <id>', 'Parent item ID')
    .option('--depends-on <ids>', 'Comma-separated dependency IDs')
    .action((idStr, opts) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const description = readStdin();
        const updateOpts = {
          ...opts,
          dependsOn: opts.dependsOn,
          ...(description ? { description } : {}),
        };
        const wi = runItemUpdate(backend, id, updateOpts);
        output(wi, () => itemToTsvRow(wi), parentOpts);
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('delete')
    .description('Delete a work item')
    .argument('<id>', 'Work item ID')
    .action((idStr) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        runItemDelete(backend, id);
        if (!parentOpts.quiet) {
          if (parentOpts.json) {
            console.log(formatJson({ deleted: id }));
          } else {
            console.log(`Deleted item ${id}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  item
    .command('comment')
    .description('Add a comment to a work item')
    .argument('<id>', 'Work item ID')
    .argument('<text>', 'Comment text')
    .option('--author <name>', 'Comment author')
    .action((idStr, text, opts) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const id = Number(idStr);
        if (Number.isNaN(id)) throw new Error(`Invalid ID: ${idStr}`);
        const comment = runItemComment(backend, id, text, opts);
        output(
          comment,
          () => formatTsvRow([comment.author, comment.date, comment.body]),
          parentOpts,
        );
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // tic iteration ...
  const iteration = program
    .command('iteration')
    .description('Manage iterations');

  iteration
    .command('list')
    .description('List iterations')
    .action(() => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        const result = runIterationList(backend);
        if (parentOpts.quiet) return;
        if (parentOpts.json) {
          console.log(formatJson(result));
        } else {
          for (const iter of result.iterations) {
            const marker = iter === result.current ? '*' : ' ';
            console.log(`${marker}\t${iter}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  iteration
    .command('set')
    .description('Set current iteration')
    .argument('<name>', 'Iteration name')
    .action((name) => {
      const parentOpts = program.opts();
      try {
        const backend = createBackend();
        runIterationSet(backend, name);
        if (!parentOpts.quiet) {
          if (parentOpts.json) {
            console.log(formatJson({ current_iteration: name }));
          } else {
            console.log(`Current iteration set to ${name}`);
          }
        }
      } catch (err) {
        handleError(err, parentOpts.json);
      }
    });

  // Global options
  program.option('--json', 'Output as JSON');
  program.option('--quiet', 'Suppress output on mutations');

  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = createProgram();
  await program.parseAsync(argv);
}
```

**Step 2: Update `src/index.tsx` to delegate to CLI**

Replace the contents of `src/index.tsx` with:

```typescript
#!/usr/bin/env node
import { render } from 'ink';
import { App } from './app.js';
import { LocalBackend } from './backends/local/index.js';
import { runCli } from './cli/index.js';

if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const backend = new LocalBackend(process.cwd());
  render(<App backend={backend} />);
}
```

**Step 3: Build and verify no type errors**

Run: `npm run build`
Expected: Compiles without errors

**Step 4: Commit**

```bash
git add src/cli/index.ts src/index.tsx
git commit -m "feat: wire up Commander.js CLI with all subcommands"
```

---

### Task 7: Add `.tic/` directory existence check for CLI commands

**Files:**
- Modify: `src/cli/index.ts`
- Test: `src/cli/__tests__/init.test.ts` (add test)

Currently, `LocalBackend` returns defaults when `.tic/` doesn't exist. CLI commands (except `init`) should fail with a helpful error when there's no `.tic/` directory.

**Step 1: Write a failing test**

Add to `src/cli/__tests__/init.test.ts`:

```typescript
import { requireTicProject } from '../index.js';

describe('requireTicProject', () => {
  it('throws when .tic directory does not exist', () => {
    const emptyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-noproject-'));
    expect(() => requireTicProject(emptyDir)).toThrow(
      'Not a tic project (no .tic/ directory found). Run \'tic init\' first.',
    );
    fs.rmSync(emptyDir, { recursive: true });
  });

  it('does not throw when .tic directory exists', () => {
    expect(() => requireTicProject(tmpDir)).not.toThrow();
  });
});
```

Note: `tmpDir` already has `.tic/` because `LocalBackend` constructor calls `readConfig`, but since `readConfig` only reads (doesn't create), we need to ensure the second test has a valid `.tic/`. We'll init first in that test.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: FAIL — `requireTicProject` not found

**Step 3: Implement `requireTicProject`**

Add to `src/cli/index.ts` and export it:

```typescript
import fs from 'node:fs';
import path from 'node:path';

export function requireTicProject(root: string): void {
  const ticDir = path.join(root, '.tic');
  if (!fs.existsSync(ticDir)) {
    throw new Error(
      "Not a tic project (no .tic/ directory found). Run 'tic init' first.",
    );
  }
}
```

Then add `requireTicProject(process.cwd())` call inside `createBackend()`:

```typescript
function createBackend(): LocalBackend {
  requireTicProject(process.cwd());
  return new LocalBackend(process.cwd());
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/init.test.ts`
Expected: PASS

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/cli/index.ts src/cli/__tests__/init.test.ts
git commit -m "feat: add .tic/ directory existence check for CLI commands"
```

---

### Task 8: Integration smoke test

**Files:**
- Modify: `src/cli/__tests__/item.test.ts` (add integration-style test)

**Step 1: Add a test that exercises the full create → list → show → update → delete flow**

Add to `src/cli/__tests__/item.test.ts`:

```typescript
describe('item workflow integration', () => {
  it('create → list → show → update → comment → delete', () => {
    const created = runItemCreate(backend, 'Workflow test', {
      type: 'issue',
      status: 'todo',
      priority: 'high',
    });
    expect(created.id).toBe(1);

    const listed = runItemList(backend, { all: true });
    expect(listed).toHaveLength(1);

    const shown = runItemShow(backend, 1);
    expect(shown.title).toBe('Workflow test');

    const updated = runItemUpdate(backend, 1, { status: 'in-progress' });
    expect(updated.status).toBe('in-progress');

    const comment = runItemComment(backend, 1, 'Working on it', { author: 'dev' });
    expect(comment.body).toBe('Working on it');

    runItemDelete(backend, 1);
    const afterDelete = runItemList(backend, { all: true });
    expect(afterDelete).toHaveLength(0);
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/cli/__tests__/item.test.ts`
Expected: PASS (11 tests)

**Step 3: Commit**

```bash
git add src/cli/__tests__/item.test.ts
git commit -m "test: add item workflow integration test"
```

---

### Task 9: Build, lint, format check, and run all tests

**Files:** None (validation only)

**Step 1: Run the full build**

Run: `npm run build`
Expected: Compiles without errors

**Step 2: Run linting**

Run: `npm run lint`
Expected: No errors

**Step 3: Run format check**

Run: `npm run format:check`
Expected: All files formatted

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Fix any issues found, then commit fixes if needed**

---

### Task 10: Final commit and summary

**Step 1: Run `npm run format` to ensure consistent formatting**

Run: `npm run format`

**Step 2: Verify clean git status**

Run: `git status`
Expected: Clean working tree (or only formatted files to stage)

**Step 3: Commit any formatting changes**

```bash
git add -A
git commit -m "style: format CLI source files"
```

**Step 4: Verify the CLI works end-to-end**

Run these commands manually in a temp directory:

```bash
mkdir /tmp/tic-test && cd /tmp/tic-test
node /Users/skrug/PycharmProjects/tic/dist/index.js init
node /Users/skrug/PycharmProjects/tic/dist/index.js item create "Test item" --type task --priority high
node /Users/skrug/PycharmProjects/tic/dist/index.js item list
node /Users/skrug/PycharmProjects/tic/dist/index.js item show 1
node /Users/skrug/PycharmProjects/tic/dist/index.js item update 1 --status done
node /Users/skrug/PycharmProjects/tic/dist/index.js item comment 1 "All done"
node /Users/skrug/PycharmProjects/tic/dist/index.js item list --json
node /Users/skrug/PycharmProjects/tic/dist/index.js iteration list
node /Users/skrug/PycharmProjects/tic/dist/index.js item delete 1 --quiet
rm -rf /tmp/tic-test
```

Expected: Each command produces correct output per the design doc.
