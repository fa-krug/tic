# Cross-Type Collapsible Children Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Show child work items in the list regardless of type, collapsed by default, with arrow left/right to expand/collapse.

**Architecture:** Extend `buildTree` to pull children from all items (not just type-filtered). Add collapse state tracking. Cross-type children render dimmed with a type label. Arrow left/right controls expand/collapse.

**Tech Stack:** React + Ink (existing), TypeScript, Vitest

---

### Task 1: Extract `buildTree` into its own module with tests

**Files:**
- Create: `src/components/buildTree.ts`
- Create: `src/components/buildTree.test.ts`
- Modify: `src/components/WorkItemList.tsx:17-53` (remove `TreeItem` and `buildTree`, re-export from new module)

**Step 1: Write the failing test**

Create `src/components/buildTree.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { buildTree } from './buildTree.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
    type: 'task',
    status: 'open',
    iteration: 'sprint-1',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('buildTree', () => {
  it('returns flat list when no parent relationships', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result.every((t) => t.depth === 0)).toBe(true);
    expect(result.every((t) => !t.isCrossType)).toBe(true);
    expect(result.every((t) => !t.hasChildren)).toBe(true);
  });

  it('nests same-type children under parent', () => {
    const items = [
      makeItem({ id: '1' }),
      makeItem({ id: '2', parent: '1' }),
    ];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[1]!.prefix).toBe('└─');
    expect(result[1]!.isCrossType).toBe(false);
  });

  it('pulls in cross-type children from allItems', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const filteredItems = [task]; // only tasks
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[0]!.hasChildren).toBe(true);
  });

  it('does not show cross-type items as roots', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug' }); // no parent, different type
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1']);
  });

  it('recursively includes cross-type grandchildren', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const subtask = makeItem({ id: '3', type: 'task', parent: '2' });
    const filteredItems = [task, subtask]; // subtask is same type but child of bug
    const allItems = [task, bug, subtask];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2', '3']);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[2]!.isCrossType).toBe(false);
    expect(result[2]!.depth).toBe(2);
  });

  it('marks hasChildren correctly for items whose children are all cross-type', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.hasChildren).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/buildTree.test.ts`
Expected: FAIL — cannot resolve `./buildTree.js`

**Step 3: Write the implementation**

Create `src/components/buildTree.ts`:

```typescript
import type { WorkItem } from '../types.js';

export interface TreeItem {
  item: WorkItem;
  depth: number;
  prefix: string;
  isCrossType: boolean;
  hasChildren: boolean;
}

/**
 * Build a tree from work items. Roots come from filteredItems (matching activeType).
 * Children are pulled from allItems regardless of type.
 * Cross-type children are marked with isCrossType=true.
 */
export function buildTree(
  filteredItems: WorkItem[],
  allItems: WorkItem[],
  activeType: string,
): TreeItem[] {
  // Build a map of ALL items for parent lookups
  const allItemMap = new Map(allItems.map((i) => [i.id, i]));

  // Build children map from ALL items (children grouped by parent ID)
  const childrenMap = new Map<string | null, WorkItem[]>();
  for (const item of allItems) {
    const parentId =
      item.parent !== null && allItemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  // Set of IDs in the filtered (same-type) set — used to identify roots
  const filteredIds = new Set(filteredItems.map((i) => i.id));

  // Determine which IDs have children (in allItems)
  const idsWithChildren = new Set<string>();
  for (const item of allItems) {
    if (item.parent !== null && allItemMap.has(item.parent)) {
      idsWithChildren.add(item.parent);
    }
  }

  const result: TreeItem[] = [];

  function walk(parentId: string | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      // At depth 0, only include items from the filtered set (same type)
      if (depth === 0 && !filteredIds.has(child.id)) return;

      const isLast = idx === children.length - 1;
      let prefix = '';
      if (depth > 0) {
        prefix = parentPrefix + (isLast ? '└─' : '├─');
      }

      result.push({
        item: child,
        depth,
        prefix,
        isCrossType: child.type !== activeType,
        hasChildren: idsWithChildren.has(child.id),
      });

      const nextParentPrefix =
        depth > 0 ? parentPrefix + (isLast ? '  ' : '│ ') : '';
      walk(child.id, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/buildTree.test.ts`
Expected: PASS (all 6 tests)

