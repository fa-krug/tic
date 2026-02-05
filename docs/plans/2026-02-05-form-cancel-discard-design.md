# Form Cancel/Discard UX Design

## Problem

The WorkItemForm has no way to cancel or discard changes. Pressing Esc always saves and navigates back. Users cannot:
- Undo a field edit they just made (field-level)
- Back out of a form without saving (form-level)
- Know whether they have unsaved changes

## Design

### Dirty Tracking

Store a snapshot of all form field values when the form opens (or after a successful save). Derive an `isDirty` boolean by comparing current form state to the snapshot. When a save succeeds, update the snapshot so the form becomes "clean" again.

For the description field edited via `$EDITOR`: no special handling needed. When the editor closes, the returned text becomes the current field value. Dirty tracking compares it against the snapshot like any other field.

### Field-Level Esc (Revert Current Edit)

When the user presses Enter to start editing a field, capture the current field value as `preEditValue`.

- **Esc during edit**: restore the field to `preEditValue`, exit edit mode.
- **Enter/submit during edit**: keep the new value, exit edit mode.

This applies to text fields, select fields, autocomplete fields, and multi-autocomplete fields. The revert happens at the form level by resetting the field value prop — no changes needed to `AutocompleteInput` or `MultiAutocompleteInput` since they are fully controlled components with no value-related internal state (only `highlightIndex`).

The `$EDITOR` description field has no inline Esc moment, so field-level revert does not apply to it.

### Form-Level Esc (Dirty Prompt)

When Esc is pressed in navigation mode (not editing a field):

- **Form is clean** (`!isDirty`): navigate back immediately. Same as current behavior.
- **Form is dirty** (`isDirty`): show an inline prompt at the bottom of the form.

#### Prompt Variants

| Scenario | Prompt |
|----------|--------|
| Existing item, dirty | `Unsaved changes: (s)ave  (d)iscard  (esc) stay` |
| New item, has title | `Unsaved changes: (s)ave  (d)iscard  (esc) stay` |
| New item, no title | `Discard new item? (d)iscard  (esc) stay` |

#### Prompt Behavior

A new state `showDirtyPrompt: boolean` controls the prompt. While showing:

- `s` — save changes, then navigate back (not shown when new item has no title)
- `d` — discard all changes (restore snapshot), then navigate back
- `Esc` — hide the prompt, stay in the form

All other keys are ignored while the prompt is visible. This follows the existing overlay pattern: boolean state gates a guard in `useInput` and renders conditional JSX.

### Ctrl+S: Save and Leave

`Ctrl+S` in navigation mode saves the form and navigates back in a single keystroke. This works regardless of dirty state — if clean, it just navigates back. This gives power users a fast explicit save-and-leave, while Esc becomes the careful path that checks for unsaved changes.

`Ctrl+S` is not available during edit mode (the field must be confirmed or reverted first) or while the dirty prompt is showing.

### Relationship Navigation

When the user presses Enter on a relationship link (parent, child, dependent) and the form is dirty, show the same dirty prompt before navigating. After save/discard, proceed with the relationship navigation. If the user chooses "stay," cancel the navigation.

### Help Text Updates

The bottom help bar updates based on form state:

| State | Help Text |
|-------|-----------|
| Navigation mode (clean) | `↑↓ navigate  enter edit  ctrl+s save & back  esc back` |
| Navigation mode (dirty) | `↑↓ navigate  enter edit  ctrl+s save & back  esc back (unsaved changes)` |
| Edit mode | `enter confirm  esc revert` |
| Dirty prompt showing | The prompt text itself replaces the help bar |

## Implementation Scope

### Files to Modify

- `src/components/WorkItemForm.tsx` — all changes are in this file:
  - Add `initialSnapshot` state (captured on mount / after save)
  - Add `isDirty` derived boolean
  - Add `preEditValue` state for field-level revert
  - Add `showDirtyPrompt` state and prompt rendering
  - Modify Esc handler in navigation mode to check dirty state
  - Modify Esc handler in edit mode to revert field
  - Modify relationship navigation to check dirty state
  - Add Ctrl+S handler for save-and-leave
  - Update help bar text

### Files NOT Modified

- `AutocompleteInput.tsx` — fully controlled, no changes needed
- `MultiAutocompleteInput.tsx` — fully controlled, no changes needed
- `app.tsx` — navigation stack unchanged
- Backend files — save/create logic unchanged

## Non-Goals

- Undo history (Ctrl+Z for multiple steps) — out of scope
- Auto-save / draft persistence — out of scope
- Visual dirty indicator beyond help bar text — out of scope
