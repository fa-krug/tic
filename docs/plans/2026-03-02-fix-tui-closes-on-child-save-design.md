# Fix: TUI closes when saving a child item after drill-down navigation

## Problem

When navigating from a parent item into a child item (via form drill-down / relationship links) and saving the child, the TUI exits instead of returning to the parent item's form.

## Root Cause

In `src/components/WorkItemForm.tsx`, the `form-save` handler (lines 798-829):

1. Sets `setSaving(true)` before the async save
2. After `save()`, calls `formStackStore.pop()` and `popWorkItem()`
3. When `popWorkItem()` returns non-null (parent ID), no `navigate()` is called — correct, the screen should stay on `'form'`
4. **But `setSaving(false)` is never called on the success path** — only in `.catch()`
5. The `useInput` hook has `isActive: !saving`, so all keyboard input is permanently disabled
6. The form becomes frozen, forcing the user to Ctrl+C (which exits the process)

The same pop/navigate pattern works in the Escape handler because it never sets `saving=true`.

## Fix

Add `.finally(() => setSaving(false))` to the async IIFE in the save handler. This ensures `saving` is always reset regardless of which code path executes (navigate to list, stay on parent form, or error).

## Key Locations

| What | Where |
|------|-------|
| Save handler (bug) | `src/components/WorkItemForm.tsx:798-829` |
| Escape handler (works) | `src/components/WorkItemForm.tsx:759-788` |
| Dirty prompt save (works) | `src/components/WorkItemForm.tsx:661-703` |
| formStackStore | `src/stores/formStackStore.ts` |
| navigationStore.popWorkItem | `src/stores/navigationStore.ts:127-136` |

## Testing

- Add a test that verifies `saving` resets to `false` after save-and-pop in drill-down context
- Manual test: open parent, drill down to child, save child, verify return to parent form with working input
