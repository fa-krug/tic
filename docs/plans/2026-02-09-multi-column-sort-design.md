# Multi-Column Sort Design

**Issue**: #20 — Add multi-column sort
**Date**: 2026-02-09

## Problem

Items are displayed in backend-native order (filesystem order for local, update-time for remote backends) with no user control over sorting. Users can't sort by priority, status, assignee, or other fields.

## Solution

Add column-based sorting with a keyboard shortcut (`O` for "Order by") and command palette entry. Support multi-level sort stacking (e.g., sort by priority, then by status within each priority). Sorting operates within each tree level, preserving parent-child hierarchy.

## Sort State

Sort state lives in `listViewStore` as a `sortStack` — an ordered array of `{ column, direction }` entries. Session-only, not persisted to config.

```ts
type SortDirection = 'asc' | 'desc';
type SortColumn = 'id' | 'title' | 'status' | 'priority' | 'assignee' | 'created' | 'updated';

interface SortEntry {
  column: SortColumn;
  direction: SortDirection;
}
```

Store actions:
- `toggleSortColumn(column)` — Three-state cycle: not in stack → add ascending, ascending → flip to descending, descending → remove from stack
- `setSortStack(stack)` — Replace entire stack
- `clearSort()` — Empty the stack

## Sort Execution

Sorting happens after tree building, applied recursively within each level of the hierarchy. A new `sortTree()` function takes a tree and sort stack, returning a sorted copy.

At each level, siblings are sorted using the sort stack as a comparator chain: primary sort (index 0) breaks ties first, then secondary (index 1), etc.

**Comparator rules per column:**
- **ID**: Numeric comparison (parse to number, fall back to string for non-numeric IDs from remote backends)
- **Title**: Case-insensitive string compare
- **Status / Assignee**: Case-insensitive string compare
- **Priority**: Ordinal comparison using rank map (`critical=0, high=1, medium=2, low=3`, empty=last)
- **Created / Updated**: ISO date string comparison (lexicographic works for ISO format)

When the sort stack is empty, items appear in backend-native order (current behavior).

## User Interaction

### Keybinding

`O` opens the sort picker via OverlayPanel in single-select mode. The overlay shows:

- **"Clear sort"** at the top (only when sort stack is non-empty)
- All sortable columns with current state inline:
  - `1 Priority ▼` — position 1, descending (pick to remove)
  - `2 Status ▲` — position 2, ascending (pick to flip to descending)
  - `Assignee` — not in stack (pick to add ascending)

When a column is picked, `toggleSortColumn` fires, the overlay closes, and the list re-renders. Press `O` again to add more levels or adjust.

### Command Palette

A `sort` command in `commands.ts` (category: Actions, shortcut: O, always visible on list screen) opens the same overlay.

### Capability Gating

Priority and assignee entries only appear when the backend supports them (`capabilities.fields.priority` / `capabilities.fields.assignee`).

### Sortable Columns

- ID — always available
- Title — always available
- Status — always available
- Priority — capability-gated
- Assignee — capability-gated
- Created — always available (not a visible column)
- Updated — always available (not a visible column)

## Visual Indicators

### Column Headers

TableLayout receives `sortStack` as a prop. Sorted columns show direction and position:
- Single sort: `Status ▲`
- Multi-level: `Priority 1▼` `Status 2▲`

### Non-Visible Sort Columns

When sorting by created/updated (not displayed as columns), a dim text line appears showing the active sort: `Sorted by: Updated 1▼, Priority 2▲`. Only shown when the stack includes a non-visible column; header arrows suffice otherwise.

## Files to Modify

1. **`src/stores/listViewStore.ts`** — Add `sortStack`, `toggleSortColumn()`, `setSortStack()`, `clearSort()`
2. **`src/components/buildTree.ts`** — Add `sortTree()` function
3. **`src/components/WorkItemList.tsx`** — Wire `O` keybinding, handle sort selection, pass sortStack to buildTree/sortTree and TableLayout
4. **`src/components/TableLayout.tsx`** — Accept `sortStack` prop, render sort indicators on headers
5. **`src/commands.ts`** — Add `sort` command
6. **`src/components/HelpScreen.tsx`** — Add `O` keybinding to Actions group

## Testing

- `listViewStore` — Test `toggleSortColumn` three-state cycle (add ascending, flip descending, remove)
- `buildTree` / `sortTree` — Test single sort, multi-level sort, priority ordinal ranking, empty stack = no-op, hierarchy preservation
- `commands` — Test sort command visibility

## Not in Scope

- Persisting sort to config across sessions
- Custom sort orders for statuses
- Sort by labels (multi-value, ambiguous ordering)
