# Global Command Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Unified command bar (`/`) across all list screens that searches items, PRs, and branches, with branch data moved into backendDataStore.

**Architecture:** Extract command bar from WorkItemList into a shared CommandBar component. Add branch data to backendDataStore (following the PR loading pattern). Add PR/branch highlight targets to navigationStore. Each list screen renders CommandBar with its own commands.

**Tech Stack:** TypeScript, React 19, Ink 6, Zustand stores

---

### Task 1: Extend OverlayItem kind type

**Files:**
- Modify: `src/components/OverlayPanel.tsx:9-17`

**Step 1: Update OverlayItem interface**

At line 16, change:
```typescript
kind?: 'command' | 'issue';
```
to:
```typescript
kind?: 'command' | 'issue' | 'pr' | 'branch';
```

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS (additive change)

---

### Task 2: Add branch data to backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`
- Modify: `src/git.ts` (export BranchRow type)

**Step 1: Export BranchRow type from git.ts**

After the `WorktreeInfo` interface (line ~159), add:
```typescript
export interface BranchRow {
  branch: BranchInfo;
  linkedItem: { id: string; title: string } | null;
  worktree: WorktreeInfo | null;
}
```

**Step 2: Add imports to backendDataStore.ts**

Add to imports:
```typescript
import { isGitRepo, listBranches, listWorktrees, type BranchRow } from '../git.js';
import { fetchAll } from '../git-async.js';
import { linkBranchToItem } from '../branch-links.js';
```

**Step 3: Add branch state to BackendDataStoreState interface**

After `prCapabilities: PrCapabilities;` (line ~70), add:
```typescript
branches: BranchRow[];
branchesLoading: boolean;
```

After `unlinkPrItem` in the interface (line ~115), add:
```typescript
loadBranches: () => void;
refreshBranches: () => void;
```

**Step 4: Add defaults to initial store state**

After `prCapabilities: { ...defaultPrCapabilities },` (~line 195), add:
```typescript
branches: [],
branchesLoading: false,
```

**Step 5: Implement loadBranches and refreshBranches methods**

After the `loadPullRequests` method (~line 580), add:
```typescript
loadBranches() {
  if (\!currentCwd || \!isGitRepo(currentCwd)) {
    set({ branches: [], branchesLoading: false });
    return;
  }
  const cwd = currentCwd;
  const items = get().items;
  const branches = listBranches(cwd);
  const worktrees = listWorktrees(cwd);

  const rows: BranchRow[] = branches.map((b) => {
    const linked = linkBranchToItem(b.name, items);
    const wt = worktrees.find((w) => w.branch === b.name) ?? null;
    return {
      branch: b,
      linkedItem: linked ? { id: linked.id, title: linked.title } : null,
      worktree: wt,
    };
  });

  rows.sort((a, b) => {
    if (a.branch.current \!== b.branch.current)
      return a.branch.current ? -1 : 1;
    const aIsTic = a.branch.name.startsWith('tic/');
    const bIsTic = b.branch.name.startsWith('tic/');
    if (aIsTic \!== bIsTic) return aIsTic ? -1 : 1;
    return a.branch.name.localeCompare(b.branch.name);
  });

  set({ branches: rows });
},

refreshBranches() {
  if (\!currentCwd || \!isGitRepo(currentCwd)) return;
  const cwd = currentCwd;
  const gen = initGeneration;
  get().loadBranches();
  set({ branchesLoading: true });
  fetchAll(cwd)
    .then(() => {
      if (gen \!== initGeneration) return;
      get().loadBranches();
    })
    .catch(() => {})
    .finally(() => {
      if (gen \!== initGeneration) return;
      set({ branchesLoading: false });
    });
},
```

**Step 6: Chain loadBranches in refresh()**

After `await get().loadPullRequests();` (~line 293), add:
```typescript
get().loadBranches();
```

**Step 7: Reset branches in destroy()**

In the `set({...})` call in destroy (~line 706), add:
```typescript
branches: [],
branchesLoading: false,
```

**Step 8: Verify build**

Run: `npm run build`
Expected: PASS

**Step 9: Commit**

```bash
git add src/git.ts src/stores/backendDataStore.ts
git commit -m "feat: add branch data to backendDataStore"
```

---

### Task 3: Add PR/branch highlight targets to navigationStore

**Files:**
- Modify: `src/stores/navigationStore.ts`

**Step 1: Add state to NavigationState interface**

After `selectedWorkItemId: string | null;` (line ~24), add:
```typescript
selectedPrId: string | null;
selectedBranchName: string | null;
```

