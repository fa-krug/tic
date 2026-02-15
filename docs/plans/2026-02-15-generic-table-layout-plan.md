# Generic TableLayout Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Generalize `TableLayout` from a WorkItem-specific component into a generic `<T>` table so PullRequestList and BranchList use the same responsive layout as WorkItemList.

**Architecture:** Extract column definitions into a declarative `ColumnDef<T>` interface. TableLayout becomes generic over `<T>`, with opt-in tree/mark/sort features. Each list view defines its own column config and passes it to TableLayout.

**Tech Stack:** TypeScript generics, React 19, Ink 6, Vitest

---

### Task 1: Define Generic Types and Refactor TableLayout

**Files:**
- Modify: `src/components/TableLayout.tsx`

**Step 1: Add the generic interfaces at the top of TableLayout.tsx**

Replace the existing `ColumnWidths`, `TableLayoutProps`, and `TableRowProps` interfaces. Keep the file's existing imports. Add these new types after the imports:

```typescript
export interface ColumnDef<T> {
  key: string;
  header: string;
  /** Fixed width in chars. Use -1 for flex column (gets remaining space). */
  width: number;
  render: (item: T, selected: boolean) => React.ReactNode;
  /** If true, column is never hidden responsively. Default false. */
  required?: boolean;
  /** Higher number = kept longer when space is tight. Default 0. */
  hidePriority?: number;
  /** Return true if any item has data for this column. If false, column is skipped entirely. */
  hasData?: (items: T[]) => boolean;
  /** Show sort indicator in header when sortStack includes this key. */
  sortable?: boolean;
}

export interface TableLayoutProps<T> {
  items: T[];
  columns: ColumnDef<T>[];
  cursor: number;
  terminalWidth: number;
  getKey: (item: T) => string;
  /** Show '>' marker column. Default true. */
  showMarker?: boolean;
  /** Tree indentation depth. */
  getDepth?: (item: T) => number;
  /** Tree drawing prefix (e.g. '├─ '). */
  getPrefix?: (item: T) => string;
  /** Collapse/expand indicator (e.g. '▶ ', '▼ ', '  '). */
  getCollapseIndicator?: (item: T) => string;
  /** Whether this item is marked for bulk operations. */
  isMarked?: (item: T) => boolean;
  /** Multi-column sort state for header indicators. */
  sortStack?: SortEntry[];
}
```

**Step 2: Replace `computeColumnWidths` with a generic version**

Delete the old `ColumnWidths` interface, `hasData` function, `FIXED_STATUS`, `FIXED_PRIORITY`, `FIXED_ASSIGNEE`, `FIXED_LABELS` constants, and `computeColumnWidths` function. Replace with:

```typescript
interface ComputedColumn {
  key: string;
  header: string;
  width: number;
  visible: boolean;
  sortable: boolean;
}

function computeVisibleColumns<T>(
  items: T[],
  columns: ColumnDef<T>[],
  terminalWidth: number,
  showMarker: boolean,
): ComputedColumn[] {
  const markerWidth = showMarker ? MARKER_WIDTH : 0;

  // Find the flex column (width === -1)
  const flexIndex = columns.findIndex((c) => c.width === -1);

  // Separate required vs optional columns (excluding flex)
  const requiredCols = columns.filter(
    (c, i) => i !== flexIndex && c.required,
  );
  const optionalCols = columns
    .filter((c, i) => i !== flexIndex && !c.required)
    .sort((a, b) => (b.hidePriority ?? 0) - (a.hidePriority ?? 0));

  // Start budget: terminal width minus marker and flex min width
  let budget = terminalWidth - markerWidth - TITLE_MIN_WIDTH - gap;

  // Deduct required columns
  for (const col of requiredCols) {
    budget -= col.width + gap;
  }

  // Add optional columns by priority (highest first), skipping those with no data
  const visibleOptional = new Set<string>();
  for (const col of optionalCols) {
    if (col.hasData && !col.hasData(items)) continue;
    if (budget >= col.width + gap) {
      visibleOptional.add(col.key);
      budget -= col.width + gap;
    }
  }

  // Compute flex column width: all remaining space
  const usedByFixed = columns.reduce((sum, col, i) => {
    if (i === flexIndex) return sum;
    if (!col.required && !visibleOptional.has(col.key)) return sum;
    return sum + col.width + gap;
  }, markerWidth);
  const flexWidth = Math.max(
    TITLE_MIN_WIDTH,
    terminalWidth - usedByFixed,
  );

  // Build result in original column order
  return columns.map((col, i) => {
    if (i === flexIndex) {
      return {
        key: col.key,
        header: col.header,
        width: flexWidth,
        visible: true,
        sortable: col.sortable ?? false,
      };
    }
    return {
      key: col.key,
      header: col.header,
      width: col.width,
      visible: col.required || visibleOptional.has(col.key),
      sortable: col.sortable ?? false,
    };
  });
}
```