**Step 5: Commit**

```bash
git add src/components/buildTree.ts src/components/buildTree.test.ts
git commit -m "feat: extract buildTree with cross-type child support"
```

---

### Task 2: Wire up new `buildTree` in WorkItemList and add collapse state

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Update imports — remove old TreeItem/buildTree, import new ones**

In `src/components/WorkItemList.tsx`, replace lines 1-53:

```typescript
import { useState, useMemo, useEffect, useCallback } from 'react';
import { Box, Text, useInput, useApp } from 'ink';
import TextInput from 'ink-text-input';
import { useAppState } from '../app.js';
import type { WorkItem } from '../types.js';
import { isGitRepo } from '../git.js';
import { beginImplementation } from '../implement.js';
import { readConfigSync } from '../backends/local/config.js';
import { TableLayout } from './TableLayout.js';
import { CardLayout } from './CardLayout.js';
import { useTerminalSize } from '../hooks/useTerminalSize.js';
import { useScrollViewport } from '../hooks/useScrollViewport.js';
import { useBackendData } from '../hooks/useBackendData.js';
import { SyncQueueStore } from '../sync/queue.js';
import type { SyncStatus, QueueAction } from '../sync/types.js';
import { buildTree } from './buildTree.js';
import type { TreeItem } from './buildTree.js';

export type { TreeItem };
```

**Step 2: Replace `items` and `treeItems` memos (lines 120-124) with collapse-aware version**

Replace lines 120-124 with:

```typescript
  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );

  const fullTree = useMemo(
    () =>
      capabilities.relationships
        ? buildTree(items, allItems, activeType ?? '')
        : buildTree(items, items, activeType ?? ''),
    [items, allItems, activeType, capabilities.relationships],
  );

  // Collapse state: set of item IDs that are collapsed
  // Initialize with all items that have children (collapsed by default)
  const [collapsedIds, setCollapsedIds] = useState<Set<string>>(() => {
    const ids = new Set<string>();
    for (const t of fullTree) {
      if (t.hasChildren) ids.add(t.item.id);
    }
    return ids;
  });

  // When fullTree changes, add any NEW parents to collapsed set (keep existing expand/collapse choices)
  useEffect(() => {
    setCollapsedIds((prev) => {
      const parentIds = new Set(
        fullTree.filter((t) => t.hasChildren).map((t) => t.item.id),
      );
      // Keep previously collapsed items that are still parents,
      // add new parents as collapsed
      const next = new Set<string>();
      for (const id of parentIds) {
        if (prev.has(id) || !prev.size) {
          // First load or was already collapsed
          next.add(id);
        }
        // If prev existed and id was NOT in prev, it was explicitly expanded — keep it expanded
      }
      return next;
    });
  }, [fullTree]);

  // Filter tree to hide children of collapsed items
  const treeItems = useMemo(() => {
    const result: TreeItem[] = [];
    const skipChildrenOf = new Set<string>();
    for (const t of fullTree) {
      // If any ancestor is in skipChildrenOf, skip this item
      if (t.depth > 0) {
        // Check if parent is being skipped
        const parentItem = fullTree.find(
          (p) =>
            p.item.id === t.item.parent &&
            result.includes(p) === false &&
            skipChildrenOf.has(p.item.id),
        );
        // Simpler: track by checking if we should skip
        let dominated = false;
        for (const skipId of skipChildrenOf) {
          // Walk up to see if any ancestor is collapsed
          let current: TreeItem | undefined = t;
          // Check ancestry via parent chain
          let checkItem: WorkItem | undefined = t.item;
          while (checkItem?.parent) {
            if (checkItem.parent === skipId) {
              dominated = true;
              break;
            }
            checkItem = fullTree.find(
              (f) => f.item.id === checkItem!.parent,
            )?.item;
          }
          if (dominated) break;
        }
        if (dominated) continue;
      }
      result.push(t);
      if (collapsedIds.has(t.item.id)) {
        skipChildrenOf.add(t.item.id);
      }
    }
    return result;
  }, [fullTree, collapsedIds]);
```

Wait — the ancestry walk is unnecessarily complex. Since `fullTree` is in depth-first order, we can use a simpler approach: track depth-based skipping.

Actually let me rethink the `treeItems` filter to be simpler and correct:

