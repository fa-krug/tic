# Bulk Select Improvements Design

Addresses issues #9 (shift+arrow range selection) and #10 (select-all shortcut).

## Keybindings

| Key | Behavior |
|-----|----------|
| `m` | Toggle mark on cursor item (unchanged) |
| `M` | Toggle all visible items — marks all if any unmarked, clears all if all marked |
| `shift+up/down` | Range select from anchor point, replaces any existing marks |

## Toggle All (`M`)

Change `M` from "clear all marks" to "toggle all visible marks."

Add `setMarkedIds(ids: Set<string>)` to `listViewStore`. In the `M` handler:

```
visibleIds = treeItems.map(item => item.id)
allMarked = visibleIds.every(id => markedIds.has(id))
if allMarked: clearMarked()
else: setMarkedIds(new Set(visibleIds))
```

"Visible items" means `treeItems` — the filtered, collapsed list the user sees. `M` respects type filters and collapsed groups.

## Shift+Arrow Range Select

### State

Add to `listViewStore`:
- `rangeAnchor: number | null` — cursor index when shift was first pressed (index into `treeItems`)
- `setRangeAnchor(index: number | null)` — set or clear the anchor

### Logic

```
if shift+up or shift+down:
  if rangeAnchor is null:
    setRangeAnchor(currentCursor)

  move cursor up or down

  start = min(rangeAnchor, newCursor)
  end = max(rangeAnchor, newCursor)
  rangeIds = treeItems[start..end].map(item => item.id)
  setMarkedIds(new Set(rangeIds))

if plain up/down (no shift):
  if rangeAnchor is not null:
    setRangeAnchor(null)  // clear anchor, keep marks
  move cursor normally
```

Key behaviors:
- Anchor item is always included in the selection
- Marks are recalculated on every shift+arrow press (extend/shrink feel)
- Plain arrow movement exits range mode but preserves marks
- `m` or `M` also clears the anchor

## Edge Cases

- **Range + `m`:** Clears anchor, toggles single cursor item. Range marks remain (minus/plus the toggled item).
- **Range + `M`:** Clears anchor, applies toggle-all logic. Exits range mode.
- **Range + `B`:** Works naturally — `getTargetIds()` reads from `markedIds`, which shift+arrow populates.
- **Cursor at boundary:** Shift+down at last item or shift+up at first — cursor stays, selection unchanged.
- **`treeItems` changes:** Clear `rangeAnchor` via `useEffect` when `treeItems` length changes, preventing stale index references.

## Files Changed

- `src/stores/listViewStore.ts` — add `setMarkedIds`, `rangeAnchor`, `setRangeAnchor`
- `src/components/WorkItemList.tsx` — update `M` handler, add shift+arrow handler, useEffect to clear stale anchor
- `src/components/HelpScreen.tsx` — update keybinding descriptions

## Tests

**Store tests (`listViewStore.test.ts`):**
- `setMarkedIds` sets exact mark set
- `setRangeAnchor` sets and clears anchor

**`M` toggle-all:**
- No marks: `M` marks all visible items
- All marked: `M` clears all
- Some marked: `M` marks all (partial = not all)

**Shift+arrow:**
- Shift+down sets anchor and marks cursor + next item
- Continued shift+down extends range
- Shift+up from extended range shrinks it
- Shift past anchor in opposite direction extends other way
- Plain arrow after shift clears anchor, keeps marks
- `m` after range clears anchor, toggles single item
- Filter change clears anchor
