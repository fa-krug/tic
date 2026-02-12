# Unified Overlay Panel Design

## Goal

Replace all overlay/picker/palette components with a single `OverlayPanel` component that renders in a consistent position (bottom of the list area) with a consistent interaction model (filter input + scrollable item list).

## Component Interface

```typescript
interface OverlayPanelProps {
  title: string;
  items: OverlayItem[];
  onSelect: (item: OverlayItem) => void;
  onCancel: () => void;
  multiSelect?: boolean;           // default false
  allowFreeform?: boolean;          // default false
  onSubmitFreeform?: (text: string) => void;
  placeholder?: string;            // filter input placeholder
  initialQuery?: string;           // pre-fill filter
  emptyMessage?: string;           // shown when no items match
  footer?: string;                 // custom instruction text override
}

interface OverlayItem {
  id: string;
  label: string;
  value: string;
  hint?: string;                   // right-aligned dimColor text (shortcut keys, metadata)
  category?: string;               // group header for categorized lists
  selected?: boolean;              // multi-select: pre-selected state
}
```

## Visual Layout

Renders at the bottom of `WorkItemList`, replacing the current footer area when active. The list content above shrinks to make room.

```
┭──────────────────────────────────╮
│ Title                            │  bold cyan
│ > filter text here_              │  filter input with cursor
│                                  │
│ ● Item one                       │  selected: cyan bold
│   Item two              shortcut │  unselected with hint
│   Item three                     │
│                                  │
│ ↑↓ navigate  enter select  esc … │  dimColor instructions
╰──────────────────────────────────╯
```

Multi-select mode uses checkboxes:

```
│ ☑ Label one                      │  selected/toggled
│ ☐ Label two                      │  unselected
│ ☑ Label three                    │  selected/toggled
```

Footer in multi-select: `space toggle  enter confirm  esc cancel`

### Sizing

- Width: full terminal width
- Height: grows to fit content, capped at half terminal height
- Overflow: scrolls using `useScrollViewport()` hook
- Filter input and footer are fixed (not part of scrollable area)
- Recalculates max height on terminal resize via Ink's `useStdout()`

## Keyboard Interaction

One model everywhere:

- **Escape** — close panel
- **Up/Down** — navigate items
- **Enter** — confirm selection (single-select: select + close; multi-select: confirm all toggled + close)
- **Printable characters** — append to filter input
- **Backspace** — remove last filter character

Multi-select additions:
- **Space** — toggle current item

Freeform mode addition:
- **Enter** with no match highlighted — submits raw filter text via `onSubmitFreeform`

Filter behavior:
- Case-insensitive substring match against `item.label`
- Typing resets cursor to index 0
- Empty filter shows all items

## Overlay Mapping

| Current Component | title | multiSelect | allowFreeform | category | notes |
|---|---|---|---|---|---|
| SearchOverlay | "Search" | no | no | iteration groups | fuzzy match on title+id+labels |
| CommandPalette | "Commands" | no | no | command categories | |
| BulkMenu | "Bulk Actions (N)" | no | no | no | shortcuts become hints |
| StatusPicker | "Set Status" | no | no | no | |
| PriorityPicker | "Set Priority" | no | no | no | |
| TypePicker | "Set Type" | no | no | no | |
| TemplatePicker | "Select Template" | no | no | no | |
| DefaultPicker | dynamic | no | no | no | |
| Parent input | "Set Parent" | no | yes | no | |
| Assignee input | "Set Assignee" | no | yes | no | |
| Labels input | "Set Labels" | yes | yes | no | pre-selected from current labels |
| Delete confirm | "Delete N items?" | no | no | no | 2 items: "Yes, delete" / "Cancel" |

## File Changes

### New

- `src/components/OverlayPanel.tsx` — the unified component

### Deleted (after migration)

- `src/components/SearchOverlay.tsx`
- `src/components/CommandPalette.tsx`
- `src/components/BulkMenu.tsx`
- `src/components/StatusPicker.tsx`
- `src/components/PriorityPicker.tsx`
- `src/components/TypePicker.tsx`
- `src/components/TemplatePicker.tsx`
- `src/components/DefaultPicker.tsx`

### Modified

- `src/components/WorkItemList.tsx` — replace all overlay rendering with `<OverlayPanel>` instances; remove inline autocomplete rendering from footer; all overlays render in same bottom position
- `src/stores/uiStore.ts` — `ActiveOverlay` types unchanged (they represent what is open, not how it renders)

### Kept As-Is

- `src/components/AutocompleteInput.tsx` — still used by `WorkItemForm`
- `src/components/MultiAutocompleteInput.tsx` — still used by `WorkItemForm`

## Edge Cases

- **Empty items list**: show `emptyMessage` in dimColor; filter input visible but no-op
- **Filter matches nothing**: show "No matches" dimColor text
- **Freeform + no matches**: Enter submits typed text
- **Terminal resize**: recalculate max height; scroll viewport adapts
- **Multi-select confirm with nothing toggled**: close with empty selection (caller decides meaning)
- **Multi-select with filter hiding items**: confirming includes hidden selected items
- **Rapid overlay switching**: uiStore enforces one active overlay; local state resets on each open

## Migration Approach

Build `OverlayPanel` first, then swap one overlay at a time:

1. PriorityPicker (simplest — fixed 4-item list)
2. StatusPicker, TypePicker, TemplatePicker, DefaultPicker (same pattern)
3. BulkMenu (shortcuts become hints)
4. Delete confirmation (2-item yes/no)
5. Parent/assignee autocomplete inputs (freeform mode)
6. Labels autocomplete input (multi-select + freeform)
7. CommandPalette (categories + scroll viewport)
8. SearchOverlay (fuzzy search + iteration grouping)

Delete old components after each successful swap.
