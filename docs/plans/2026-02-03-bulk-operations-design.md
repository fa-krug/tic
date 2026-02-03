# Bulk Operations Design

## Overview

Add multi-select and bulk operations to the TUI, enabling users to mark multiple items and apply actions to all of them at once. This supports sprint planning, cleanup, and organizing workflows.

## Selection Model

### Marking Items

- Press `m` on any item to toggle its marked state
- Marked items display with a distinct background color (muted highlight that contrasts with cursor)
- Header shows "X marked" when items are marked
- Press `M` (shift+m) to clear all marks at once

### Mark Persistence

Marks persist while:
- Navigating up/down in the list
- Switching type tabs
- Changing iterations

Marks clear on quit.

### Action Rules

- **No marks present:** actions apply to cursor item (current behavior)
- **Marks present:** actions apply to marked items only; cursor item ignored unless also marked

## Keyboard Shortcuts

### Existing Keys (Now Bulk-Aware)

| Key | Action | Bulk Behavior |
|-----|--------|---------------|
| `s` | Cycle status | Cycles all to next status of first marked item |
| `i` | Change iteration | Opens picker, applies choice to all |
| `p` | Set parent | Prompts for ID, applies to all |
| `d` | Delete | Shows confirmation with count, deletes all |

### New Keys

| Key | Action | Behavior |
|-----|--------|----------|
| `t` | Change type | Opens type picker, applies to all |
| `P` | Set priority | Opens priority picker (low/medium/high/critical) |
| `a` | Set assignee | Text input, applies to all |
| `l` | Set labels | Text input (comma-separated), replaces labels on all |
| `b` | Bulk menu | Opens discoverable menu of all bulk actions |
| `m` | Toggle mark | Mark/unmark cursor item |
| `M` | Clear marks | Clear all marks |

## Bulk Menu

Press `b` to open the bulk actions menu.

```
┌─ Bulk Actions (3 marked) ─────────┐
│ › Set status...              (s)  │
│   Set iteration...           (i)  │
│   Set parent...              (p)  │
│   Set type...                (t)  │
│   Set priority...            (P)  │
│   Set assignee...            (a)  │
│   Set labels...              (l)  │
│   ─────────────────────────────   │
│   Delete                     (d)  │
└───────────────────────────────────┘
```

### Menu Behavior

- Header shows "X marked" or "current item" if nothing marked
- Arrow keys navigate, Enter selects, Esc cancels
- Shortcut keys (shown in parentheses) work directly from menu
- Only shows actions the current backend supports

### After Selection

Menu closes and the appropriate picker or input appears (reuses existing components).

## Confirmation and Feedback

### Delete Confirmation

- Shows count: "Delete 5 items?"
- Lists relationship impact: "This will unparent 3 children and remove 2 dependency references"
- Requires y/n confirmation

### Other Actions

- No confirmation required
- Shows "Updated N items" briefly in status area after completion
- Marks preserved after action (enables chaining operations)

### Error Handling

- Partial failures: "Updated X of Y items — Z failed"
- Failed items remain marked for inspection or retry

## Backend Integration

### Capability Awareness

- Bulk menu hides actions the backend doesn't support
- Uses existing `getCapabilities()` method
- No new backend interface changes required

### Execution Model

- Operations execute sequentially (one API call per item)
- Progress indicator: "Updating 3 of 5..." for larger batches
- Future optimization: backends could add optional `bulkUpdate()` method

### Parent Validation

- When setting parent on multiple items, validates none would create circular references
- If any would be invalid, shows error and aborts before applying any changes
- Example: "Cannot set parent: item #12 would create a circular reference"

## Implementation Notes

### State Management

Add to WorkItemList component state:
- `markedIds: Set<string>` — IDs of marked items
- Update header to show mark count
- Pass marked state to row rendering for background color

### New Components

- `BulkMenu` — overlay component for the `b` menu
- `PriorityPicker` — simple picker for priority values (similar to existing pickers)

### Modified Components

- `WorkItemList` — handle `m`, `M`, `b` keys; track marked state; modify action handlers to operate on marked items
- `Header` — display mark count

### Styling

- Marked items: `bgCyan` with `dim` modifier (or similar muted color)
- Cursor on marked item: cursor highlight takes precedence, but mark indicator could use a subtle border or different shade
