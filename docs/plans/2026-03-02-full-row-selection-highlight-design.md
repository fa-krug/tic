# Full-Row Selection Highlight Design

**Issue**: #40 — Highlight whole row on select instead of just parts of the text
**Date**: 2026-03-02

## Problem

When navigating the work item list, the selected row only highlights individual text segments (bold + accent color on ID/title). This makes it hard to visually identify the active row at a glance, especially in wide terminals.

## Approach

Apply `backgroundColor` to the existing outer `<Box>` in `GenericTableRow` when the row is selected. This extends the existing pattern already used for marked (bulk-selected) rows.

## Design

### Theme Changes (`src/stores/themeStore.ts`)

Add two new colors to `ThemeColors`:

- **`selectionBg`**: Background color for the selected row.
  - default theme: `'cyanBright'` (accent-tinted, matches cyan accent)
  - high-contrast theme: `'whiteBright'`
- **`selectedMarkedBg`**: Combined state when row is both selected and marked.
  - default theme: `'magentaBright'`
  - high-contrast theme: `'whiteBright'`

### Row Rendering (`src/components/TableLayout.tsx`)

Update `GenericTableRow` outer Box background logic from:

```tsx
<Box {...(marked && !selected ? { backgroundColor: accentBg } : {})}>
```

to:

```tsx
<Box backgroundColor={
  selected && marked ? selectedMarkedBg
  : selected ? selectionBg
  : marked ? accentBg
  : undefined
}>
```

Three visual states:
- **Selected only**: `cyanBright` background, bold text with readable foreground
- **Marked only**: `cyan` background (existing `accentBg`, unchanged)
- **Selected + marked**: `magentaBright` background (combined state)

### Text Color Adjustments

When `selectionBg` is `cyanBright`, text needs readable foreground colors. Column renderers in `WorkItemList.tsx` that currently use `color={selected ? accent : undefined}` need updating, since cyan text on cyanBright background is unreadable. For selected rows, use `autoFg(selectionBg)` to compute a readable foreground color (black on cyanBright).

### ColorPills

Pills retain their own background colors regardless of row selection state. However, any pill color in the cyan family would blend into the `cyanBright` selection background. The current default for "medium" priority is `{ bg: 'cyan', fg: 'black' }`, which would be indistinguishable.

**Fix**: Change the "medium" priority default color from `cyan` to `blue` (and in high-contrast theme from `cyanBright` to `blueBright`) so it's visually distinct from the selection background.

## Files to Change

1. `src/stores/themeStore.ts` — add `selectionBg`, `selectedMarkedBg` to `ThemeColors` interface + both theme definitions
2. `src/components/TableLayout.tsx` — update background logic in `GenericTableRow`, pass `selectionBg` + `selectedMarkedBg` from theme
3. `src/components/WorkItemList.tsx` — update column render functions to use readable text colors when row has selection background
4. `src/stores/themeStore.ts` (keyword defaults) — change "medium" priority default from `cyan`/`cyanBright` to `blue`/`blueBright` to avoid blending with selection background

## Decisions

- **Accent-tinted background**: `cyanBright` ANSI color (user choice over gray/blue)
- **Combined selected+marked**: distinct `magentaBright` color (layered, not winner-takes-all)
- **ColorPills unchanged**: keep their own background colors on selected rows