Keep `gap`, `MARKER_WIDTH`, and `TITLE_MIN_WIDTH` constants unchanged.

**Step 3: Replace `TableRow` with a generic version**

Delete the old `TableRow` component and its `TableRowProps`. Replace with:

```typescript
interface GenericTableRowProps<T> {
  item: T;
  selected: boolean;
  marked: boolean;
  showMarker: boolean;
  columns: ColumnDef<T>[];
  computedColumns: ComputedColumn[];
  getPrefix?: (item: T) => string;
  getCollapseIndicator?: (item: T) => string;
}

const GenericTableRow = memo(
  function GenericTableRow<T>({
    item,
    selected,
    marked,
    showMarker,
    columns,
    computedColumns,
    getPrefix,
    getCollapseIndicator,
  }: GenericTableRowProps<T>) {
    const { accent, accentBg } = useThemeStore((s) => s.colors);
    const prefix = getPrefix ? getPrefix(item) : '';
    const collapseIndicator = getCollapseIndicator
      ? getCollapseIndicator(item)
      : '';

    return (
      <Box {...(marked && !selected ? { backgroundColor: accentBg } : {})}>
        {showMarker && (
          <Box width={MARKER_WIDTH}>
            <Text color={accent}>{selected ? '>' : ' '}</Text>
          </Box>
        )}
        {columns.map((colDef, i) => {
          const computed = computedColumns[i]!;
          if (!computed.visible) return null;
          const isLast = i === computedColumns.findLastIndex((c) => c.visible);
          return (
            <Box
              key={colDef.key}
              width={computed.width}
              marginRight={isLast ? 0 : gap}
              overflowX="hidden"
            >
              {i === 0 && (prefix || collapseIndicator) ? (
                <Text wrap="truncate">
                  {prefix}
                  {collapseIndicator}
                  {colDef.render(item, selected)}
                </Text>
              ) : (
                colDef.render(item, selected)
              )}
            </Box>
          );
        })}
      </Box>
    );
  },
) as <T>(props: GenericTableRowProps<T>) => React.ReactElement;
```

Note: The tree prefix/collapseIndicator is prepended to the **first visible column** (which is typically the title/name column). This matches current behavior where the prefix goes before the title. If the first column is the ID column (like WorkItemList), the prefix should go on the flex column instead. We'll handle this by having the `render` function for the flex column include the prefix internally — see Task 2.

Actually, let's simplify: remove prefix/collapseIndicator from GenericTableRow entirely. Instead, each view's column `render` function handles its own prefix logic. This is cleaner — the row component just calls `render()` for each cell.

Revised `GenericTableRow`:

```typescript
interface GenericTableRowProps<T> {
  item: T;
  selected: boolean;
  marked: boolean;
  showMarker: boolean;
  columns: ColumnDef<T>[];
  computedColumns: ComputedColumn[];
}

const GenericTableRow = memo(
  function GenericTableRow<T>({
    item,
    selected,
    marked,
    showMarker,
    columns,
    computedColumns,
  }: GenericTableRowProps<T>) {
    const { accent, accentBg } = useThemeStore((s) => s.colors);

    return (
      <Box {...(marked && !selected ? { backgroundColor: accentBg } : {})}>
        {showMarker && (
          <Box width={MARKER_WIDTH}>
            <Text color={accent}>{selected ? '>' : ' '}</Text>
          </Box>
        )}
        {columns.map((colDef, i) => {
          const computed = computedColumns[i]!;
          if (!computed.visible) return null;
          const isLast = i === computedColumns.findLastIndex((c) => c.visible);
          return (
            <Box
              key={colDef.key}
              width={computed.width}
              marginRight={isLast ? 0 : gap}
              overflowX="hidden"
            >
              {colDef.render(item, selected)}
            </Box>
          );
        })}
      </Box>
    );
  },
) as <T>(props: GenericTableRowProps<T>) => React.ReactElement;
```

**Step 4: Replace `TableLayoutInner` with a generic version**

Delete the old `TableLayoutInner` and the `sortedHeaderLabel` function. Replace with:

```typescript
function sortedHeaderLabel(
  baseLabel: string,
  column: string,
  sortStack: SortEntry[],
): string {
  const idx = sortStack.findIndex((e) => e.column === column);
  if (idx === -1) return baseLabel;
  const entry = sortStack[idx]!;
  const arrow = entry.direction === 'asc' ? '\u25B2' : '\u25BC';
  const pos = sortStack.length > 1 ? `${idx + 1}` : '';
  return `${baseLabel} ${pos}${arrow}`;
}

function TableLayoutInner<T>({
  items,
  columns,
  cursor,
  terminalWidth,
  getKey,
  showMarker = true,
  isMarked,
  sortStack,
}: TableLayoutProps<T>) {
  const { mutedDim } = useThemeStore((s) => s.colors);
  const ss = sortStack ?? [];

  const computedColumns = useMemo(
    () => computeVisibleColumns(items, columns, terminalWidth, showMarker),
    [items, columns, terminalWidth, showMarker],
  );

  return (
    <>
      {/* Header */}
      <Box>
        {showMarker && (
          <Box width={MARKER_WIDTH}>
            <Text> </Text>
          </Box>
        )}
        {columns.map((colDef, i) => {
          const computed = computedColumns[i]!;
          if (!computed.visible) return null;
          const isLast = i === computedColumns.findLastIndex((c) => c.visible);
          return (
            <Box
              key={colDef.key}
              width={computed.width}
              marginRight={isLast ? 0 : gap}
            >
              <Text bold underline>
                {computed.sortable
                  ? sortedHeaderLabel(computed.header, colDef.key, ss)
                  : computed.header}
              </Text>
            </Box>
          );
        })}
      </Box>

      {/* Non-visible sort indicators */}
      {(() => {
        const nonVisibleSorts = ss.filter(
          (e) => !computedColumns.some((c) => c.key === e.column && c.visible),
        );
        if (nonVisibleSorts.length === 0) return null;
        const parts = nonVisibleSorts.map((e) => {
          const idx = ss.indexOf(e);
          const arrow = e.direction === 'asc' ? '\u25B2' : '\u25BC';
          const pos = ss.length > 1 ? `${idx + 1}` : '';
          const label = e.column.charAt(0).toUpperCase() + e.column.slice(1);
          return `${label} ${pos}${arrow}`;
        });
        return (
          <Box>
            <Text dimColor={mutedDim}>Sorted by: {parts.join(', ')}</Text>
          </Box>
        );
      })()}

      {/* Rows */}
      {items.map((item, idx) => (
        <GenericTableRow
          key={getKey(item)}
          item={item}
          selected={idx === cursor}
          marked={isMarked ? isMarked(item) : false}
          showMarker={showMarker}
          columns={columns}
          computedColumns={computedColumns}
        />
      ))}
    </>
  );
}

export const TableLayout = memo(TableLayoutInner) as <T>(
  props: TableLayoutProps<T>,
) => React.ReactElement;
```

