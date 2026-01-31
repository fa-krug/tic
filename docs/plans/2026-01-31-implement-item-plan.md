# Implement Item — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a `b` keybinding to the TUI that creates a git branch/worktree for a work item, copies item details to clipboard, and spawns a child shell.

**Architecture:** New `src/git.ts` module for git operations, new `src/implement.ts` for orchestration and clipboard formatting. The `WorkItemList` component gets a `b` keybinding. Config gets a `branchMode` field.

**Tech Stack:** Node.js `child_process.execFileSync`/`spawnSync`, `node:fs`, `node:path`. No new dependencies.

---

### Task 1: Add `branchMode` to config

**Files:**
- Modify: `src/backends/local/config.ts:5-12` (Config interface)
- Modify: `src/backends/local/config.ts:14-21` (defaultConfig)
- Test: `src/backends/local/config.test.ts`

**Step 1: Write the failing tests**

Add to `src/backends/local/config.test.ts`:

```typescript
it('returns default config with branchMode', () => {
  const config = readConfig(tmpDir);
  expect(config.branchMode).toBe('worktree');
});

it('reads config with branchMode set to branch', () => {
  const ticDir = path.join(tmpDir, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticDir, 'config.yml'),
    'branchMode: branch\nstatuses:\n  - open\ncurrent_iteration: v1\niterations:\n  - v1\nnext_id: 1\n',
  );
  const config = readConfig(tmpDir);
  expect(config.branchMode).toBe('branch');
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — `branchMode` not in Config interface

**Step 3: Add `branchMode` to Config and defaultConfig**

In `src/backends/local/config.ts`, add `branchMode` field to the `Config` interface:

```typescript
export interface Config {
  backend: string;
  types: string[];
  statuses: string[];
  current_iteration: string;
  iterations: string[];
  next_id: number;
  branchMode: 'worktree' | 'branch';
}
```

And to `defaultConfig`:

```typescript
export const defaultConfig: Config = {
  backend: 'local',
  types: ['epic', 'issue', 'task'],
  statuses: ['backlog', 'todo', 'in-progress', 'review', 'done'],
  current_iteration: 'default',
  iterations: ['default'],
  next_id: 1,
  branchMode: 'worktree',
};
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat: add branchMode config field (worktree | branch)"
```

---

### Task 2: Create `src/git.ts` — slugify and isGitRepo

**Files:**
- Create: `src/git.ts`
- Create: `src/git.test.ts`

**Step 1: Write the failing tests**

Create `src/git.test.ts`:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { slugify, isGitRepo } from './git.js';

describe('slugify', () => {
  it('converts title to lowercase kebab-case with id prefix', () => {
    expect(slugify(42, 'Add user authentication')).toBe(
      '42-add-user-authentication',
    );
  });

  it('strips special characters', () => {
    expect(slugify(7, "Fix bug: can't login (v2)")).toBe(
      '7-fix-bug-cant-login-v2',
    );
  });

  it('collapses multiple hyphens', () => {
    expect(slugify(1, 'foo - bar -- baz')).toBe('1-foo-bar-baz');
  });

  it('trims trailing hyphens', () => {
    expect(slugify(3, 'trailing!')).toBe('3-trailing');
  });

  it('truncates very long titles', () => {
    const longTitle = 'a'.repeat(200);
    const result = slugify(1, longTitle);
    expect(result.length).toBeLessThanOrEqual(80);
  });
});

describe('isGitRepo', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns false for a non-git directory', () => {
    expect(isGitRepo(tmpDir)).toBe(false);
  });

  it('returns true when .git exists', () => {
    fs.mkdirSync(path.join(tmpDir, '.git'));
    expect(isGitRepo(tmpDir)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/git.test.ts`
Expected: FAIL — module `./git.js` not found

**Step 3: Implement slugify and isGitRepo**

