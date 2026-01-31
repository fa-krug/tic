# Local Backend TUI Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Build the first working version of tic — a terminal UI for local markdown-based issue tracking using `.tic/` folder with YAML frontmatter.

**Architecture:** TypeScript ESM project using Ink v6 (React for CLI). Backend interface abstracts issue operations; local backend reads/writes markdown files with gray-matter. TUI uses state-driven screen switching (list view, form view, iteration picker). Navigation via useInput hook, form fields via ink-text-input and ink-select-input.

**Tech Stack:** TypeScript, Ink v6, React 19, gray-matter, yaml, ink-text-input, ink-select-input

---

### Task 1: Project Scaffolding

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/index.tsx`

**Step 1: Create package.json**

```json
{
  "name": "tic",
  "version": "0.1.0",
  "description": "Terminal UI for issue tracking",
  "type": "module",
  "bin": {
    "tic": "./dist/index.js"
  },
  "scripts": {
    "build": "tsc",
    "dev": "tsc --watch",
    "start": "node dist/index.js"
  },
  "license": "MIT"
}
```

**Step 2: Install dependencies**

Run: `npm install ink react ink-text-input ink-select-input gray-matter yaml`
Run: `npm install -D typescript @types/react @sindresorhus/tsconfig`

**Step 3: Create tsconfig.json**

```json
{
  "extends": "@sindresorhus/tsconfig",
  "compilerOptions": {
    "outDir": "dist",
    "sourceMap": true,
    "jsx": "react-jsx",
    "isolatedModules": true
  },
  "include": ["src"]
}
```

**Step 4: Create minimal entry point src/index.tsx**

```tsx
#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { Text } from 'ink';

function App() {
  return <Text>tic - issue tracker</Text>;
}

render(<App />);
```

**Step 5: Verify it builds and runs**

Run: `npx tsc && node dist/index.js`
Expected: Prints "tic - issue tracker" and exits.

**Step 6: Add .gitignore entries**

Add `dist/` and `node_modules/` to `.gitignore`.

**Step 7: Commit**

```bash
git add package.json tsconfig.json src/index.tsx .gitignore package-lock.json
git commit -m "feat: scaffold TypeScript + Ink project"
```

---

### Task 2: Shared Types

**Files:**
- Create: `src/types.ts`
- Create: `src/backends/types.ts`

**Step 1: Create src/types.ts with Issue, Comment, and related types**

```ts
export interface Comment {
  author: string;
  date: string;
  body: string;
}