**Step 5: Remove the `BackendCapabilities` import**

The generic TableLayout no longer imports or uses `BackendCapabilities` or `TreeItem`. Remove:
```typescript
import type { BackendCapabilities } from '../backends/types.js';
import type { TreeItem } from './buildTree.js';
```

**Step 6: Run build to check types**

Run: `npm run build`
Expected: May have errors in WorkItemList.tsx since its call site hasn't been updated yet. That's fine — Task 2 fixes it.

**Step 7: Commit**

```
feat: generalize TableLayout into generic <T> component
```

---

### Task 2: Migrate WorkItemList to Generic TableLayout

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Define WorkItem column config**

Add a function (or constant factory) in WorkItemList.tsx that builds the `ColumnDef<TreeItem>[]` array. This moves the rendering logic that was previously inside the old `TableRow` into per-column `render` functions.

```typescript
import type { ColumnDef } from './TableLayout.js';

function buildWorkItemColumns(
  capabilities: BackendCapabilities,
  collapsedIds: Set<string>,
  accent: string,
): ColumnDef<TreeItem>[] {
  const cols: ColumnDef<TreeItem>[] = [
    {
      key: 'id',
      header: 'ID',
      width: 0, // will be set dynamically below
      required: true,
      sortable: true,
      render: (treeItem, selected) => {
        const { item, isCrossType } = treeItem;
        const dimmed = isCrossType && !selected;
        return (
          <Text
            color={selected ? accent : undefined}
            bold={selected}
            dimColor={dimmed}
          >
            {item.id}
          </Text>
        );
      },
    },
    {
      key: 'title',
      header: 'Title',
      width: -1, // flex
      required: true,
      sortable: true,
      render: (treeItem, selected) => {
        const { item, prefix, isCrossType, hasChildren } = treeItem;
        const dimmed = isCrossType && !selected;
        const typeLabel = isCrossType ? ` (${item.type})` : '';
        const collapseIndicator = hasChildren
          ? collapsedIds.has(item.id)
            ? '\u25B6 '
            : '\u25BC '
          : '  ';
        return (
          <Text
            color={selected ? accent : undefined}
            bold={selected}
            dimColor={dimmed}
            wrap="truncate"
          >
            {capabilities.relationships ? prefix : ''}
            {collapseIndicator}
            {item.title}
            {typeLabel}
          </Text>
        );
      },
    },
  ];

  // Status — always add, responsive hiding handled by TableLayout
  cols.push({
    key: 'status',
    header: 'Status',
    width: 14,
    hidePriority: 3,
    sortable: true,
    render: (treeItem, _selected) => {
      const { item, isCrossType } = treeItem;
      const dimmed = isCrossType && !_selected;
      const hasUnresolvedDeps =
        capabilities.fields.dependsOn && item.dependsOn.length > 0;
      return (
        <>
          {hasUnresolvedDeps && <Text dimColor={dimmed}>{'⧗ '}</Text>}
          <ColorPill field="status" value={item.status} />
        </>
      );
    },
  });

  // Assignee
  if (capabilities.fields.assignee) {
    cols.push({
      key: 'assignee',
      header: 'Assignee',
      width: 20,
      hidePriority: 4,
      sortable: true,
      hasData: (items) => items.some((ti) => !!ti.item.assignee),
      render: (treeItem, selected) => {
        const { item, isCrossType } = treeItem;
        const dimmed = isCrossType && !selected;
        return (
          <Text
            color={selected ? accent : undefined}
            bold={selected}
            dimColor={dimmed}
            wrap="truncate"
          >
            {item.assignee}
          </Text>
        );
      },
    });
  }

  // Labels
  if (capabilities.fields.labels) {
    cols.push({
      key: 'labels',
      header: 'Labels',
      width: 20,
      hidePriority: 2,
      hasData: (items) => items.some((ti) => ti.item.labels.length > 0),
      render: (treeItem) => {
        const labels = treeItem.item.labels;
        const maxWidth = 20;
        const rendered: string[] = [];
        let usedWidth = 0;
        for (const label of labels) {
          const pillWidth = label.length + 2;
          const needed = usedWidth === 0 ? pillWidth : pillWidth + 1;
          if (usedWidth + needed > maxWidth) {
            const remaining = labels.length - rendered.length;
            if (remaining > 0) {
              return (
                <Box gap={1}>
                  {rendered.map((l) => (
                    <ColorPill key={l} field="label" value={l} />
                  ))}
                  <Text dimColor>+{remaining}</Text>
                </Box>
              );
            }
            break;
          }
          rendered.push(label);
          usedWidth += needed;
        }
        return (
          <Box gap={1}>
            {rendered.map((l) => (
              <ColorPill key={l} field="label" value={l} />
            ))}
          </Box>
        );
      },
    });
  }

  // Priority
  if (capabilities.fields.priority) {
    cols.push({
      key: 'priority',
      header: 'Priority',
      width: 12,
      hidePriority: 1,
      sortable: true,
      hasData: (items) => items.some((ti) => !!ti.item.priority),
      render: (treeItem) =>
        treeItem.item.priority ? (
          <ColorPill field="priority" value={treeItem.item.priority} />
        ) : (
          <Text> </Text>
        ),
    });
  }

  return cols;
}
```