After `selectWorkItem: (id: string | null) => void;` (line ~43), add:
```typescript
selectPr: (id: string | null) => void;
selectBranch: (name: string | null) => void;
```

**Step 2: Add to initialState**

After `selectedWorkItemId: null,` (line ~58), add:
```typescript
selectedPrId: null,
selectedBranchName: null,
```

**Step 3: Clear on navigate**

In `navigate` action (~line 78), add to the set call:
```typescript
selectedPrId: null,
selectedBranchName: null,
```

**Step 4: Add actions**

After `selectWorkItem` action (~line 98), add:
```typescript
selectPr: (id: string | null) => {
  set({ selectedPrId: id });
},

selectBranch: (name: string | null) => {
  set({ selectedBranchName: name });
},
```

**Step 5: Verify build + commit**

Run: `npm run build`

```bash
git add src/stores/navigationStore.ts
git commit -m "feat: add PR/branch selection to navigationStore"
```

---

### Task 4: Create CommandBar component

**Files:**
- Create: `src/components/CommandBar.tsx`
- Test: `src/components/CommandBar.test.tsx`

**Step 1: Write failing test**

```typescript
import { describe, it, expect } from 'vitest';
import { CommandBar } from './CommandBar.js';

describe('CommandBar', () => {
  it('exports CommandBar component', () => {
    expect(typeof CommandBar).toBe('function');
  });
});
```

Run: `npx vitest run src/components/CommandBar.test.tsx`
Expected: FAIL

**Step 2: Create CommandBar component**

