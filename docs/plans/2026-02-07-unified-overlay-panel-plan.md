# Unified Overlay Panel Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace all overlay/picker/palette components with a single `OverlayPanel` component rendered at the bottom of the list area with consistent filter + select interaction.

**Architecture:** One `OverlayPanel` component handles all overlay types. Each overlay becomes a thin configuration passed as props. The component manages filter input, keyboard navigation, scroll viewport, single-select and multi-select modes, and optional freeform text submission. It renders at the bottom of `WorkItemList` (and `Settings`), replacing both the current top-rendered modal overlays and the inline footer autocomplete inputs.

**Tech Stack:** React 19, Ink 6, TypeScript, Vitest

**Working directory:** `/Users/skrug/PycharmProjects/tic/.worktrees/unified-overlay-panel`

---

### Task 1: Create OverlayPanel types and filter logic

**Files:**
- Create: `src/components/OverlayPanel.tsx`
- Create: `src/components/OverlayPanel.test.ts`

**Step 1: Write the failing test for filterItems**

Create `src/components/OverlayPanel.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { filterItems, groupByCategory, type OverlayItem } from './OverlayPanel.js';

function makeItem(overrides: Partial<OverlayItem> & { id: string }): OverlayItem {
  return {
    label: overrides.id,
    value: overrides.id,
    ...overrides,
  };
}

describe('filterItems', () => {
  const items: OverlayItem[] = [
    makeItem({ id: '1', label: 'Critical' }),
    makeItem({ id: '2', label: 'High' }),
    makeItem({ id: '3', label: 'Medium' }),
    makeItem({ id: '4', label: 'Low' }),
  ];

  it('returns all items when query is empty', () => {
    expect(filterItems(items, '')).toHaveLength(4);
  });

  it('filters by case-insensitive substring', () => {
    const result = filterItems(items, 'cri');
    expect(result).toHaveLength(1);
    expect(result[0]!.label).toBe('Critical');
  });

  it('returns empty array when nothing matches', () => {
    expect(filterItems(items, 'zzz')).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const result = filterItems(items, 'HIGH');
    expect(result.map((i) => i.label)).toContain('High');
  });

  it('matches partial substrings', () => {
    const result = filterItems(items, 'edi');
    expect(result.map((i) => i.label)).toContain('Medium');
  });
});

describe('groupByCategory', () => {
  it('groups items by category preserving order', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'A', category: 'Actions' }),
      makeItem({ id: '2', label: 'B', category: 'Navigation' }),
      makeItem({ id: '3', label: 'C', category: 'Actions' }),
    ];
    const groups = groupByCategory(items);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.category).toBe('Actions');
    expect(groups[0]!.items).toHaveLength(2);
    expect(groups[1]!.category).toBe('Navigation');
    expect(groups[1]!.items).toHaveLength(1);
  });

  it('returns single group with empty category for uncategorized items', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'A' }),
      makeItem({ id: '2', label: 'B' }),
    ];
    const groups = groupByCategory(items);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('');
    expect(groups[0]!.items).toHaveLength(2);
  });

  it('preserves item order within groups', () => {
    const items: OverlayItem[] = [
      makeItem({ id: '1', label: 'Zebra', category: 'Animals' }),
      makeItem({ id: '2', label: 'Apple', category: 'Animals' }),
    ];
    const groups = groupByCategory(items);
    expect(groups[0]!.items[0]!.label).toBe('Zebra');
    expect(groups[0]!.items[1]!.label).toBe('Apple');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/OverlayPanel.test.ts`
Expected: FAIL — module not found

**Step 3: Implement types and filter logic**

Create `src/components/OverlayPanel.tsx`:

