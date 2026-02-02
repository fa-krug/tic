# Help Screen Design

## Overview

Add a context-aware help screen accessible from every TUI view via `?`. Trim each screen's bottom hint bar to show only the 3 most important shortcuts plus `? help`. Pressing `?` opens a full-screen view of all shortcuts for the current screen.

## Motivation

The current bottom hint bar tries to show all shortcuts at once, leading to either truncation on narrow terminals or an overwhelming wall of text. New users have no way to discover shortcuts beyond what fits in the bar. A dedicated help screen solves both problems: the bar stays clean, and the full reference is one keypress away.

## Design

### Help Screen Component

New file: `src/components/HelpScreen.tsx`

**Props:**
- `sourceScreen` — which screen the user came from (determines content)
- `onBack` — callback to return to the previous screen

**Layout:**
- Title: "Keyboard Shortcuts"
- Subtitle: screen name ("List View", "Form View", etc.)
- Shortcuts in a two-column layout: key on the left, description on the right
- Grouped logically (Navigation, Actions, Switching, etc.)
- Scrollable via up/down arrows if content exceeds terminal height
- Bottom hint: `esc back`

**Capability-aware:** Shortcuts that depend on backend capabilities (parent, custom types, iterations, sync) only appear when the current backend supports them.

### Screen Routing

**`src/app.tsx` changes:**
- Add `'help'` to the `Screen` type
- Add `previousScreen` state to track where the user came from
- When navigating to help, store current screen as `previousScreen`
- When leaving help, restore `previousScreen` directly (bypass normal `navigate()` to avoid clearing navigation stack)

All existing state is preserved: `selectedWorkItemId`, `activeType`, `navigationStack`, scroll position. Only the `screen` variable changes.

### Bottom Hint Bar (Trimmed)

Each screen's hint bar is reduced to 3 shortcuts + `? help`:

| Screen | Hints |
|--------|-------|
| List | `↑↓ navigate` `enter edit` `c create` `? help` |
| Form | `↑↓ navigate` `enter edit field` `esc save & back` `? help` |
| Iteration Picker | `↑↓ navigate` `enter select` `esc back` `? help` |
| Settings | `↑↓ navigate` `enter select` `esc back` `? help` |
| Status | `↑↓ scroll` `esc back` `? help` |

Form hints become static regardless of edit mode (no more context-dependent switching).

### Triggering `?` From Every Screen

Each screen's `useInput` handler gets a `?` check:

```typescript
if (input === '?') {
  navigateToHelp();
  return;
}
```

**Text input guard:** In screens with text editing (Form, Settings), `?` only triggers help when in navigation mode. When editing a field, `?` passes through as normal text input. Both screens already track an `editing` state that can gate this.

### Help Content Per Screen

**List View:**
- Navigation: `↑`/`↓` navigate, `←` collapse or jump to parent, `→` expand
- Actions: `enter` edit item, `c` create, `d` delete, `o` open in browser, `s` cycle status, `p` set parent
- Switching: `tab` cycle work item type, `i` iteration picker, `,` settings
- Other: `r` sync, `b` branch/worktree, `q` quit

**Form View:**
- Navigation: `↑`/`↓` move between fields
- Editing: `enter` edit field, `esc` confirm edit (text) or cancel (select)
- Relationships: `enter` on child/dependent opens that item
- Save: `esc` (in navigation mode) save and go back

**Iteration Picker:**
- `↑`/`↓` navigate, `enter` select iteration

**Settings:**
- Navigation: `↑`/`↓` navigate, `enter` select or edit, `esc` or `,` go back
- Editing: type to edit, `enter`/`esc` confirm

**Status:**
- `↑`/`↓` scroll errors, `esc` or `q` go back

## Files Changed

| File | Change |
|------|--------|
| `src/components/HelpScreen.tsx` | New component |
| `src/app.tsx` | Add `'help'` screen type, `previousScreen` state, routing |
| `src/components/WorkItemList.tsx` | Add `?` handler, trim hint bar |
| `src/components/WorkItemForm.tsx` | Add `?` handler (navigation mode only), trim hint bar |
| `src/components/IterationPicker.tsx` | Add `?` handler, trim hint bar |
| `src/components/Settings.tsx` | Add `?` handler (navigation mode only), trim hint bar |
| `src/components/StatusScreen.tsx` | Add `?` handler, trim hint bar |
