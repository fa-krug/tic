# Saved Filters/Views Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add client-side filtering across 5 fields (status, type, priority, assignee, labels) and saved named views stored in `.tic/config.yml`.

**Architecture:** New `filterStore` (Zustand vanilla) holds active filter state. Filter picker overlay reuses existing `OverlayPanel` multi-select mode. Views persist via `configStore.update()`. Filtering logic applied in `WorkItemList` after existing type filter.

**Tech Stack:** TypeScript, Zustand, React/Ink, Vitest

---

### Task 1: Add ViewFilters and SavedView types

**Files:**
- Create: `src/filters.ts`

**Step 1: Create the types file**

```typescript
// src/filters.ts
import type { SortEntry } from './stores/listViewStore.js';

export interface ViewFilters {
  statuses?: string[];
  types?: string[];
  priorities?: string[];
  assignees?: string[];
  labels?: string[];
}

export interface SavedView {
  name: string;
  filters: ViewFilters;
  sort?: SortEntry[];
}

/**
 * Apply ViewFilters to a list of work items.
 * Each non-empty array is an inclusion filter (OR within field, AND across fields).
 */
export function applyFilters<
  T extends {
    status: string;
    type: string;
    priority: string;
    assignee: string;
    labels: string[];
  },
>(items: T[], filters: ViewFilters): T[] {
  let result = items;
  if (filters.statuses?.length) {
    result = result.filter((i) => filters.statuses!.includes(i.status));
  }
  if (filters.types?.length) {
    result = result.filter((i) => filters.types!.includes(i.type));
  }
  if (filters.priorities?.length) {
    result = result.filter((i) => filters.priorities!.includes(i.priority));
  }
  if (filters.assignees?.length) {
    result = result.filter((i) => filters.assignees!.includes(i.assignee));
  }
  if (filters.labels?.length) {
    result = result.filter((i) =>
      i.labels.some((l) => filters.labels!.includes(l)),
    );
  }
  return result;
}

/** Count the total number of active filter values across all fields. */
export function countActiveFilters(filters: ViewFilters): number {
  return (
    (filters.statuses?.length ?? 0) +
    (filters.types?.length ?? 0) +
    (filters.priorities?.length ?? 0) +
    (filters.assignees?.length ?? 0) +
    (filters.labels?.length ?? 0)
  );
}

/** Summarize active filters as a short string, e.g. "status: open, done | type: bug" */
export function summarizeFilters(filters: ViewFilters): string {
  const parts: string[] = [];
  if (filters.statuses?.length) parts.push(`status: ${filters.statuses.join(', ')}`);
  if (filters.types?.length) parts.push(`type: ${filters.types.join(', ')}`);
  if (filters.priorities?.length) parts.push(`priority: ${filters.priorities.join(', ')}`);
  if (filters.assignees?.length) parts.push(`assignee: ${filters.assignees.join(', ')}`);
  if (filters.labels?.length) parts.push(`labels: ${filters.labels.join(', ')}`);
  return parts.join(' | ');
}
```

**Step 2: Run build to verify types compile**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/filters.ts
git commit -m "feat(filters): add ViewFilters, SavedView types and applyFilters function"
```

---

### Task 2: Test the applyFilters function

**Files:**
- Create: `src/filters.test.ts`

**Step 1: Write the tests**

```typescript
// src/filters.test.ts
import { describe, it, expect } from 'vitest';
import { applyFilters, countActiveFilters, summarizeFilters } from './filters.js';

const items = [
  { id: '1', status: 'open', type: 'bug', priority: 'high', assignee: 'alice', labels: ['frontend'] },
  { id: '2', status: 'done', type: 'task', priority: 'low', assignee: 'bob', labels: ['backend'] },
  { id: '3', status: 'open', type: 'task', priority: 'medium', assignee: 'alice', labels: ['frontend', 'urgent'] },
  { id: '4', status: 'in-progress', type: 'bug', priority: 'critical', assignee: 'charlie', labels: [] },
];

