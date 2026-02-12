# Unified Command Bar Design

## Overview

Replace the separate search (`/`) and command palette (`:`) with a single unified command bar triggered by `/`. One input field that shows commands by default and adds matching issues as you type.

## UX Behavior

**Trigger**: `/` opens the command bar. `:` keybinding removed.

**Default state (no input)**:
- Recent commands at top (category: "Recent")
- All visible commands grouped by category (Actions, Navigation, Bulk, Switching, Other)
- No shortcut hints on commands (they don't work inside the overlay)
- No issues shown until the user types

**With input**:
- Filtered commands listed first, grouped by category
- Up to 5 matching issues appended in an "Issues" section
- Issues show `#id title` as label and `type` as hint
- If no commands match but issues do, only Issues section shown (and vice versa)
- If nothing matches, "No matches" empty state

**Selection**:
- Select a command → execute it (same as current command palette)
- Select an issue → open edit form (same as current search)

**Footer**: `↑↓ navigate  ↵ select  esc cancel`

## Data Flow

1. Panel opens → load all work items in background (cached while open)
2. On each keystroke, build the item list:
   - Recent commands filtered by query (category: "Recent")
   - Visible commands filtered by query (existing categories)
   - If query non-empty: up to 5 matching issues (category: "Issues")
3. OverlayPanel renders the combined list with category grouping

## Implementation Details

### New overlay type

Replace `'search'` and `'command-palette'` with `'command-bar'`.

### Distinguishing commands from issues

Add `kind: 'command' | 'issue'` to overlay items. The selection handler checks `kind` to dispatch to command execution or form navigation.

### OverlayPanel changes

Minimal — remove shortcut hints from command items. Issues use `hint: item.type`. Component already supports categories and filtering.

### Keybinding changes

- `/` → `openOverlay({ type: 'command-bar' })`
- `:` → removed
- Selection handler combines logic from `handleSearchSelect` and `handleCommandSelect`

## What Gets Removed

- `search` overlay type
- `command-palette` overlay type
- `/` search keybinding (repurposed)
- `:` command palette keybinding (deleted)
- Shortcut hints on command overlay items

## What Stays

- `OverlayPanel` component (reused as-is with combined items)
- `recentCommandsStore` (unchanged)
- `commands.ts` registry (unchanged)
- All command execution logic (moved into unified handler)
