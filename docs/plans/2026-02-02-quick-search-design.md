# Quick Search / Fuzzy Find

## Overview

Add a "go to item" search overlay to the TUI, activated by pressing `/` from the list view. Users type a query and fuzzy-match against all items across all types and iterations. Selecting a result opens the item's edit form directly.

## Motivation

As projects grow beyond a handful of items, scrolling through the tree to find a specific item becomes slow. Quick search lets users jump directly to any item they can partially recall by title, ID, or label.

## Interaction Flow

1. Press `/` from the list view to open the search overlay.
2. A text input appears at the top of an overlay rendered on top of the dimmed list view.
3. As the user types, results update in real-time using fuzzy matching.
4. Results are grouped: **current iteration** first, then **other iterations**, with a visual separator. Within each group, results are sorted by match quality.
5. Arrow keys navigate the results list.
6. **Enter** opens the selected item's edit form.
7. **Esc** dismisses the search and returns to the list view with the previous selection intact.

## UI Layout

```
┌─ Search ──────────────────────────────┐
│ > bug in auth_                        │
│                                       │
│ Current iteration:                    │
│   ● #12  Auth bug on login     [bug]  │
│   ○ #34  Auth token refresh    [bug]  │
│                                       │
│ Other iterations:                     │
│   ○ #7   Auth bug legacy       [bug]  │
└───────────────────────────────────────┘
```

- `●` indicates the currently highlighted result.
- Each row shows: **ID**, **title**, **labels** (as tags), and **type** indicator.
- Matching characters are displayed in bold/highlight color.
- Maximum 10 visible results with scrolling for longer lists.
- Empty query shows no results, just hint text: "Type to search..."
- No matches shows: "No items found"

## Search Behavior

### Match Fields

- Item title (fuzzy)
- Item ID (fuzzy)
- Item labels (fuzzy)

### Fuzzy Matching

Built-in scoring algorithm (no external dependency). Character-by-character substring matching with bonuses for:

- Consecutive matching characters
- Match at start of word
- Exact prefix match on ID

### Result Grouping

Results are partitioned into two groups:

1. **Current iteration** — items in the active iteration, sorted by match score
2. **Other iterations** — everything else, sorted by match score

If no iterations are configured, show a single flat list sorted by match score.

## Implementation

### Component: `SearchOverlay`

New component in `src/components/SearchOverlay.tsx`. Renders conditionally when search mode is active.

Props:
- `items: WorkItem[]` — all items to search
- `currentIteration: string | null` — for grouping
- `onSelect: (item: WorkItem) => void` — called on Enter
- `onCancel: () => void` — called on Esc

### State Management

The `WorkItemList` component manages a local `isSearching` boolean:

- `/` keypress sets `isSearching = true`
- `SearchOverlay` calls `onCancel` (Esc) or `onSelect` (Enter)
- `onSelect` navigates to the edit form for the chosen item

### Data Flow

- On activation, pass all loaded items to `SearchOverlay`. The list view already fetches items; no new backend calls needed.
- For remote backends, search operates on whatever items have been synced/cached locally. No network requests on keystroke.
- Items across all types are included (not just the active tab).

### Keyboard Handling

| Key | Action |
|-----|--------|
| `/` | Enter search mode (from list view) |
| Any character | Update query, re-filter results |
| Up/Down | Navigate result list |
| Enter | Open selected item's edit form |
| Esc | Exit search, return to list view |

### No New Backend Methods

This feature uses existing `listItems()` calls. No changes to the `Backend` interface.

## Edge Cases

- **Empty query**: Show hint text, no results listed.
- **No matches**: Show "No items found" message.
- **No iterations configured**: Skip grouping, show flat sorted list.
- **Remote backend, items not cached**: Search only what's loaded. No new fetches.
- **Very long titles**: Truncate to fit terminal width.

## Out of Scope

- Persistent filter mode (this is a "go to" action, not a filter)
- Searching item descriptions
- Search history / recent searches
- Regex or structured query syntax
