# Multi-Column Sort Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add multi-column sort to the work item list with `O` keybinding and command palette integration.

**Architecture:** Sort state (an ordered stack of column+direction pairs) lives in listViewStore. A `sortTree()` function recursively sorts siblings at each tree level. The sort picker reuses OverlayPanel with entries showing current sort state.

**Tech Stack:** TypeScript, Zustand (vanilla store), React/Ink, Vitest

---

### Task 1: Add sort types and state to listViewStore

**Files:**
- Modify: `src/stores/listViewStore.ts`
- Test: `src/stores/listViewStore.test.ts`

**Step 1: Write the failing tests**

Add to `src/stores/listViewStore.test.ts`:

```ts
describe('sortStack', () => {
  it('starts with empty sort stack', () => {
    expect(listViewStore.getState().sortStack).toEqual([]);
  });

  it('toggleSortColumn adds column as ascending', () => {
    listViewStore.getState().toggleSortColumn('priority');
    expect(listViewStore.getState().sortStack).toEqual([
      { column: 'priority', direction: 'asc' },
    ]);
  });

  it('toggleSortColumn flips ascending to descending', () => {
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().toggleSortColumn('priority');
    expect(listViewStore.getState().sortStack).toEqual([
      { column: 'priority', direction: 'desc' },
    ]);
  });

  it('toggleSortColumn removes descending column', () => {
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().toggleSortColumn('priority');
    expect(listViewStore.getState().sortStack).toEqual([]);
  });

  it('stacks multiple sort columns', () => {
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().toggleSortColumn('status');
    expect(listViewStore.getState().sortStack).toEqual([
      { column: 'priority', direction: 'asc' },
      { column: 'status', direction: 'asc' },
    ]);
  });

  it('clearSort empties the stack', () => {
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().toggleSortColumn('status');
    listViewStore.getState().clearSort();
    expect(listViewStore.getState().sortStack).toEqual([]);
  });

  it('reset clears sort stack', () => {
    listViewStore.getState().toggleSortColumn('priority');
    listViewStore.getState().reset();
    expect(listViewStore.getState().sortStack).toEqual([]);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: FAIL — `sortStack`, `toggleSortColumn`, `clearSort` don't exist

**Step 3: Implement sort state in listViewStore**

In `src/stores/listViewStore.ts`, add the types and state:

```ts
export type SortDirection = 'asc' | 'desc';
export type SortColumn =
  | 'id'
  | 'title'
  | 'status'
  | 'priority'
  | 'assignee'
  | 'created'
  | 'updated';

export interface SortEntry {
  column: SortColumn;
  direction: SortDirection;
}
```

Add to `ListViewState` interface:
```ts
sortStack: SortEntry[];
toggleSortColumn: (column: SortColumn) => void;
clearSort: () => void;
```

Add to `initialState`:
```ts
sortStack: [] as SortEntry[],
```

Add to store implementation:
```ts
toggleSortColumn: (column) =>
  set((state) => {
    const idx = state.sortStack.findIndex((e) => e.column === column);
    if (idx === -1) {
      return { sortStack: [...state.sortStack, { column, direction: 'asc' }] };
    }
    const entry = state.sortStack[idx]!;
    if (entry.direction === 'asc') {
      const next = [...state.sortStack];
      next[idx] = { column, direction: 'desc' };
      return { sortStack: next };
    }
    return { sortStack: state.sortStack.filter((_, i) => i !== idx) };
  }),

clearSort: () => set({ sortStack: [] }),
```

Update `reset` to include `sortStack: []`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(store): add sortStack to listViewStore with toggle and clear
```

---

### Task 2: Add sortTree function

**Files:**
- Modify: `src/components/buildTree.ts`
- Test: `src/components/buildTree.test.ts`

**Step 1: Write the failing tests**

Add to `src/components/buildTree.test.ts`:

```ts
import { sortTree } from './buildTree.js';
import type { SortEntry } from '../stores/listViewStore.js';
```

```ts
describe('sortTree', () => {
  it('returns items unchanged when sort stack is empty', () => {
    const items = [makeItem({ id: '2' }), makeItem({ id: '1' })];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, []);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '1']);
  });

  it('sorts by ID ascending', () => {
    const items = [makeItem({ id: '3' }), makeItem({ id: '1' }), makeItem({ id: '2' })];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3']);
  });

  it('sorts by ID descending', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '3' }), makeItem({ id: '2' })];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['3', '2', '1']);
  });

  it('sorts by title case-insensitive', () => {
    const items = [
      makeItem({ id: '1', title: 'Banana' }),
      makeItem({ id: '2', title: 'apple' }),
      makeItem({ id: '3', title: 'Cherry' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'title', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.title)).toEqual(['apple', 'Banana', 'Cherry']);
  });

  it('sorts by priority using ordinal ranking', () => {
    const items = [
      makeItem({ id: '1', priority: 'low' }),
      makeItem({ id: '2', priority: 'critical' }),
      makeItem({ id: '3', priority: 'high' }),
      makeItem({ id: '4', priority: 'medium' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.priority)).toEqual([
      'critical', 'high', 'medium', 'low',
    ]);
  });

  it('sorts by priority descending (low first)', () => {
    const items = [
      makeItem({ id: '1', priority: 'critical' }),
      makeItem({ id: '2', priority: 'low' }),
      makeItem({ id: '3', priority: 'high' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.priority)).toEqual(['low', 'high', 'critical']);
  });

  it('empty priority sorts last in ascending', () => {
    const items = [
      makeItem({ id: '1', priority: '' as any }),
      makeItem({ id: '2', priority: 'high' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '1']);
  });

  it('multi-level sort: priority then status', () => {
    const items = [
      makeItem({ id: '1', priority: 'high', status: 'closed' }),
      makeItem({ id: '2', priority: 'high', status: 'open' }),
      makeItem({ id: '3', priority: 'low', status: 'open' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [
      { column: 'priority', direction: 'asc' },
      { column: 'status', direction: 'asc' },
    ]);
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3']);
  });

  it('sorts within each tree level preserving hierarchy', () => {
    const parent1 = makeItem({ id: '2', title: 'B' });
    const parent2 = makeItem({ id: '1', title: 'A' });
    const child1 = makeItem({ id: '4', title: 'D', parent: '2' });
    const child2 = makeItem({ id: '3', title: 'C', parent: '2' });
    const items = [parent1, parent2, child1, child2];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'title', direction: 'asc' }]);
    // Parents sorted: A(1), B(2). Children of B sorted: C(3), D(4)
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3', '4']);
  });

  it('sorts by created date', () => {
    const items = [
      makeItem({ id: '1', created: '2026-02-03T00:00:00Z' }),
      makeItem({ id: '2', created: '2026-02-01T00:00:00Z' }),
      makeItem({ id: '3', created: '2026-02-02T00:00:00Z' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'created', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by updated date descending', () => {
    const items = [
      makeItem({ id: '1', updated: '2026-02-01T00:00:00Z' }),
      makeItem({ id: '2', updated: '2026-02-03T00:00:00Z' }),
      makeItem({ id: '3', updated: '2026-02-02T00:00:00Z' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'updated', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '3', '1']);
  });

  it('handles non-numeric IDs with string fallback', () => {
    const items = [
      makeItem({ id: 'ABC-10' }),
      makeItem({ id: 'ABC-2' }),
      makeItem({ id: 'ABC-1' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['ABC-1', 'ABC-10', 'ABC-2']);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/buildTree.test.ts`
Expected: FAIL — `sortTree` doesn't exist

**Step 3: Implement sortTree**

Add to `src/components/buildTree.ts`:

```ts
import type { SortEntry } from '../stores/listViewStore.js';

const PRIORITY_RANK: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

function compareValues(
  a: WorkItem,
  b: WorkItem,
  entry: SortEntry,
): number {
  const { column, direction } = entry;
  let result = 0;

  switch (column) {
    case 'id': {
      const aNum = Number(a.id);
      const bNum = Number(b.id);
      if (!isNaN(aNum) && !isNaN(bNum)) {
        result = aNum - bNum;
      } else {
        result = a.id.localeCompare(b.id);
      }
      break;
    }
    case 'title':
      result = a.title.localeCompare(b.title, undefined, { sensitivity: 'base' });
      break;
    case 'status':
      result = a.status.localeCompare(b.status, undefined, { sensitivity: 'base' });
      break;
    case 'assignee':
      result = a.assignee.localeCompare(b.assignee, undefined, { sensitivity: 'base' });
      break;
    case 'priority': {
      const aRank = PRIORITY_RANK[a.priority] ?? 999;
      const bRank = PRIORITY_RANK[b.priority] ?? 999;
      result = aRank - bRank;
      break;
    }
    case 'created':
      result = a.created.localeCompare(b.created);
      break;
    case 'updated':
      result = a.updated.localeCompare(b.updated);
      break;
  }

  return direction === 'desc' ? -result : result;
}

export function sortTree(
  treeItems: TreeItem[],
  sortStack: SortEntry[],
): TreeItem[] {
  if (sortStack.length === 0) return treeItems;

  // Group items by depth level and parent
  // We need to sort siblings (items at the same depth that share a parent)
  // Strategy: identify contiguous groups of siblings and sort each group

  // Build a map: parentId -> array of {index, treeItem}
  // Items at depth 0 have parentId null
  const groups = new Map<string | null, { index: number; item: TreeItem }[]>();
  for (let i = 0; i < treeItems.length; i++) {
    const t = treeItems[i]!;
    const parentId = t.item.parent;
    const key = t.depth === 0 ? null : parentId;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push({ index: i, item: t });
  }

  // Sort each sibling group
  for (const siblings of groups.values()) {
    siblings.sort((a, b) => {
      for (const entry of sortStack) {
        const cmp = compareValues(a.item.item, b.item.item, entry);
        if (cmp !== 0) return cmp;
      }
      return 0;
    });
  }

  // Reconstruct the flat list in tree order (DFS)
  const result: TreeItem[] = [];
  const childMap = new Map<string | null, TreeItem[]>();
  for (const [key, siblings] of groups) {
    childMap.set(key, siblings.map((s) => s.item));
  }

  function walk(parentId: string | null) {
    const children = childMap.get(parentId);
    if (!children) return;
    for (const child of children) {
      result.push(child);
      walk(child.item.id);
    }
  }

  walk(null);
  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/buildTree.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(sort): add sortTree function for multi-column sorting
```

---

### Task 3: Add sort-picker overlay type and sort command

**Files:**
- Modify: `src/stores/uiStore.ts`
- Modify: `src/commands.ts`
- Test: `src/commands.test.ts`

**Step 1: Write the failing test**

Add to `src/commands.test.ts`:

```ts
it('shows sort command on list screen', () => {
  const ctx = makeContext();
  const commands = getVisibleCommands(ctx);
  const labels = commands.map((c) => c.label);
  expect(labels).toContain('Order by...');
});
```

**Step 2: Run tests to verify it fails**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — no "Order by..." command

**Step 3: Add overlay type and command**

In `src/stores/uiStore.ts`, add to the `ActiveOverlay` union:
```ts
| { type: 'sort-picker' }
```

In `src/commands.ts`, add to the commands array (in the Actions section):
```ts
{
  id: 'sort',
  label: 'Order by...',
  category: 'Actions',
  shortcut: 'O',
  when: (ctx) => ctx.screen === 'list',
},
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(sort): add sort-picker overlay type and Order by command
```

---

