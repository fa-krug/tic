# Work Item Types Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the flat issue model with typed work items (epic, issue, task) where the backend provides available types, the TUI filters by type with Tab cycling, and the form includes a type dropdown.

**Architecture:** Rename Issue → WorkItem throughout. Add `type: string` field. Backend interface gains `getWorkItemTypes()`. Local backend stores types in config, items in `.tic/items/`. TUI list filters by active type, form gets a type select field.

**Tech Stack:** TypeScript 5.9, Ink 6, React 19, Vitest 4, gray-matter, yaml

---

### Task 1: Rename shared types (Issue → WorkItem)

**Files:**
- Modify: `src/types.ts` (all lines)

**Step 1: Update the types file**

Replace the entire contents of `src/types.ts`:

```typescript
export interface Comment {
  author: string;
  date: string;
  body: string;
}

export interface WorkItem {
  id: number;
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
  description: string;
  comments: Comment[];
}

export type NewWorkItem = Pick<
  WorkItem,
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
>;

export interface NewComment {
  author: string;
  body: string;
}
```

**Step 2: Run type check to see what breaks**

Run: `npx tsc --noEmit`
Expected: Multiple errors referencing `Issue` and `NewIssue` in backend and component files. This is expected — we fix them in subsequent tasks.

**Step 3: Commit**

```bash
git add src/types.ts
git commit -m "feat: rename Issue to WorkItem with type field"
```

---

### Task 2: Update Backend interface

**Files:**
- Modify: `src/backends/types.ts` (all lines)

**Step 1: Update the Backend interface**

Replace the entire contents of `src/backends/types.ts`:

```typescript
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

export interface Backend {
  getStatuses(): string[];
  getIterations(): string[];
  getWorkItemTypes(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listWorkItems(iteration?: string): WorkItem[];
  getWorkItem(id: number): WorkItem;
  createWorkItem(data: NewWorkItem): WorkItem;
  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem;
  deleteWorkItem(id: number): void;
  addComment(workItemId: number, comment: NewComment): Comment;
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Errors in local backend and components — they still use old method names.

**Step 3: Commit**

```bash
git add src/backends/types.ts
git commit -m "feat: rename Backend interface methods to WorkItem"
```

---

### Task 3: Add types to local backend config

**Files:**
- Modify: `src/backends/local/config.ts:5-17`
- Modify: `src/backends/local/config.test.ts`

**Step 1: Write the failing test**

Add a test to `src/backends/local/config.test.ts` (after the existing tests, before the closing `});`):

```typescript
  it('returns default config with types', () => {
    const config = readConfig(tmpDir);
    expect(config.types).toEqual(['epic', 'issue', 'task']);
  });

  it('reads config with custom types', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      'types:\n  - story\n  - bug\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
    );
    const config = readConfig(tmpDir);
    expect(config.types).toEqual(['story', 'bug']);
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — `config.types` is undefined

**Step 3: Update the Config interface and default**

In `src/backends/local/config.ts`, update the `Config` interface and `defaultConfig`:

```typescript
export interface Config {
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
}

export const defaultConfig: Config = {
  types: ['epic', 'issue', 'task'],
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
};
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: All 5 tests PASS

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat: add types field to local backend config"
```

---

### Task 4: Rename issues file module to items

**Files:**
- Create: `src/backends/local/items.ts` (based on `src/backends/local/issues.ts`)
- Delete: `src/backends/local/issues.ts`
- Create: `src/backends/local/items.test.ts` (based on `src/backends/local/issues.test.ts`)
- Delete: `src/backends/local/issues.test.ts`

**Step 1: Create items.ts with renamed functions and type field**

Create `src/backends/local/items.ts` with the following content (adapted from `issues.ts`):