describe('applyFilters', () => {
  it('returns all items when filters are empty', () => {
    expect(applyFilters(items, {})).toEqual(items);
  });

  it('filters by status', () => {
    const result = applyFilters(items, { statuses: ['open'] });
    expect(result.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('filters by multiple statuses (OR)', () => {
    const result = applyFilters(items, { statuses: ['open', 'done'] });
    expect(result.map((i) => i.id)).toEqual(['1', '2', '3']);
  });

  it('filters by type', () => {
    const result = applyFilters(items, { types: ['bug'] });
    expect(result.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('filters by priority', () => {
    const result = applyFilters(items, { priorities: ['high', 'critical'] });
    expect(result.map((i) => i.id)).toEqual(['1', '4']);
  });

  it('filters by assignee', () => {
    const result = applyFilters(items, { assignees: ['alice'] });
    expect(result.map((i) => i.id)).toEqual(['1', '3']);
  });

  it('filters by labels (item matches if any label matches)', () => {
    const result = applyFilters(items, { labels: ['urgent'] });
    expect(result.map((i) => i.id)).toEqual(['3']);
  });

  it('ANDs across fields', () => {
    const result = applyFilters(items, { statuses: ['open'], types: ['bug'] });
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('empty array means no filter for that field', () => {
    const result = applyFilters(items, { statuses: [] });
    expect(result).toEqual(items);
  });
});

describe('countActiveFilters', () => {
  it('returns 0 for empty filters', () => {
    expect(countActiveFilters({})).toBe(0);
  });

  it('counts total filter values across fields', () => {
    expect(countActiveFilters({ statuses: ['open', 'done'], types: ['bug'] })).toBe(3);
  });
});

describe('summarizeFilters', () => {
  it('returns empty string for no filters', () => {
    expect(summarizeFilters({})).toBe('');
  });

  it('summarizes multiple fields', () => {
    expect(summarizeFilters({ statuses: ['open'], types: ['bug'] })).toBe('status: open | type: bug');
  });
});
```

**Step 2: Run tests to verify they pass**

Run: `npx vitest run src/filters.test.ts`
Expected: PASS (all tests green — implementation was already written in Task 1)

**Step 3: Commit**

```bash
git add src/filters.test.ts
git commit -m "test(filters): add tests for applyFilters, countActiveFilters, summarizeFilters"
```

---

### Task 3: Add views field to Config

**Files:**
- Modify: `src/backends/local/config.ts:6-24` (Config interface)
- Modify: `src/backends/local/config.test.ts` (add views round-trip test)

**Step 1: Write the failing test**

Add to the bottom of `src/backends/local/config.test.ts`, before the final `});`:

```typescript
  it('reads config with saved views', async () => {
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(
      path.join(ticDir, 'config.yml'),
      `statuses:
  - open
current_iteration: v1
iterations:
  - v1
next_id: 1
views:
  - name: My bugs
    filters:
      statuses:
        - open
      types:
        - bug
    sort:
      - column: priority
        direction: asc
`,
    );
    const config = await readConfig(tmpDir);
    expect(config.views).toEqual([
      {
        name: 'My bugs',
        filters: { statuses: ['open'], types: ['bug'] },
        sort: [{ column: 'priority', direction: 'asc' }],
      },
    ]);
  });

  it('writes config with views and reads them back', async () => {
    await writeConfig(tmpDir, {
      ...defaultConfig,
      views: [
        {
          name: 'Test view',
          filters: { priorities: ['high'] },
        },
      ],
    });
    const config = await readConfig(tmpDir);
    expect(config.views).toEqual([
      { name: 'Test view', filters: { priorities: ['high'] } },
    ]);
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: FAIL — `config.views` doesn't exist on the type yet (TypeScript error)

**Step 3: Add views to Config interface**

In `src/backends/local/config.ts`, add after line 23 (before the closing `}` of the `Config` interface):

```typescript
  views?: Array<{
    name: string;
    filters: {
      statuses?: string[];
      types?: string[];
      priorities?: string[];
      assignees?: string[];
      labels?: string[];
    };
    sort?: Array<{ column: string; direction: string }>;
  }>;
```

Note: We use inline types here rather than importing `SavedView` to avoid circular deps (config.ts is a low-level module). The shape matches `SavedView` from `src/filters.ts`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/local/config.ts src/backends/local/config.test.ts
git commit -m "feat(config): add views field to Config interface"
```

---

### Task 4: Create filterStore

**Files:**
- Create: `src/stores/filterStore.ts`
- Create: `src/stores/filterStore.test.ts`

**Step 1: Write the failing tests**

```typescript
// src/stores/filterStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { filterStore } from './filterStore.js';

beforeEach(() => {
  filterStore.getState().clearFilters();
});

describe('filterStore', () => {
  it('starts with empty filters', () => {
    const state = filterStore.getState();
    expect(state.activeFilters).toEqual({});
    expect(state.activeViewName).toBeNull();
  });

  it('setFilters replaces all filters', () => {
    filterStore.getState().setFilters({ statuses: ['open'], types: ['bug'] });
    expect(filterStore.getState().activeFilters).toEqual({
      statuses: ['open'],
      types: ['bug'],
    });
  });

  it('setFilters clears activeViewName', () => {
    filterStore.setState({ activeViewName: 'old view' });
    filterStore.getState().setFilters({ statuses: ['open'] });
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('clearFilters resets to empty', () => {
    filterStore.getState().setFilters({ statuses: ['open'] });
    filterStore.getState().clearFilters();
    expect(filterStore.getState().activeFilters).toEqual({});
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('toggleFilter adds a value to empty field', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toEqual(['open']);
  });

  it('toggleFilter adds a second value', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'done');
    expect(filterStore.getState().activeFilters.statuses).toEqual(['open', 'done']);
  });

  it('toggleFilter removes an existing value', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'done');
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toEqual(['done']);
  });

  it('toggleFilter removes field when last value toggled off', () => {
    filterStore.getState().toggleFilter('statuses', 'open');
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeFilters.statuses).toBeUndefined();
  });

  it('toggleFilter clears activeViewName', () => {
    filterStore.setState({ activeViewName: 'a view' });
    filterStore.getState().toggleFilter('statuses', 'open');
    expect(filterStore.getState().activeViewName).toBeNull();
  });

  it('loadView sets filters and activeViewName', () => {
    filterStore.getState().loadView({
      name: 'My bugs',
      filters: { statuses: ['open'], types: ['bug'] },
    });
    expect(filterStore.getState().activeFilters).toEqual({
      statuses: ['open'],
      types: ['bug'],
    });
    expect(filterStore.getState().activeViewName).toBe('My bugs');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/filterStore.test.ts`
Expected: FAIL — module not found

**Step 3: Implement the store**

```typescript
// src/stores/filterStore.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import type { ViewFilters, SavedView } from '../filters.js';

export interface FilterStoreState {
  activeFilters: ViewFilters;
  activeViewName: string | null;

  setFilters: (filters: ViewFilters) => void;
  clearFilters: () => void;
  toggleFilter: (field: keyof ViewFilters, value: string) => void;
  loadView: (view: SavedView) => void;
}

export const filterStore = createStore<FilterStoreState>((set) => ({
  activeFilters: {},
  activeViewName: null,

  setFilters: (filters) => set({ activeFilters: filters, activeViewName: null }),

  clearFilters: () => set({ activeFilters: {}, activeViewName: null }),

  toggleFilter: (field, value) =>
    set((state) => {
      const current = state.activeFilters[field] ?? [];
      const idx = current.indexOf(value);
      let next: string[];
      if (idx === -1) {
        next = [...current, value];
      } else {
        next = current.filter((_, i) => i !== idx);
      }
      const nextFilters = { ...state.activeFilters };
      if (next.length === 0) {
        delete nextFilters[field];
      } else {
        nextFilters[field] = next;
      }
      return { activeFilters: nextFilters, activeViewName: null };
    }),

  loadView: (view) =>
    set({ activeFilters: { ...view.filters }, activeViewName: view.name }),
}));

export function useFilterStore<T>(selector: (state: FilterStoreState) => T): T {
  return useStore(filterStore, selector);
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/filterStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/filterStore.ts src/stores/filterStore.test.ts
git commit -m "feat(filters): add filterStore with toggle, set, clear, loadView"
```

---

### Task 5: Add setSortStack to listViewStore

**Files:**
- Modify: `src/stores/listViewStore.ts:19-38` (interface + actions)
- Modify: `src/stores/listViewStore.test.ts` (add test)

**Step 1: Write the failing test**

Add to `src/stores/listViewStore.test.ts` inside the `sortStack` describe block, before its closing `});`:

```typescript
    it('setSortStack replaces the entire stack', () => {
      listViewStore.getState().toggleSortColumn('priority');
      listViewStore.getState().setSortStack([
        { column: 'status', direction: 'desc' },
        { column: 'title', direction: 'asc' },
      ]);
      expect(listViewStore.getState().sortStack).toEqual([
        { column: 'status', direction: 'desc' },
        { column: 'title', direction: 'asc' },
      ]);
    });

    it('setSortStack with empty array clears sort', () => {
      listViewStore.getState().toggleSortColumn('priority');
      listViewStore.getState().setSortStack([]);
      expect(listViewStore.getState().sortStack).toEqual([]);
    });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: FAIL — `setSortStack` is not a function

**Step 3: Add setSortStack action**

In `src/stores/listViewStore.ts`:

Add to the `ListViewState` interface (after `clearSort: () => void;` at line 37):
```typescript
  setSortStack: (stack: SortEntry[]) => void;
```

Add to the store implementation (after `clearSort` at line 116):
```typescript
  setSortStack: (stack) => set({ sortStack: stack }),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/listViewStore.ts src/stores/listViewStore.test.ts
git commit -m "feat(listView): add setSortStack action for saved views"
```

---

### Task 6: Add overlay types to uiStore

**Files:**
- Modify: `src/stores/uiStore.ts:4-22` (ActiveOverlay union)

**Step 1: Add new overlay types**

In `src/stores/uiStore.ts`, add these three new entries to the `ActiveOverlay` type union, after `| { type: 'sort-picker' }` (line 17):

```typescript
  | { type: 'filter-picker' }
  | { type: 'view-picker' }
  | { type: 'save-view-input' }
  | { type: 'delete-view-picker' }
```

**Step 2: Run build to verify it compiles**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat(ui): add filter-picker, view-picker, save-view-input, delete-view-picker overlay types"
```

---

### Task 7: Add commands to command registry

**Files:**
- Modify: `src/commands.ts:14-23` (CommandContext interface)
- Modify: `src/commands.ts:33-191` (commands array)

**Step 1: Extend CommandContext**

In `src/commands.ts`, add two fields to the `CommandContext` interface (after `gitAvailable: boolean;` at line 22):

```typescript
  hasActiveFilters: boolean;
  hasSavedViews: boolean;
```

**Step 2: Add new commands**

In `src/commands.ts`, add to the `commands` array before the `// Other` comment (line 176):

```typescript
  {
    id: 'filter',
    label: 'Filter...',
    category: 'Actions',
    shortcut: 'F',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'clear-filters',
    label: 'Clear filters',
    category: 'Actions',
    shortcut: 'X',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'load-view',
    label: 'Load view...',
    category: 'Actions',
    shortcut: 'V',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSavedViews,
  },
  {
    id: 'save-view',
    label: 'Save current view...',
    category: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasActiveFilters,
  },
  {
    id: 'delete-view',
    label: 'Delete view...',
    category: 'Actions',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSavedViews,
  },
```

**Step 3: Run build to verify it compiles**

Run: `npm run build`
Expected: PASS (may see errors in WorkItemList.tsx where `commandContext` is built — we'll fix that in Task 8)

**Step 4: Commit**

```bash
git add src/commands.ts
git commit -m "feat(commands): add filter, clear-filters, load-view, save-view, delete-view commands"
```

---

### Task 8: Wire up filtering and keybindings in WorkItemList

This is the main integration task. It wires up:
- Filter store subscription
- `F`, `V`, `X` keybindings
- Filter picker overlay rendering
- View picker overlay rendering
- Save view input overlay rendering
- Delete view picker overlay rendering
- Filter badge in header
- Filtering logic in item pipeline
- Command palette handling for new commands
- Command context updates

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add imports**

At the top of `WorkItemList.tsx`, add these imports (after the existing import block):

```typescript
import { filterStore, useFilterStore } from '../stores/filterStore.js';
import { applyFilters, countActiveFilters, summarizeFilters, type ViewFilters, type SavedView } from '../filters.js';
```

**Step 2: Subscribe to filter store state**

Inside `WorkItemList()`, after the `useListViewStore` block (~line 148), add:

```typescript
  const { activeFilters, activeViewName } = useFilterStore(
    useShallow((s) => ({
      activeFilters: s.activeFilters,
      activeViewName: s.activeViewName,
    })),
  );
  const filterCount = useMemo(() => countActiveFilters(activeFilters), [activeFilters]);
```

Also subscribe to saved views from config store (after the existing `useConfigStore` selectors ~line 134):

```typescript
  const savedViews = useConfigStore((s) => s.config.views ?? []);
```

**Step 3: Apply filters in the item pipeline**

Replace the existing items filter (lines 249-252):

```typescript
  const items = useMemo(
    () => allItems.filter((item) => item.type === activeType),
    [allItems, activeType],
  );
```

With:

```typescript
  const items = useMemo(() => {
    // If type filter is active in filters, it overrides the type tab
    const hasTypeFilter = (activeFilters.types?.length ?? 0) > 0;
    let filtered = hasTypeFilter
      ? allItems
      : allItems.filter((item) => item.type === activeType);
    filtered = applyFilters(filtered, activeFilters);
    return filtered;
  }, [allItems, activeType, activeFilters]);
```

**Step 4: Update commandContext**

Update the `commandContext` object (~line 709) to include the new fields:

```typescript
  const commandContext: CommandContext = {
    screen: 'list',
    markedCount: markedIds.size,
    hasSelectedItem: treeItems.length > 0 && treeItems[cursor] !== undefined,
    capabilities,
    types,
    activeType,
    hasSyncManager: syncManager !== null,
    gitAvailable,
    hasActiveFilters: filterCount > 0,
    hasSavedViews: savedViews.length > 0,
  };
```

**Step 5: Add F, V, X keybindings**

In the main input handler (Block 3, after the `if (input === 'O')` block at ~line 598), add:

```typescript
      if (input === 'F') {
        openOverlay({ type: 'filter-picker' });
      }

      if (input === 'V' && savedViews.length > 0) {
        openOverlay({ type: 'view-picker' });
      }

      if (input === 'X' && filterCount > 0) {
        filterStore.getState().clearFilters();
        setToast('Filters cleared');
      }
```

**Step 6: Handle new commands in handleCommandSelect**

Add cases to `handleCommandSelect` switch (before the `case 'quit':` at ~line 921):

```typescript
      case 'filter':
        openOverlay({ type: 'filter-picker' });
        break;
      case 'clear-filters':
        filterStore.getState().clearFilters();
        setToast('Filters cleared');
        break;
      case 'load-view':
        openOverlay({ type: 'view-picker' });
        break;
      case 'save-view':
        openOverlay({ type: 'save-view-input' });
        break;
      case 'delete-view':
        openOverlay({ type: 'delete-view-picker' });
        break;
```

**Step 7: Build filter picker items**

After the `sortPickerItems` useMemo (~line 797), add:

```typescript
  const filterPickerItems: OverlayItem[] = useMemo(() => {
    const items: OverlayItem[] = [];

    if (filterCount > 0) {
      items.push({ id: '__clear__', label: 'Clear all filters', value: '__clear__' });
    }

    for (const s of statuses) {
      items.push({
        id: `status-${s}`,
        label: s,
        value: s,
        category: 'Status',
        selected: activeFilters.statuses?.includes(s),
      });
    }

    for (const p of ['critical', 'high', 'medium', 'low']) {
      if (!capabilities.fields.priority) continue;
      items.push({
        id: `priority-${p}`,
        label: p.charAt(0).toUpperCase() + p.slice(1),
        value: p,
        category: 'Priority',
        selected: activeFilters.priorities?.includes(p),
      });
    }

    for (const t of types) {
      items.push({
        id: `type-${t}`,
        label: t.charAt(0).toUpperCase() + t.slice(1),
        value: t,
        category: 'Type',
        selected: activeFilters.types?.includes(t),
      });
    }

    for (const a of assignees) {
      if (!capabilities.fields.assignee) continue;
      items.push({
        id: `assignee-${a}`,
        label: a,
        value: a,
        category: 'Assignee',
        selected: activeFilters.assignees?.includes(a),
      });
    }

    for (const l of labelSuggestions) {
      if (!capabilities.fields.labels) continue;
      items.push({
        id: `label-${l}`,
        label: l,
        value: l,
        category: 'Labels',
        selected: activeFilters.labels?.includes(l),
      });
    }

    return items;
  }, [statuses, types, assignees, labelSuggestions, capabilities, activeFilters, filterCount]);
```

**Step 8: Build view picker items**

After the filter picker items, add:

```typescript
  const viewPickerItems: OverlayItem[] = useMemo(() => {
    return savedViews.map((v) => ({
      id: v.name,
      label: v.name,
      value: v.name,
      hint: summarizeFilters(v.filters),
    }));
  }, [savedViews]);
```

**Step 9: Add filter picker overlay rendering**

In the JSX overlay chain, after the `sort-picker` overlay block (~line 1464), add before the `delete-confirm` overlay:

```typescript
        ) : activeOverlay?.type === 'filter-picker' ? (
          (() => {
            const handleFilterConfirm = (selected: OverlayItem[]) => {
              const newFilters: ViewFilters = {};
              for (const item of selected) {
                const cat = item.category;
                if (cat === 'Status') {
                  (newFilters.statuses ??= []).push(item.value);
                } else if (cat === 'Priority') {
                  (newFilters.priorities ??= []).push(item.value);
                } else if (cat === 'Type') {
                  (newFilters.types ??= []).push(item.value);
                } else if (cat === 'Assignee') {
                  (newFilters.assignees ??= []).push(item.value);
                } else if (cat === 'Labels') {
                  (newFilters.labels ??= []).push(item.value);
                }
              }
              filterStore.getState().setFilters(newFilters);
              closeOverlay();
              const count = countActiveFilters(newFilters);
              if (count > 0) {
                setToast(`${count} filter${count === 1 ? '' : 's'} applied`);
              } else {
                setToast('Filters cleared');
              }
            };

            // Check if "Clear all" was selected via single-select path
            const handleFilterSelect = (item: OverlayItem) => {
              if (item.value === '__clear__') {
                filterStore.getState().clearFilters();
                closeOverlay();
                setToast('Filters cleared');
              }
            };

            return (
              <OverlayPanel
                title={filterCount > 0 ? `Filter [${filterCount} active]` : 'Filter'}
                items={filterPickerItems}
                multiSelect
                onSelect={handleFilterSelect}
                onConfirm={handleFilterConfirm}
                onCancel={() => closeOverlay()}
                placeholder="Type to filter..."
                footer="space toggle  enter confirm  esc cancel"
              />
            );
          })()
```

**Step 10: Add view picker overlay rendering**

After the filter-picker overlay block:

```typescript
        ) : activeOverlay?.type === 'view-picker' ? (
          <OverlayPanel
            title="Load View"
            items={viewPickerItems}
            onSelect={(item) => {
              const view = savedViews.find((v) => v.name === item.value);
              if (view) {
                filterStore.getState().loadView(view as SavedView);
                if (view.sort) {
                  listViewStore.getState().setSortStack(view.sort as SortEntry[]);
                }
                closeOverlay();
                setToast(`View "${view.name}" loaded`);
              }
            }}
            onCancel={() => closeOverlay()}
          />
```

**Step 11: Add save view input overlay rendering**

After the view-picker overlay block:

```typescript
        ) : activeOverlay?.type === 'save-view-input' ? (
          <OverlayPanel
            title="Save View"
            items={[]}
            allowFreeform
            onSelect={() => {}}
            onSubmitFreeform={(name) => {
              if (!name.trim()) {
                closeOverlay();
                return;
              }
              const newView = {
                name: name.trim(),
                filters: { ...activeFilters },
                ...(sortStack.length > 0 ? { sort: [...sortStack] } : {}),
              };
              const existing = savedViews.filter((v) => v.name !== name.trim());
              void configStore.getState().update({
                views: [...existing, newView],
              });
              filterStore.setState({ activeViewName: name.trim() });
              closeOverlay();
              setToast(`View "${name.trim()}" saved`);
            }}
            onCancel={() => closeOverlay()}
            placeholder="Enter view name..."
            emptyMessage="Type a name and press enter"
          />
```

**Step 12: Add delete view picker overlay rendering**

After the save-view-input overlay block:

```typescript
        ) : activeOverlay?.type === 'delete-view-picker' ? (
          <OverlayPanel
            title="Delete View"
            items={viewPickerItems}
            onSelect={(item) => {
              const remaining = savedViews.filter((v) => v.name !== item.value);
              void configStore.getState().update({ views: remaining });
              if (activeViewName === item.value) {
                filterStore.setState({ activeViewName: null });
              }
              closeOverlay();
              setToast(`View "${item.value}" deleted`);
            }}
            onCancel={() => closeOverlay()}
          />
```

**Step 13: Add filter badge in header**

In the JSX header section (~line 984-994), add the filter badge after the marked count display:

```typescript
          {filterCount > 0 && (
            <Text color="yellow">
              {` [${filterCount} filter${filterCount === 1 ? '' : 's'}${activeViewName ? `: ${activeViewName}` : ''}]`}
            </Text>
          )}
```

Add this right after the closing `)}` of the markedCount block (line 992).

**Step 14: Import SortEntry type**

Make sure `SortEntry` is imported. It should already be available via the existing `import type { SortColumn } from '../stores/listViewStore.js';` line. Change this to:

```typescript
import type { SortColumn, SortEntry } from '../stores/listViewStore.js';
```

**Step 15: Run build to verify everything compiles**

Run: `npm run build`
Expected: PASS

**Step 16: Run all tests to make sure nothing is broken**

Run: `npm test`
Expected: PASS

**Step 17: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat(filters): wire up filter picker, view picker, save/delete views, F/V/X keybindings"
```

---

### Task 9: Add keybindings to HelpScreen

**Files:**
- Modify: `src/components/HelpScreen.tsx:45-98` (list screen shortcuts)

**Step 1: Add shortcuts**

In `src/components/HelpScreen.tsx`, in the `case 'list'` block, add these entries to the `actions` array (after the `O` / `Order by column` entry at line 53):

```typescript
      actions.push({ key: 'F', description: 'Filter items' });
      actions.push({ key: 'X', description: 'Clear all filters' });
```

And add to the `switching` array (after the existing entries, before `switching.push({ key: ',', description: 'Settings' });` at line 84):

```typescript
      switching.push({ key: 'V', description: 'Load saved view' });
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/HelpScreen.tsx
git commit -m "docs(help): add F, V, X keybinding documentation"
```

---

### Task 10: Final verification

**Step 1: Run full build**

Run: `npm run build`
Expected: PASS

**Step 2: Run all tests**

Run: `npm test`
Expected: PASS

**Step 3: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 4: Run format check**

Run: `npm run format:check`
Expected: PASS (if not, run `npm run format` first, then commit formatting)

**Step 5: Manual smoke test**

Run: `npm start`

Test checklist:
- [ ] Press `F` — filter picker opens with statuses, types, priorities, assignees, labels grouped by category
- [ ] Toggle some filters with Space, confirm with Enter — items filter correctly
- [ ] Badge shows `[N filters]` in header
- [ ] Press `X` — filters clear, badge disappears
- [ ] Press `:` — command palette shows "Filter...", "Clear filters" (when filters active), "Save current view..." (when filters active), "Load view..." and "Delete view..." (when views exist)
- [ ] Set some filters, run "Save current view" from palette, type a name — view saved
- [ ] Press `V` — view picker shows saved view, select it — filters + sort applied
- [ ] "Delete view" from palette — removes the view
- [ ] Press `?` — help screen shows F, V, X entries
