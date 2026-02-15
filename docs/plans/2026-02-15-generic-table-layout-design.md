# Generic TableLayout Design

## Goal

Generalize `TableLayout` from a WorkItem-specific component into a generic `<T>` table that PullRequestList and BranchList can also use. All three list views share the same responsive column layout, selection styling, and header rendering.

## Current State

- **WorkItemList** uses `TableLayout` — responsive columns, accent-color selection, ColorPill, tree support, sort indicators, marked items
- **PullRequestList** — custom inline table with fixed-width `<Box>` elements, `inverse` selection, manual truncation
- **BranchList** — custom inline table with fixed-width `<Box>` elements, `inverse` selection, manual truncation

## Design

### Column Definition

```typescript
interface ColumnDef<T> {
  key: string;
  header: string;
  width: number;            // fixed width, or -1 for flex (gets remaining space)
  render: (item: T, selected: boolean) => React.ReactNode;
  required?: boolean;       // if true, never hidden (default false)
  hidePriority?: number;    // lower = hidden first when narrow (default 0)
  hasData?: (items: T[]) => boolean;  // skip column if no items have data
  sortable?: boolean;       // show sort indicator in header
}
```

### Generic TableLayout Props

```typescript
interface GenericTableLayoutProps<T> {
  items: T[];
  columns: ColumnDef<T>[];
  cursor: number;
  terminalWidth: number;
  getKey: (item: T) => string;

  // --- Opt-in features ---
  showMarker?: boolean;                       // default true
  getDepth?: (item: T) => number;             // tree indentation
  getPrefix?: (item: T) => string;            // tree drawing chars
  getCollapseIndicator?: (item: T) => string; // collapse/expand icon
  isMarked?: (item: T) => boolean;            // bulk mark highlighting
  sortStack?: SortEntry[];                    // sort indicators
}
```

### Responsive Width Algorithm

Same budget-based approach as today, but driven by `ColumnDef[]`:

1. Allocate marker column (2 chars) if `showMarker` is true
2. Allocate `required: true` columns at their declared widths
3. Budget = terminalWidth minus required columns
4. Add optional columns by descending `hidePriority` (highest kept first), skipping columns where `hasData` returns false
5. Flex column (`width: -1`) gets all remaining space (min 30 chars)

### Selection Styling

All views use consistent accent-color `>` marker (matching WorkItemList today). The `inverse` style in PR/Branch lists is replaced.

### Column Definitions Per View

**WorkItemList** (`ColumnDef<TreeItem>[]`):
- ID (required), Title (flex, required), Status, Assignee, Labels, Priority

**PullRequestList** (`ColumnDef<PullRequest>[]`):
- # (required), Title (flex, required), Status, Branches, Author, Links

**BranchList** (`ColumnDef<BranchRow>[]`):
- Branch (flex, required), Item, Worktree, Remote, Last Commit

### What Changes

| Component | Before | After |
|---|---|---|
| `TableLayout` | WorkItem-specific, hardcoded columns | Generic `<T>`, declarative columns |
| `WorkItemList` | Passes `TreeItem[]` + capabilities | Passes `TreeItem[]` + `ColumnDef<TreeItem>[]` + tree callbacks |
| `PullRequestList` | Custom inline table rendering | Uses `<TableLayout>` with `ColumnDef<PullRequest>[]` |
| `BranchList` | Custom inline table rendering | Uses `<TableLayout>` with `ColumnDef<BranchRow>[]` |

### What Stays

- All keyboard handling in each list component
- Store subscriptions and data flow
- BranchList confirmation dialogs, input mode, toasts
- PullRequestList open-in-browser logic
- WorkItemList viewport scrolling, overlay panel, etc.

### Files Modified

- `src/components/TableLayout.tsx` — generalize to `<T>`
- `src/components/WorkItemList.tsx` — define column config, pass tree callbacks
- `src/components/PullRequestList.tsx` — replace inline table with `<TableLayout>`
- `src/components/BranchList.tsx` — replace inline table with `<TableLayout>`

### Files Not Changed

- `src/components/buildTree.ts` — TreeItem interface unchanged
- All store files — no changes needed
- All backend files — no changes needed
