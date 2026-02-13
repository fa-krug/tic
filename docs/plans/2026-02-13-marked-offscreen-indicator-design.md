# Marked Item Off-Screen Indicator Design

## Problem

When the list is scrolled, users can't see how many marked items are above or below the viewport. The existing `● N` counter shows total count but not distribution.

## Solution

Enhance the existing marked item counter in the header to append directional arrows when marked items are off-screen.

## Display

| State | Rendered |
|-------|----------|
| No marks | *(nothing)* |
| All visible | `● 3` |
| Some above | `● 3 ↑1` |
| Some below | `● 3 ↓2` |
| Both directions | `● 3 ↑1 ↓2` |

- All text in magenta (matches current style)
- Arrows only appear when there are actually off-screen marked items

## Implementation

### Single file change: `src/components/WorkItemList.tsx`

**Computation** (new `useMemo`):

Cross-reference `markedIds` against `treeItems` indices and `viewport.start`/`viewport.end`:

```
aboveCount = count of markedIds where treeItems index < viewport.start
belowCount = count of markedIds where treeItems index >= viewport.end
```

Dependencies: `[markedIds, treeItems, viewport.start, viewport.end]`

**Rendering** (modify header, ~line 1273):

Replace `● ${markedCount} marked` with `● ${markedCount}` plus conditional `↑${aboveCount}` and `↓${belowCount}`.

### Extract helper function

Extract the above/below counting into a pure function (`getMarkedDistribution`) for unit testability.

## Performance

`markedIds` is typically small (< 50 items). Building an id-to-index map from `treeItems` is O(n) but `treeItems` is already iterated for rendering, so this adds negligible overhead.

## Testing

Unit tests for `getMarkedDistribution`:
- No marked items → no counts
- All visible → counts are 0/0
- Mixed above/below → correct distribution
- All above or all below → edge cases