```typescript
  const treeItems = useMemo(() => {
    const result: TreeItem[] = [];
    let skipDepth: number | null = null;
    for (const t of fullTree) {
      // If we're skipping and this item is deeper than the collapsed parent, skip it
      if (skipDepth !== null && t.depth > skipDepth) continue;
      // Reset skip when we reach same or shallower depth
      skipDepth = null;
      result.push(t);
      // If this item is collapsed, skip its descendants
      if (collapsedIds.has(t.item.id)) {
        skipDepth = t.depth;
      }
    }
    return result;
  }, [fullTree, collapsedIds]);
```

This is much cleaner — depth-first order means descendants always follow their parent at deeper depths.

**Step 3: Add arrow left/right handlers in useInput (around line 153-160 area)**

After the existing up/down arrow handlers, add:

```typescript
    if (key.rightArrow && treeItems.length > 0) {
      const current = treeItems[cursor];
      if (current && current.hasChildren && collapsedIds.has(current.item.id)) {
        setCollapsedIds((prev) => {
          const next = new Set(prev);
          next.delete(current.item.id);
          return next;
        });
      }
    }

    if (key.leftArrow && treeItems.length > 0) {
      const current = treeItems[cursor];
      if (current) {
        if (current.hasChildren && !collapsedIds.has(current.item.id)) {
          // Collapse current item
          setCollapsedIds((prev) => new Set(prev).add(current.item.id));
        } else if (current.depth > 0 && current.item.parent) {
          // Jump cursor to parent
          const parentIdx = treeItems.findIndex(
            (t) => t.item.id === current.item.parent,
          );
          if (parentIdx >= 0) setCursor(parentIdx);
        }
      }
    }
```

**Step 4: Update help text (around line 245-257)**

Add left/right arrow hints. Update the `helpParts` array:

```typescript
  const helpParts = [
    'up/down: navigate',
  ];
  if (capabilities.relationships) helpParts.push('left/right: collapse/expand');
  helpParts.push(
    'enter: edit',
    'o: open',
    'c: create',
    'd: delete',
  );
```

Update compact help similarly:

```typescript
  const compactHelpParts = [
    '↑↓ Nav',
    '←→ Fold',
    'c New',
    '⏎ Edit',
    '⇥ Type',
    's Status',
    'q Quit',
  ];
```

**Step 5: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: wire up cross-type tree with collapse/expand state"
```

---

### Task 3: Add collapse indicator and cross-type styling to TableLayout

**Files:**
- Modify: `src/components/TableLayout.tsx`

**Step 1: Update the rendering of each row**

The `TreeItem` now has `isCrossType` and `hasChildren`. Use them.

In `TableLayout.tsx`, update the row rendering (lines 58-99). The title cell needs to show the collapse indicator and the type label for cross-type items:

Replace the row map function body with:

```typescript
      {treeItems.map((treeItem, idx) => {
        const { item, prefix, isCrossType, hasChildren } = treeItem;
        const selected = idx === cursor;
        const hasUnresolvedDeps = item.dependsOn.length > 0;
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '▶ '
            : '▼ '
          : '  ';
        const typeLabel = isCrossType ? ` (${item.type})` : '';
        const dimmed = isCrossType && !selected;
        return (
          <Box key={`${item.id}-${item.type}`}>
            <Box width={2}>
              <Text color="cyan">{selected ? '>' : ' '}</Text>
            </Box>
            <Box width={colId}>
              <Text
                color={selected ? 'cyan' : undefined}
                bold={selected}
                dimColor={dimmed}
              >
                {item.id}
              </Text>
            </Box>
            <Box flexGrow={1}>
              <Text
                color={selected ? 'cyan' : undefined}
                bold={selected}
                dimColor={dimmed}
              >
                {capabilities.relationships ? prefix : ''}
                {collapseIndicator}
                {item.title}
                {typeLabel}
              </Text>
            </Box>
            <Box width={colStatus}>
              <Text
                color={selected ? 'cyan' : undefined}
                bold={selected}
                dimColor={dimmed}
              >
                {capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}
                {item.status}
              </Text>
            </Box>
            {capabilities.fields.priority && (
              <Box width={colPriority}>
                <Text
                  color={selected ? 'cyan' : undefined}
                  bold={selected}
                  dimColor={dimmed}
                >
                  {item.priority}
                </Text>
              </Box>
            )}
            {capabilities.fields.assignee && (
              <Box width={colAssignee}>
                <Text
                  color={selected ? 'cyan' : undefined}
                  bold={selected}
                  dimColor={dimmed}
                >
                  {item.assignee}
                </Text>
              </Box>
            )}
          </Box>
        );
      })}