```typescript
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { WorkItem, Comment } from '../../types.js';

function itemsDir(root: string): string {
  return path.join(root, '.tic', 'items');
}

function itemPath(root: string, id: number): string {
  return path.join(itemsDir(root), `${id}.md`);
}

export function listItemFiles(root: string): string[] {
  const dir = itemsDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => path.join(dir, f));
}

function serializeComments(comments: Comment[]): string {
  if (comments.length === 0) return '';
  const parts = comments.map(
    (c) => `---\nauthor: ${c.author}\ndate: ${c.date}\n\n${c.body}`,
  );
  return '\n\n## Comments\n\n' + parts.join('\n\n');
}

function parseComments(content: string): {
  description: string;
  comments: Comment[];
} {
  const marker = '## Comments';
  const idx = content.indexOf(marker);
  if (idx === -1) return { description: content.trim(), comments: [] };

  const description = content.slice(0, idx).trim();
  const commentsRaw = content.slice(idx + marker.length).trim();
  const blocks = commentsRaw.split(/\n---\n/).filter((b) => b.trim());

  const comments: Comment[] = blocks.map((block) => {
    const lines = block.trim().split('\n');
    let author = '';
    let date = '';
    const bodyLines: string[] = [];
    let pastMeta = false;
    for (const line of lines) {
      if (!pastMeta && line === '---') {
        continue;
      }
      if (!pastMeta && line.startsWith('author: ')) {
        author = line.slice('author: '.length).trim();
      } else if (!pastMeta && line.startsWith('date: ')) {
        date = line.slice('date: '.length).trim();
      } else if (!pastMeta && line === '') {
        pastMeta = true;
      } else {
        pastMeta = true;
        bodyLines.push(line);
      }
    }
    return { author, date, body: bodyLines.join('\n').trim() };
  });

  return { description, comments };
}

export function readWorkItem(root: string, id: number): WorkItem {
  const raw = fs.readFileSync(itemPath(root, id), 'utf-8');
  return parseWorkItemFile(raw);
}

export function parseWorkItemFile(raw: string): WorkItem {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const { description, comments } = parseComments(parsed.content);

  return {
    id: data['id'] as number,
    title: data['title'] as string,
    type: (data['type'] as string) || 'issue',
    status: data['status'] as string,
    iteration: data['iteration'] as string,
    priority: data['priority'] as WorkItem['priority'],
    assignee: (data['assignee'] as string) || '',
    labels: (data['labels'] as string[]) || [],
    created: data['created'] as string,
    updated: data['updated'] as string,
    description,
    comments,
  };
}

export function writeWorkItem(root: string, item: WorkItem): void {
  const dir = itemsDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const frontmatter = {
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    iteration: item.iteration,
    priority: item.priority,
    assignee: item.assignee,
    labels: item.labels,
    created: item.created,
    updated: item.updated,
  };

  const body = item.description + serializeComments(item.comments);
  const content = matter.stringify(body, frontmatter);
  fs.writeFileSync(itemPath(root, item.id), content);
}

export function deleteWorkItem(root: string, id: number): void {
  const p = itemPath(root, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
```

**Step 2: Create items.test.ts**

