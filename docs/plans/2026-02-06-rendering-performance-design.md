# Rendering Performance Optimization

## Problem

The main rendering hot path is: keystroke → store update → WorkItemList re-render → TableLayout/CardLayout re-render → N row components re-render.

Three issues cause unnecessary work:

1. **No component memoization** — TableLayout and CardLayout re-render on every WorkItemList render. Each renders all visible rows (~20-40) as inline JSX with no way for React to skip individual rows.

2. **Broad store selectors** — WorkItemList pulls 10+ fields from `backendDataStore` via a single `useShallow` selector. A change to `loading` triggers re-render even when `items` hasn't changed.

3. **Cursor movement re-renders everything** — Moving the cursor only changes which row is selected, but all rows re-render because there are no memoized row components.

The foundation is solid: viewport slicing limits visible items to ~20-40, and `useMemo` covers expensive tree computations. This work eliminates wasted renders on top of that foundation.

## Approach

### 1. Extract Memoized Row Components

Extract the inline `.map()` bodies in TableLayout and CardLayout into `TableRow` and `CardRow` components wrapped in `React.memo`.

Each row receives pre-computed props:

```ts
interface TableRowProps {
  treeItem: TreeItem;
  selected: boolean;        // pre-computed from cursor === idx
  marked: boolean;          // pre-computed from markedIds.has(id)
  capabilities: BackendCapabilities;
  colId: number;
  collapseIndicator: string; // pre-computed from collapsedIds
}
```

Custom comparator checks `treeItem.item.id`, `selected`, and `marked`. This ensures:

- **Cursor movement** (hot path): only 2 of ~30 rows re-render (old and new selection)
- **Tree rebuilds** (cold path): all rows re-render because TreeItem references change — correct, since data actually changed

Pre-computing `selected`, `marked`, and `collapseIndicator` in the parent loop avoids passing `cursor`, `markedIds`, and `collapsedIds` to rows, which would defeat memoization (cursor changes every keystroke, Sets are reference types).

### 2. React.memo on Layout Components

Wrap `TableLayout` and `CardLayout` with `React.memo` (default shallow comparison).

Props are either primitives (`cursor`), stable store references (`capabilities`, `markedIds`), or `useMemo`-derived references (`treeItems`, `collapsedIds`) — all stable when unchanged, so default `Object.is` comparison works without a custom comparator.

This prevents layout re-renders when WorkItemList re-renders for unrelated reasons (overlay state, warnings, loading toggle).

### 3. Memoize visibleTreeItems Slice

Currently `visibleTreeItems` is an unmemoized `.slice()` that creates a new array reference every render:

```ts
// Before
const visibleTreeItems = treeItems.slice(viewport.start, viewport.end);

// After
const visibleTreeItems = useMemo(
  () => treeItems.slice(viewport.start, viewport.end),
  [treeItems, viewport.start, viewport.end],
);
```

This ensures the memoized layout components see a stable array reference when only unrelated state changes.

### 4. Narrow Store Selectors in WorkItemList

Split the single broad `backendDataStore` selector into purpose-specific selectors grouped by change frequency:

**Rarely changes** (individual selectors):
```ts
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const capabilities = useBackendDataStore((s) => s.capabilities);
```

**Changes on data refresh** (grouped with useShallow):
```ts
const { items: allItems, types, statuses, assignees, labels } =
  useBackendDataStore(useShallow((s) => ({
    items: s.items, types: s.types, statuses: s.statuses,
    assignees: s.assignees, labels: s.labels,
  })));
```

**Changes independently** (individual selectors):
```ts
const iteration = useBackendDataStore((s) => s.currentIteration);
const loading = useBackendDataStore((s) => s.loading);
```

### 5. Extract Store Actions to getState()

Move `navigationStore` action functions from hook selectors to `getState()`, matching the existing pattern for `listViewStore` and `uiStore`:

```ts
// Actions via getState() — stable, never trigger re-renders
const { navigate, navigateToHelp, selectWorkItem, setActiveType, setFormMode, setActiveTemplate } =
  navigationStore.getState();

// Only reactive data via hooks
const activeType = useNavigationStore((s) => s.activeType);
const updateInfo = useNavigationStore((s) => s.updateInfo);
```

Rule: **hooks for reactive data, `getState()` for actions**.

### 6. React.memo on SearchOverlay

SearchOverlay persists while open and does fuzzy search. Memoizing it prevents re-renders from background state changes (e.g., sync updating `loading`).

## What We're NOT Doing

- **Deep comparators on TreeItem** — premature; tree rebuilds are infrequent and re-rendering all visible rows when data changes is correct
- **Memoizing short-lived overlay components** (BulkMenu, PriorityPicker, etc.) — they mount/unmount rather than re-render in place
- **useCallback on inline overlay handlers** — created once at mount time since overlays mount/unmount
- **Module-level store extraction** — keep consistent with existing inside-component pattern

## Files Changed

| File | Changes |
|------|---------|
| `src/components/TableLayout.tsx` | Extract `TableRow` with `React.memo`, wrap `TableLayout` with `React.memo` |
| `src/components/CardLayout.tsx` | Extract `CardRow` with `React.memo`, wrap `CardLayout` with `React.memo` |
| `src/components/SearchOverlay.tsx` | Wrap with `React.memo` |
| `src/components/WorkItemList.tsx` | Split store selectors, extract nav actions to `getState()`, memoize `visibleTreeItems` |

## Expected Impact

| Scenario | Before | After |
|----------|--------|-------|
| Cursor movement | ~30 row re-renders | 2 row re-renders |
| Overlay open/close | Full layout re-render | Layout skipped entirely |
| Loading state toggle | Full tree recomputation | No list re-render |
| Data refresh | ~30 row re-renders | ~30 row re-renders (correct) |
