# Branch Management Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a full branch lifecycle management screen (list, create, switch, merge, delete, push) accessible via `B` from the work item list, with CLI and MCP support.

**Architecture:** New `BranchList` screen component following the `PullRequestList` pattern. Git operations in `src/git.ts` (sync functions) + `src/git-async.ts` (async functions for fetch/push/merge). Branch-to-item linking resolved at render time by matching `tic/{id}-*` branch names against store items. Two-phase loading: instant local data, then background `git fetch` with status in Header.

**Tech Stack:** TypeScript, React 19 + Ink 6, execFileSync/execFile from node:child_process, Commander CLI, Zod MCP schemas.

---

### Task 1: Add `listBranches()` and `listWorktrees()` to `src/git.ts`

**Files:**
- Modify: `src/git.ts`
- Create: `src/git.test.ts`

**Step 1: Write the failing tests**

In `src/git.test.ts`, create tests for `listBranches()` and `listWorktrees()`. Each test should create a temp git repo, make some commits/branches, and verify the returned data structures.

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import {
  listBranches,
  listWorktrees,
  type BranchInfo,
  type WorktreeInfo,
} from './git.js';

function initRepo(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'pipe',
  });
  writeFileSync(join(dir, 'file.txt'), 'hello');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
}

describe('listBranches', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-test-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists branches with current branch marked', () => {
    execFileSync('git', ['branch', 'feature-1'], { cwd: dir, stdio: 'pipe' });
    const branches = listBranches(dir);
    expect(branches.length).toBe(2);

    const current = branches.find((b) => b.current);
    expect(current).toBeDefined();
    expect(current!.name).toMatch(/main|master/);

    const feature = branches.find((b) => b.name === 'feature-1');
    expect(feature).toBeDefined();
    expect(feature!.current).toBe(false);
  });

  it('returns empty upstream for local-only branches', () => {
    const branches = listBranches(dir);
    expect(branches[0]!.upstream).toBeNull();
    expect(branches[0]!.ahead).toBe(0);
    expect(branches[0]!.behind).toBe(0);
  });

  it('includes last commit info', () => {
    const branches = listBranches(dir);
    expect(branches[0]!.lastCommitDate).toBeTruthy();
  });
});

describe('listWorktrees', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-test-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('lists the main worktree', () => {
    const worktrees = listWorktrees(dir);
    expect(worktrees.length).toBe(1);
    expect(worktrees[0]!.branch).toMatch(/main|master/);
  });

  it('lists additional worktrees', () => {
    execFileSync('git', ['branch', 'wt-branch'], { cwd: dir, stdio: 'pipe' });
    const wtPath = join(dir, '.worktrees', 'wt-branch');
    execFileSync('git', ['worktree', 'add', wtPath, 'wt-branch'], {
      cwd: dir,
      stdio: 'pipe',
    });
    const worktrees = listWorktrees(dir);
    expect(worktrees.length).toBe(2);
    const added = worktrees.find((w) => w.branch === 'wt-branch');
    expect(added).toBeDefined();
    expect(added!.path).toBe(wtPath);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/git.test.ts`
Expected: FAIL — `listBranches` and `listWorktrees` not exported.

**Step 3: Implement `listBranches()` and `listWorktrees()`**

Add to `src/git.ts` after existing exports:

```typescript
export interface BranchInfo {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitDate: string; // ISO date string
}

export interface WorktreeInfo {
  path: string;
  branch: string | null;
  head: string;
  bare: boolean;
}

export function listBranches(cwd: string): BranchInfo[] {
  const format =
    '%(HEAD)%00%(refname:short)%00%(upstream:short)%00%(upstream:track)%00%(committerdate:iso-strict)';
  const output = execFileSync(
    'git',
    ['for-each-ref', '--format', format, 'refs/heads/'],
    { cwd, encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] },
  );

  return output
    .trim()
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [head, name, upstream, track, date] = line.split('\0');
      const aheadMatch = track?.match(/ahead (\d+)/);
      const behindMatch = track?.match(/behind (\d+)/);
      return {
        name: name!,
        current: head === '*',
        upstream: upstream || null,
        ahead: aheadMatch ? parseInt(aheadMatch[1]!, 10) : 0,
        behind: behindMatch ? parseInt(behindMatch[1]!, 10) : 0,
        lastCommitDate: date ?? '',
      };
    });
}