Create `src/git.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';

export function slugify(id: number, title: string): string {
  const slug = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
  const full = `${id}-${slug}`;
  return full.length > 80 ? full.slice(0, 80).replace(/-$/, '') : full;
}

export function isGitRepo(root: string): boolean {
  return fs.existsSync(path.join(root, '.git'));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/git.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/git.ts src/git.test.ts
git commit -m "feat: add slugify and isGitRepo git utilities"
```

---

### Task 3: Add git branch and worktree operations to `src/git.ts`

**Files:**
- Modify: `src/git.ts`
- Modify: `src/git.test.ts`

These tests need a real git repo. We'll create one in a temp dir during setup.

**Step 1: Write the failing tests**

Add to `src/git.test.ts`:

```typescript
import {
  slugify,
  isGitRepo,
  branchExists,
  createWorktree,
  worktreeExists,
  hasUncommittedChanges,
  checkoutBranch,
  createBranch,
} from './git.js';
import { execFileSync } from 'node:child_process';

describe('git operations', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-git-test-'));
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tmpDir,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'init');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('detects existing branch', () => {
    expect(branchExists('main', tmpDir)).toBe(false);
    execFileSync('git', ['branch', 'test-branch'], { cwd: tmpDir });
    expect(branchExists('test-branch', tmpDir)).toBe(true);
  });

  it('creates a new branch', () => {
    createBranch('new-branch', tmpDir);
    expect(branchExists('new-branch', tmpDir)).toBe(true);
  });

  it('checks out a branch', () => {
    createBranch('feature', tmpDir);
    checkoutBranch('feature', tmpDir);
    const current = execFileSync('git', ['branch', '--show-current'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();
    expect(current).toBe('feature');
  });

  it('detects uncommitted changes', () => {
    expect(hasUncommittedChanges(tmpDir)).toBe(false);
    fs.writeFileSync(path.join(tmpDir, 'dirty.txt'), 'dirty');
    expect(hasUncommittedChanges(tmpDir)).toBe(true);
  });

  it('creates a worktree with new branch', () => {
    const wtPath = path.join(tmpDir, '.worktrees', 'test-wt');
    createWorktree(wtPath, 'tic/test-wt', tmpDir);
    expect(worktreeExists(wtPath)).toBe(true);
    expect(branchExists('tic/test-wt', tmpDir)).toBe(true);
  });

  it('detects existing worktree', () => {
    const wtPath = path.join(tmpDir, '.worktrees', 'test-wt');
    expect(worktreeExists(wtPath)).toBe(false);
    createWorktree(wtPath, 'tic/test-wt', tmpDir);
    expect(worktreeExists(wtPath)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/git.test.ts`
Expected: FAIL — functions not exported

**Step 3: Implement git operations**

Add to `src/git.ts`:

```typescript
import { execFileSync } from 'node:child_process';

export function branchExists(name: string, cwd: string): boolean {
  try {
    execFileSync('git', ['rev-parse', '--verify', name], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

export function createBranch(name: string, cwd: string): void {
  execFileSync('git', ['branch', name], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
}

export function checkoutBranch(name: string, cwd: string): void {
  execFileSync('git', ['checkout', name], {
    cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}

export function hasUncommittedChanges(cwd: string): boolean {
  const result = execFileSync('git', ['status', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return result.trim().length > 0;
}

export function createWorktree(
  worktreePath: string,
  branch: string,
  cwd: string,
): void {
  if (branchExists(branch, cwd)) {
    execFileSync('git', ['worktree', 'add', worktreePath, branch], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  } else {
    execFileSync('git', ['worktree', 'add', worktreePath, '-b', branch], {
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
  }
}

export function worktreeExists(worktreePath: string): boolean {
  return fs.existsSync(path.join(worktreePath, '.git'));
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/git.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/git.ts src/git.test.ts
git commit -m "feat: add git branch and worktree operations"
```

---

### Task 4: Create `src/implement.ts` — formatItemForClipboard

**Files:**
- Create: `src/implement.ts`
- Create: `src/implement.test.ts`