export interface Issue {
  id: number;
  title: string;
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

export type NewIssue = Pick<Issue, 'title' | 'status' | 'iteration' | 'priority' | 'assignee' | 'labels' | 'description'>;

export interface NewComment {
  author: string;
  body: string;
}
```

**Step 2: Create src/backends/types.ts with Backend interface**

```ts
import { Issue, NewIssue, NewComment, Comment } from '../types.js';

export interface Backend {
  getStatuses(): string[];
  getIterations(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listIssues(iteration?: string): Issue[];
  getIssue(id: number): Issue;
  createIssue(data: NewIssue): Issue;
  updateIssue(id: number, data: Partial<Issue>): Issue;
  deleteIssue(id: number): void;
  addComment(issueId: number, comment: NewComment): Comment;
}
```

**Step 3: Verify it compiles**

Run: `npx tsc`
Expected: No errors.

**Step 4: Commit**

```bash
git add src/types.ts src/backends/types.ts
git commit -m "feat: add shared types and backend interface"
```

---

### Task 3: Local Backend — Config

**Files:**
- Create: `src/backends/local/config.ts`

**Step 1: Write tests for config read/write**

Create: `src/backends/local/config.test.ts`

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readConfig, writeConfig, defaultConfig } from './config.js';

describe('config', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default config when no config file exists', () => {
    const config = readConfig(tmpDir);
    expect(config.statuses).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
    expect(config.current_iteration).toBe('default');
    expect(config.iterations).toEqual(['default']);
    expect(config.next_id).toBe(1);
  });

  it('reads existing config file', () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(path.join(ticDir, 'config.yml'), 'statuses:\n  - open\n  - closed\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 5\n');
    const config = readConfig(tmpDir);
    expect(config.statuses).toEqual(['open', 'closed']);
    expect(config.current_iteration).toBe('v1');
    expect(config.next_id).toBe(5);
  });

  it('writes config file and creates .tic dir', () => {
    writeConfig(tmpDir, { ...defaultConfig, next_id: 10 });
    const raw = fs.readFileSync(path.join(tmpDir, '.tic', 'config.yml'), 'utf-8');
    expect(raw).toContain('next_id: 10');
  });
});
```

**Step 2: Install vitest**

Run: `npm install -D vitest`

Add to package.json scripts: `"test": "vitest run"`

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — module not found.

**Step 4: Implement config.ts**

```ts
import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';

export interface Config {
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
}

export const defaultConfig: Config = {
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
};

function configPath(root: string): string {
  return path.join(root, '.tic', 'config.yml');
}

export function readConfig(root: string): Config {
  const p = configPath(root);
  if (!fs.existsSync(p)) return { ...defaultConfig };
  const raw = fs.readFileSync(p, 'utf-8');
  return yaml.parse(raw) as Config;
}

export function writeConfig(root: string, config: Config): void {
  const dir = path.join(root, '.tic');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(configPath(root), yaml.stringify(config));
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: All 3 tests PASS.

**Step 6: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts package.json
git commit -m "feat: local backend config read/write with tests"
```

---

### Task 4: Local Backend — Issue File Read/Write

**Files:**
- Create: `src/backends/local/issues.ts`
- Create: `src/backends/local/issues.test.ts`

**Step 1: Write tests for issue CRUD operations**

```ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { readIssue, writeIssue, deleteIssue, listIssueFiles, parseIssueFile } from './issues.js';
import type { Issue } from '../../types.js';

describe('issues', () => {
  let tmpDir: string;
  let issuesDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    issuesDir = path.join(tmpDir, '.tic', 'issues');
    fs.mkdirSync(issuesDir, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('writes and reads an issue', () => {
    const issue: Issue = {
      id: 1, title: 'Test issue', status: 'todo', iteration: 'v1',
      priority: 'high', assignee: 'dev', labels: ['bug'],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: 'A test issue.', comments: [],
    };
    writeIssue(tmpDir, issue);
    const read = readIssue(tmpDir, 1);
    expect(read.title).toBe('Test issue');
    expect(read.labels).toEqual(['bug']);
    expect(read.description).toBe('A test issue.');
  });

  it('writes and reads an issue with comments', () => {
    const issue: Issue = {
      id: 2, title: 'With comments', status: 'todo', iteration: 'v1',
      priority: 'medium', assignee: '', labels: [],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: 'Has comments.',
      comments: [
        { author: 'dev', date: '2026-01-31T01:00:00Z', body: 'First comment.' },
        { author: 'dev', date: '2026-01-31T02:00:00Z', body: 'Second comment.' },
      ],
    };
    writeIssue(tmpDir, issue);
    const read = readIssue(tmpDir, 2);
    expect(read.comments).toHaveLength(2);
    expect(read.comments[0].body).toBe('First comment.');
  });

  it('deletes an issue file', () => {
    const issue: Issue = {
      id: 3, title: 'To delete', status: 'todo', iteration: 'v1',
      priority: 'low', assignee: '', labels: [],
      created: '2026-01-31T00:00:00Z', updated: '2026-01-31T00:00:00Z',
      description: '', comments: [],
    };
    writeIssue(tmpDir, issue);
    expect(fs.existsSync(path.join(issuesDir, '3.md'))).toBe(true);
    deleteIssue(tmpDir, 3);
    expect(fs.existsSync(path.join(issuesDir, '3.md'))).toBe(false);
  });

  it('lists all issue files', () => {
    writeIssue(tmpDir, { id: 1, title: 'A', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], created: '', updated: '', description: '', comments: [] });
    writeIssue(tmpDir, { id: 2, title: 'B', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], created: '', updated: '', description: '', comments: [] });
    const files = listIssueFiles(tmpDir);
    expect(files).toHaveLength(2);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/issues.test.ts`
Expected: FAIL.

**Step 3: Implement issues.ts**

The key logic: use gray-matter to parse/stringify frontmatter. Comments are appended below a `## Comments` heading as `---`-separated blocks with `author:` and `date:` metadata lines.

```ts
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import type { Issue, Comment } from '../../types.js';

function issuesDir(root: string): string {
  return path.join(root, '.tic', 'issues');
}

function issuePath(root: string, id: number): string {
  return path.join(issuesDir(root), `${id}.md`);
}

export function listIssueFiles(root: string): string[] {
  const dir = issuesDir(root);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f));
}

function serializeComments(comments: Comment[]): string {
  if (comments.length === 0) return '';
  const parts = comments.map(c =>
    `---\nauthor: ${c.author}\ndate: ${c.date}\n\n${c.body}`
  );
  return '\n\n## Comments\n\n' + parts.join('\n\n');
}

function parseComments(content: string): { description: string; comments: Comment[] } {
  const marker = '## Comments';
  const idx = content.indexOf(marker);
  if (idx === -1) return { description: content.trim(), comments: [] };

  const description = content.slice(0, idx).trim();
  const commentsRaw = content.slice(idx + marker.length).trim();
  const blocks = commentsRaw.split(/\n---\n/).filter(b => b.trim());

  const comments: Comment[] = blocks.map(block => {
    const lines = block.trim().split('\n');
    let author = '';
    let date = '';
    const bodyLines: string[] = [];
    let pastMeta = false;
    for (const line of lines) {
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

export function readIssue(root: string, id: number): Issue {
  const raw = fs.readFileSync(issuePath(root, id), 'utf-8');
  return parseIssueFile(raw);
}

export function parseIssueFile(raw: string): Issue {
  const parsed = matter(raw);
  const data = parsed.data as Record<string, unknown>;
  const { description, comments } = parseComments(parsed.content);

  return {
    id: data.id as number,
    title: data.title as string,
    status: data.status as string,
    iteration: data.iteration as string,
    priority: data.priority as Issue['priority'],
    assignee: (data.assignee as string) || '',
    labels: (data.labels as string[]) || [],
    created: data.created as string,
    updated: data.updated as string,
    description,
    comments,
  };
}

export function writeIssue(root: string, issue: Issue): void {
  const dir = issuesDir(root);
  fs.mkdirSync(dir, { recursive: true });

  const frontmatter = {
    id: issue.id,
    title: issue.title,
    status: issue.status,
    iteration: issue.iteration,
    priority: issue.priority,
    assignee: issue.assignee,
    labels: issue.labels,
    created: issue.created,
    updated: issue.updated,
  };

  const body = issue.description + serializeComments(issue.comments);
  const content = matter.stringify(body, frontmatter);
  fs.writeFileSync(issuePath(root, issue.id), content);
}

export function deleteIssue(root: string, id: number): void {
  const p = issuePath(root, id);
  if (fs.existsSync(p)) fs.unlinkSync(p);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/issues.test.ts`
Expected: All 4 tests PASS.

**Step 5: Commit**

```bash
git add src/backends/local/issues.ts src/backends/local/issues.test.ts
git commit -m "feat: local issue file read/write/delete with tests"
```

---

### Task 5: Local Backend — Full Implementation

**Files:**
- Create: `src/backends/local/index.ts`
- Create: `src/backends/local/index.test.ts`

**Step 1: Write tests for the local backend**

```ts
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
    expect(backend.getStatuses()).toEqual(['backlog', 'todo', 'in-progress', 'review', 'done']);
  });

  it('creates and lists issues', () => {
    backend.createIssue({
      title: 'Test', status: 'todo', iteration: 'default',
      priority: 'medium', assignee: '', labels: [], description: 'A test.',
    });
    const issues = backend.listIssues();
    expect(issues).toHaveLength(1);
    expect(issues[0].title).toBe('Test');
    expect(issues[0].id).toBe(1);
  });

  it('filters issues by iteration', () => {
    backend.createIssue({ title: 'A', status: 'todo', iteration: 'v1', priority: 'low', assignee: '', labels: [], description: '' });
    backend.createIssue({ title: 'B', status: 'todo', iteration: 'v2', priority: 'low', assignee: '', labels: [], description: '' });
    expect(backend.listIssues('v1')).toHaveLength(1);
    expect(backend.listIssues('v2')).toHaveLength(1);
  });

  it('updates an issue', () => {
    backend.createIssue({ title: 'Original', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    backend.updateIssue(1, { title: 'Updated', status: 'in-progress' });
    const issue = backend.getIssue(1);
    expect(issue.title).toBe('Updated');
    expect(issue.status).toBe('in-progress');
  });

  it('deletes an issue', () => {
    backend.createIssue({ title: 'Delete me', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    expect(backend.listIssues()).toHaveLength(1);
    backend.deleteIssue(1);
    expect(backend.listIssues()).toHaveLength(0);
  });

  it('adds a comment', () => {
    backend.createIssue({ title: 'Commentable', status: 'todo', iteration: 'default', priority: 'low', assignee: '', labels: [], description: '' });
    backend.addComment(1, { author: 'dev', body: 'A comment.' });
    const issue = backend.getIssue(1);
    expect(issue.comments).toHaveLength(1);
    expect(issue.comments[0].body).toBe('A comment.');
  });

  it('manages iterations', () => {
    expect(backend.getCurrentIteration()).toBe('default');
    backend.setCurrentIteration('v1');
    expect(backend.getCurrentIteration()).toBe('v1');
    expect(backend.getIterations()).toContain('v1');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL.

**Step 3: Implement LocalBackend**

```ts
import type { Backend } from '../types.js';
import type { Issue, NewIssue, NewComment, Comment } from '../../types.js';
import { readConfig, writeConfig, type Config } from './config.js';
import { readIssue, writeIssue, deleteIssue as removeIssueFile, listIssueFiles, parseIssueFile } from './issues.js';
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

