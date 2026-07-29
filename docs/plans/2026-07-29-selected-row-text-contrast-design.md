# Selected-row text contrast

## Problem

When the cursor sits on a row that has a background color, values rendered by
`ColorPill` keep their own foreground color. If that color is perceptually close
to the row background, the text becomes unreadable.

Concretely: in the `Set Status` overlay the item `todo` resolves to `gray` via
the keyword defaults, and the selected row's background is `selectionBg`
(`cyanBright` in the default theme). Gray on light cyan is illegible.

Two independent causes:

1. `OverlayPanel` renders `<ColorPill field={fieldType} value={item.value} />`
   without the `selectionBg` prop, so `ensureContrast()` never runs. The same
   omission exists in `MultiSelectInput` (label picker rows) and
   `PullRequestList` (status column).
2. `ensureContrast()` defaults to `min = 3`. Gray on `cyanBright` scores 3.19,
   so even with the prop wired through the color would be kept. `redBright`
   (3.19), `magenta` (3.74) and `blueBright` (3.78) sit in the same gap.

A related defect: `TableLayout` computes the row background from both `selected`
and `marked`, but that value never leaves the row component. Columns therefore
assume the background is always `selectionBg`, which is wrong for
marked+selected rows (`selectedMarkedBg`) and marked-only rows (`accentBg`).

## Approach

Keep the existing `ensureContrast()` mechanism — a value keeps its hue when it
still reads clearly, and falls back to `autoFg(bg)` (black or white) when it
doesn't. Raise the threshold so borderline cases actually flip, and make every
highlighted row pass its *actual* background down to the pills.

Rejected: unconditionally forcing `autoFg(selectionBg)` on selected rows. It
guarantees legibility but discards status/label color coding exactly while the
cursor is on the row.

## Changes

### 1. `src/stores/themeStore.ts`

`ensureContrast(fg, bg, min = 3)` becomes `min = 4.5` (WCAG AA for normal
text). Against the default `cyanBright` selection background only `black`
(16.75), `blue` (7.49) and `red` (4.66) clear the threshold; everything else
falls back to `black`.

That is aggressive, but it is what a light selection background implies: with
`cyanBright` at a relative luminance of 0.787, no saturated mid-luminance color
can reach 4.5. The same holds for `selectedMarkedBg` (`magenta`), where nothing
clears 4.5 — `autoFg()` returns the best available foreground, not a guaranteed
one.

The change also applies to `WorkItemList`, which already threads `selectionBg`
through — the too-lenient threshold affects it identically.

### 2. `src/components/TableLayout.tsx`

- Compute the row's effective background once in `GenericTableRow` as `rowBg`
  (`selected && marked → selectedMarkedBg`, `selected → selectionBg`,
  `marked → accentBg`, else `undefined`).
- Use `rowBg` for `<Box backgroundColor>` (behavior unchanged) and for the `>`
  marker: `rowBg ? autoFg(rowBg) : accent`, replacing the hardcoded
  `autoFg(selectionBg)`.
- Widen `ColumnDef.render` to `(item: T, selected: boolean, rowBg: string | undefined) => ReactNode`.
  Existing columns that ignore the third argument keep compiling.

### 3. `src/components/WorkItemList.tsx`

`buildWorkItemColumns` drops its `selectionFg` and `selectionBg` parameters.
Text colors become `rowBg ? autoFg(rowBg) : undefined`; `ColorPill` receives
`selectionBg={rowBg}`. The `useMemo` call site drops the two arguments and its
`selectionBg` dependency.

### 4. `src/components/PullRequestList.tsx`

The status column currently ignores `selected` entirely; it gets
`selectionBg={rowBg}`. The other columns' `selected ? autoFg(selectionBg)`
expressions become `rowBg ? autoFg(rowBg) : undefined`, so `buildPrColumns`
no longer needs its `selectionBg` parameter.

### 5. `src/components/OverlayPanel.tsx` and `src/components/MultiSelectInput.tsx`

Neither uses `TableLayout`; both already know `isSelected` and `selectionBg`.
Their pills get `selectionBg={isSelected ? selectionBg : undefined}`.

## Out of scope

- `BranchList` and `IterationPicker` — no pills, and they never mark rows, so
  `rowBg` would always equal `selectionBg`.
- Selected pills stay non-bold. Surrounding text goes bold on selection; pills
  never have, and matching them is a separate visual decision.
- The color values themselves. Only the selected-row foreground changes.

## Testing

- `src/stores/themeStore.test.ts` — pin the new threshold: the gap cases
  (`gray`, `redBright`, `magenta`, `blueBright` on `cyanBright`) resolve to
  `black`, `red` and `blue` keep their hue, and an explicit `min = 3` still
  keeps `gray`. The existing `ensureContrast` cases must continue to pass.
- `src/components/TableLayout.test.tsx` (new) — a column captures the `rowBg` it
  is handed and the test pins all four cases: plain, selected, marked, and
  selected+marked. The last one is the regression guard, since columns
  previously assumed `selectionBg`.
- Full `npm test`, `npm run lint`, `npm run format:check`, `tsc --noEmit`.

Assertions on the emitted SGR sequences are *not* included.
`ink-testing-library` renders with colors disabled unless `FORCE_COLOR` is set,
so `lastFrame()` contains no color information — which is why the existing
`ColorPill` tests only check that the text appears. Forcing color globally would
change what every other component test sees, for too little gain. The color
decision itself is covered by the `ensureContrast` unit tests, the plumbing that
feeds it by the `TableLayout` tests, and the prop wiring by `tsc`.

Verified manually under `FORCE_COLOR=3`: with the cursor on `todo` in the status
overlay, the value now renders `\u001b[30m` (black) on the `\u001b[106m`
selection background instead of `\u001b[90m` (gray). The label picker behaves
the same.