Create `src/backends/local/items.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem,
  listItemFiles,
} from './items.js';
import type { WorkItem } from '../../types.js';

describe('items', () => {
  let tmpDir: string;
  let itemsDirPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    itemsDirPath = path.join(tmpDir, '.tic', 'items');
    fs.mkdirSync(itemsDirPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes and reads a work item', () => {
    const item: WorkItem = {
      id: 1,
      title: 'Test item',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'high',
      assignee: 'dev',
      labels: ['bug'],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'A test item.',
      comments: [],
    };
    writeWorkItem(tmpDir, item);
    const read = readWorkItem(tmpDir, 1);
    expect(read.title).toBe('Test item');
    expect(read.type).toBe('task');
    expect(read.labels).toEqual(['bug']);
    expect(read.description).toBe('A test item.');
  });

  it('writes and reads a work item with comments', () => {
    const item: WorkItem = {
      id: 2,
      title: 'With comments',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'Has comments.',
      comments: [
        { author: 'dev', date: '2026-01-31T01:00:00Z', body: 'First comment.' },
        {
          author: 'dev',
          date: '2026-01-31T02:00:00Z',
          body: 'Second comment.',
        },
      ],
    };
    writeWorkItem(tmpDir, item);
    const read = readWorkItem(tmpDir, 2);
    expect(read.comments).toHaveLength(2);
    expect(read.comments[0]!.body).toBe('First comment.');
  });

  it('deletes a work item file', () => {
    const item: WorkItem = {
      id: 3,
      title: 'To delete',
      type: 'issue',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: '',
      comments: [],
    };
    writeWorkItem(tmpDir, item);
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(true);
    deleteWorkItem(tmpDir, 3);
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(false);
  });

  it('lists all item files', () => {
    writeWorkItem(tmpDir, {
      id: 1,
      title: 'A',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
    });
    writeWorkItem(tmpDir, {
      id: 2,
      title: 'B',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
    });
    const files = listItemFiles(tmpDir);
    expect(files).toHaveLength(2);
  });
});
```

**Step 3: Delete old files**

```bash
rm src/backends/local/issues.ts src/backends/local/issues.test.ts
```

**Step 4: Run tests**

Run: `npx vitest run src/backends/local/items.test.ts`
Expected: All 4 tests PASS

**Step 5: Commit**

```bash
git add src/backends/local/items.ts src/backends/local/items.test.ts
git rm src/backends/local/issues.ts src/backends/local/issues.test.ts
git commit -m "feat: rename issues module to items with type field"
```

---

### Task 5: Update LocalBackend class

**Files:**
- Modify: `src/backends/local/index.ts` (all lines)

**Step 1: Update the LocalBackend implementation**

Replace the entire contents of `src/backends/local/index.ts`:

```typescript
import type { Backend } from '../types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../../types.js';
import { readConfig, writeConfig, type Config } from './config.js';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem as removeWorkItemFile,
  listItemFiles,
  parseWorkItemFile,
} from './items.js';
import fs from 'node:fs';

export class LocalBackend implements Backend {
  private root: string;
  private config: Config;

  constructor(root: string) {
    this.root = root;
    this.config = readConfig(root);
  }

  private save(): void {
    writeConfig(this.root, this.config);
  }

  getStatuses(): string[] {
    return this.config.statuses;
  }

  getIterations(): string[] {
    return this.config.iterations;
  }

  getWorkItemTypes(): string[] {
    return this.config.types;
  }

  getCurrentIteration(): string {
    return this.config.current_iteration;
  }

  setCurrentIteration(name: string): void {
    this.config.current_iteration = name;
    if (!this.config.iterations.includes(name)) {
      this.config.iterations.push(name);
    }
    this.save();
  }

  listWorkItems(iteration?: string): WorkItem[] {
    const files = listItemFiles(this.root);
    const items = files.map((f) => {
      const raw = fs.readFileSync(f, 'utf-8');
      return parseWorkItemFile(raw);
    });
    if (iteration) return items.filter((i) => i.iteration === iteration);
    return items;
  }

  getWorkItem(id: number): WorkItem {
    return readWorkItem(this.root, id);
  }

  createWorkItem(data: NewWorkItem): WorkItem {
    const now = new Date().toISOString();
    const item: WorkItem = {
      ...data,
      id: this.config.next_id,
      created: now,
      updated: now,
      comments: [],
    };
    this.config.next_id++;
    if (data.iteration && !this.config.iterations.includes(data.iteration)) {
      this.config.iterations.push(data.iteration);
    }
    this.save();
    writeWorkItem(this.root, item);
    return item;
  }

  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem {
    const item = this.getWorkItem(id);
    const updated = {
      ...item,
      ...data,
      id,
      updated: new Date().toISOString(),
    };
    writeWorkItem(this.root, updated);
    return updated;
  }

  deleteWorkItem(id: number): void {
    removeWorkItemFile(this.root, id);
  }

  addComment(workItemId: number, comment: NewComment): Comment {
    const item = this.getWorkItem(workItemId);
    const newComment: Comment = {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
    item.comments.push(newComment);
    item.updated = new Date().toISOString();
    writeWorkItem(this.root, item);
    return newComment;
  }
}
```