### Task 4: Wire up O keybinding and sort overlay in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add the O keybinding**

In the main `useInput` block (around line 588 where `S` is handled), add:

```ts
if (input === 'O') {
  openOverlay({ type: 'sort-picker' });
}
```

**Step 2: Add sort command handling**

In `handleCommandSelect`, add a case for `'sort'`:
```ts
case 'sort':
  openOverlay({ type: 'sort-picker' });
  break;
```

**Step 3: Import sort types and read sort state from store**

Add to imports:
```ts
import { sortTree } from './buildTree.js';
import type { SortEntry, SortColumn } from '../stores/listViewStore.js';
```

Add `sortStack` to the useListViewStore useShallow selector:
```ts
const { cursor, markedIds, expandedIds, rangeAnchor, sortStack } = useListViewStore(
  useShallow((s) => ({
    cursor: s.cursor,
    markedIds: s.markedIds,
    expandedIds: s.expandedIds,
    rangeAnchor: s.rangeAnchor,
    sortStack: s.sortStack,
  })),
);
```

Add `toggleSortColumn` and `clearSort` to the destructured store actions:
```ts
const {
  setCursor,
  toggleExpanded,
  toggleMarked,
  clearMarked,
  setMarkedIds,
  setRangeAnchor,
  clampCursor,
  removeDeletedItem,
  toggleSortColumn,
  clearSort,
} = listViewStore.getState();
```

**Step 4: Apply sort to the tree**

Change the `fullTree` useMemo to apply sortTree:
```ts
const fullTree = useMemo(
  () => {
    const tree = capabilities.relationships
      ? buildTree(items, allItems, activeType ?? '')
      : buildTree(items, items, activeType ?? '');
    return sortTree(tree, sortStack);
  },
  [items, allItems, activeType, capabilities.relationships, sortStack],
);
```

**Step 5: Build sort overlay items and render**

Add a `useMemo` for the sort picker items:
```ts
const sortPickerItems: OverlayItem[] = useMemo(() => {
  const columns: { column: SortColumn; label: string; capGated?: boolean }[] = [
    { column: 'id', label: 'ID' },
    { column: 'title', label: 'Title' },
    { column: 'status', label: 'Status' },
    { column: 'priority', label: 'Priority', capGated: true },
    { column: 'assignee', label: 'Assignee', capGated: true },
    { column: 'created', label: 'Created' },
    { column: 'updated', label: 'Updated' },
  ];

  const items: OverlayItem[] = [];

  if (sortStack.length > 0) {
    items.push({ id: '__clear__', label: 'Clear sort', value: '__clear__' });
  }

  for (const col of columns) {
    if (col.column === 'priority' && !capabilities.fields.priority) continue;
    if (col.column === 'assignee' && !capabilities.fields.assignee) continue;

    const idx = sortStack.findIndex((e) => e.column === col.column);
    let label = col.label;
    if (idx !== -1) {
      const entry = sortStack[idx]!;
      const arrow = entry.direction === 'asc' ? '▲' : '▼';
      const pos = sortStack.length > 1 ? `${idx + 1} ` : '';
      label = `${pos}${col.label} ${arrow}`;
    }

    items.push({ id: col.column, label, value: col.column });
  }

  return items;
}, [sortStack, capabilities.fields.priority, capabilities.fields.assignee]);
```

In the JSX, add the sort-picker overlay rendering (after the existing overlay chain, before the toast/help bar fallback). Insert before the `) : activeOverlay?.type === 'delete-confirm'` branch:

```tsx
) : activeOverlay?.type === 'sort-picker' ? (
  <OverlayPanel
    title="Order by"
    items={sortPickerItems}
    onSelect={(item) => {
      closeOverlay();
      if (item.value === '__clear__') {
        clearSort();
      } else {
        toggleSortColumn(item.value as SortColumn);
      }
    }}
    onCancel={() => closeOverlay()}
  />
```