```typescript
import { useState, useMemo } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { useScrollViewport } from '../hooks/useScrollViewport.js';

export interface OverlayItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  category?: string;
  selected?: boolean;
}

export interface OverlayItemGroup {
  category: string;
  items: OverlayItem[];
}

export interface OverlayPanelProps {
  title: string;
  items: OverlayItem[];
  onSelect: (item: OverlayItem) => void;
  onCancel: () => void;
  multiSelect?: boolean;
  allowFreeform?: boolean;
  onSubmitFreeform?: (text: string) => void;
  placeholder?: string;
  initialQuery?: string;
  emptyMessage?: string;
  footer?: string;
}

export function filterItems(items: OverlayItem[], query: string): OverlayItem[] {
  if (query.trim() === '') return items;
  const q = query.toLowerCase();
  return items.filter((item) => item.label.toLowerCase().includes(q));
}

export function groupByCategory(items: OverlayItem[]): OverlayItemGroup[] {
  const groups: OverlayItemGroup[] = [];
  const seen = new Map<string, OverlayItemGroup>();

  for (const item of items) {
    const cat = item.category ?? '';
    let group = seen.get(cat);
    if (!group) {
      group = { category: cat, items: [] };
      seen.set(cat, group);
      groups.push(group);
    }
    group.items.push(item);
  }

  return groups;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/components/OverlayPanel.test.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add src/components/OverlayPanel.tsx src/components/OverlayPanel.test.ts
git commit -m "feat(overlay): add OverlayPanel types and filter/group logic"
```

---

### Task 2: Implement OverlayPanel single-select rendering and keyboard handling

**Files:**
- Modify: `src/components/OverlayPanel.tsx`

**Step 1: Implement the OverlayPanel component**

Add the `OverlayPanel` function component to `src/components/OverlayPanel.tsx` after the existing helper functions:

```typescript
export function OverlayPanel({
  title,
  items,
  onSelect,
  onCancel,
  multiSelect = false,
  allowFreeform = false,
  onSubmitFreeform,
  placeholder = 'Type to filter...',
  initialQuery = '',
  emptyMessage = 'No matches',
  footer,
}: OverlayPanelProps) {
  const [query, setQuery] = useState(initialQuery);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [toggled, setToggled] = useState<Set<string>>(() => {
    if (!multiSelect) return new Set();
    return new Set(items.filter((i) => i.selected).map((i) => i.id));
  });

  const filtered = useMemo(() => filterItems(items, query), [items, query]);
  const groups = useMemo(() => groupByCategory(filtered), [filtered]);
  const flatItems = useMemo(
    () => groups.flatMap((g) => g.items),
    [groups],
  );

  const hasCategories = items.some((i) => i.category);

  // Clamp selected index
  const clampedIndex = Math.min(
    selectedIndex,
    Math.max(0, flatItems.length - 1),
  );

  // chromeLines: title(1) + filter input(1) + marginBottom(1) + footer(1) + borders(2) + marginTop(1) = 7
  // Add 1 per category header if categorized
  const categoryCount = hasCategories ? groups.length : 0;
  const viewport = useScrollViewport({
    totalItems: flatItems.length + categoryCount,
    cursor: clampedIndex,
    chromeLines: 7,
    linesPerItem: 1,
  });

  // Cap at half terminal height — useScrollViewport already uses terminal height internally
  // so it naturally caps. We just need to limit item rendering.

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
      return;
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(flatItems.length - 1, i + 1));
      return;
    }
    if (key.return) {
      if (multiSelect) {
        // Confirm with all toggled items
        const selectedItems = items.filter((i) => toggled.has(i.id));
        for (const item of selectedItems) {
          onSelect(item);
        }
        onCancel();
        return;
      }
      if (flatItems.length > 0 && flatItems[clampedIndex]) {
        onSelect(flatItems[clampedIndex]);
      } else if (allowFreeform && query.trim() !== '' && onSubmitFreeform) {
        onSubmitFreeform(query.trim());
      }
      return;
    }
    if (_input === ' ' && multiSelect) {
      const current = flatItems[clampedIndex];
      if (current) {
        setToggled((prev) => {
          const next = new Set(prev);
          if (next.has(current.id)) {
            next.delete(current.id);
          } else {
            next.add(current.id);
          }
          return next;
        });
      }
      return;
    }
  });

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  const defaultFooter = multiSelect
    ? 'space toggle  enter confirm  esc cancel'
    : '↑↓ navigate  enter select  esc cancel';

  // Render items with viewport slicing
  const visibleItems = flatItems.slice(viewport.start, viewport.end);
  const visibleGroups = hasCategories
    ? groupByCategory(visibleItems)
    : [{ category: '', items: visibleItems }];

  let selectableIdx = 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text bold color="cyan">
          {title}{' '}
        </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder={placeholder}
        />
      </Box>

      {flatItems.length === 0 && (
        <Text dimColor>{emptyMessage}</Text>
      )}

      {visibleGroups.map((group) => (
        <Box key={group.category || '__default'} flexDirection="column">
          {group.category !== '' && (
            <Text dimColor bold>
              {group.category}
            </Text>
          )}
          {group.items.map((item) => {
            const idx = selectableIdx++;
            const isSelected = idx === viewport.visibleCursor;
            const isToggled = toggled.has(item.id);

            return (
              <Box key={item.id}>
                <Text
                  color={isSelected ? 'cyan' : undefined}
                  bold={isSelected}
                >
                  {multiSelect
                    ? isToggled
                      ? '☑ '
                      : '☐ '
                    : isSelected
                      ? '● '
                      : '  '}
                </Text>
                <Box flexGrow={1}>
                  <Text
                    color={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                  >
                    {item.label}
                  </Text>
                </Box>
                {item.hint && <Text dimColor> {item.hint}</Text>}
              </Box>
            );
          })}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>{footer ?? defaultFooter}</Text>
      </Box>
    </Box>
  );
}
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run existing tests still pass**

Run: `npx vitest run src/components/OverlayPanel.test.ts`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/OverlayPanel.tsx
git commit -m "feat(overlay): implement OverlayPanel component with filter, select, and multi-select"
```