**Step 1: Write the failing tests**

Create `src/implement.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { formatItemForClipboard } from './implement.js';
import type { WorkItem, Comment } from './types.js';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: 42,
    title: 'Add user authentication',
    type: 'feature',
    status: 'in-progress',
    iteration: 'v1',
    priority: 'high',
    assignee: 'skrug',
    labels: ['backend', 'security'],
    created: '2026-01-30T10:00:00Z',
    updated: '2026-01-30T12:00:00Z',
    description: 'Users should be able to log in.',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('formatItemForClipboard', () => {
  it('formats a full item with all fields', () => {
    const item = makeItem({
      parent: 10,
      dependsOn: [38, 41],
    });
    const comments: Comment[] = [
      { author: 'skrug', date: '2026-01-30', body: 'Use bcrypt.' },
    ];
    const result = formatItemForClipboard(item, comments);
    expect(result).toContain('# #42: Add user authentication');
    expect(result).toContain('**Type:** feature');
    expect(result).toContain('**Status:** in-progress');
    expect(result).toContain('**Assignee:** skrug');
    expect(result).toContain('**Labels:** backend, security');
    expect(result).toContain('**Parent:** #10');
    expect(result).toContain('**Depends on:** #38, #41');
    expect(result).toContain('## Description');
    expect(result).toContain('Users should be able to log in.');
    expect(result).toContain('## Comments');
    expect(result).toContain('**skrug** (2026-01-30):');
    expect(result).toContain('Use bcrypt.');
  });

  it('omits empty fields', () => {
    const item = makeItem({
      assignee: '',
      labels: [],
      parent: null,
      dependsOn: [],
      description: '',
    });
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('Assignee');
    expect(result).not.toContain('Labels');
    expect(result).not.toContain('Parent');
    expect(result).not.toContain('Depends on');
    expect(result).not.toContain('## Description');
    expect(result).not.toContain('## Comments');
  });

  it('omits comments section when no comments', () => {
    const item = makeItem();
    const result = formatItemForClipboard(item, []);
    expect(result).not.toContain('## Comments');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/implement.test.ts`
Expected: FAIL — module `./implement.js` not found

**Step 3: Implement formatItemForClipboard**

Create `src/implement.ts`:

```typescript
import type { WorkItem, Comment } from './types.js';

export function formatItemForClipboard(
  item: WorkItem,
  comments: Comment[],
): string {
  const lines: string[] = [];

  lines.push(`# #${item.id}: ${item.title}`);
  lines.push('');

  lines.push(`- **Type:** ${item.type}`);
  lines.push(`- **Status:** ${item.status}`);
  if (item.priority) lines.push(`- **Priority:** ${item.priority}`);
  if (item.assignee) lines.push(`- **Assignee:** ${item.assignee}`);
  if (item.labels.length > 0)
    lines.push(`- **Labels:** ${item.labels.join(', ')}`);
  if (item.parent !== null) lines.push(`- **Parent:** #${item.parent}`);
  if (item.dependsOn.length > 0)
    lines.push(
      `- **Depends on:** ${item.dependsOn.map((d) => `#${d}`).join(', ')}`,
    );

  if (item.description) {
    lines.push('');
    lines.push('## Description');
    lines.push('');
    lines.push(item.description);
  }

  if (comments.length > 0) {
    lines.push('');
    lines.push('## Comments');
    for (const c of comments) {
      lines.push('');
      lines.push(`**${c.author}** (${c.date}):`);
      lines.push(c.body);
    }
  }

  return lines.join('\n') + '\n';
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/implement.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/implement.ts src/implement.test.ts
git commit -m "feat: add formatItemForClipboard for clipboard content"
```

---

### Task 5: Add clipboard and shell spawn to `src/implement.ts` — beginImplementation

**Files:**
- Modify: `src/implement.ts`
- Modify: `src/implement.test.ts`

**Step 1: Write the failing tests**

Note: `beginImplementation` calls `spawnSync` and clipboard commands — we test the branch/worktree setup parts using real git repos in temp dirs. The shell spawn itself is hard to unit test (it's interactive), so we test the git side effects.

Add to `src/implement.test.ts`:

```typescript
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { beginImplementation } from './implement.js';
import { branchExists, worktreeExists } from './git.js';

