# Replace Switch Iteration Overlay with Full-Screen IterationPicker Page

**Date:** 2026-03-04

## Summary

Replace the `iteration-switch` inline overlay (triggered by `I`) with a full-screen `IterationPicker` page for switching which iteration the list is filtered by. The `i` overlay for setting iteration on items stays unchanged.

## Keybinding Split

- `i` — overlay to set iteration on selected/marked item(s) (unchanged)
- `I` (Shift+I) — full-screen page to switch the current iteration filter

## Changes

1. **`src/components/IterationPicker.tsx`** — New screen component. Lists iterations using Ink's `SelectInput` with date labels and "(current)" marker. On select: calls `setCurrentIteration()`, refreshes data, navigates back to `list`. Escape goes back.
2. **`src/stores/navigationStore.ts`** — Add `'iteration-picker'` to the `Screen` type.
3. **`src/app.tsx`** — Add `iteration-picker` case to screen router, rendering `<IterationPicker>`.
4. **`src/components/WorkItemList.tsx`** — Change `switch-iteration` command handler from opening `iteration-switch` overlay to `navigate('iteration-picker')`. Remove `iteration-switch` overlay JSX block.
5. **`src/stores/uiStore.ts`** — Remove `iteration-switch` from `ActiveOverlay` type.
6. **`src/commands.ts`** — Keep `switch-iteration` command definition (key `I`), handler changes.