  listIssues(iteration?: string): Issue[] {
    const files = listIssueFiles(this.root);
    const issues = files.map(f => {
      const raw = fs.readFileSync(f, 'utf-8');
      return parseIssueFile(raw);
    });
    if (iteration) return issues.filter(i => i.iteration === iteration);
    return issues;
  }

  getIssue(id: number): Issue {
    return readIssue(this.root, id);
  }

  createIssue(data: NewIssue): Issue {
    const now = new Date().toISOString();
    const issue: Issue = {
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
    writeIssue(this.root, issue);
    return issue;
  }

  updateIssue(id: number, data: Partial<Issue>): Issue {
    const issue = this.getIssue(id);
    const updated = { ...issue, ...data, id, updated: new Date().toISOString() };
    writeIssue(this.root, updated);
    return updated;
  }

  deleteIssue(id: number): void {
    removeIssueFile(this.root, id);
  }

  addComment(issueId: number, comment: NewComment): Comment {
    const issue = this.getIssue(issueId);
    const newComment: Comment = {
      author: comment.author,
      date: new Date().toISOString(),
      body: comment.body,
    };
    issue.comments.push(newComment);
    issue.updated = new Date().toISOString();
    writeIssue(this.root, issue);
    return newComment;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: All 7 tests PASS.

**Step 5: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat: local backend implementation with tests"
```

---

### Task 6: TUI — App Shell and Issue List Screen

**Files:**
- Create: `src/app.tsx`
- Create: `src/components/IssueList.tsx`
- Modify: `src/index.tsx`

**Step 1: Create the App shell with screen routing**

`src/app.tsx`:

```tsx
import React, { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { IssueList } from './components/IssueList.js';
import { IssueForm } from './components/IssueForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import type { Backend } from './backends/types.js';

type Screen = 'list' | 'form' | 'iteration-picker';

interface AppState {
  screen: Screen;
  selectedIssueId: number | null;
  backend: Backend;
  navigate: (screen: Screen) => void;
  selectIssue: (id: number | null) => void;
}

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({ backend }: { backend: Backend }) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);

  const state: AppState = {
    screen,
    selectedIssueId,
    backend,
    navigate: setScreen,
    selectIssue: setSelectedIssueId,
  };

  return (
    <AppContext.Provider value={state}>
      <Box flexDirection="column">
        {screen === 'list' && <IssueList />}
        {screen === 'form' && <IssueForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
      </Box>
    </AppContext.Provider>
  );
}
```

**Step 2: Create IssueList component**

`src/components/IssueList.tsx`:

```tsx
import React, { useState, useMemo } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import { useAppState } from '../app.js';

export function IssueList() {
  const { backend, navigate, selectIssue } = useAppState();
  const { exit } = useApp();
  const [cursor, setCursor] = useState(0);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [refresh, setRefresh] = useState(0);

  const iteration = backend.getCurrentIteration();
  const issues = useMemo(
    () => backend.listIssues(iteration),
    [iteration, refresh]
  );
  const statuses = backend.getStatuses();

  useInput((input, key) => {
    if (confirmDelete) {
      if (input === 'y' || input === 'Y') {
        backend.deleteIssue(issues[cursor].id);
        setConfirmDelete(false);
        setCursor(c => Math.max(0, c - 1));
        setRefresh(r => r + 1);
      } else {
        setConfirmDelete(false);
      }
      return;
    }

    if (key.upArrow) setCursor(c => Math.max(0, c - 1));
    if (key.downArrow) setCursor(c => Math.min(issues.length - 1, c + 1));

    if (key.return && issues.length > 0) {
      selectIssue(issues[cursor].id);
      navigate('form');
    }

    if (input === 'q') exit();
    if (input === 'i') navigate('iteration-picker');

    if (input === 'c') {
      selectIssue(null); // null means "create new"
      navigate('form');
    }

    if (input === 'd' && issues.length > 0) {
      setConfirmDelete(true);
    }

    if (input === 's' && issues.length > 0) {
      const issue = issues[cursor];
      const idx = statuses.indexOf(issue.status);
      const nextStatus = statuses[(idx + 1) % statuses.length];
      backend.updateIssue(issue.id, { status: nextStatus });
      setRefresh(r => r + 1);
    }
  });

  const colId = 5;
  const colStatus = 14;
  const colPriority = 10;
  const colAssignee = 12;

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">Iteration: {iteration}</Text>
        <Text dimColor>  ({issues.length} issues)</Text>
      </Box>

      {/* Header row */}
      <Box>
        <Box width={2}><Text> </Text></Box>
        <Box width={colId}><Text bold underline>ID</Text></Box>
        <Box flexGrow={1}><Text bold underline>Title</Text></Box>
        <Box width={colStatus}><Text bold underline>Status</Text></Box>
        <Box width={colPriority}><Text bold underline>Priority</Text></Box>
        <Box width={colAssignee}><Text bold underline>Assignee</Text></Box>
      </Box>

      {/* Issue rows */}
      {issues.length === 0 && (
        <Box marginTop={1}><Text dimColor>No issues in this iteration.</Text></Box>
      )}
      {issues.map((issue, idx) => {
        const selected = idx === cursor;
        return (
          <Box key={issue.id}>
            <Box width={2}><Text color="cyan">{selected ? '>' : ' '}</Text></Box>
            <Box width={colId}><Text color={selected ? 'cyan' : undefined}>{issue.id}</Text></Box>
            <Box flexGrow={1}><Text color={selected ? 'cyan' : undefined} bold={selected}>{issue.title}</Text></Box>
            <Box width={colStatus}><Text color={selected ? 'cyan' : undefined}>{issue.status}</Text></Box>
            <Box width={colPriority}><Text color={selected ? 'cyan' : undefined}>{issue.priority}</Text></Box>
            <Box width={colAssignee}><Text color={selected ? 'cyan' : undefined}>{issue.assignee}</Text></Box>
          </Box>
        );
      })}

      {/* Footer */}
      <Box marginTop={1}>
        {confirmDelete ? (
          <Text color="red">Delete issue #{issues[cursor]?.id}? (y/n)</Text>
        ) : (
          <Text dimColor>
            up/down: navigate  enter: open  c: create  d: delete  s: cycle status  i: iteration  q: quit
          </Text>
        )}
      </Box>
    </Box>
  );
}
```

**Step 3: Update src/index.tsx to wire up the app**

```tsx
#!/usr/bin/env node
import { render } from 'ink';
import React from 'react';
import { App } from './app.js';
import { LocalBackend } from './backends/local/index.js';

const backend = new LocalBackend(process.cwd());
render(<App backend={backend} />);
```

**Step 4: Build and manually test**

Run: `npx tsc && node dist/index.js`
Expected: Shows the issue list for the default iteration (empty). Press `q` to quit.

**Step 5: Commit**

```bash
git add src/app.tsx src/components/IssueList.tsx src/index.tsx
git commit -m "feat: app shell and issue list screen"
```

---

### Task 7: TUI — Iteration Picker

**Files:**
- Create: `src/components/IterationPicker.tsx`

**Step 1: Implement IterationPicker**

```tsx
import React from 'react';
import { Box, Text } from 'ink';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';

export function IterationPicker() {
  const { backend, navigate } = useAppState();
  const iterations = backend.getIterations();
  const current = backend.getCurrentIteration();

  const items = iterations.map(it => ({
    label: it === current ? `${it} (current)` : it,
    value: it,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Switch Iteration</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={iterations.indexOf(current)}
        onSelect={(item) => {
          backend.setCurrentIteration(item.value);
          navigate('list');
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>up/down: navigate  enter: select</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Build and manually test**

Run: `npx tsc && node dist/index.js`
Expected: Press `i` from list view, see iteration picker. Select one to switch.

**Step 3: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "feat: iteration picker component"
```

---

### Task 8: TUI — Issue Form (Create & Edit)

**Files:**
- Create: `src/components/IssueForm.tsx`

This is the most complex component. It implements a vertical form with arrow key navigation between fields, Enter to activate a field, Esc to go back.

**Step 1: Implement IssueForm**

```tsx
import React, { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';
import type { Issue, Comment } from '../types.js';

type FieldName = 'title' | 'status' | 'iteration' | 'priority' | 'assignee' | 'labels' | 'description' | 'comments';

const FIELDS: FieldName[] = ['title', 'status', 'iteration', 'priority', 'assignee', 'labels', 'description', 'comments'];
const SELECT_FIELDS: FieldName[] = ['status', 'iteration', 'priority'];
const PRIORITIES = ['low', 'medium', 'high', 'critical'];

export function IssueForm() {
  const { backend, navigate, selectedIssueId } = useAppState();
  const isNew = selectedIssueId === null;

  const existingIssue = useMemo(
    () => (isNew ? null : backend.getIssue(selectedIssueId!)),
    [selectedIssueId]
  );

  const [title, setTitle] = useState(existingIssue?.title ?? '');
  const [status, setStatus] = useState(existingIssue?.status ?? backend.getStatuses()[0]);
  const [iteration, setIteration] = useState(existingIssue?.iteration ?? backend.getCurrentIteration());
  const [priority, setPriority] = useState(existingIssue?.priority ?? 'medium');
  const [assignee, setAssignee] = useState(existingIssue?.assignee ?? '');
  const [labels, setLabels] = useState(existingIssue?.labels.join(', ') ?? '');
  const [description, setDescription] = useState(existingIssue?.description ?? '');
  const [comments] = useState<Comment[]>(existingIssue?.comments ?? []);
  const [newComment, setNewComment] = useState('');

  const [focusedField, setFocusedField] = useState(0);
  const [editing, setEditing] = useState(false);

  function save() {
    const issueData = {
      title,
      status,
      iteration,
      priority: priority as Issue['priority'],
      assignee,
      labels: labels.split(',').map(l => l.trim()).filter(Boolean),
      description,
    };

    if (isNew) {
      const created = backend.createIssue(issueData);
      if (newComment.trim()) {
        backend.addComment(created.id, { author: 'me', body: newComment.trim() });
      }
    } else {
      backend.updateIssue(selectedIssueId!, issueData);
      if (newComment.trim()) {
        backend.addComment(selectedIssueId!, { author: 'me', body: newComment.trim() });
      }
    }
  }

  useInput((input, key) => {
    if (editing) {
      if (key.escape) {
        setEditing(false);
      }
      // When editing a select field, Enter is handled by SelectInput
      return;
    }

    if (key.escape) {
      save();
      navigate('list');
      return;
    }

    if (key.upArrow) setFocusedField(f => Math.max(0, f - 1));
    if (key.downArrow) setFocusedField(f => Math.min(FIELDS.length - 1, f + 1));

    if (key.return) {
      setEditing(true);
    }
  }, { isActive: !editing || !SELECT_FIELDS.includes(FIELDS[focusedField]) });

  const currentField = FIELDS[focusedField];
  const statuses = backend.getStatuses();
  const iterations = backend.getIterations();

  function renderField(name: FieldName, idx: number) {
    const focused = idx === focusedField;
    const isEditing = focused && editing;
    const label = name.charAt(0).toUpperCase() + name.slice(1);

    if (name === 'comments') {
      return (
        <Box key={name} flexDirection="column" marginTop={1}>
          <Text bold color={focused ? 'cyan' : undefined}>{focused ? '> ' : '  '}Comments ({comments.length})</Text>
          {comments.map((c, ci) => (
            <Box key={ci} flexDirection="column" marginLeft={4} marginTop={ci > 0 ? 1 : 0}>
              <Text dimColor>{c.author} ({c.date})</Text>
              <Text>{c.body}</Text>
            </Box>
          ))}
          <Box marginLeft={4} marginTop={1}>
            <Text dimColor>New: </Text>
            {isEditing ? (
              <TextInput
                value={newComment}
                onChange={setNewComment}
                focus={true}
                onSubmit={() => setEditing(false)}
              />
            ) : (
              <Text>{newComment || '(press Enter to add comment)'}</Text>
            )}
          </Box>
        </Box>
      );
    }

    if (SELECT_FIELDS.includes(name) && isEditing) {
      let items: { label: string; value: string }[];
      if (name === 'status') items = statuses.map(s => ({ label: s, value: s }));
      else if (name === 'iteration') items = iterations.map(i => ({ label: i, value: i }));
      else items = PRIORITIES.map(p => ({ label: p, value: p }));

      return (
        <Box key={name} flexDirection="column">
          <Text bold color="cyan">{'> '}{label}:</Text>
          <Box marginLeft={4}>
            <SelectInput
              items={items}
              onSelect={(item) => {
                if (name === 'status') setStatus(item.value);
                else if (name === 'iteration') setIteration(item.value);
                else setPriority(item.value);
                setEditing(false);
              }}
            />
          </Box>
        </Box>
      );
    }

    let value: string;
    let setValue: (v: string) => void;
    if (name === 'title') { value = title; setValue = setTitle; }
    else if (name === 'status') { value = status; setValue = setStatus; }
    else if (name === 'iteration') { value = iteration; setValue = setIteration; }
    else if (name === 'priority') { value = priority; setValue = setPriority; }
    else if (name === 'assignee') { value = assignee; setValue = setAssignee; }
    else if (name === 'labels') { value = labels; setValue = setLabels; }
    else { value = description; setValue = setDescription; }

    return (
      <Box key={name}>
        <Text bold={focused} color={focused ? 'cyan' : undefined}>
          {focused ? '> ' : '  '}{label}:{' '}
        </Text>
        {isEditing ? (
          <TextInput
            value={value}
            onChange={setValue}
            focus={true}
            onSubmit={() => setEditing(false)}
          />
        ) : (
          <Text>{value || '(empty)'}</Text>
        )}
      </Box>
    );
  }

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">{isNew ? 'Create Issue' : `Edit Issue #${selectedIssueId}`}</Text>
      </Box>

      {FIELDS.map((name, idx) => renderField(name, idx))}

      <Box marginTop={1}>
        <Text dimColor>
          {editing ? 'Enter: confirm  Esc: cancel edit' : 'up/down: navigate  Enter: edit field  Esc: save & back'}
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Build and manually test**

Run: `npx tsc && node dist/index.js`

Test flow:
1. Press `c` to create an issue — form appears.
2. Navigate with up/down, press Enter on title, type text, press Enter.
3. Navigate to status, press Enter, see dropdown, select one.
4. Press Esc to save and go back to list.
5. See the new issue in the list.
6. Press Enter to open it, modify fields, Esc to save.

**Step 3: Commit**

```bash
git add src/components/IssueForm.tsx
git commit -m "feat: issue form with create and edit"
```

---

### Task 9: Polish and Wire Everything Together

**Files:**
- Modify: `src/app.tsx` (ensure all components imported)
- Modify: `src/index.tsx` (add shebang, bin link)

**Step 1: Ensure clean compilation**

Run: `npx tsc`
Expected: No errors.

**Step 2: Full manual test cycle**

Run: `node dist/index.js`

1. Starts on empty list for "default" iteration.
2. `c` — create issue, fill title, set status/priority/iteration, Esc to save.
3. See issue in list.
4. `s` — cycles status.
5. `Enter` — opens form, edit fields, Esc to save.
6. `i` — switch iteration.
7. `d` — delete with y/n confirmation.
8. `q` — quit.

**Step 3: Link binary for local testing**

Run: `npm link`
Now `tic` command should work globally.

**Step 4: Commit**

```bash
git add -A
git commit -m "feat: wire up TUI, polish and link binary"
```

---

### Task 10: Add .tic to .gitignore of target projects

**Files:**
- Modify: `.gitignore`

**Step 1: Note in README that `.tic/` should be gitignored**

This is a documentation-only step. The `.tic/` folder in target repos should be gitignored since it's local state. However for the tic project itself, we should gitignore `dist/` and `node_modules/` only.

**Step 2: Commit if there are any remaining changes**

```bash
git add .gitignore
git commit -m "chore: update gitignore"
```
