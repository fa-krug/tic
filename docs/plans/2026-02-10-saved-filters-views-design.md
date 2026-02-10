# Saved Filters/Views Design

## Problem

Users must re-apply filters every time they start the app. Common views like "my open bugs" can't be saved. Currently only type switching exists — no status, priority, assignee, or label filtering.

## Solution

Add client-side filtering across five fields (status, type, priority, assignee, labels), then let users save and recall named filter+sort combinations as "views" stored in `.tic/config.yml`.

## Data Model

### ViewFilters and SavedView types

New file `src/filters.ts`:

```typescript
interface ViewFilters {
  statuses?: string[];
  types?: string[];
  priorities?: string[];
  assignees?: string[];
  labels?: string[];
}

interface SavedView {
  name: string;
  filters: ViewFilters;
  sort?: SortEntry[];
}
```

Omitted or empty arrays mean "no filter" (show all values for that field).

### Config extension

Add `views?: SavedView[]` to the `Config` interface in `src/backends/local/config.ts`:

```yaml
views:
  - name: "My open bugs"
    filters:
      statuses: ["open", "in-progress"]
      types: ["bug"]
      priorities: ["high", "critical"]
    sort:
      - column: "priority"
        direction: "asc"
  - name: "All tasks"
    filters:
      types: ["task"]
```

## State Management

### filterStore (`src/stores/filterStore.ts`)

Zustand vanilla store, consistent with existing stores:

```typescript
interface FilterState {
  activeFilters: ViewFilters;
  activeViewName: string | null;

  setFilters(filters: ViewFilters): void;
  clearFilters(): void;
  toggleFilter(field: keyof ViewFilters, value: string): void;
  loadView(view: SavedView): void;
}
```

- `setFilters()` — replaces all active filters
- `clearFilters()` — resets to no filters, clears `activeViewName`
- `toggleFilter()` — adds/removes a single value from a field's filter array
- `loadView()` — applies filters from the view and calls `listViewStore.getState().setSortStack(view.sort)` to apply sort

No separate persistence file. Views are saved/deleted through `configStore.update({ views: [...] })`.

### listViewStore addition

Add `setSortStack(stack: SortEntry[])` action to allow views to set sort state directly.

## Filter Picker Overlay

### Trigger

`F` keybinding opens the `filter-picker` overlay.

### UI

Reuses existing OverlayPanel in multi-select mode. Single flat list of all filterable values grouped by category:

```
Status
  ● open
  ● in-progress
    review
    done
Priority
  ● high
  ● critical
    medium
    low
Type
    bug
  ● task
    epic
Assignee
    alice
    bob
Labels
    frontend
    urgent
```

- `●` marks currently active filters
- Fuzzy search works across all entries
- Space to toggle, Enter to confirm
- "Clear all filters" item at top when filters are active

Values come from `backendDataStore` (statuses, types, priorities, assignees, labels are all available).

On close, `filterStore.setFilters()` is called with the new selections.

### Filter badge

A `[N filters]` badge renders in the header area near the type tabs when any filters are active.

## Filtering Logic

Applied in `WorkItemList.tsx` after the existing `activeType` filter (~line 250). Each non-empty array in `activeFilters` is an inclusion filter — the item must match at least one value in the array. All fields are ANDed together.

```typescript
// Pseudocode
if (activeFilters.statuses?.length)
  items = items.filter(i => activeFilters.statuses.includes(i.status));
if (activeFilters.priorities?.length)
  items = items.filter(i => activeFilters.priorities.includes(i.priority));
// ... etc for types, assignees, labels
```

When a type filter is active in `activeFilters`, it overrides the type tab selection, allowing multi-type views.

## Saved Views — Save, Load, Delete

### Save current view

- Command palette command: "Save current view" (id: `save-view`)
- Visible when filters or sort are active
- Opens freeform input overlay prompting for a name
- Persists via `configStore.update({ views: [...existing, newView] })`
- Sets `activeViewName` on filterStore

### Load saved view

- `V` keybinding opens `view-picker` overlay
- Also accessible via command palette: "Load view" (id: `load-view`)
- Visible when saved views exist in config
- Shows view names in OverlayPanel (single-select)
- Each entry shows name plus summary: `status: open, in-progress | type: bug`
- Selecting calls `filterStore.loadView(view)`

### Delete saved view

- Command palette command: "Delete view" (id: `delete-view`)
- Visible when saved views exist
- Opens picker to select which view to delete
- Removes from config via `configStore.update()`

### Clear filters

- `X` keybinding clears all active filters
- Also a command palette command: "Clear filters" (id: `clear-filters`)
- Visible when filters are active
- Resets `activeViewName` to null, empties `activeFilters`

## Keybindings

| Key | Action |
|-----|--------|
| `F` | Open filter picker overlay |
| `V` | Open saved view picker |
| `X` | Clear all active filters |

## Files to Create

| File | Purpose |
|------|---------|
| `src/filters.ts` | `ViewFilters`, `SavedView` types |
| `src/stores/filterStore.ts` | Active filter state + actions |
| `src/stores/filterStore.test.ts` | Store unit tests |
| `src/filters.test.ts` | Filter matching logic tests |

## Files to Modify

| File | Change |
|------|--------|
| `src/backends/local/config.ts` | Add `views?: SavedView[]` to `Config` |
| `src/stores/listViewStore.ts` | Add `setSortStack()` action |
| `src/stores/uiStore.ts` | Add `filter-picker`, `view-picker` overlay types |
| `src/commands.ts` | Add Filter, Save view, Load view, Delete view, Clear filters commands |
| `src/components/WorkItemList.tsx` | Filter logic, `F`/`V`/`X` keybindings, overlay rendering, badge |
| `src/components/HelpScreen.tsx` | Document `F`, `V`, `X` keybindings |

## Not in Scope

- No backend changes — filtering is purely client-side
- No changes to OverlayPanel component — reuses existing modes
- No CLI commands for views (TUI only)
- No default view on startup (can add later)