```

**Step 2: Update the props interface to include `collapsedIds`**

```typescript
interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
}
```

Update the destructure:

```typescript
export function TableLayout({
  treeItems,
  cursor,
  capabilities,
  collapsedIds,
}: TableLayoutProps) {
```

**Step 3: Update the import to use new TreeItem**

```typescript
import type { TreeItem } from './buildTree.js';
```

**Step 4: Run build to check types**

Run: `npx tsc --noEmit`
Expected: Will fail because WorkItemList hasn't passed `collapsedIds` yet — that's fine, we'll fix in Task 5.

**Step 5: Commit**

```bash
git add src/components/TableLayout.tsx
git commit -m "feat: add collapse indicator and cross-type styling to TableLayout"
```

---

### Task 4: Add collapse indicator and cross-type styling to CardLayout

**Files:**
- Modify: `src/components/CardLayout.tsx`

**Step 1: Update the props interface**

```typescript
interface CardLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
}
```

Update destructure and import:

```typescript
import type { TreeItem } from './buildTree.js';
```

**Step 2: Update the row rendering**

Add collapse indicator and cross-type styling. In the title line:

```typescript
        const collapseIndicator = hasChildren
          ? collapsedIds.has(child.id)
            ? '▶ '
            : '▼ '
          : '  ';
        const typeLabel = isCrossType ? ` (${item.type})` : '';
        const dimmed = isCrossType && !selected;
```

Update the `<Text>` for the title line:

```typescript
              <Text
                color={selected ? 'cyan' : undefined}
                bold={selected}
                dimColor={dimmed}
              >
                {marker}
                {indent}{collapseIndicator}#{item.id} {item.title}
                {typeLabel}
                {depIndicator}
              </Text>
```

And dim the metadata line for cross-type items as well.

**Step 3: Update the test import** (if it references `TreeItem` from `WorkItemList`)

The existing `CardLayout.test.ts` only tests helper functions — no changes needed.

**Step 4: Run build**

Run: `npx tsc --noEmit`
Expected: May still fail until Task 5 wires up the prop.

**Step 5: Commit**

```bash
git add src/components/CardLayout.tsx
git commit -m "feat: add collapse indicator and cross-type styling to CardLayout"
```

---

### Task 5: Pass `collapsedIds` through and verify build

**Files:**
- Modify: `src/components/WorkItemList.tsx` (lines 309-321 where layouts are rendered)

**Step 1: Pass `collapsedIds` prop to both layout components**

```typescript
      {terminalWidth >= 80 ? (
        <TableLayout
          treeItems={visibleTreeItems}
          cursor={viewport.visibleCursor}
          capabilities={capabilities}
          collapsedIds={collapsedIds}
        />
      ) : (
        <CardLayout
          treeItems={visibleTreeItems}
          cursor={viewport.visibleCursor}
          capabilities={capabilities}
          collapsedIds={collapsedIds}
        />
      )}
```

**Step 2: Run full build**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors

**Step 3: Run all tests**

Run: `npm test`
Expected: PASS (existing tests + new buildTree tests)

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: wire collapse state to layout components"
```

---

### Task 6: Manual smoke test and fix collapse state initialization

**Step 1: Build and run**

Run: `npm run build && npm start`

**Step 2: Verify behavior**

- Items with children show `▶` indicator (collapsed)
- Arrow right on a collapsed item expands it (`▼`), showing children
- Arrow left on expanded item collapses it
- Arrow left on child jumps to parent
- Cross-type children appear dimmed with `(type)` label
- Tab still switches between types correctly
- Existing same-type tree nesting still works

**Step 3: Fix any issues found during smoke test**

Most likely adjustment: the collapse initialization `useEffect` needs refinement to avoid resetting explicit expand/collapse choices when data refreshes.

**Step 4: Final commit**

```bash
git add -A
git commit -m "fix: polish collapse state initialization"
```