**Step 6: Run build and full tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 7: Commit**

```
feat(list): wire up O keybinding and sort overlay
```

---

### Task 5: Add sort indicators to TableLayout header

**Files:**
- Modify: `src/components/TableLayout.tsx`

**Step 1: Add sortStack prop**

Update `TableLayoutProps`:
```ts
import type { SortEntry } from '../stores/listViewStore.js';

interface TableLayoutProps {
  treeItems: TreeItem[];
  cursor: number;
  capabilities: BackendCapabilities;
  collapsedIds: Set<string>;
  markedIds: Set<string>;
  terminalWidth: number;
  sortStack?: SortEntry[];
}
```

**Step 2: Create a header label helper**

Add a function inside the file:
```ts
function sortedHeaderLabel(
  baseLabel: string,
  column: string,
  sortStack: SortEntry[],
): string {
  const idx = sortStack.findIndex((e) => e.column === column);
  if (idx === -1) return baseLabel;
  const entry = sortStack[idx]!;
  const arrow = entry.direction === 'asc' ? '▲' : '▼';
  const pos = sortStack.length > 1 ? `${idx + 1}` : '';
  return `${baseLabel} ${pos}${arrow}`;
}
```

**Step 3: Update header rendering in TableLayoutInner**

Replace the header `<Box>` section. Pass `sortStack` (defaulting to `[]`) into the helper for each column:

```tsx
const ss = sortStack ?? [];
```

Then replace each header `<Text bold underline>ID</Text>` with:
```tsx
<Text bold underline>{sortedHeaderLabel('ID', 'id', ss)}</Text>
```

Do the same for Title, Status, Assignee, Labels, Priority using their respective column names.

**Step 4: Add non-visible sort indicator**

After the header `<Box>` and before the row mapping, add:
```tsx
{(() => {
  const ss = sortStack ?? [];
  const nonVisibleSorts = ss.filter(
    (e) => e.column === 'created' || e.column === 'updated',
  );
  if (nonVisibleSorts.length === 0) return null;
  const parts = nonVisibleSorts.map((e) => {
    const idx = ss.indexOf(e);
    const arrow = e.direction === 'asc' ? '▲' : '▼';
    const pos = ss.length > 1 ? `${idx + 1}` : '';
    const label = e.column.charAt(0).toUpperCase() + e.column.slice(1);
    return `${label} ${pos}${arrow}`;
  });
  return (
    <Box>
      <Text dimColor>Sorted by: {parts.join(', ')}</Text>
    </Box>
  );
})()}
```

**Step 5: Pass sortStack from WorkItemList**

In `WorkItemList.tsx`, update the `<TableLayout>` call:
```tsx
<TableLayout
  treeItems={visibleTreeItems}
  cursor={viewport.visibleCursor}
  capabilities={capabilities}
  collapsedIds={collapsedIds}
  markedIds={markedIds}
  terminalWidth={terminalWidth}
  sortStack={sortStack}
/>
```

**Step 6: Run build and full tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 7: Commit**

```
feat(table): show sort indicators in column headers
```

---

### Task 6: Update HelpScreen with O keybinding

**Files:**
- Modify: `src/components/HelpScreen.tsx`

**Step 1: Add the keybinding**

In `HelpScreen.tsx`, in the `case 'list'` block, add to the `actions` array (after the existing entries, before the search entry):

```ts
actions.push({ key: 'O', description: 'Order by column' });
```

Place it logically near the other property-setting keys.

**Step 2: Run build and full tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 3: Commit**

```
docs(help): add O keybinding for order by column
```

---

### Task 7: Format, lint, and final verification

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run full checks**

Run: `npm run format:check && npm run lint && npx tsc --noEmit && npm test`
Expected: All PASS

**Step 3: Commit any formatting fixes**

```
chore: format
```

---

### Task 8: Update tic issue status

**Step 1:** Mark issue #20 as done/closed using tic tools.