export function listWorktrees(cwd: string): WorktreeInfo[] {
  const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  const worktrees: WorktreeInfo[] = [];
  let current: Partial<WorktreeInfo> = {};

  for (const line of output.split('\n')) {
    if (line.startsWith('worktree ')) {
      current.path = line.slice('worktree '.length);
    } else if (line.startsWith('HEAD ')) {
      current.head = line.slice('HEAD '.length);
    } else if (line.startsWith('branch ')) {
      const ref = line.slice('branch '.length);
      current.branch = ref.replace('refs/heads/', '');
    } else if (line === 'bare') {
      current.bare = true;
    } else if (line === 'detached') {
      current.branch = null;
    } else if (line === '') {
      if (current.path) {
        worktrees.push({
          path: current.path,
          branch: current.branch ?? null,
          head: current.head ?? '',
          bare: current.bare ?? false,
        });
      }
      current = {};
    }
  }
  return worktrees;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/git.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/git.ts src/git.test.ts
git commit -m "feat: add listBranches and listWorktrees to git utilities"
```

---

### Task 2: Add async git operations — `src/git-async.ts`

**Files:**
- Create: `src/git-async.ts`
- Create: `src/git-async.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import os from 'node:os';
import {
  deleteBranch,
  mergeBranch,
  removeWorktree,
  fetchAll,
  pushBranch,
} from './git-async.js';

function initRepo(dir: string) {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], {
    cwd: dir,
    stdio: 'pipe',
  });
  execFileSync('git', ['config', 'user.name', 'Test'], {
    cwd: dir,
    stdio: 'pipe',
  });
  writeFileSync(join(dir, 'file.txt'), 'hello');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
}

describe('deleteBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('deletes a merged branch', async () => {
    execFileSync('git', ['branch', 'to-delete'], { cwd: dir, stdio: 'pipe' });
    await deleteBranch('to-delete', dir);
    const output = execFileSync('git', ['branch', '--list', 'to-delete'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output.trim()).toBe('');
  });

  it('throws when deleting unmerged branch without force', async () => {
    execFileSync('git', ['checkout', '-b', 'unmerged'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'unmerged work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });
    await expect(deleteBranch('unmerged', dir)).rejects.toThrow();
  });

  it('force-deletes unmerged branch', async () => {
    execFileSync('git', ['checkout', '-b', 'unmerged'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'new.txt'), 'new');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'unmerged work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });
    await deleteBranch('unmerged', dir, true);
    const output = execFileSync('git', ['branch', '--list', 'unmerged'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output.trim()).toBe('');
  });
});

describe('mergeBranch', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('merges a branch into current', async () => {
    execFileSync('git', ['checkout', '-b', 'feature'], {
      cwd: dir,
      stdio: 'pipe',
    });
    writeFileSync(join(dir, 'feature.txt'), 'feature');
    execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
    execFileSync('git', ['commit', '-m', 'feature work'], {
      cwd: dir,
      stdio: 'pipe',
    });
    execFileSync('git', ['checkout', '-'], { cwd: dir, stdio: 'pipe' });

    const result = await mergeBranch('feature', dir);
    expect(result.success).toBe(true);
  });
});

describe('removeWorktree', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(os.tmpdir(), 'tic-git-async-'));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('removes a worktree', async () => {
    execFileSync('git', ['branch', 'wt-branch'], { cwd: dir, stdio: 'pipe' });
    const wtPath = join(dir, '.worktrees', 'wt-branch');
    execFileSync('git', ['worktree', 'add', wtPath, 'wt-branch'], {
      cwd: dir,
      stdio: 'pipe',
    });
    await removeWorktree(wtPath, dir);
    const output = execFileSync('git', ['worktree', 'list', '--porcelain'], {
      cwd: dir,
      encoding: 'utf-8',
      stdio: 'pipe',
    });
    expect(output).not.toContain('wt-branch');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/git-async.test.ts`
Expected: FAIL — module not found.

**Step 3: Implement async git operations**

Create `src/git-async.ts`:

```typescript
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export interface MergeResult {
  success: boolean;
  message: string;
  hasConflicts: boolean;
}

export async function deleteBranch(
  name: string,
  cwd: string,
  force = false,
): Promise<void> {
  await execFileAsync('git', ['branch', force ? '-D' : '-d', name], { cwd });
}

export async function mergeBranch(
  name: string,
  cwd: string,
): Promise<MergeResult> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['merge', '--no-edit', name],
      { cwd },
    );
    return { success: true, message: stdout.trim(), hasConflicts: false };
  } catch (err: unknown) {
    const message =
      err instanceof Error ? err.message : String(err);
    const hasConflicts = message.includes('CONFLICT') || message.includes('Merge conflict');
    if (hasConflicts) {
      // Abort the merge so we leave things clean
      try {
        await execFileAsync('git', ['merge', '--abort'], { cwd });
      } catch {
        // ignore abort failures
      }
    }
    return { success: false, message, hasConflicts };
  }
}

export async function removeWorktree(
  worktreePath: string,
  cwd: string,
  force = false,
): Promise<void> {
  const args = ['worktree', 'remove'];
  if (force) args.push('--force');
  args.push(worktreePath);
  await execFileAsync('git', args, { cwd });
}

export async function fetchAll(cwd: string): Promise<void> {
  await execFileAsync('git', ['fetch', '--all', '--prune'], { cwd });
}