```typescript
import { useState, useEffect, useMemo, useCallback } from 'react';
import { backendDataStore, useBackendDataStore } from '../stores/backendDataStore.js';
import {
  navigationStore,
  useNavigationStore,
} from '../stores/navigationStore.js';
import {
  recentCommandsStore,
  useRecentCommandsStore,
} from '../stores/recentCommandsStore.js';
import { OverlayPanel, type OverlayItem } from './OverlayPanel.js';
import type { Command } from '../commands.js';
import type { WorkItem } from '../types.js';

interface CommandBarProps {
  commands: Command[];
  onCommand: (cmd: Command) => void;
  onCancel: () => void;
}

export function CommandBar({ commands, onCommand, onCancel }: CommandBarProps) {
  const [query, setQuery] = useState('');
  const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);
  const recentIds = useRecentCommandsStore((s) => s.recentIds);
  const pullRequests = useBackendDataStore((s) => s.pullRequests);
  const branches = useBackendDataStore((s) => s.branches);
  const navigate = useNavigationStore((s) => s.navigate);
  const screen = useNavigationStore((s) => s.screen);

  // Load all work items on mount (may differ from filtered list)
  useEffect(() => {
    const backend = backendDataStore.getState().backend;
    if (\!backend) return;
    let cancelled = false;
    void backend
      .listWorkItems()
      .then((items) => {
        if (\!cancelled) setAllSearchItems(items);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const items: OverlayItem[] = useMemo(() => {
    const q = query.toLowerCase();

    // Build command items (recent + categorized)
    const commandMap = new Map(commands.map((c) => [c.id, c]));
    const recentItems: OverlayItem[] = [];
    for (const id of recentIds) {
      const cmd = commandMap.get(id);
      if (cmd) {
        recentItems.push({
          id: `recent-${cmd.id}`,
          label: cmd.label,
          value: cmd.id,
          category: 'Recent',
          kind: 'command',
        });
      }
    }

    const commandItems: OverlayItem[] = commands.map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      value: cmd.id,
      category: cmd.category,
      kind: 'command' as const,
    }));

    let all = [...recentItems, ...commandItems];

    if (q) {
      all = all.filter((item) =>
        item.label.toLowerCase().includes(q),
      );

      // Add matching issues (up to 5)
      const matchingIssues = allSearchItems
        .filter(
          (item) =>
            item.title.toLowerCase().includes(q) ||
            item.id.toLowerCase().includes(q),
        )
        .slice(0, 5)
        .map((item) => ({
          id: `issue-${item.id}`,
          label: `#${item.id} ${item.title}`,
          value: item.id,
          hint: item.type,
          category: 'Issues',
          kind: 'issue' as const,
        }));

      // Add matching PRs (up to 5)
      const matchingPrs = pullRequests
        .filter(
          (pr) =>
            pr.title.toLowerCase().includes(q) ||
            String(pr.number).includes(q),
        )
        .slice(0, 5)
        .map((pr) => ({
          id: `pr-${pr.id}`,
          label: `PR #${pr.number} ${pr.title}`,
          value: pr.id,
          hint: pr.status,
          category: 'Pull Requests',
          kind: 'pr' as const,
        }));

      // Add matching branches (up to 5)
      const matchingBranches = branches
        .filter(
          (r) =>
            r.branch.name.toLowerCase().includes(q) ||
            r.linkedItem?.title.toLowerCase().includes(q),
        )
        .slice(0, 5)
        .map((r) => ({
          id: `branch-${r.branch.name}`,
          label: r.branch.name,
          value: r.branch.name,
          hint: r.linkedItem ? `#${r.linkedItem.id} ${r.linkedItem.title}` : undefined,
          category: 'Branches',
          kind: 'branch' as const,
        }));

      all = [...all, ...matchingIssues, ...matchingPrs, ...matchingBranches];
    }

    return all;
  }, [commands, recentIds, query, allSearchItems, pullRequests, branches]);

  const handleSelect = useCallback(
    (item: OverlayItem) => {
      setQuery('');
      if (item.kind === 'issue') {
        const workItem = allSearchItems.find((i) => i.id === item.value);
        if (workItem) {
          navigationStore.getState().selectWorkItem(workItem.id);
          if (screen \!== 'list') navigate('list');
          navigate('form');
        }
        onCancel();
        return;
      }
      if (item.kind === 'pr') {
        navigationStore.getState().selectPr(item.value);
        if (screen \!== 'pr-list') navigate('pr-list');
        onCancel();
        return;
      }
      if (item.kind === 'branch') {
        navigationStore.getState().selectBranch(item.value);
        if (screen \!== 'branch-list') navigate('branch-list');
        onCancel();
        return;
      }
      // Command
      const cmd = commands.find((c) => c.id === item.value);
      if (cmd) {
        recentCommandsStore.getState().addRecent(cmd.id);
        onCommand(cmd);
      }
    },
    [allSearchItems, commands, onCommand, onCancel, screen, navigate],
  );

  return (
    <OverlayPanel
      title="Commands"
      items={items}
      placeholder="Type to search..."
      externalFilter
      onQueryChange={setQuery}
      onSelect={handleSelect}
      onCancel={() => {
        setQuery('');
        onCancel();
      }}
    />
  );
}
```

**Step 3: Run test**

Run: `npx vitest run src/components/CommandBar.test.tsx`
Expected: PASS

**Step 4: Verify build + commit**

Run: `npm run build`

```bash
git add src/components/CommandBar.tsx src/components/CommandBar.test.tsx
git commit -m "feat: create shared CommandBar component"
```

---

### Task 5: Integrate CommandBar into WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add import**

Replace the OverlayPanel import line to also import CommandBar:
```typescript
import { CommandBar } from './CommandBar.js';
```

**Step 2: Remove command bar local state**

Remove these state declarations (~lines 199, 203):
- `const [allSearchItems, setAllSearchItems] = useState<WorkItem[]>([]);`
- `const [commandBarQuery, setCommandBarQuery] = useState('');`

**Step 3: Remove allSearchItems useEffect**

Remove the useEffect at ~lines 402-420 that loads allSearchItems when command-bar overlay opens.

**Step 4: Remove commandBarItems useMemo**

Remove the entire `commandBarItems` useMemo at ~lines 908-964.

**Step 5: Remove handleSearchSelect**

Remove `handleSearchSelect` at ~lines 873-878. (CommandBar handles this internally.)

**Step 6: Replace OverlayPanel command-bar JSX**

Replace the command-bar OverlayPanel block (~lines 1402-1424) with:
```typescript
activeOverlay?.type === 'command-bar' ? (
  <CommandBar
    commands={paletteCommands}
    onCommand={handleCommandSelect}
    onCancel={closeOverlay}
  />
)
```

**Step 7: Verify build + test**

Run: `npm run build && npm test`
Expected: PASS

**Step 8: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor: use shared CommandBar in WorkItemList"
```

---

### Task 6: Integrate CommandBar into PullRequestList

**Files:**
- Modify: `src/components/PullRequestList.tsx`

**Step 1: Add imports and state**

Add imports:
```typescript
import { useNavigationStore } from '../stores/navigationStore.js';
import { uiStore } from '../stores/uiStore.js';
import { getVisibleCommands, type CommandContext } from '../commands.js';
import { CommandBar } from './CommandBar.js';
```

Add overlay state from uiStore:
```typescript
const { activeOverlay, openOverlay, closeOverlay } = uiStore.getState();
```

Actually, use the hook pattern consistent with other components. Import useShallow if needed.

**Step 2: Add selectedPrId consumption**