**Step 2: Dynamically set ID column width**

The ID column width depends on the longest visible ID. Compute this where the columns are built — either as a `useMemo` wrapping `buildWorkItemColumns`, or set the ID column's width after computing it:

```typescript
const workItemColumns = useMemo(() => {
  const maxIdLen = visibleTreeItems.reduce(
    (max, { item }) => Math.max(max, item.id.length),
    2,
  );
  const cols = buildWorkItemColumns(capabilities, collapsedIds, accent);
  // Set ID column width dynamically
  cols[0]!.width = maxIdLen + 2; // +2 for gap
  return cols;
}, [visibleTreeItems, capabilities, collapsedIds, accent]);
```

**Step 3: Update the TableLayout call site**

Replace:
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

With:
```tsx
<TableLayout
  items={visibleTreeItems}
  columns={workItemColumns}
  cursor={viewport.visibleCursor}
  terminalWidth={terminalWidth}
  getKey={(ti) => `${ti.item.id}-${ti.item.type}`}
  isMarked={(ti) => markedIds.has(ti.item.id)}
  sortStack={sortStack}
/>
```

**Step 4: Remove unused imports**

Remove the `BackendCapabilities` import from WorkItemList if it was only used for the old TableLayout props (likely still used elsewhere in the component — check before removing).

**Step 5: Run build and test**

Run: `npm run build && npm test`
Expected: Build passes. All existing tests pass. The WorkItemList rendering should be identical to before.

**Step 6: Commit**

```
refactor: migrate WorkItemList to generic TableLayout columns
```

---

### Task 3: Migrate PullRequestList to Generic TableLayout

**Files:**
- Modify: `src/components/PullRequestList.tsx`

**Step 1: Add imports and define column config**

Add to PullRequestList.tsx:

```typescript
import { useStdout } from 'ink';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import type { PullRequest } from '../types.js';

function buildPrColumns(
  accent: string,
  muted: string,
  mutedDim: boolean,
): ColumnDef<PullRequest>[] {
  return [
    {
      key: 'number',
      header: '#',
      width: 8,
      required: true,
      render: (pr, selected) => (
        <Text color={selected ? accent : undefined} bold={selected}>
          #{pr.number}
        </Text>
      ),
    },
    {
      key: 'title',
      header: 'Title',
      width: -1, // flex
      required: true,
      render: (pr, selected) => (
        <Text
          color={selected ? accent : undefined}
          bold={selected}
          wrap="truncate"
        >
          {pr.title}
        </Text>
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: 12,
      hidePriority: 3,
      render: (pr) => <ColorPill field="status" value={pr.status} />,
    },
    {
      key: 'branches',
      header: 'Branches',
      width: 30,
      hidePriority: 2,
      render: (pr, selected) => (
        <Text
          color={selected ? undefined : muted}
          dimColor={!selected ? mutedDim : undefined}
          wrap="truncate"
        >
          {pr.sourceBranch} {'\u2192'} {pr.targetBranch}
        </Text>
      ),
    },
    {
      key: 'author',
      header: 'Author',
      width: 16,
      hidePriority: 1,
      render: (pr, selected) => (
        <Text
          color={selected ? accent : undefined}
          wrap="truncate"
        >
          {pr.author}
        </Text>
      ),
    },
    {
      key: 'links',
      header: 'Links',
      width: 6,
      hidePriority: 0,
      render: (pr) => (
        <Text>
          {pr.linkedItems.length > 0 ? String(pr.linkedItems.length) : ''}
        </Text>
      ),
    },
  ];
}
```

**Step 2: Replace the inline table rendering**

Replace the header row and data rows section (lines ~100-181 in PullRequestList.tsx) with:

```tsx
const { columns: termWidth } = useStdout();
const prColumns = useMemo(
  () => buildPrColumns(accent, muted, mutedDim),
  [accent, muted, mutedDim],
);

// In the JSX, replace the <Box flexDirection="column"> block:
<TableLayout
  items={pullRequests}
  columns={prColumns}
  cursor={clampedCursor}
  terminalWidth={termWidth ?? 80}
  getKey={(pr) => pr.id}
/>
```

Remove the manual truncation logic (the `title.length > 37` and `branches.length > 27` code). The responsive column widths and `overflowX="hidden"` handle truncation.

**Step 3: Remove unused imports**

The `ColorPill` import stays (used in column render functions). But remove any inline `<Box width={...}>` rendering that was replaced.

**Step 4: Run build and test**

Run: `npm run build && npm test`
Expected: Build passes. PullRequestList.test.tsx still passes (it only checks the export exists).

**Step 5: Visual check**

Run: `npm start` and navigate to the PR list (press `P`). Verify:
- Columns are responsive to terminal width
- Selection uses accent `>` marker instead of inverse video
- Status shows as ColorPill
- No visual regressions

**Step 6: Commit**

```
refactor: migrate PullRequestList to generic TableLayout
```

---

### Task 4: Migrate BranchList to Generic TableLayout

**Files:**
- Modify: `src/components/BranchList.tsx`

**Step 1: Add imports and define column config**

Add to BranchList.tsx:

