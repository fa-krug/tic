# Iteration Shortcuts Design (`j` / `J`)

## Problem

Changing iteration requires navigating to a full-screen picker (`i` key). There's no inline way to set the iteration field on individual work items, unlike status (`s`), assignee (`a`), labels (`l`), and type (`t`).

## Solution

Two new keybindings in WorkItemList using the established overlay picker pattern:

- **`j`** — Set iteration on selected/marked work items (inline overlay)
- **`J`** (Shift+J) — Switch the global current iteration (inline overlay)

The existing `i` keybinding and full-screen `IterationPicker` component are removed.

## Note on Ctrl+I

The issue title mentions Ctrl+I, but Ctrl+I sends the same byte as Tab in terminals (ASCII 9), making them indistinguishable. We use `j`/`J` instead.

## `j` — Set Item Iteration

Follows the exact pattern of `s` (status picker):

1. **Command**: `set-iteration` in `commands.ts`, `keys: ['j']`, gated on `capabilities.iterations`
2. **Overlay type**: `{ type: 'iteration-picker'; targetIds: string[] }` in `uiStore.ts`
3. **Keybinding handler**: In WorkItemList `useInput`, open overlay with `targetIds` from `getTargetIds()`
4. **OverlayPanel rendering**: Items from `iterations` list. On select: `backend.cachedUpdateWorkItem(id, { iteration: value })` for each target, then `queueWrite()` + `reloadItem()`
5. **Bulk support**: Works with marked items via `getTargetIds()`

## `J` — Switch Global Iteration

1. **Command**: Replace existing `iterations` command, change keys to `['J']`
2. **Overlay type**: `{ type: 'iteration-switch' }` (no `targetIds`)
3. **On select**: `backend.setCurrentIteration(value)` then `refresh()`
4. **Current iteration indicator**: Highlight or checkmark next to active iteration

## Removals

- `i` keybinding from `commands.ts`
- `iteration-picker` screen from `app.tsx` routing
- `src/components/IterationPicker.tsx`
- `navigate('iteration-picker')` calls (bulk menu uses `j` overlay instead)

## Files Changed

- `src/commands.ts` — remove `iterations` command, add `set-iteration` + `switch-iteration`
- `src/stores/uiStore.ts` — add overlay types
- `src/components/WorkItemList.tsx` — keybinding handlers + overlay rendering
- `src/app.tsx` — remove `iteration-picker` screen
- `src/components/IterationPicker.tsx` — delete
- Help screen entries updated automatically via commands