---

### Task 3: Replace PriorityPicker with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx` (lines ~925-945 and imports)

**Step 1: Update the import in WorkItemList**

In `src/components/WorkItemList.tsx`, replace the `PriorityPicker` import with `OverlayPanel`:

Remove:
```typescript
import { PriorityPicker } from './PriorityPicker.js';
```

Add (if not already present):
```typescript
import { OverlayPanel, type OverlayItem } from './OverlayPanel.js';
```

**Step 2: Replace the PriorityPicker rendering**

In `WorkItemList.tsx`, find the `activeOverlay?.type === 'priority-picker'` block (around line 925) and replace:

Old:
```typescript
{activeOverlay?.type === 'priority-picker' && (
  <PriorityPicker
    onSelect={(priority) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { priority });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Priority updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

New:
```typescript
{activeOverlay?.type === 'priority-picker' && (
  <OverlayPanel
    title="Set Priority"
    items={[
      { id: 'critical', label: 'Critical', value: 'critical' },
      { id: 'high', label: 'High', value: 'high' },
      { id: 'medium', label: 'Medium', value: 'medium' },
      { id: 'low', label: 'Low', value: 'low' },
    ]}
    onSelect={(item) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      const priority = item.value as 'low' | 'medium' | 'high' | 'critical';
      void (async () => {
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { priority });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Priority updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): replace PriorityPicker with OverlayPanel"
```

---

### Task 4: Replace StatusPicker, TypePicker, and TemplatePicker with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx` (lines ~879-959 and imports)

**Step 1: Remove old imports from WorkItemList**

Remove these imports from `WorkItemList.tsx`:
```typescript
import { StatusPicker } from './StatusPicker.js';
import { TypePicker } from './TypePicker.js';
import { TemplatePicker } from './TemplatePicker.js';
```

**Step 2: Replace StatusPicker rendering**

Find the `activeOverlay?.type === 'status-picker'` block and replace:

```typescript
{activeOverlay?.type === 'status-picker' && (
  <OverlayPanel
    title="Set Status"
    items={statuses.map((s) => ({ id: s, label: s, value: s }))}
    onSelect={(item) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { status: item.value });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Status updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

**Step 3: Replace TypePicker rendering**

Find the `activeOverlay?.type === 'type-picker'` block and replace:

```typescript
{activeOverlay?.type === 'type-picker' && (
  <OverlayPanel
    title="Set Type"
    items={types.map((t) => ({
      id: t,
      label: t.charAt(0).toUpperCase() + t.slice(1),
      value: t,
    }))}
    onSelect={(item) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { type: item.value });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Type updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

**Step 4: Replace TemplatePicker rendering**

Find the `activeOverlay?.type === 'template-picker'` block and replace:

```typescript
{activeOverlay?.type === 'template-picker' && (
  <OverlayPanel
    title="Select Template"
    items={[
      { id: '__none__', label: 'No template', value: '__none__' },
      ...templates.map((t) => ({ id: t.slug, label: t.name, value: t.slug })),
    ]}
    onSelect={(item) => {
      closeOverlay();
      setFormMode('item');
      if (item.value === '__none__') {
        setActiveTemplate(null);
      } else {
        const template = templates.find((t) => t.slug === item.value);
        setActiveTemplate(template ?? null);
      }
      selectWorkItem(null);
      navigate('form');
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): replace StatusPicker, TypePicker, TemplatePicker with OverlayPanel"
```

---

### Task 5: Replace BulkMenu with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Remove BulkMenu import**

Remove from `WorkItemList.tsx`:
```typescript
import { BulkMenu, type BulkAction } from './BulkMenu.js';
```

Keep the `BulkAction` type — define it locally or import from a shared location. Since it's only used here, define it locally:

```typescript
type BulkAction =
  | 'status'
  | 'iteration'
  | 'parent'
  | 'type'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'delete';
```

**Step 2: Replace BulkMenu rendering**

Find the `activeOverlay?.type === 'bulk-menu'` block and replace. Build the items list dynamically from capabilities, moving the shortcut text to `hint`:

```typescript
{activeOverlay?.type === 'bulk-menu' && (() => {
  const bulkItems: OverlayItem[] = [];
  bulkItems.push({ id: 'status', label: 'Set status...', value: 'status', hint: 's' });
  if (capabilities.iterations) {
    bulkItems.push({ id: 'iteration', label: 'Set iteration...', value: 'iteration', hint: 'i' });
  }
  if (capabilities.fields.parent) {
    bulkItems.push({ id: 'parent', label: 'Set parent...', value: 'parent', hint: 'p' });
  }
  if (capabilities.customTypes) {
    bulkItems.push({ id: 'type', label: 'Set type...', value: 'type', hint: 't' });
  }
  if (capabilities.fields.priority) {
    bulkItems.push({ id: 'priority', label: 'Set priority...', value: 'priority', hint: 'P' });
  }
  if (capabilities.fields.assignee) {
    bulkItems.push({ id: 'assignee', label: 'Set assignee...', value: 'assignee', hint: 'a' });
  }
  if (capabilities.fields.labels) {
    bulkItems.push({ id: 'labels', label: 'Set labels...', value: 'labels', hint: 'l' });
  }
  bulkItems.push({ id: 'delete', label: 'Delete', value: 'delete', hint: 'd' });
  const count = markedIds.size > 0 ? markedIds.size : 1;
  return (
    <OverlayPanel
      title={`Bulk Actions (${count} ${count === 1 ? 'item' : 'items'})`}
      items={bulkItems}
      onSelect={(item) => {
        closeOverlay();
        handleBulkAction(item.value as BulkAction);
      }}
      onCancel={() => closeOverlay()}
    />
  );
})()}
```

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): replace BulkMenu with OverlayPanel"
```

---

### Task 6: Replace delete confirmation with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx` (delete-confirm rendering ~line 1136 and Block 2 input handler ~line 368)

**Step 1: Replace the delete confirmation rendering**

Find the `activeOverlay?.type === 'delete-confirm'` block in the footer area (~line 1136) and replace:

Old:
```typescript
) : activeOverlay?.type === 'delete-confirm' ? (
  <Text color="red">
    Delete {activeOverlay.targetIds.length} item
    {activeOverlay.targetIds.length > 1 ? 's' : ''}? (y/n)
  </Text>
```

New:
```typescript
) : activeOverlay?.type === 'delete-confirm' ? (
  <OverlayPanel
    title={`Delete ${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''}?`}
    items={[
      { id: 'yes', label: 'Yes, delete', value: 'yes' },
      { id: 'no', label: 'Cancel', value: 'no' },
    ]}
    onSelect={(item) => {
      if (item.value === 'yes') {
        const targetIds = activeOverlay.targetIds;
        if (!backend) return;
        void (async () => {
          for (const id of targetIds) {
            await backend.cachedDeleteWorkItem(id);
            await queueWrite('delete', id);
          }
          closeOverlay();
          for (const id of targetIds) {
            removeDeletedItem(id);
          }
          setCursor(Math.max(0, cursor - 1));
          refreshData();
          setToast(
            targetIds.length === 1
              ? `Item #${targetIds[0]} deleted`
              : `${targetIds.length} items deleted`,
          );
        })();
      } else {
        closeOverlay();
      }
    }}
    onCancel={() => closeOverlay()}
  />