describe('beginImplementation', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-impl-test-'));
    execFileSync('git', ['init'], { cwd: tmpDir });
    execFileSync('git', ['config', 'user.email', 'test@test.com'], {
      cwd: tmpDir,
    });
    execFileSync('git', ['config', 'user.name', 'Test'], { cwd: tmpDir });
    fs.writeFileSync(path.join(tmpDir, 'README.md'), 'init');
    execFileSync('git', ['add', '.'], { cwd: tmpDir });
    execFileSync('git', ['commit', '-m', 'init'], { cwd: tmpDir });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates worktree and branch in worktree mode', () => {
    const item = makeItem({ id: 5, title: 'My feature' });
    const result = beginImplementation(item, [], { branchMode: 'worktree' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    expect(result.resumed).toBe(false);
    expect(branchExists('tic/5-my-feature', tmpDir)).toBe(true);
    expect(
      worktreeExists(path.join(tmpDir, '.worktrees', '5-my-feature')),
    ).toBe(true);
  });

  it('creates and checks out branch in branch mode', () => {
    const item = makeItem({ id: 3, title: 'Bug fix' });
    const result = beginImplementation(item, [], { branchMode: 'branch' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    expect(result.resumed).toBe(false);
    expect(branchExists('tic/3-bug-fix', tmpDir)).toBe(true);
    const current = execFileSync('git', ['branch', '--show-current'], {
      cwd: tmpDir,
      encoding: 'utf-8',
    }).trim();
    expect(current).toBe('tic/3-bug-fix');
  });

  it('resumes when branch already exists in worktree mode', () => {
    const item = makeItem({ id: 5, title: 'My feature' });
    beginImplementation(item, [], { branchMode: 'worktree' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    const result = beginImplementation(item, [], { branchMode: 'worktree' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    expect(result.resumed).toBe(true);
  });

  it('resumes when branch already exists in branch mode', () => {
    const item = makeItem({ id: 3, title: 'Bug fix' });
    beginImplementation(item, [], { branchMode: 'branch' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    // Switch back to original branch to simulate returning to TUI
    execFileSync('git', ['checkout', '-'], { cwd: tmpDir });
    const result = beginImplementation(item, [], { branchMode: 'branch' }, tmpDir, {
      skipShell: true,
      skipClipboard: true,
    });
    expect(result.resumed).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/implement.test.ts`
Expected: FAIL — `beginImplementation` not exported

**Step 3: Implement beginImplementation**

Add to `src/implement.ts`:

```typescript
import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import {
  slugify,
  branchExists,
  createBranch,
  checkoutBranch,
  createWorktree,
  worktreeExists,
  hasUncommittedChanges,
} from './git.js';

interface ImplementOptions {
  skipShell?: boolean;
  skipClipboard?: boolean;
}

export function copyToClipboard(text: string): boolean {
  try {
    if (process.platform === 'darwin') {
      execFileSync('pbcopy', { input: text, stdio: ['pipe', 'pipe', 'pipe'] });
      return true;
    }
    // Linux: try xclip first, then xsel
    try {
      execFileSync('xclip', ['-selection', 'clipboard'], {
        input: text,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    } catch {
      execFileSync('xsel', ['--clipboard'], {
        input: text,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      return true;
    }
  } catch {
    return false;
  }
}

export function beginImplementation(
  item: WorkItem,
  comments: Comment[],
  config: { branchMode: 'worktree' | 'branch' },
  repoRoot: string,
  options: ImplementOptions = {},
): { resumed: boolean; targetDir: string; clipboardOk: boolean } {
  const slug = slugify(item.id, item.title);
  const branchName = `tic/${slug}`;
  const resumed = branchExists(branchName, repoRoot);
  let targetDir: string;

  if (config.branchMode === 'worktree') {
    const wtPath = path.join(repoRoot, '.worktrees', slug);
    if (!resumed) {
      createWorktree(wtPath, branchName, repoRoot);
    }
    targetDir = wtPath;
  } else {
    if (!resumed && hasUncommittedChanges(repoRoot)) {
      throw new Error(
        'Cannot switch branches — uncommitted changes. Commit or stash first.',
      );
    }
    if (!resumed) {
      createBranch(branchName, repoRoot);
    }
    checkoutBranch(branchName, repoRoot);
    targetDir = repoRoot;
  }

  // Copy to clipboard
  let clipboardOk = false;
  if (!options.skipClipboard) {
    const content = formatItemForClipboard(item, comments);
    clipboardOk = copyToClipboard(content);
  }

  // Spawn shell
  if (!options.skipShell) {
    const shell = process.env['SHELL'] || '/bin/sh';
    spawnSync(shell, {
      cwd: targetDir,
      stdio: 'inherit',
      env: {
        ...process.env,
        TIC_ITEM_ID: String(item.id),
        TIC_ITEM_TITLE: item.title,
      },
    });
  }

  return { resumed, targetDir, clipboardOk };
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/implement.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/implement.ts src/implement.test.ts
git commit -m "feat: add beginImplementation with branch/worktree/shell/clipboard"
```

---

### Task 6: Wire `b` keybinding into WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx:81-196` (useInput handler)
- Modify: `src/components/WorkItemList.tsx:202-213` (helpParts)

**Step 1: Add the keybinding**

In `src/components/WorkItemList.tsx`, add imports at the top:

```typescript
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { readConfig } from '../backends/local/config.js';
```

Add state for git availability and warning. After the existing `useMemo` calls (around line 56), add:

```typescript
const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);
```

Inside the `useInput` callback, after the `if (input === 'o' ...)` block (after line 131), add:

```typescript
if (input === 'b' && gitAvailable && treeItems.length > 0) {
  const item = treeItems[cursor]!.item;
  const comments = item.comments;
  const config = readConfig(process.cwd());
  try {
    const result = beginImplementation(
      item,
      comments,
      { branchMode: config.branchMode },
      process.cwd(),
    );
    setWarning(
      result.resumed
        ? `Resumed work on #${item.id}`
        : `Started work on #${item.id}`,
    );
  } catch (e) {
    setWarning(e instanceof Error ? e.message : 'Failed to start implementation');
  }
  setRefresh((r) => r + 1);
}
```

In the `helpParts` array (around line 202), add before the settings/quit entries:

```typescript
if (gitAvailable) helpParts.push('b: branch');
```

**Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS (no existing tests break)

**Step 3: Manual test**

Run: `npm run build && npm start`
Verify: `b` hint shows in footer. Press `b` on an item — should create worktree, copy to clipboard, spawn shell. Type `exit` to return.

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: wire b keybinding for begin implementation in TUI"
```

---

### Task 7: Add `.worktrees/` to `.gitignore`

**Files:**
- Modify: `.gitignore`

**Step 1: Add `.worktrees/` to `.gitignore`**

Append to `.gitignore`:

```
.worktrees/
```

**Step 2: Commit**

```bash
git add .gitignore
git commit -m "chore: ignore .worktrees/ directory"
```

---

### Task 8: Run full test suite and lint

**Step 1: Run all checks**

```bash
npm test && npm run lint && npm run format:check && npx tsc --noEmit
```

Expected: All pass with no errors.

**Step 2: Fix any issues found**

Address any type errors, lint warnings, or test failures.

**Step 3: Final commit if needed**

```bash
git add -A
git commit -m "fix: address lint/type issues from implement-item feature"
```