**Step 2: Run type check**

Run: `npx tsc --noEmit`
Expected: Errors only in component files (app.tsx, IssueList.tsx, IssueForm.tsx) — backend is clean.

**Step 3: Commit**

```bash
git add src/backends/local/index.ts
git commit -m "feat: update LocalBackend to implement WorkItem methods"
```

---

### Task 6: Update LocalBackend tests

**Files:**
- Modify: `src/backends/local/index.test.ts` (all lines)

**Step 1: Rewrite the test file**

Replace the entire contents of `src/backends/local/index.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from './index.js';

describe('LocalBackend', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default statuses', () => {
    expect(backend.getStatuses()).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('returns default work item types', () => {
    expect(backend.getWorkItemTypes()).toEqual(['epic', 'issue', 'task']);
  });

  it('creates and lists work items', () => {
    backend.createWorkItem({
      title: 'Test',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: 'A test.',
    });
    const items = backend.listWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Test');
    expect(items[0]!.type).toBe('task');
    expect(items[0]!.id).toBe(1);
  });

  it('filters work items by iteration', () => {
    backend.createWorkItem({
      title: 'A',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
    });
    backend.createWorkItem({
      title: 'B',
      type: 'issue',
      status: 'todo',
      iteration: 'v2',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
    });
    expect(backend.listWorkItems('v1')).toHaveLength(1);
    expect(backend.listWorkItems('v2')).toHaveLength(1);
  });

  it('updates a work item', () => {
    backend.createWorkItem({
      title: 'Original',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
    });
    backend.updateWorkItem(1, { title: 'Updated', status: 'in-progress' });
    const item = backend.getWorkItem(1);
    expect(item.title).toBe('Updated');
    expect(item.status).toBe('in-progress');
  });

  it('deletes a work item', () => {
    backend.createWorkItem({
      title: 'Delete me',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
    });
    expect(backend.listWorkItems()).toHaveLength(1);
    backend.deleteWorkItem(1);
    expect(backend.listWorkItems()).toHaveLength(0);
  });

  it('adds a comment', () => {
    backend.createWorkItem({
      title: 'Commentable',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
    });
    backend.addComment(1, { author: 'dev', body: 'A comment.' });
    const item = backend.getWorkItem(1);
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.body).toBe('A comment.');
  });

  it('manages iterations', () => {
    expect(backend.getCurrentIteration()).toBe('default');
    backend.setCurrentIteration('v1');
    expect(backend.getCurrentIteration()).toBe('v1');
    expect(backend.getIterations()).toContain('v1');
  });
});
```

**Step 2: Run all backend tests**

Run: `npx vitest run src/backends/local/`
Expected: All tests PASS (5 config, 4 items, 8 backend = 17 total)

**Step 3: Commit**

```bash
git add src/backends/local/index.test.ts
git commit -m "test: update LocalBackend tests for WorkItem rename"
```

---

### Task 7: Update App shell and context

**Files:**
- Modify: `src/app.tsx` (all lines)

**Step 1: Update app.tsx**

Replace the contents of `src/app.tsx`:

```typescript
import { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import type { Backend } from './backends/types.js';

type Screen = 'list' | 'form' | 'iteration-picker';

interface AppState {
  screen: Screen;
  selectedWorkItemId: number | null;
  activeType: string | null;
  backend: Backend;
  navigate: (screen: Screen) => void;
  selectWorkItem: (id: number | null) => void;
  setActiveType: (type: string | null) => void;
}

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({ backend }: { backend: Backend }) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<number | null>(
    null,
  );
  const [activeType, setActiveType] = useState<string | null>(null);

  const state: AppState = {
    screen,
    selectedWorkItemId,
    activeType,
    backend,
    navigate: setScreen,
    selectWorkItem: setSelectedWorkItemId,
    setActiveType,
  };

  return (
    <AppContext.Provider value={state}>
      <Box flexDirection="column">
        {screen === 'list' && <WorkItemList />}
        {screen === 'form' && <WorkItemForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
      </Box>
    </AppContext.Provider>
  );
}
```