```

**Step 2: Remove Block 2 (delete confirmation input handler)**

Find and remove the entire "Block 2: Delete confirmation handler" `useInput` call (~lines 368-397). The OverlayPanel now handles Enter/Escape internally.

**Step 3: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): replace delete confirmation with OverlayPanel"
```

---

### Task 7: Replace SearchOverlay with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx`

This is more complex because SearchOverlay uses fuzzy matching and iteration grouping. The item-building logic moves to `WorkItemList`.

**Step 1: Remove SearchOverlay import, keep fuzzyMatch**

Remove:
```typescript
import { SearchOverlay } from './SearchOverlay.js';
```

Add:
```typescript
import { fuzzyMatch } from './fuzzyMatch.js';
```

(Check if `fuzzyMatch` is already imported — it may be used by SearchOverlay internally. If not already imported, add it.)

**Step 2: Replace SearchOverlay rendering**

Find the `activeOverlay?.type === 'search'` block (~line 851) and the special conditional that separates search from other overlays. Replace with OverlayPanel rendered in the same bottom position as everything else.

The key change: search overlay currently renders INSTEAD of the list (at the top). Now it renders at the bottom like all other overlays. The list remains visible behind it.

Build search items from `allSearchItems` using fuzzyMatch, and use `category` for iteration grouping:

```typescript
{activeOverlay?.type === 'search' && (() => {
  // Search items are built dynamically from the query, so we use
  // OverlayPanel's onSelect and build items externally.
  // However, OverlayPanel handles its own filtering. For search,
  // we want fuzzy matching instead of simple substring.
  // Solution: Pass all items, let OverlayPanel filter by label substring.
  // This is slightly different from the original fuzzy match on title+id+labels,
  // but keeps the unified model. The label contains the title, so it works.
  const searchItems: OverlayItem[] = allSearchItems.map((item) => ({
    id: item.id,
    label: `#${item.id} ${item.title}`,
    value: item.id,
    hint: item.type,
    category: item.iteration === iteration ? 'Current iteration' : (item.iteration ?? 'No iteration'),
  }));
  return (
    <OverlayPanel
      title="Search"
      items={searchItems}
      placeholder="Type to search..."
      onSelect={(selected) => {
        const item = allSearchItems.find((i) => i.id === selected.value);
        if (item) handleSearchSelect(item);
      }}
      onCancel={handleSearchCancel}
    />
  );
})()}
```

**Step 3: Remove the special search/non-search conditional wrapper**

Currently the render has:
```typescript
{activeOverlay?.type === 'search' && (<SearchOverlay .../>)}
{activeOverlay?.type !== 'search' && (<>...all other content...</>)}
```

Remove the `activeOverlay?.type !== 'search'` wrapper. All overlays now render at the bottom, so the list always shows. Move the search OverlayPanel to the same position as the other overlays (in the footer area).

**Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass. Note: `SearchOverlay.test.ts` tests `groupResults` which is exported from `SearchOverlay.tsx`. We need to either keep `groupResults` in a separate file or update the test import. Since we're deleting `SearchOverlay.tsx` later, move `groupResults` to `fuzzyMatch.ts` and update the test.

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): replace SearchOverlay with OverlayPanel"
```

---

### Task 8: Replace CommandPalette with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Remove CommandPalette import**

Remove:
```typescript
import { CommandPalette } from './CommandPalette.js';
```

**Step 2: Replace CommandPalette rendering**

Find the `activeOverlay?.type === 'command-palette'` block and replace. Map `Command` objects to `OverlayItem`, using `category` for grouping and `shortcut` as `hint`:

```typescript
{activeOverlay?.type === 'command-palette' && (
  <OverlayPanel
    title="Commands"
    items={paletteCommands.map((cmd) => ({
      id: cmd.id,
      label: cmd.label,
      value: cmd.id,
      hint: cmd.shortcut,
      category: cmd.category,
    }))}
    placeholder="Type a command..."
    onSelect={(item) => {
      const cmd = paletteCommands.find((c) => c.id === item.value);
      if (cmd) handleCommandSelect(cmd);
    }}
    onCancel={() => closeOverlay()}
  />
)}
```

