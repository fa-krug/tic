# Detail Panel: Expandable Description

## Summary

Add description preview and full-view to the existing detail panel below the list table. The panel always shows a single-line description preview when visible. Pressing `v` expands to a scrollable full description view.

## Keybindings

| Key | Action |
|-----|--------|
| `V` (shift) | Toggle detail panel on/off (persisted in config) |
| `v` | Toggle between preview and full description (when panel visible) |
| `↑/↓` | Scroll description content (when in full mode) |
| `Esc` | Exit full mode, return to preview |

Note: `v` currently toggles the panel — this moves to `V`. `v` gets the new description toggle behavior.

## State

### Existing (unchanged)

- `showDetailPanel: boolean` in config store — controls panel visibility, persisted to `.tic/config.yml`

### New (local component state)

- `showFullDescription: boolean` — default `false`, toggles full description view
- `descriptionScrollOffset: number` — scroll position within full description

### Reset behavior

Both new state values reset to defaults (`false`, `0`) on:
- Cursor movement (switching items via `↑/↓/pgup/pgdn/home/end`)
- Screen change (opening form, returning to list)
- Panel toggle (`V`)

## Layout

### Preview mode (default when panel visible)

```
  Fix authentication timeout on slow connections
  #42  ·  open  ·  @sarah
  ▲ high  auth, backend
  When users are on slow connections, the auth token expires before...
```

- One extra line below existing panel content
- Truncated to terminal width with `…`
- Dim text styling to visually separate from metadata
- Empty descriptions: no extra line shown

### Full mode (after pressing `v`)

```
  Fix authentication timeout on slow connections
  #42  ·  open  ·  @sarah
  ▲ high  auth, backend
  ─── description ───────────────────────────────────
  When users are on slow connections, the auth token
  expires before the login request completes. This
  causes a 401 error that isn't handled gracefully.

  Steps to reproduce:
  1. Throttle network to 3G
  2. Attempt login
  3. Observe timeout error
```

- Separator line (`───`) between metadata and description
- Description fills available terminal height (no cap)
- List above shrinks but keeps minimum 1-2 rows visible
- No separate scroll indicators — help bar communicates controls

### No-op cases

- `v` does nothing when panel is hidden
- `v` does nothing when selected item has no description

## Input Gating

Full description mode acts as a lightweight overlay:
- `useInput` for list navigation is **inactive** while in full mode
- A separate `useInput` block handles `↑/↓` for scrolling and `v/Esc` for closing
- Same pattern as existing overlays (search, bulk menu) using `isActive` guards

## Help Bar

- **Preview mode:** existing help text (unchanged)
- **Full mode:** `↑↓ scroll  v/esc close`

## Chrome Calculation

The `chromeLines` value passed to `useScrollViewport` changes dynamically:

| State | chromeLines | Notes |
|-------|-------------|-------|
| Panel hidden | 6 | Unchanged from current |
| Panel + preview, no description | 11 | Same as current panel |
| Panel + preview, has description | 12 | Current 11 + 1 description line |
| Panel + full | dynamic | List gets minimum rows, rest to description |

## Files to Modify

### `src/components/DetailPanel.tsx`
- Add `description` preview line (single line, truncated, dim)
- Add full mode: separator line + scrollable description viewport
- New props: `showFullDescription`, `descriptionScrollOffset`, `maxDescriptionHeight`

### `src/components/WorkItemList.tsx`
- Add local state: `showFullDescription`, `descriptionScrollOffset`
- Rebind panel toggle from `v` to `V`
- Add `v` handler for description toggle
- Add input gating: scroll handler active in full mode, list handler inactive
- Reset state on cursor move / screen change
- Dynamic `chromeLines` calculation
- Swap help bar text in full mode

### `src/components/HelpScreen.tsx`
- Update `v` → `V` for "Toggle detail panel"
- Add `v` for "Expand description"