```typescript
import { useStdout } from 'ink';
import { TableLayout } from './TableLayout.js';
import type { ColumnDef } from './TableLayout.js';
import type { BranchRow } from '../git.js';

function relativeTime(isoDate: string): string {
  if (!isoDate) return '';
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function buildBranchColumns(
  accent: string,
  muted: string,
  mutedDim: boolean,
): ColumnDef<BranchRow>[] {
  return [
    {
      key: 'branch',
      header: 'Branch',
      width: -1, // flex
      required: true,
      render: (row, selected) => {
        const isTic = row.branch.name.startsWith('tic/');
        const prefix = row.branch.current ? '* ' : '  ';
        return (
          <Text
            color={selected ? accent : isTic ? accent : undefined}
            bold={selected || isTic}
            wrap="truncate"
          >
            {prefix}
            {row.branch.name}
          </Text>
        );
      },
    },
    {
      key: 'item',
      header: 'Item',
      width: 30,
      hidePriority: 3,
      render: (row, selected) => {
        const display = row.linkedItem
          ? `#${row.linkedItem.id} ${row.linkedItem.title}`
          : '';
        return (
          <Text
            color={
              row.linkedItem ? (selected ? undefined : muted) : undefined
            }
            dimColor={!row.linkedItem ? mutedDim : undefined}
            wrap="truncate"
          >
            {display}
          </Text>
        );
      },
    },
    {
      key: 'worktree',
      header: 'Worktree',
      width: 10,
      hidePriority: 1,
      render: (row) => <Text>{row.worktree ? '\u2713' : ''}</Text>,
    },
    {
      key: 'remote',
      header: 'Remote',
      width: 10,
      hidePriority: 2,
      render: (row) => {
        if (!row.branch.upstream) return <Text>--</Text>;
        const parts: string[] = [];
        if (row.branch.ahead > 0) parts.push(`\u2191${row.branch.ahead}`);
        if (row.branch.behind > 0) parts.push(`\u2193${row.branch.behind}`);
        return <Text>{parts.length > 0 ? parts.join(' ') : '\u2713'}</Text>;
      },
    },
    {
      key: 'time',
      header: 'Last Commit',
      width: 10,
      hidePriority: 0,
      render: (row, selected) => (
        <Text
          color={selected ? undefined : muted}
          dimColor={!selected ? mutedDim : undefined}
        >
          {relativeTime(row.branch.lastCommitDate)}
        </Text>
      ),
    },
  ];
}
```

**Step 2: Replace the inline table rendering**

Replace the header row and data rows section (lines ~391-489 in BranchList.tsx) with:

```tsx
const { columns: termWidth } = useStdout();
const branchColumns = useMemo(
  () => buildBranchColumns(accent, muted, mutedDim),
  [accent, muted, mutedDim],
);

// In the JSX, replace the <Box flexDirection="column"> containing header + data rows:
<TableLayout
  items={rows}
  columns={branchColumns}
  cursor={clampedCursor}
  terminalWidth={termWidth ?? 80}
  getKey={(row) => row.branch.name}
/>
```

**Step 3: Move `relativeTime` out of the component**

The `relativeTime` helper was previously defined inside the component body. It's now a module-level function (see Step 1). Remove the old in-component definition.

**Step 4: Remove unused imports and code**

Remove any manual truncation logic. Keep all keyboard handling, confirmation, input mode, and toast logic unchanged.

**Step 5: Run build and test**

Run: `npm run build && npm test`
Expected: Build passes. All tests pass.

**Step 6: Visual check**

Run: `npm start` and navigate to the branch list (press `B`). Verify:
- Columns are responsive to terminal width
- Selection uses accent `>` marker
- `tic/*` branches still show accent color and bold
- Current branch still shows `*` prefix
- Worktree, remote, and time columns still render correctly
- Confirmation and input overlays still work

**Step 7: Commit**

```
refactor: migrate BranchList to generic TableLayout
```

---

### Task 5: Verify and Polish

**Files:**
- All modified files

**Step 1: Run full verification**

Run: `npm run build && npm test && npm run lint && npm run format:check`
Expected: All pass.

**Step 2: Fix any lint or format issues**

Run: `npm run format && npm run lint:fix`

**Step 3: Manual smoke test**

Run `npm start` and test all three list views:
- WorkItemList: tree expand/collapse, sort, marks, detail panel, color pills
- PullRequestList: navigation, status pills, open in browser
- BranchList: switch, delete, merge, push, new branch, worktree

**Step 4: Final commit if any fixes were needed**

```
chore: fix lint and format after TableLayout generalization
```

---

### Task 6: Update Tests

**Files:**
- Modify: `src/components/PullRequestList.test.tsx` (add rendering test)

**Step 1: Add a basic rendering test for PullRequestList**

The existing test only checks the export. Since we changed the rendering, add a snapshot or assertion test if the test infrastructure supports Ink component rendering. If not, the export-exists test is sufficient — the build verification in Task 5 confirms type-safety.

**Step 2: Commit if tests were added**

```
test: add rendering tests for PullRequestList with TableLayout
```