Note: `activeType` is stored in app context so the list can pass the currently filtered type to the form when creating. It starts as `null` and gets initialized to the first type in `WorkItemList` on mount.

**Step 2: Commit (won't compile yet — components not renamed)**

```bash
git add src/app.tsx
git commit -m "feat: update App shell for WorkItem and type context"
```

---

### Task 8: Create WorkItemList component

**Files:**
- Create: `src/components/WorkItemList.tsx` (based on `src/components/IssueList.tsx`)
- Delete: `src/components/IssueList.tsx`

**Step 1: Create WorkItemList.tsx**

Create `src/components/WorkItemList.tsx`:

```typescript
import { useState, useMemo, useEffect } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useAppState } from '../app.js';

export function WorkItemList() {
  const { backend, navigate, selectWorkItem, activeType, setActiveType } =
    useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const types = useMemo(() => backend.getWorkItemTypes(), [backend]);

  useEffect(() => {
    if (activeType === null && types.length > 0) {
      setActiveType(types[0]!);
    }
  }, [activeType, types, setActiveType]);

  const iteration = backend.getCurrentIteration();
  const allItems = useMemo(
    () => backend.listWorkItems(iteration),
    [iteration, refresh],
  );
  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );
  const statuses = backend.getStatuses();

  useEffect(() => {
    setCursor((c) => Math.min(c, Math.max(0, items.length - 1)));
  }, [items.length]);

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        backend.deleteWorkItem(items[cursor]!.id);
        setConfirmDelete(false);
        setCursor((c) => Math.max(0, c - 1));
        setRefresh((r) => r + 1);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) setCursor((c) => Math.max(0, c - 1));
    if (key.downArrow) setCursor((c) => Math.min(items.length - 1, c + 1));

    if (key.return && items.length > 0) {
      selectWorkItem(items[cursor]!.id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i') navigate('iteration-picker');

    if (input === 'c') {
      selectWorkItem(null);
      navigate('form');
    }

    if (input === 'd' && items.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 's' && items.length > 0) {
      const item = items[cursor]!;
      const idx = statuses.indexOf(item.status);
      const nextStatus = statuses[(idx + 1) % statuses.length]!;
      backend.updateWorkItem(item.id, { status: nextStatus });
      setRefresh((r) => r + 1);
    }

    if (key.tab && types.length > 0) {
      const currentIdx = types.indexOf(activeType ?? '');
      const nextType = types[(currentIdx + 1) % types.length]!;
      setActiveType(nextType);
      setCursor(0);
    }
  });

  const typeLabel = activeType
    ? activeType.charAt(0).toUpperCase() + activeType.slice(1) + 's'
    : '';

  const colId = 5;
  const colStatus = 14;
  const colPriority = 10;
  const colAssignee = 12;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {typeLabel} — {iteration}
        </Text>
        <Text dimColor> ({items.length} items)</Text>
      </Box>

      <Box>
        <Box width={2}>
          <Text> </Text>
        </Box>
        <Box width={colId}>
          <Text bold underline>
            ID
          </Text>
        </Box>
        <Box flexGrow={1}>
          <Text bold underline>
            Title
          </Text>
        </Box>
        <Box width={colStatus}>
          <Text bold underline>
            Status
          </Text>
        </Box>
        <Box width={colPriority}>
          <Text bold underline>
            Priority
          </Text>
        </Box>
        <Box width={colAssignee}>
          <Text bold underline>
            Assignee
          </Text>
        </Box>
      </Box>

      {items.length === 0 && (
        <Box marginTop={1}>
          <Text dimColor>No {activeType}s in this iteration.</Text>
        </Box>
      )}
      {items.map((item, idx) => {
        const selected = idx === cursor;
        return (
          <Box key={item.id}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text color={selected ? 'cyan' : undefined}>{item.id}</Text>
            </Box>
            <Box flexGrow={1}>
              <Text color={selected ? 'cyan' : undefined} bold={selected}>
                {item.title}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text color={selected ? 'cyan' : undefined}>{item.status}</Text>
            </Box>
            <Box width={colPriority}>
              <Text color={selected ? 'cyan' : undefined}>
                {item.priority}
              </Text>
            </Box>
            <Box width={colAssignee}>
              <Text color={selected ? 'cyan' : undefined}>
                {item.assignee}
              </Text>
            </Box>
          </Box>
        );
      })}

      <Box marginTop={1}>
        {confirmDelete ? (
          <Text color="red">Delete item #{items[cursor]?.id}? (y/n)</Text>
        ) : (
          <Text dimColor>
            up/down: navigate enter: open c: create d: delete s: cycle status
            tab: type i: iteration q: quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
```

**Step 2: Delete old file**

```bash
rm src/components/IssueList.tsx
```

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git rm src/components/IssueList.tsx
git commit -m "feat: create WorkItemList with Tab type cycling"
```

---

### Task 9: Create WorkItemForm component

**Files:**
- Create: `src/components/WorkItemForm.tsx` (based on `src/components/IssueForm.tsx`)
- Delete: `src/components/IssueForm.tsx`

**Step 1: Create WorkItemForm.tsx**

Create `src/components/WorkItemForm.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';
import type { Comment } from '../types.js';

type FieldName =
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'comments';

const FIELDS: FieldName[] = [
  'title',
  'type',
  'status',
  'iteration',
  'priority',
  'assignee',
  'labels',
  'description',
  'comments',
];
const SELECT_FIELDS: FieldName[] = ['type', 'status', 'iteration', 'priority'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export function WorkItemForm() {
  const { backend, navigate, selectedWorkItemId, activeType } = useAppState();

  const statuses = useMemo(() => backend.getStatuses(), [backend]);
  const iterations = useMemo(() => backend.getIterations(), [backend]);
  const types = useMemo(() => backend.getWorkItemTypes(), [backend]);

  const existingItem = useMemo(
    () =>
      selectedWorkItemId !== null
        ? backend.getWorkItem(selectedWorkItemId)
        : null,
    [selectedWorkItemId, backend],
  );

  const [title, setTitle] = useState(existingItem?.title ?? '');
  const [type, setType] = useState(
    existingItem?.type ?? activeType ?? types[0] ?? '',
  );
  const [status, setStatus] = useState(
    existingItem?.status ?? statuses[0] ?? '',
  );
  const [iteration, setIteration] = useState(
    existingItem?.iteration ?? backend.getCurrentIteration(),
  );
  const [priority, setPriority] = useState(existingItem?.priority ?? 'medium');
  const [assignee, setAssignee] = useState(existingItem?.assignee ?? '');
  const [labels, setLabels] = useState(existingItem?.labels.join(', ') ?? '');
  const [description, setDescription] = useState(
    existingItem?.description ?? '',
  );
  const [newComment, setNewComment] = useState('');
  const [comments, setComments] = useState<Comment[]>(
    existingItem?.comments ?? [],
  );

  const [focusedField, setFocusedField] = useState(0);
  const [editing, setEditing] = useState(false);

  const currentField = FIELDS[focusedField]!;
  const isSelectField = SELECT_FIELDS.includes(currentField);

  function save() {
    const parsedLabels = labels
      .split(',')
      .map((l) => l.trim())
      .filter((l) => l.length > 0);

    if (selectedWorkItemId !== null) {
      backend.updateWorkItem(selectedWorkItemId, {
        title,
        type,
        status,
        iteration,
        priority: priority,
        assignee,
        labels: parsedLabels,
        description,
      });

      if (newComment.trim().length > 0) {
        const added = backend.addComment(selectedWorkItemId, {
          author: 'me',
          body: newComment.trim(),
        });
        setComments((prev) => [...prev, added]);
        setNewComment('');
      }
    } else {
      const created = backend.createWorkItem({
        title: title || 'Untitled',
        type,
        status,
        iteration,
        priority: priority,
        assignee,
        labels: parsedLabels,
        description,
      });

      if (newComment.trim().length > 0) {
        backend.addComment(created.id, {
          author: 'me',
          body: newComment.trim(),
        });
      }
    }
  }

  useInput(
    (_input, key) => {
      if (!editing) {
        if (key.upArrow) {
          setFocusedField((f) => Math.max(0, f - 1));
        }

        if (key.downArrow) {
          setFocusedField((f) => Math.min(FIELDS.length - 1, f + 1));
        }

        if (key.return) {
          setEditing(true);
        }

        if (key.escape) {
          save();
          navigate('list');
        }
      } else {
        if (key.escape) {
          setEditing(false);
        }
      }
    },
    { isActive: !editing || !isSelectField },
  );

  function getSelectItems(field: FieldName) {
    switch (field) {
      case 'type': {
        return types.map((t) => ({ label: t, value: t }));
      }

      case 'status': {
        return statuses.map((s) => ({ label: s, value: s }));
      }

      case 'iteration': {
        return iterations.map((i) => ({ label: i, value: i }));
      }

      case 'priority': {
        return PRIORITIES.map((p) => ({ label: p, value: p }));
      }

      default: {
        return [];
      }
    }
  }

  function getSelectInitialIndex(field: FieldName): number {
    switch (field) {
      case 'type': {
        const idx = types.indexOf(type);
        return idx >= 0 ? idx : 0;
      }

      case 'status': {
        const idx = statuses.indexOf(status);
        return idx >= 0 ? idx : 0;
      }

      case 'iteration': {
        const idx = iterations.indexOf(iteration);
        return idx >= 0 ? idx : 0;
      }

      case 'priority': {
        const idx = PRIORITIES.indexOf(priority);
        return idx >= 0 ? idx : 0;
      }

      default: {
        return 0;
      }
    }
  }

  function handleSelectItem(field: FieldName, value: string) {
    switch (field) {
      case 'type': {
        setType(value);
        break;
      }

      case 'status': {
        setStatus(value);
        break;
      }

      case 'iteration': {
        setIteration(value);
        break;
      }

      case 'priority': {
        setPriority(value as 'low' | 'medium' | 'high' | 'critical');
        break;
      }

      default: {
        break;
      }
    }

    setEditing(false);
  }

  function renderField(field: FieldName, index: number) {
    const focused = index === focusedField;
    const isEditing = focused && editing;
    const label = field.charAt(0).toUpperCase() + field.slice(1);
    const cursor = focused ? '>' : ' ';

    if (field === 'comments') {
      return (
        <Box key={field} flexDirection="column">
          <Box>
            <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
            <Text bold={focused} color={focused ? 'cyan' : undefined}>
              {label}:
            </Text>
          </Box>
          {comments.map((c, ci) => (
            <Box key={ci} marginLeft={4}>
              <Text dimColor>
                [{c.date}] {c.author}: {c.body}
              </Text>
            </Box>
          ))}
          <Box marginLeft={4}>
            {isEditing ? (
              <Box>
                <Text color="green">New: </Text>
                <TextInput
                  value={newComment}
                  onChange={setNewComment}
                  focus={true}
                  onSubmit={() => {
                    setEditing(false);
                  }}
                />
              </Box>
            ) : (
              <Text dimColor>
                {newComment
                  ? `New: ${newComment}`
                  : '(press Enter to add comment)'}
              </Text>
            )}
          </Box>
        </Box>
      );
    }

    if (SELECT_FIELDS.includes(field)) {
      const currentValue =
        field === 'type'
          ? type
          : field === 'status'
            ? status
            : field === 'iteration'
              ? iteration
              : priority;

      if (isEditing) {
        return (
          <Box key={field} flexDirection="column">
            <Box>
              <Text color="cyan">{cursor} </Text>
              <Text bold color="cyan">
                {label}:{' '}
              </Text>
            </Box>
            <Box marginLeft={4}>
              <SelectInput
                items={getSelectItems(field)}
                initialIndex={getSelectInitialIndex(field)}
                onSelect={(item) => {
                  handleSelectItem(field, item.value);
                }}
              />
            </Box>
          </Box>
        );
      }

      return (
        <Box key={field}>
          <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
          <Text bold={focused} color={focused ? 'cyan' : undefined}>
            {label}:{' '}
          </Text>
          <Text>{currentValue}</Text>
        </Box>
      );
    }

    // Text fields: title, assignee, labels, description
    const textValue =
      field === 'title'
        ? title
        : field === 'assignee'
          ? assignee
          : field === 'labels'
            ? labels
            : description;

    const textSetter =
      field === 'title'
        ? setTitle
        : field === 'assignee'
          ? setAssignee
          : field === 'labels'
            ? setLabels
            : setDescription;

    if (isEditing) {
      return (
        <Box key={field}>
          <Text color="cyan">{cursor} </Text>
          <Text bold color="cyan">
            {label}:{' '}
          </Text>
          <TextInput
            value={textValue}
            onChange={textSetter}
            focus={true}
            onSubmit={() => {
              setEditing(false);
            }}
          />
        </Box>
      );
    }

    return (
      <Box key={field}>
        <Text color={focused ? 'cyan' : undefined}>{cursor} </Text>
        <Text bold={focused} color={focused ? 'cyan' : undefined}>
          {label}:{' '}
        </Text>
        <Text>{textValue || <Text dimColor>(empty)</Text>}</Text>
      </Box>
    );
  }

  const mode = selectedWorkItemId !== null ? 'Edit' : 'Create';
  const typeLabel = type.charAt(0).toUpperCase() + type.slice(1);

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {mode} {typeLabel}
          {selectedWorkItemId !== null ? ` #${selectedWorkItemId}` : ''}
        </Text>
      </Box>

      {FIELDS.map((field, index) => renderField(field, index))}

      <Box marginTop={1}>
        <Text dimColor>
          {editing
            ? isSelectField
              ? 'up/down: navigate  enter: select'
              : 'type to edit  enter/esc: confirm'
            : 'up/down: navigate  enter: edit field  esc: save & back'}
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Delete old file**

```bash
rm src/components/IssueForm.tsx
```

**Step 3: Commit**

```bash
git add src/components/WorkItemForm.tsx
git rm src/components/IssueForm.tsx
git commit -m "feat: create WorkItemForm with type dropdown"
```

---

### Task 10: Final verification

**Files:** None (verification only)

**Step 1: Run type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All 17 tests PASS (5 config, 4 items, 8 backend)

**Step 3: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 4: Run format fix if needed**

Run: `npm run format`

**Step 5: Build**

Run: `npm run build`
Expected: Clean build with no errors

**Step 6: Final commit if formatting changed anything**

```bash
git add -A
git commit -m "style: format after work item migration"
```

---

### Task 11: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update references**

In `CLAUDE.md`, update all references from "issue" terminology to "work item" terminology:

- `IssueList` → `WorkItemList`
- `IssueForm` → `WorkItemForm`
- "issues as markdown files" → "work items as markdown files"
- `.tic/issues/{id}.md` → `.tic/items/{id}.md`
- `Issue`, `NewIssue` → `WorkItem`, `NewWorkItem`
- Add `Tab` to the keybindings list: `Tab` switch work item type
- Add mention of `types` in config description

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for work item rename"
```
