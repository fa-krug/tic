# Command Palette Design

## Overview

A fuzzy-searchable command overlay triggered by `:` from the list screen. Displays all available actions grouped by category with shortcut hints. Provides a discoverable entry point to every action in tic, while preserving all existing single-key shortcuts for power users.

## Interaction Model

1. User presses `:` on the list screen — overlay appears with full command list
2. User types characters — list filters via fuzzy matching
3. Arrow keys move selection, Enter executes, Esc dismisses
4. Palette closes — the command's action runs (opens form, triggers picker, navigates to screen, etc.)

The palette is **context-aware**. Commands shown depend on:

- **Current screen** (list vs form vs other)
- **Current state** (are items marked? is an item selected?)
- **Backend capabilities** (hide unsupported features)

All existing shortcuts remain unchanged. The palette is an additive layer for discoverability.

## Command Registry

### Categories & Commands

**Actions**

| Command | Shortcut | When |
|---------|----------|------|
| Create item | `c` | list screen |
| Edit item | `Enter` | list, item selected |
| Delete item | `d` | list, item selected |
| Open in browser | `o` | list, item selected |
| Create branch/worktree | `B` | list, item selected |
| Refresh/sync | `r` | list screen |

**Navigation**

| Command | Shortcut | When |
|---------|----------|------|
| Go to iterations | `i` | list screen |
| Go to settings | `,` | list screen |
| Go to status | `s` | list screen |
| Go to help | `?` | list screen |

**Bulk**

| Command | Shortcut | When |
|---------|----------|------|
| Mark/unmark item | `m` | list, item selected |
| Clear all marks | `M` | items marked |
| Set priority | `P` | item selected or items marked |
| Set assignee | `a` | item selected or items marked |
| Set labels | `l` | item selected or items marked |
| Set type | `t` | item selected or items marked |
| Bulk actions menu | `b` | items marked |

**Switching**

| Command | Shortcut | When |
|---------|----------|------|
| Switch to epics | `Tab` | list screen |
| Switch to issues | `Tab` | list screen |
| Switch to tasks | `Tab` | list screen |

**Other**

| Command | Shortcut | When |
|---------|----------|------|
| Quit | `q` | always |

### Data Model

```ts
interface Command {
  id: string;
  label: string;
  category: 'Actions' | 'Navigation' | 'Bulk' | 'Switching' | 'Other';
  shortcut?: string;
  when: (ctx: CommandContext) => boolean;
  action: (ctx: CommandContext) => void;
}

interface CommandContext {
  screen: Screen;
  markedCount: number;
  selectedItem: WorkItem | null;
  capabilities: BackendCapabilities;
  navigate: (screen: Screen, params?: any) => void;
  setType: (type: string) => void;
  openPicker: (picker: string) => void;
}
```

The `action` callback delegates to existing app functions — it does not implement logic itself. The `when` function gates visibility. The registry is defined once and filtered at render time.

## Component Architecture

### New Files

- `src/commands.ts` — command registry (definitions + `when` conditions)
- `src/components/CommandPalette.tsx` — overlay component

### Integration Points

- `WorkItemList.tsx` — add `:` key handler, pass context (marked items, cursor item, current type)

### Visual Layout

```
+-----------------------------+
| : filter text               |  <- input line
+-----------------------------+
| Actions                     |  <- category header (dimmed)
| > Create item            c  |  <- selected (highlighted)
|   Delete item            d  |
|   Open in browser        o  |
| Navigation                  |
|   Go to iterations       i  |
|   Go to settings         ,  |
| Bulk                        |
|   Set priority           P  |
|   Set assignee           a  |
+-----------------------------+
```

Reuses the same overlay pattern as `SearchOverlay` and `BulkMenu` — a `Box` with `position: absolute`, border, fixed width centered in the terminal.

## Fuzzy Matching & Rendering

- **Filtering**: Fuzzy match against command `label` using `fuzzysort` (existing dependency). Results sorted by match score within categories. Empty categories hidden.
- **Input line**: `:` prefix (dimmed) + typed filter text with cursor
- **Category headers**: Dimmed/grey, not selectable
- **Command rows**: Label left-aligned, shortcut right-aligned and dimmed. Selected row gets inverse/highlight.
- **Match highlighting**: Matched characters in bold
- **Max visible**: ~15 rows with scroll viewport (reuse `useScrollViewport` hook)
- **Empty state**: "No matching commands" (dimmed)

### Keyboard Handling

| Key | Action |
|-----|--------|
| Arrow Up/Down | Move selection (skip category headers) |
| Enter | Execute selected command, close palette |
| Esc | Close palette, no action |
| Printable character | Append to filter |
| Backspace | Remove last filter character; close if empty |

## Testing

- **Command registry tests** (`src/commands.test.ts`) — test `when` conditions with various `CommandContext` values. Verify commands show/hide based on screen, marked items, capabilities.
- **CommandPalette component tests** (`src/components/CommandPalette.test.tsx`) — test fuzzy filtering, keyboard navigation (arrows skip headers, Enter fires action, Esc closes), empty state.

## Scope

### In

- `:` trigger from the list screen
- Command registry with all list-screen commands
- Fuzzy filtering with category grouping
- Shortcut hints
- Context-aware visibility

### Out (future follow-ups)

- `:` from the form screen
- Parameterized commands (e.g., `:set status done`)
- User-defined custom commands
- Command history / recent commands
- `:` from settings, help, or other screens
