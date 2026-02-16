# Unified Command Registry Design

## Problem

Adding a keyboard shortcut requires updating 3-4 separate locations:

1. `src/commands.ts` — command metadata (id, label, shortcut, capability guard)
2. `src/components/HelpScreen.tsx` — per-screen shortcut groups with key + description
3. Component `useInput()` handlers — hardcoded `input === 'c'` checks
4. Footer hint bars — `buildHelpText()` in WorkItemList, hardcoded strings in BranchList/PullRequestList

This causes description drift (e.g., "Mark/unmark item" vs "Toggle mark"), missing entries, and duplicated capability guards.

## Solution

Expand `commands.ts` to be the **sole source of truth** for all command metadata across all screens. HelpScreen and footer hints become pure consumers.

## Command Interface

```typescript
export interface Command {
  id: string;
  label: string;              // used in command palette AND help screen
  category: CommandCategory;
  shortcut?: string;           // display key (e.g., 'c', 'enter', 'shift+up/down')
  screen: Screen | Screen[] | 'global';  // which screen(s) this applies to
  helpGroup?: string;          // group label in help screen (e.g., 'Navigation', 'Actions')
  footer?: boolean;            // show in footer hint bar
  footerLabel?: string;        // short label for footer (defaults to label)
  when?: (ctx: CommandContext) => boolean;  // optional capability/state guard
}
```

Key changes from current:

- **`screen`** — declares which screen(s) a command belongs to, replacing screen checks embedded in `when()`. `'global'` for commands available everywhere (quit, help).
- **`helpGroup`** — controls grouping in HelpScreen. Replaces the manual `ShortcutGroup[]` construction in `getShortcuts()`.
- **`footer` / `footerLabel`** — marks which commands appear in footer hint bars. `footerLabel` provides a short form (e.g., "create" instead of "Create item").
- **`when`** — becomes optional. Only needed for capability/state guards (e.g., "only if item selected", "only if gitAvailable"). Screen filtering is handled by `screen` field.

## Registry Expansion

Currently `commands.ts` only defines list-screen commands. The registry expands to include ALL screens:

- **List view**: existing commands (create, edit, delete, open, branch, sync, sort, mark, filters, etc.)
- **Form view**: navigate fields (up/down), edit field (enter), save (s), back (esc), revert field (esc in edit mode)
- **Branch list**: switch (enter), new (n), delete (d), merge (m), push (P), worktree (w), refresh (r), search (/)
- **PR list**: open in browser (enter/o), search (/), back (esc)
- **Settings**: navigate (up/down), select/edit (enter), back (esc/,), create template (c), delete template (d)
- **Iteration picker**: navigate (up/down), select (enter)
- **Status screen**: scroll errors (up/down), back (esc/q), retry sync (r)
- **Global**: quit (q), help (?)

## New Exported Functions

```typescript
// Get commands visible on a specific screen with given context
getCommandsForScreen(screen: Screen, ctx: CommandContext): Command[]

// Get commands marked for footer display on a screen
getFooterCommands(screen: Screen, ctx: CommandContext): Command[]

// Group commands by helpGroup for HelpScreen rendering
groupByHelpGroup(commands: Command[]): ShortcutGroup[]

// Find a command by ID (for components to reference shortcut keys)
findCommand(id: string): Command | undefined
```

## What Changes Where

### `src/commands.ts`
- Expand `Command` interface with `screen`, `helpGroup`, `footer`, `footerLabel`
- Add commands for all screens (form, branch-list, pr-list, settings, iteration-picker, status)
- Add `getCommandsForScreen()`, `getFooterCommands()`, `groupByHelpGroup()`, `findCommand()`
- Existing `getVisibleCommands()` / `filterCommands()` / `groupCommandsByCategory()` remain for command palette

### `src/components/HelpScreen.tsx`
- Replace `getShortcuts()` (~200 lines of manual shortcut definitions) with ~5 lines reading from registry
- `ShortcutGroup[]` now auto-generated from command `helpGroup` fields
- Capability-based filtering handled by command `when()` guards — no duplication

### `src/components/WorkItemList.tsx`
- Replace `buildHelpText()` with a call to `getFooterCommands('list', ctx)` + formatting
- `useInput()` handlers optionally reference `findCommand(id)?.shortcut` instead of hardcoded keys
- `handleCommandSelect()` switch statement unchanged

### `src/components/BranchList.tsx`
- Replace hardcoded footer string with `getFooterCommands('branch-list', ctx)` + formatting
- `useInput()` handlers optionally reference command shortcuts

### `src/components/PullRequestList.tsx`
- Replace hardcoded footer string with `getFooterCommands('pr-list', ctx)` + formatting

## What Does NOT Change

- Handler logic stays in components (close to the React state it needs)
- Command palette already uses `commands.ts` — no change needed
- `CommandContext` interface stays the same
- `when()` guards still work for capability checks
- Component structure and rendering unchanged

## Migration Path

1. Add new fields (`screen`, `helpGroup`, `footer`, `footerLabel`) to `Command` interface
2. Update existing commands with the new fields
3. Add commands for all non-list screens
4. Add new exported functions (`getCommandsForScreen`, `getFooterCommands`, `groupByHelpGroup`, `findCommand`)
5. Replace `HelpScreen.getShortcuts()` to read from registry
6. Create shared `buildFooterHints()` utility
7. Replace `buildHelpText()` in WorkItemList with shared utility
8. Replace hardcoded footer strings in BranchList and PullRequestList
9. Optionally: update component `useInput()` handlers to reference `findCommand(id)?.shortcut`
