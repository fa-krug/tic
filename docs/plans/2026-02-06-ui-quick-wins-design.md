# UI Quick Wins Design

## Overview

A focused pass of 8 small UI improvements that collectively polish the TUI experience across all areas: feedback, navigation, forms, list view, and discoverability.

## 1. Success Toasts

**Problem:** No feedback after create/update/delete — the user saves and returns to the list with no confirmation.

**Design:** Add a `toast` field to `uiStore` — `{ message: string; timestamp: number } | null`. When set, the WorkItemList help bar area shows the toast in green instead of the normal dimmed help text. A `useEffect` auto-clears it after 3 seconds.

**Changes:**
- `src/stores/uiStore.ts`: Add `toast: { message: string; timestamp: number } | null`, `setToast(msg: string)`, `clearToast()`
- `src/components/WorkItemList.tsx`: In help bar area (~line 957), if `toast` is set, render in green instead of dimmed help text. Add `useEffect` watching `toast` that calls `clearToast()` after 3s.
- `src/components/WorkItemForm.tsx`: After successful save (~line 449), call `setToast(...)` before navigating back. Messages: `"Item #ID created"`, `"Item #ID updated"`.
- `src/components/WorkItemList.tsx`: After delete confirm and bulk operations, call `setToast(...)`. Messages: `"Item #ID deleted"`, `"N items updated"`.

## 2. Scroll Position Indicator

**Problem:** No sense of position in long lists.

**Design:** Show compact `42/150` (cursor position / total) on the right side of the help bar. Only visible when the list is scrollable (more items than fit on screen). When a toast is active, the toast replaces help text but the position indicator still shows on the right.

**Changes:**
- `src/components/WorkItemList.tsx`: After viewport hook (~line 238), compute `positionText` from `cursor + 1` and `treeItems.length`. Render in a `<Box justifyContent="space-between">` wrapping help text (left) and position (right, dimColor). Only show when `treeItems.length` exceeds visible count.

No new state — purely derived from existing viewport and cursor values.

## 3. Better Empty States

**Problem:** Bare "No tasks in this iteration" with no guidance.

**Design:** Replace with actionable hint text:
- No items in iteration: `"No {type}s in this iteration. Press c to create, / to search all."`
- Loading: Keep current spinner + "Loading..." (already fine).

**Changes:**
- `src/components/WorkItemList.tsx`: Update empty state text (~line 838-842) to include keyboard hints.

One-liner change.

## 4. Required Field Markers

**Problem:** All form fields look identical — no visual distinction between required and optional.

**Design:** Append a dim `*` after the label of required fields. Required fields:
- Always required: `title`
- Required in create mode: `status`, `type` (when `capabilities.customTypes`)

The marker is purely visual — `title *` with the asterisk rendered in dimColor.

**Changes:**
- `src/components/WorkItemForm.tsx`: In `renderField()` (~line 937), check if current field key is in a `requiredFields` set. If so, append ` *` (dimColor) after the label. Define `requiredFields` based on mode (create vs edit) and capabilities.

Single file change.

## 5. Autocomplete "+X more" Indicator

**Problem:** Autocomplete silently truncates at MAX_VISIBLE (5). Users don't know there are more matches to narrow down.

**Design:** Track total filtered count before slicing to MAX_VISIBLE. If truncated, render a dim line below suggestions: `+3 more`.

**Changes:**
- `src/components/AutocompleteInput.tsx`: In `filterSuggestions()` (~line 15), return both sliced array and `totalCount`. After suggestion list rendering (~line 84), conditionally render `<Text dimColor>+{remaining} more</Text>`.
- `src/components/MultiAutocompleteInput.tsx`: Same change — same pattern.

Two files, same small change in each.

## 6. Description Field Hint (Verify/Polish)

**Problem:** Users might not discover that Enter opens $EDITOR.

**Current state:** Code at ~line 1119 already shows `[enter opens $EDITOR]` when focused. This may already be sufficient.

**Action:** Verify the hint renders correctly. Polish wording if needed (e.g., `enter to edit in $EDITOR` or `enter to edit` if $EDITOR unset). Skip if already good.

## 7. Auto-dismiss Warnings

**Problem:** Yellow warning banner persists until cursor movement, which feels sticky for informational warnings.

**Design:** Add a `useEffect` in WorkItemList that sets a 5-second timeout to `clearWarning()` whenever `warning` changes. If the user moves the cursor first (which already clears warnings), the timeout is cancelled via cleanup. Warnings clear on whichever comes first: cursor movement (existing) or timeout (new).

**Changes:**
- `src/components/WorkItemList.tsx`: Add `useEffect` watching `warning` that calls `setTimeout(clearWarning, 5000)` with cleanup return.

No store changes needed — timeout handled entirely in the component. Single file.

## 8. Help Bar Responsive Trimming

**Problem:** Static help text truncates mid-word on narrow terminals.

**Design:** Define shortcuts in priority order as an array of `{ key: string; label: string }`. Render left-to-right with ` · ` separators, stopping when the next entry won't fit. Highest-priority shortcuts (navigate, enter, create) always show; lower-priority ones (search, help, bulk) drop off gracefully.

The scroll position indicator (`42/150`) reserves its width first, so help text fills the remaining space.

**Changes:**
- `src/components/WorkItemList.tsx`: Replace static `helpText` string (~line 704) with a `buildHelpText(availableWidth: number)` function. Use `useStdout().columns` for terminal width. Shortcuts defined in priority order, joined with ` · `, accumulated until next entry exceeds remaining width.

Single file change, no new dependencies.

## Summary

| # | Improvement | Files | Complexity |
|---|------------|-------|-----------|
| 1 | Success toasts | uiStore, WorkItemList, WorkItemForm | Medium |
| 2 | Scroll position `42/150` | WorkItemList | Small |
| 3 | Better empty states | WorkItemList | Trivial |
| 4 | Required field `*` markers | WorkItemForm | Small |
| 5 | Autocomplete `+X more` | AutocompleteInput, MultiAutocompleteInput | Small |
| 6 | Description hint | WorkItemForm (verify only) | Trivial |
| 7 | Auto-dismiss warnings | WorkItemList | Small |
| 8 | Help bar responsive trimming | WorkItemList | Medium |

Total: ~5 files modified, 1 new store field. All changes are additive and low-risk.