export async function pushBranch(
  name: string,
  cwd: string,
): Promise<void> {
  await execFileAsync('git', ['push', '-u', 'origin', name], { cwd });
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/git-async.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/git-async.ts src/git-async.test.ts
git commit -m "feat: add async git operations (delete, merge, remove worktree, fetch, push)"
```

---

### Task 3: Add branch-to-item linking helper

**Files:**
- Create: `src/branch-links.ts`
- Create: `src/branch-links.test.ts`

**Step 1: Write the failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { linkBranchToItem } from './branch-links.js';
import type { WorkItem } from './types.js';

describe('linkBranchToItem', () => {
  const items: WorkItem[] = [
    {
      id: '42',
      title: 'Add login page',
      status: 'open',
      description: '',
      createdAt: '',
      updatedAt: '',
      parent: null,
      dependsOn: [],
      labels: [],
    } as WorkItem,
    {
      id: '100',
      title: 'Fix bug',
      status: 'open',
      description: '',
      createdAt: '',
      updatedAt: '',
      parent: null,
      dependsOn: [],
      labels: [],
    } as WorkItem,
  ];

  it('matches tic/{id}-{slug} pattern', () => {
    const result = linkBranchToItem('tic/42-add-login-page', items);
    expect(result).toEqual(items[0]);
  });

  it('returns null for non-tic branches', () => {
    const result = linkBranchToItem('feature/something', items);
    expect(result).toBeNull();
  });

  it('returns null when item ID not found', () => {
    const result = linkBranchToItem('tic/999-unknown', items);
    expect(result).toBeNull();
  });

  it('handles tic/{id} without slug', () => {
    const result = linkBranchToItem('tic/42', items);
    expect(result).toEqual(items[0]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/branch-links.test.ts`
Expected: FAIL

**Step 3: Implement the helper**

Create `src/branch-links.ts`:

```typescript
import type { WorkItem } from './types.js';

/**
 * Match a branch name to a work item by extracting the ID from
 * the `tic/{id}-{slug}` or `tic/{id}` naming convention.
 * Returns the matching WorkItem or null.
 */
export function linkBranchToItem(
  branchName: string,
  items: WorkItem[],
): WorkItem | null {
  const match = branchName.match(/^tic\/([^-/]+)/);
  if (!match) return null;
  const id = match[1]!;
  return items.find((item) => item.id === id) ?? null;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/branch-links.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/branch-links.ts src/branch-links.test.ts
git commit -m "feat: add branch-to-item linking helper"
```

---

### Task 4: Add `'branch-list'` screen to navigation store and app routing

**Files:**
- Modify: `src/stores/navigationStore.ts:8-15` (Screen type)
- Modify: `src/app.tsx:39-43` (lazy import), `src/app.tsx:82` (render)

**Step 1: Add `'branch-list'` to the Screen type**

In `src/stores/navigationStore.ts`, add `'branch-list'` to the Screen union (after `'pr-list'` on line 12):

```typescript
export type Screen =
  | 'list'
  | 'form'
  | 'iteration-picker'
  | 'pr-list'
  | 'branch-list'
  | 'settings'
  | 'status'
  | 'help';
```

**Step 2: Add lazy import in `src/app.tsx`**

After the PullRequestList lazy import (line 43), add:

```typescript
const BranchList = lazy(() =>
  import('./components/BranchList.js').then((m) => ({
    default: m.BranchList,
  })),
);
```

**Step 3: Add screen render in `src/app.tsx`**

After line 82 (`{screen === 'pr-list' && <PullRequestList />}`), add:

```typescript
{screen === 'branch-list' && <BranchList />}
```

**Step 4: Verify build compiles (will fail until BranchList component exists — that's OK, commit anyway)**

This task is a wiring step. The component will be created in Task 5.

**Step 5: Commit**

```bash
git add src/stores/navigationStore.ts src/app.tsx
git commit -m "feat: add branch-list screen type and app routing"
```

---

### Task 5: Create the `BranchList` component

**Files:**
- Create: `src/components/BranchList.tsx`

This is the core UI component. It follows the `PullRequestList` pattern from `src/components/PullRequestList.tsx`.

**Step 1: Create `src/components/BranchList.tsx`**

```typescript
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import Spinner from 'ink-spinner';
import { useThemeStore } from '../stores/themeStore.js';
import { useNavigationStore } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import {
  listBranches,
  listWorktrees,
  getCurrentBranch,
  checkoutBranch,
  hasUncommittedChanges,
  createBranch,
  type BranchInfo,
  type WorktreeInfo,
} from '../git.js';
import {
  deleteBranch,
  mergeBranch,
  removeWorktree,
  fetchAll,
  pushBranch,
} from '../git-async.js';
import { linkBranchToItem } from '../branch-links.js';
import { uiStore } from '../stores/uiStore.js';

interface BranchRow {
  branch: BranchInfo;
  linkedItem: { id: string; title: string } | null;
  worktree: WorktreeInfo | null;
}

type Confirmation =
  | { type: 'delete'; branch: string; worktreePath: string | null; unmerged: boolean }
  | { type: 'merge'; branch: string; into: string }
  | { type: 'force-delete'; branch: string; worktreePath: string | null }
  | null;

type InputMode = 'normal' | 'new-branch' | 'search';

export function BranchList() {
  const { accent, muted, mutedDim, warning, error } = useThemeStore(
    (s) => s.colors,
  );
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const items = useBackendDataStore((s) => s.items);
  const cwd = process.cwd();

  const [rows, setRows] = useState<BranchRow[]>([]);
  const [cursor, setCursor] = useState(0);
  const [fetching, setFetching] = useState(false);
  const [confirmation, setConfirmation] = useState<Confirmation>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const [inputMode, setInputMode] = useState<InputMode>('normal');
  const [inputValue, setInputValue] = useState('');
  const [filterText, setFilterText] = useState('');

  const loadBranches = useCallback(() => {
    const branches = listBranches(cwd);
    const worktrees = listWorktrees(cwd);

    const branchRows: BranchRow[] = branches.map((b) => {
      const linked = linkBranchToItem(b.name, items);
      const wt = worktrees.find((w) => w.branch === b.name) ?? null;
      return {
        branch: b,
        linkedItem: linked ? { id: linked.id, title: linked.title } : null,
        worktree: wt,
      };
    });

    // Sort: current branch first, then tic/ branches, then alphabetical
    branchRows.sort((a, b) => {
      if (a.branch.current !== b.branch.current)
        return a.branch.current ? -1 : 1;
      const aIsTic = a.branch.name.startsWith('tic/');
      const bIsTic = b.branch.name.startsWith('tic/');
      if (aIsTic !== bIsTic) return aIsTic ? -1 : 1;
      return a.branch.name.localeCompare(b.branch.name);
    });

    setRows(branchRows);
  }, [cwd, items]);

  // Initial load + background fetch
  useEffect(() => {
    loadBranches();
    setFetching(true);
    fetchAll(cwd)
      .then(() => {
        loadBranches(); // reload with updated remote info
      })
      .catch(() => {
        // fetch failed (no remote, offline, etc) — ignore
      })
      .finally(() => {
        setFetching(false);
      });
  }, [cwd, loadBranches]);

  // Filtered rows
  const filteredRows = useMemo(() => {
    if (!filterText) return rows;
    const lower = filterText.toLowerCase();
    return rows.filter(
      (r) =>
        r.branch.name.toLowerCase().includes(lower) ||
        r.linkedItem?.title.toLowerCase().includes(lower),
    );
  }, [rows, filterText]);

  // Clamp cursor
  const clampedCursor = Math.max(
    0,
    Math.min(cursor, filteredRows.length - 1),
  );
  if (clampedCursor !== cursor && filteredRows.length > 0) {
    setCursor(clampedCursor);
  }

  // Auto-clear toast
  useEffect(() => {
    if (!toastMessage) return;
    const timer = setTimeout(() => setToastMessage(null), 3000);
    return () => clearTimeout(timer);
  }, [toastMessage]);

  const showToast = (msg: string) => setToastMessage(msg);

  const currentRow = filteredRows[clampedCursor];

  useInput((input, key) => {
    // --- Confirmation mode ---
    if (confirmation) {
      if (input === 'y' || input === 'Y') {
        const conf = confirmation;
        setConfirmation(null);
        void (async () => {
          try {
            if (conf.type === 'delete' || conf.type === 'force-delete') {
              const force = conf.type === 'force-delete';
              if (conf.worktreePath) {
                await removeWorktree(conf.worktreePath, cwd, true);
              }
              await deleteBranch(conf.branch, cwd, force);
              showToast(`Deleted ${conf.branch}`);
              loadBranches();
            } else if (conf.type === 'merge') {
              const result = await mergeBranch(conf.branch, cwd);
              if (result.success) {
                showToast(`Merged ${conf.branch} into ${conf.into}`);
                // Offer to delete merged branch
                const wt =
                  rows.find((r) => r.branch.name === conf.branch)?.worktree ??
                  null;
                setConfirmation({
                  type: 'delete',
                  branch: conf.branch,
                  worktreePath: wt?.path ?? null,
                  unmerged: false,
                });
              } else if (result.hasConflicts) {
                showToast('Merge conflicts — resolve in terminal');
              } else {
                showToast(`Merge failed: ${result.message}`);
              }
              loadBranches();
            }
          } catch (err: unknown) {
            const msg = err instanceof Error ? err.message : String(err);
            if (
              conf.type === 'delete' &&
              !conf.unmerged &&
              msg.includes('not fully merged')
            ) {
              setConfirmation({
                type: 'force-delete',
                branch: conf.branch,
                worktreePath: conf.worktreePath,
              });
            } else {
              showToast(msg.split('\n')[0] ?? 'Error');
            }
          }
        })();
        return;
      }
      if (input === 'n' || input === 'N' || key.escape) {
        setConfirmation(null);
        return;
      }
      return; // block other input during confirmation
    }

    // --- Input modes (new branch name, search) ---
    if (inputMode !== 'normal') {
      if (key.escape) {
        setInputMode('normal');
        setInputValue('');
        if (inputMode === 'search') setFilterText('');
        return;
      }
      if (key.return) {
        if (inputMode === 'new-branch' && inputValue.trim()) {
          try {
            createBranch(inputValue.trim(), cwd);
            showToast(`Created branch ${inputValue.trim()}`);
            loadBranches();
          } catch (err: unknown) {
            showToast(
              err instanceof Error ? err.message : 'Failed to create branch',
            );
          }
        }
        if (inputMode === 'search') {
          setFilterText(inputValue);
        }
        setInputMode('normal');
        setInputValue('');
        return;
      }
      if (key.backspace || key.delete) {
        setInputValue((v) => v.slice(0, -1));
        if (inputMode === 'search') setFilterText(inputValue.slice(0, -1));
        return;
      }
      if (input && !key.ctrl && !key.meta) {
        setInputValue((v) => v + input);
        if (inputMode === 'search') setFilterText(inputValue + input);
        return;
      }
      return;
    }

    // --- Normal mode ---
    if (key.escape) {
      if (filterText) {
        setFilterText('');
        return;
      }
      navigate('list');
      return;
    }

    if (input === '?') {
      navigateToHelp();
      return;
    }

    // Navigation
    if (input === 'j' || key.downArrow) {
      setCursor((c) => Math.min(c + 1, filteredRows.length - 1));
      return;
    }
    if (input === 'k' || key.upArrow) {
      setCursor((c) => Math.max(c - 1, 0));
      return;
    }

    if (!currentRow) return;

    // Switch to branch
    if (key.return) {
      if (currentRow.branch.current) {
        showToast('Already on this branch');
        return;
      }
      if (hasUncommittedChanges(cwd)) {
        showToast('Uncommitted changes — stash or commit first');
        return;
      }
      try {
        checkoutBranch(currentRow.branch.name, cwd);
        showToast(`Switched to ${currentRow.branch.name}`);
        loadBranches();
      } catch (err: unknown) {
        showToast(err instanceof Error ? err.message : 'Checkout failed');
      }
      return;
    }

    // Open worktree shell
    if (input === 'w') {
      if (!currentRow.worktree) {
        showToast('No worktree for this branch');
        return;
      }
      // Spawn shell in worktree directory
      const { spawnSync } = require('node:child_process');
      const shell = process.env.SHELL ?? '/bin/sh';
      process.stdin.setRawMode?.(false);
      spawnSync(shell, [], {
        cwd: currentRow.worktree.path,
        stdio: 'inherit',
        env: { ...process.env },
      });
      process.stdin.setRawMode?.(true);
      loadBranches();
      return;
    }

    // Delete branch
    if (input === 'd') {
      if (currentRow.branch.current) {
        showToast('Cannot delete current branch');
        return;
      }
      setConfirmation({
        type: 'delete',
        branch: currentRow.branch.name,
        worktreePath: currentRow.worktree?.path ?? null,
        unmerged: false,
      });
      return;
    }

    // Merge branch
    if (input === 'm') {
      if (currentRow.branch.current) {
        showToast('Cannot merge current branch into itself');
        return;
      }
      const currentBranch = getCurrentBranch(cwd) ?? 'current branch';
      setConfirmation({
        type: 'merge',
        branch: currentRow.branch.name,
        into: currentBranch,
      });
      return;
    }

    // Push branch
    if (input === 'P') {
      void (async () => {
        try {
          showToast(`Pushing ${currentRow.branch.name}...`);
          await pushBranch(currentRow.branch.name, cwd);
          showToast(`Pushed ${currentRow.branch.name}`);
          loadBranches();
        } catch (err: unknown) {
          showToast(err instanceof Error ? err.message : 'Push failed');
        }
      })();
      return;
    }

    // Create PR (reuse existing flow)
    if (input === 'p') {
      // Navigate back to list and trigger PR creation for this branch
      // For now, show toast — full integration in Task 7
      showToast('PR creation — use p from list view');
      return;
    }

    // Refresh
    if (input === 'r') {
      setFetching(true);
      fetchAll(cwd)
        .then(() => loadBranches())
        .catch(() => {})
        .finally(() => setFetching(false));
      return;
    }

    // New branch
    if (input === 'n') {
      setInputMode('new-branch');
      setInputValue('');
      return;
    }

    // Search
    if (input === '/') {
      setInputMode('search');
      setInputValue('');
      return;
    }
  });

  // --- Time formatting helper ---
  const relativeTime = (isoDate: string): string => {
    if (!isoDate) return '';
    const diff = Date.now() - new Date(isoDate).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    return `${days}d ago`;
  };

  // --- Render ---
  return (
    <Box flexDirection="column" padding={1}>
      {/* Title */}
      <Box marginBottom={1}>
        <Text bold color={accent}>
          Branches
        </Text>
        <Text color={muted} dimColor={mutedDim}>
          {' '}
          ({filteredRows.length})
        </Text>
        {fetching && (
          <Text color={warning}>
            {' '}
            <Spinner type="dots" /> Fetching...
          </Text>
        )}
        {filterText && (
          <Text color={muted} dimColor={mutedDim}>
            {' '}
            filter: {filterText}
          </Text>
        )}
      </Box>

      {/* Input prompts */}
      {inputMode === 'new-branch' && (
        <Box marginBottom={1}>
          <Text color={accent}>New branch name: </Text>
          <Text>{inputValue}</Text>
          <Text color={muted} dimColor={mutedDim}>
            █
          </Text>
        </Box>
      )}
      {inputMode === 'search' && (
        <Box marginBottom={1}>
          <Text color={accent}>/</Text>
          <Text>{inputValue}</Text>
          <Text color={muted} dimColor={mutedDim}>
            █
          </Text>
        </Box>
      )}

      {/* Confirmation dialog */}
      {confirmation && (
        <Box marginBottom={1}>
          <Text color={warning}>
            {confirmation.type === 'delete' &&
              `Delete branch "${confirmation.branch}"?` +
                (confirmation.worktreePath
                  ? ` This will also remove worktree at ${confirmation.worktreePath}.`
                  : '')}
            {confirmation.type === 'force-delete' &&
              `Branch "${confirmation.branch}" is not fully merged. Force delete?` +
                (confirmation.worktreePath
                  ? ` This will also remove worktree at ${confirmation.worktreePath}.`
                  : '')}
            {confirmation.type === 'merge' &&
              `Merge "${confirmation.branch}" into "${confirmation.into}"?`}
            {' (y/n)'}
          </Text>
        </Box>
      )}

      {filteredRows.length === 0 ? (
        <Box>
          <Text color={muted} dimColor={mutedDim}>
            No branches
          </Text>
        </Box>
      ) : (
        <Box flexDirection="column">
          {/* Header row */}
          <Box>
            <Box width={32}>
              <Text bold color={muted} dimColor={mutedDim}>
                Branch
              </Text>
            </Box>
            <Box width={30}>
              <Text bold color={muted} dimColor={mutedDim}>
                Item
              </Text>
            </Box>
            <Box width={20}>
              <Text bold color={muted} dimColor={mutedDim}>
                Worktree
              </Text>
            </Box>
            <Box width={10}>
              <Text bold color={muted} dimColor={mutedDim}>
                Remote
              </Text>
            </Box>
            <Box width={10}>
              <Text bold color={muted} dimColor={mutedDim}>
                Last Commit
              </Text>
            </Box>
          </Box>

          {/* Data rows */}
          {filteredRows.map((row, index) => {
            const isSelected = index === clampedCursor;
            const isTic = row.branch.name.startsWith('tic/');
            const prefix = row.branch.current ? '* ' : '  ';
            const branchDisplay = prefix + row.branch.name;
            const truncBranch =
              branchDisplay.length > 30
                ? branchDisplay.slice(0, 30) + '…'
                : branchDisplay;

            const itemDisplay = row.linkedItem
              ? `#${row.linkedItem.id} ${row.linkedItem.title}`
              : '';
            const truncItem =
              itemDisplay.length > 28
                ? itemDisplay.slice(0, 28) + '…'
                : itemDisplay;

            const wtDisplay = row.worktree ? '✓' : '';

            let remoteDisplay = '--';
            if (row.branch.upstream) {
              const parts: string[] = [];
              if (row.branch.ahead > 0) parts.push(`↑${row.branch.ahead}`);
              if (row.branch.behind > 0) parts.push(`↓${row.branch.behind}`);
              remoteDisplay = parts.length > 0 ? parts.join(' ') : '✓';
            }

            return (
              <Box key={row.branch.name}>
                <Box width={32}>
                  <Text
                    inverse={isSelected}
                    bold={isSelected || isTic}
                    color={isTic && !isSelected ? accent : undefined}
                  >
                    {truncBranch}
                  </Text>
                </Box>
                <Box width={30}>
                  <Text
                    inverse={isSelected}
                    color={
                      row.linkedItem
                        ? isSelected
                          ? undefined
                          : muted
                        : undefined
                    }
                    dimColor={!row.linkedItem ? mutedDim : undefined}
                  >
                    {truncItem}
                  </Text>
                </Box>
                <Box width={20}>
                  <Text inverse={isSelected}>{wtDisplay}</Text>
                </Box>
                <Box width={10}>
                  <Text inverse={isSelected}>{remoteDisplay}</Text>
                </Box>
                <Box width={10}>
                  <Text
                    inverse={isSelected}
                    color={muted}
                    dimColor={mutedDim}
                  >
                    {relativeTime(row.branch.lastCommitDate)}
                  </Text>
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      {/* Toast */}
      {toastMessage && (
        <Box marginTop={1}>
          <Text color={warning}>{toastMessage}</Text>
        </Box>
      )}

      {/* Footer keybinding hints */}
      <Box marginTop={1}>
        <Text color={muted} dimColor={mutedDim}>
          j/k navigate · Enter switch · d delete · m merge · P push · n new · w
          worktree · r refresh · / search · Esc back · ? help
        </Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Verify build compiles**

Run: `npm run build`
Expected: PASS (may need minor fixes)

**Step 3: Commit**

```bash
git add src/components/BranchList.tsx
git commit -m "feat: add BranchList component with full lifecycle management"
```

---

### Task 6: Add `B` keybinding in WorkItemList and HelpScreen updates

**Files:**
- Modify: `src/components/WorkItemList.tsx` (~line 593, near `P` keybinding)
- Modify: `src/components/HelpScreen.tsx` (lines 20-27, 74, 98-103, 204-214)

**Step 1: Add `B` keybinding in WorkItemList**

In `src/components/WorkItemList.tsx`, after the `P` keybinding block (around line 596), add:

```typescript
if (input === 'B' && gitAvailable) {
  navigate('branch-list');
  return;
}
```

**Step 2: Update HelpScreen**

In `src/components/HelpScreen.tsx`:

1. Add to `SCREEN_LABELS` (after `'pr-list'` on line 24):
```typescript
'branch-list': 'Branches',
```

2. Add to list view actions (after the `P` line at line 74):
```typescript
if (gitAvailable) {
  actions.push({ key: 'B', description: 'Branch management' });
}
```

3. Add branch-list case (after the `'pr-list'` case ending at line 214):
```typescript
case 'branch-list': {
  return [
    {
      label: 'Navigation',
      shortcuts: [
        { key: 'j/k', description: 'Navigate branches' },
        { key: 'esc', description: 'Back to list' },
        { key: '?', description: 'Help' },
      ],
    },
    {
      label: 'Actions',
      shortcuts: [
        { key: 'enter', description: 'Switch to branch' },
        { key: 'n', description: 'New branch' },
        { key: 'd', description: 'Delete branch' },
        { key: 'm', description: 'Merge into current' },
        { key: 'P', description: 'Push to remote' },
        { key: 'w', description: 'Open worktree shell' },
        { key: 'r', description: 'Refresh (re-fetch)' },
        { key: '/', description: 'Search branches' },
      ],
    },
  ];
}
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Run all tests**

Run: `npm test`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/HelpScreen.tsx
git commit -m "feat: add B keybinding for branch management and help screen entries"
```

---

### Task 7: Add `tic branch` CLI commands

**Files:**
- Create: `src/cli/commands/branch.ts`
- Modify: `src/cli/index.ts` (add command group after PR commands)

**Step 1: Create `src/cli/commands/branch.ts`**

```typescript
import {
  listBranches,
  listWorktrees,
  createBranch,
  checkoutBranch,
  getCurrentBranch,
  hasUncommittedChanges,
} from '../../git.js';
import {
  deleteBranch,
  mergeBranch,
  removeWorktree,
  pushBranch,
} from '../../git-async.js';
import { linkBranchToItem } from '../../branch-links.js';
import type { WorkItem } from '../../types.js';

export interface BranchListResult {
  name: string;
  current: boolean;
  upstream: string | null;
  ahead: number;
  behind: number;
  lastCommitDate: string;
  linkedItemId: string | null;
  worktreePath: string | null;
}

export function runBranchList(
  cwd: string,
  items: WorkItem[],
): BranchListResult[] {
  const branches = listBranches(cwd);
  const worktrees = listWorktrees(cwd);

  return branches.map((b) => {
    const linked = linkBranchToItem(b.name, items);
    const wt = worktrees.find((w) => w.branch === b.name);
    return {
      ...b,
      linkedItemId: linked?.id ?? null,
      worktreePath: wt?.path ?? null,
    };
  });
}

export async function runBranchSwitch(
  name: string,
  cwd: string,
): Promise<{ switched: true; branch: string }> {
  if (hasUncommittedChanges(cwd)) {
    throw new Error('Uncommitted changes — stash or commit first');
  }
  checkoutBranch(name, cwd);
  return { switched: true, branch: name };
}

export function runBranchCreate(
  name: string,
  cwd: string,
): { created: true; branch: string } {
  createBranch(name, cwd);
  return { created: true, branch: name };
}

export async function runBranchDelete(
  name: string,
  cwd: string,
  force: boolean,
): Promise<{ deleted: true; branch: string }> {
  const current = getCurrentBranch(cwd);
  if (name === current) {
    throw new Error('Cannot delete current branch');
  }
  // Check for worktree and remove if exists
  const worktrees = listWorktrees(cwd);
  const wt = worktrees.find((w) => w.branch === name);
  if (wt) {
    await removeWorktree(wt.path, cwd, true);
  }
  await deleteBranch(name, cwd, force);
  return { deleted: true, branch: name };
}

export async function runBranchMerge(
  name: string,
  cwd: string,
): Promise<{ merged: boolean; message: string; hasConflicts: boolean }> {
  const result = await mergeBranch(name, cwd);
  if (!result.success) {
    throw new Error(result.message);
  }
  return result;
}

export async function runBranchPush(
  name: string | undefined,
  cwd: string,
): Promise<{ pushed: true; branch: string }> {
  const branch = name ?? getCurrentBranch(cwd);
  if (!branch) {
    throw new Error('Not on a branch (detached HEAD)');
  }
  await pushBranch(branch, cwd);
  return { pushed: true, branch };
}
```

**Step 2: Register commands in `src/cli/index.ts`**

After the PR command group (around line 590), add:

```typescript
// tic branch ...
const branch = program.command('branch').description('Manage git branches');

branch
  .command('list')
  .description('List branches with linked items and worktree status')
  .action(async () => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const backend = await createBackend();
      const items = await backend.listItems();
      const { runBranchList } = await import('./commands/branch.js');
      const branches = runBranchList(process.cwd(), items);
      if (parentOpts.quiet) return;
      if (parentOpts.json) {
        console.log(formatJson(branches));
      } else {
        for (const b of branches) {
          const prefix = b.current ? '* ' : '  ';
          const item = b.linkedItemId ? ` → #${b.linkedItemId}` : '';
          const wt = b.worktreePath ? ' [worktree]' : '';
          console.log(`${prefix}${b.name}${item}${wt}`);
        }
      }
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

branch
  .command('switch')
  .description('Switch to a branch')
  .argument('<name>', 'Branch name')
  .action(async (name: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runBranchSwitch } = await import('./commands/branch.js');
      const result = await runBranchSwitch(name, process.cwd());
      output(result, () => `Switched to ${result.branch}`, parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

branch
  .command('create')
  .description('Create a new branch')
  .argument('<name>', 'Branch name')
  .action(async (name: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runBranchCreate } = await import('./commands/branch.js');
      const result = runBranchCreate(name, process.cwd());
      output(result, () => `Created branch ${result.branch}`, parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

branch
  .command('delete')
  .description('Delete a branch (and its worktree if present)')
  .argument('<name>', 'Branch name')
  .option('--force', 'Force delete even if not fully merged')
  .action(async (name: string, opts: { force?: boolean }) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runBranchDelete } = await import('./commands/branch.js');
      const result = await runBranchDelete(
        name,
        process.cwd(),
        opts.force ?? false,
      );
      output(result, () => `Deleted branch ${result.branch}`, parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

branch
  .command('merge')
  .description('Merge a branch into the current branch')
  .argument('<name>', 'Branch name')
  .action(async (name: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runBranchMerge } = await import('./commands/branch.js');
      const result = await runBranchMerge(name, process.cwd());
      output(result, () => result.message, parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });

branch
  .command('push')
  .description('Push a branch to remote')
  .argument('[name]', 'Branch name (defaults to current)')
  .action(async (name?: string) => {
    const parentOpts = program.opts<GlobalOpts>();
    try {
      const { runBranchPush } = await import('./commands/branch.js');
      const result = await runBranchPush(name, process.cwd());
      output(result, () => `Pushed ${result.branch}`, parentOpts);
    } catch (err) {
      handleError(err, parentOpts.json);
    }
  });
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/commands/branch.ts src/cli/index.ts
git commit -m "feat: add tic branch CLI commands (list, switch, create, delete, merge, push)"
```

---

### Task 8: Add MCP branch tools

**Files:**
- Modify: `src/cli/commands/mcp.ts` (after PR tools block, ~line 911)

**Step 1: Add MCP tool handlers and registrations**

After the PR tools block (line 911), add branch tools. These are always registered (not gated on backend capabilities), but gated on `isGitRepo` at runtime:

```typescript
// Branch tools — available if in a git repo
if (isGitRepo(root)) {
  server.tool(
    'tic-list_branches',
    'List git branches with linked work items and worktree status',
    {},
    async () => {
      const items = await backend.listItems();
      const { runBranchList } = await import('./branch.js');
      const branches = runBranchList(root, items);
      return {
        content: [
          { type: 'text', text: JSON.stringify(branches, null, 2) },
        ],
      };
    },
  );

  server.tool(
    'tic-switch_branch',
    'Switch to a git branch',
    {
      name: z.string().describe('Branch name to switch to'),
    },
    async (args) => {
      const { runBranchSwitch } = await import('./branch.js');
      const result = await runBranchSwitch(args.name, root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'tic-create_branch',
    'Create a new git branch',
    {
      name: z.string().describe('Branch name to create'),
    },
    async (args) => {
      const { runBranchCreate } = await import('./branch.js');
      const result = runBranchCreate(args.name, root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'tic-delete_branch',
    'Delete a git branch and its worktree if present',
    {
      name: z.string().describe('Branch name to delete'),
      force: z.boolean().optional().describe('Force delete if not fully merged'),
    },
    async (args) => {
      const { runBranchDelete } = await import('./branch.js');
      const result = await runBranchDelete(args.name, root, args.force ?? false);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'tic-merge_branch',
    'Merge a git branch into the current branch',
    {
      name: z.string().describe('Branch name to merge'),
    },
    async (args) => {
      const { runBranchMerge } = await import('./branch.js');
      const result = await runBranchMerge(args.name, root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );

  server.tool(
    'tic-push_branch',
    'Push a git branch to remote',
    {
      name: z.string().optional().describe('Branch name (defaults to current)'),
    },
    async (args) => {
      const { runBranchPush } = await import('./branch.js');
      const result = await runBranchPush(args.name, root);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
      };
    },
  );
}
```

Note: You'll need to add `import { isGitRepo } from '../../git.js';` to the imports at the top of `mcp.ts` if not already present.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat: add MCP branch tools (list, switch, create, delete, merge, push)"
```

---

### Task 9: Run full verification

**Step 1: Format**

Run: `npm run format`

**Step 2: Lint**

Run: `npm run lint`
Fix any issues.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Fix any type errors.

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 5: Fix any issues found and commit fixes**

```bash
git add -A
git commit -m "chore: fix lint/format/type issues for branch management feature"
```

---

### Task 10: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update relevant sections**

- Add `branch-list` to the screen list in Entry Point & Rendering
- Add `B` to the WorkItemList keybindings description
- Add `tic branch` to the CLI section
- Add branch MCP tools mention
- Add `src/git-async.ts` and `src/branch-links.ts` to relevant sections

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md with branch management feature"
```