**Step 3: Move exported functions from CommandPalette.tsx**

`CommandPalette.test.ts` tests `filterCommands` and `groupByCategory` from `CommandPalette.tsx`. Since we're deleting that file later, move those functions to `commands.ts` (where `Command` type lives) and update the test import.

In `src/commands.ts`, add:
```typescript
export function filterCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === '') return commands;
  const q = query.toLowerCase();
  return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
}

export function groupCommandsByCategory(commands: Command[]): Array<{ category: string; commands: Command[] }> {
  const groups: Array<{ category: string; commands: Command[] }> = [];
  for (const category of CATEGORIES) {
    const cmds = commands.filter((c) => c.category === category);
    if (cmds.length > 0) {
      groups.push({ category, commands: cmds });
    }
  }
  return groups;
}
```

Update `src/components/CommandPalette.test.ts` imports to point to `../commands.js`.

**Step 4: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx src/commands.ts src/components/CommandPalette.test.ts
git commit -m "refactor(overlay): replace CommandPalette with OverlayPanel"
```

---

### Task 9: Replace inline autocomplete inputs with OverlayPanel

**Files:**
- Modify: `src/components/WorkItemList.tsx` (lines ~1020-1135 and Block 1 input handler)

**Step 1: Replace parent-input rendering**

Find the `activeOverlay?.type === 'parent-input'` block (~line 1020) and replace:

```typescript
) : activeOverlay?.type === 'parent-input' ? (
  <OverlayPanel
    title={`Set Parent (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
    items={parentSuggestions.map((s) => ({
      id: s,
      label: s,
      value: s,
    }))}
    allowFreeform
    onSelect={(item) => {
      handleParentSubmit(item.value);
    }}
    onSubmitFreeform={(text) => {
      handleParentSubmit(text);
    }}
    onCancel={() => closeOverlay()}
    placeholder="Type parent ID or title..."
    emptyMessage="Type a parent ID (empty to clear)"
  />
```

Extract the parent submit logic into a helper function `handleParentSubmit(raw: string)` to avoid duplication:

```typescript
const handleParentSubmit = useCallback((raw: string) => {
  const targetIds = getOverlayTargetIds();
  if (!backend) return;
  void (async () => {
    const trimmed = raw.trim();
    const newParent =
      trimmed === ''
        ? null
        : trimmed.includes(' - ')
          ? trimmed.split(' - ')[0]!.trim()
          : trimmed;
    try {
      for (const id of targetIds) {
        await backend.cachedUpdateWorkItem(id, { parent: newParent });
        await queueWrite('update', id);
      }
      clearWarning();
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'Invalid parent');
    }
    closeOverlay();
    refreshData();
    setToast(
      targetIds.length === 1
        ? 'Parent updated'
        : `${targetIds.length} items updated`,
    );
  })();
}, [backend, closeOverlay, refreshData, setToast, clearWarning, setWarning]);
```

**Step 2: Replace assignee-input rendering**

Similarly replace with OverlayPanel:

```typescript
) : activeOverlay?.type === 'assignee-input' ? (
  <OverlayPanel
    title={`Set Assignee (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
    items={assignees.map((a) => ({ id: a, label: a, value: a }))}
    allowFreeform
    onSelect={(item) => handleAssigneeSubmit(item.value)}
    onSubmitFreeform={(text) => handleAssigneeSubmit(text)}
    onCancel={() => closeOverlay()}
    placeholder="Type assignee name..."
  />
```

Extract `handleAssigneeSubmit` similarly.

**Step 3: Replace labels-input rendering**

This one uses multi-select mode:

```typescript
) : activeOverlay?.type === 'labels-input' ? (
  <OverlayPanel
    title={`Set Labels (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
    items={labelSuggestions.map((l) => ({ id: l, label: l, value: l }))}
    multiSelect
    allowFreeform
    onSelect={(item) => {
      // Called once per toggled item on confirm — collect them
      // Actually, for multi-select we need a different approach.
      // The onSelect is called for each toggled item. We should
      // instead use a callback that receives all selected values.
    }}
    onCancel={() => closeOverlay()}
    placeholder="Type to filter labels..."
  />
```

**Important design adjustment for multi-select:** The current `onSelect` callback fires per-item, but for labels we need all selected labels at once. Modify `OverlayPanel` to support an `onConfirm` callback for multi-select that receives all toggled items:

Add to `OverlayPanelProps`:
```typescript
onConfirm?: (items: OverlayItem[]) => void;  // multi-select: called with all toggled items
```

In the Enter handler for multi-select, call `onConfirm` instead of iterating `onSelect`:
```typescript
if (multiSelect) {
  const selectedItems = items.filter((i) => toggled.has(i.id));
  if (onConfirm) {
    onConfirm(selectedItems);
  }
  onCancel();
  return;
}
```

Then labels becomes:
```typescript
) : activeOverlay?.type === 'labels-input' ? (
  <OverlayPanel
    title={`Set Labels (${activeOverlay.targetIds.length} item${activeOverlay.targetIds.length > 1 ? 's' : ''})`}
    items={labelSuggestions.map((l) => ({ id: l, label: l, value: l }))}
    multiSelect
    allowFreeform
    onSelect={() => {}}
    onConfirm={(selected) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        const labels = selected.map((i) => i.value);
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { labels });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Labels updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onSubmitFreeform={(text) => {
      // Freeform: parse comma-separated labels
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        const labels = text.split(',').map((l) => l.trim()).filter(Boolean);
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, { labels });
          await queueWrite('update', id);
        }
        refreshData();
        setToast(
          targetIds.length === 1
            ? 'Labels updated'
            : `${targetIds.length} items updated`,
        );
      })();
    }}
    onCancel={() => closeOverlay()}
    placeholder="Type to filter labels..."
  />
```

**Step 4: Remove Block 1 (inline input escape handler)**

Remove the "Block 1: Overlay escape handlers for inline inputs" `useInput` call (~lines 331-344). OverlayPanel handles Escape internally.

**Step 5: Remove unused state variables and imports**

Remove from WorkItemList:
- `parentInput` / `setParentInput` state
- `assigneeInput` / `setAssigneeInput` state
- `labelsInput` / `setLabelsInput` state
- `AutocompleteInput` import
- `MultiAutocompleteInput` import

**Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/OverlayPanel.tsx
git commit -m "refactor(overlay): replace inline autocomplete inputs with OverlayPanel"
```

---

### Task 10: Replace DefaultPicker in Settings with OverlayPanel

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Update imports**

Replace:
```typescript
import { DefaultPicker } from './DefaultPicker.js';
```

With:
```typescript
import { OverlayPanel } from './OverlayPanel.js';
```

**Step 2: Replace default-type-picker rendering**

Find the `activeOverlay?.type === 'default-type-picker'` block (~line 571) and replace:

```typescript
{activeOverlay?.type === 'default-type-picker' && (
  <OverlayPanel
    title="Default Type"
    items={config.types.map((t) => ({ id: t, label: t, value: t }))}
    onSelect={(item) => {
      void configStore.getState().update({ defaultType: item.value });
      closeOverlay();
    }}
    onCancel={() => closeOverlay()}
    emptyMessage="(none configured)"
  />
)}
```

**Step 3: Replace default-iteration-picker rendering**

Find the `activeOverlay?.type === 'default-iteration-picker'` block (~line 583) and replace:

```typescript
{activeOverlay?.type === 'default-iteration-picker' && (
  <OverlayPanel
    title="Default Iteration"
    items={config.iterations.map((i) => ({ id: i, label: i, value: i }))}
    onSelect={(item) => {
      void configStore.getState().update({ current_iteration: item.value });
      closeOverlay();
    }}
    onCancel={() => closeOverlay()}
    emptyMessage="(none configured)"
  />
)}
```

**Step 4: Replace delete-template-confirm with OverlayPanel**

Find the `activeOverlay?.type === 'delete-template-confirm'` block and replace with a 2-item OverlayPanel (Yes/Cancel), similar to Task 6. Move the delete logic from the `useInput` handler into the `onSelect` callback.

**Step 5: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 6: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 7: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "refactor(overlay): replace DefaultPicker in Settings with OverlayPanel"
```

---

### Task 11: Move reusable functions, update tests, and delete old components

**Files:**
- Modify: `src/components/fuzzyMatch.ts` — add `groupResults` (moved from SearchOverlay)
- Modify: `src/components/SearchOverlay.test.ts` — rename to `src/components/fuzzyMatch.test.ts`, update imports
- Modify: `src/components/CommandPalette.test.ts` — rename to `src/commands.test.ts`, update imports
- Delete: `src/components/SearchOverlay.tsx`
- Delete: `src/components/CommandPalette.tsx`
- Delete: `src/components/BulkMenu.tsx`
- Delete: `src/components/PriorityPicker.tsx`
- Delete: `src/components/StatusPicker.tsx`
- Delete: `src/components/TypePicker.tsx`
- Delete: `src/components/TemplatePicker.tsx`
- Delete: `src/components/DefaultPicker.tsx`

**Step 1: Move groupResults to fuzzyMatch.ts**

Move the `groupResults` function from `SearchOverlay.tsx` to `src/components/fuzzyMatch.ts` (it already imports FuzzyResult from there).

**Step 2: Move SearchOverlay tests**

Rename `src/components/SearchOverlay.test.ts` to `src/components/fuzzyMatch.test.ts`. Update import:

```typescript
import { groupResults } from './fuzzyMatch.js';
```

**Step 3: Move command utility functions to commands.ts and update test**

If not already done in Task 8, move `filterCommands` and `groupByCategory` to `src/commands.ts`. Rename `src/components/CommandPalette.test.ts` to `src/commands.test.ts`. Update imports.

**Step 4: Delete all old overlay components**

Delete:
- `src/components/SearchOverlay.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/BulkMenu.tsx`
- `src/components/PriorityPicker.tsx`
- `src/components/StatusPicker.tsx`
- `src/components/TypePicker.tsx`
- `src/components/TemplatePicker.tsx`
- `src/components/DefaultPicker.tsx`

**Step 5: Verify no remaining imports of deleted files**

Run: `grep -r "from './SearchOverlay" src/` (and similar for each deleted file)
Expected: No matches (except possibly test files that we already updated)

**Step 6: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 7: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add -A
git commit -m "refactor(overlay): delete old overlay components, relocate utility functions"
```

---

### Task 12: Restructure WorkItemList rendering — all overlays at bottom

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Flatten the rendering structure**

Currently the render return has a complex conditional structure with search at the top and everything else wrapped in a non-search guard. Now that all overlays use OverlayPanel at the bottom, simplify:

1. Remove the `{activeOverlay?.type === 'search' && ...}` top-level block
2. Remove the `{activeOverlay?.type !== 'search' && (<>...</>)}` wrapper
3. The list/table always renders
4. All OverlayPanel instances render in the footer area (after the table, detail panel, and before the help text)

The structure becomes:
```
<Box flexDirection="column">
  {/* Header */}
  <Box marginBottom={1}>...</Box>

  {/* Table (always visible) */}
  <TableLayout ... />

  {/* Empty states */}
  ...

  {/* Detail panel */}
  {showDetailPanel && ...}

  {/* Overlay panel (any type) OR footer help text */}
  <Box marginTop={1}>
    {activeOverlay ? (
      <OverlayPanel ... />  {/* whichever overlay is active */}
    ) : toast ? (
      <Text ...>{toast}</Text>
    ) : (
      <Text dimColor>{helpText}</Text>
    )}
  </Box>
</Box>
```

**Step 2: Verify build compiles**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 3: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(overlay): flatten WorkItemList render — all overlays at bottom"
```

---

### Task 13: Final verification — format, lint, build, test

**Files:** None (verification only)

**Step 1: Format**

Run: `npm run format`

**Step 2: Lint**

Run: `npm run lint`
Fix any issues.

**Step 3: Type check**

Run: `npx tsc --noEmit`
Expected: No errors

**Step 4: Full test suite**

Run: `npm test`
Expected: All tests pass

**Step 5: Format check (matches pre-commit hook)**

Run: `npm run format:check`
Expected: No issues

**Step 6: Commit any formatting fixes**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```