Read initial selection from navigationStore:
```typescript
const selectedPrId = useNavigationStore((s) => s.selectedPrId);
```

In a useEffect, if selectedPrId is set, find the index in pullRequests and set cursor:
```typescript
useEffect(() => {
  if (selectedPrId) {
    const idx = pullRequests.findIndex((pr) => pr.id === selectedPrId);
    if (idx >= 0) setCursor(idx);
    navigationStore.getState().selectPr(null);
  }
}, [selectedPrId, pullRequests]);
```

**Step 3: Add `/` keybinding and command bar**

In useInput, add before the escape handler:
```typescript
if (input === '/') {
  openOverlay({ type: 'command-bar' });
  return;
}
```

Add early return guard at top of useInput when overlay is active:
```typescript
if (activeOverlay) return;
```

**Step 4: Render CommandBar**

After the footer Box, conditionally render:
```typescript
{activeOverlay?.type === 'command-bar' && (
  <CommandBar
    commands={[]}
    onCommand={() => closeOverlay()}
    onCancel={closeOverlay}
  />
)}
```

**Step 5: Update footer keybinding hints**

Add `/ search` to the footer text.

**Step 6: Verify build + test**

Run: `npm run build && npm test`

**Step 7: Commit**

```bash
git add src/components/PullRequestList.tsx
git commit -m "feat: add command bar to PullRequestList"
```

---

### Task 7: Refactor BranchList to use store data + CommandBar

**Files:**
- Modify: `src/components/BranchList.tsx`

**Step 1: Replace local branch loading with store data**

Remove:
- `const [rows, setRows] = useState<BranchRow[]>([]);`
- `const [fetching, setFetching] = useState(false);`
- `const [filterText, setFilterText] = useState('');`
- The `loadBranches` useCallback
- The two-phase loading useEffect
- The `filteredRows` useMemo

Replace with store consumption:
```typescript
const rows = useBackendDataStore((s) => s.branches);
const fetching = useBackendDataStore((s) => s.branchesLoading);
```

Trigger initial remote fetch on mount:
```typescript
useEffect(() => {
  backendDataStore.getState().refreshBranches();
}, []);
```

**Step 2: Remove custom search**

Remove:
- `inputMode` type and state (keep only for new-branch)
- `filterText` state and all references
- The search input mode handling in useInput
- The search UI rendering (`inputMode === 'search'`)
- The `/` keybinding that sets `inputMode('search')`

Change `InputMode` type to `'normal' | 'new-branch'` (remove `'search'`).

**Step 3: Add CommandBar**

Add imports:
```typescript
import { uiStore } from '../stores/uiStore.js';
import { CommandBar } from './CommandBar.js';
```

Add overlay state, `/` keybinding, and early return guard (same pattern as PullRequestList).

**Step 4: Add selectedBranchName consumption**

```typescript
const selectedBranchName = useNavigationStore((s) => s.selectedBranchName);

useEffect(() => {
  if (selectedBranchName) {
    const idx = rows.findIndex((r) => r.branch.name === selectedBranchName);
    if (idx >= 0) setCursor(idx);
    navigationStore.getState().selectBranch(null);
  }
}, [selectedBranchName, rows]);
```

**Step 5: Update mutation callbacks to use store refresh**

After successful delete/merge/push/create operations, call:
```typescript
backendDataStore.getState().loadBranches();
```
instead of the local `loadBranches()`.

**Step 6: Render CommandBar**

Pass branch-specific commands (e.g., new branch if desired, or empty array):
```typescript
{activeOverlay?.type === 'command-bar' && (
  <CommandBar
    commands={[]}
    onCommand={() => closeOverlay()}
    onCancel={closeOverlay}
  />
)}
```

**Step 7: Remove BranchRow import from BranchList**

BranchRow now comes from git.ts, not locally defined.

**Step 8: Verify build + test**

Run: `npm run build && npm test`

**Step 9: Commit**

```bash
git add src/components/BranchList.tsx
git commit -m "refactor: BranchList uses store data and shared CommandBar"
```

---

### Task 8: Update tests and cleanup

**Files:**
- Modify: any test files that reference removed state/functions
- Modify: `src/stores/backendDataStore.ts` tests if they assert store shape

**Step 1: Run full test suite**

Run: `npm test`

Fix any failing tests due to:
- Changed store state shape (branches/branchesLoading in snapshots)
- Removed allSearchItems/commandBarQuery from WorkItemList
- Changed BranchList behavior

**Step 2: Run lint + format**

Run: `npm run lint && npm run format`

**Step 3: Final commit**

```bash
git add -A
git commit -m "test: update tests for global command bar"
```
