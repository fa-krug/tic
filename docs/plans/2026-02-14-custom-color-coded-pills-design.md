# Custom Color-Coded Pills

## Overview

Add colored background pills to all categorical values (statuses, priorities, types, labels) throughout the TUI. Smart defaults provide a colorful experience out of the box. Users can override any color via a new Colors section in Settings. Priority icons in DetailPanel are replaced by pills for visual consistency.

## Decisions

| Decision | Choice |
|----------|--------|
| Storage | Separate `color_mappings` table |
| Architecture | Extend themeStore with `resolveFieldColor()` |
| Component | ColorPill as drop-in wrapper |
| Priority icons | Replaced by pills everywhere |
| Settings UI | Included in initial implementation |
| Scope | No backend/sync/MCP changes |

## Data Layer

### New `color_mappings` table (Drizzle migration)

```sql
CREATE TABLE color_mappings (
  field_type TEXT NOT NULL,  -- 'status' | 'priority' | 'type' | 'label'
  value TEXT NOT NULL,
  bg TEXT NOT NULL,          -- named terminal color (e.g. 'red', 'greenBright')
  fg TEXT NOT NULL,          -- named terminal color
  PRIMARY KEY (field_type, value)
);
```

Only user overrides are stored. Smart defaults and label hashing live in code.

### Storage methods on `Storage` class

- `getColorMappings(): Promise<ColorMapping[]>` — reads all rows
- `setColorMapping(fieldType, value, bg, fg): Promise<void>` — upsert
- `deleteColorMapping(fieldType, value): Promise<void>` — reset one
- `deleteColorMappingsByField(fieldType): Promise<void>` — reset all for a field type

## themeStore Extension

### New types

```typescript
type FieldType = 'status' | 'priority' | 'type' | 'label';
interface FieldColor { bg: string; fg: string; }
```

### Store additions

- **`colorOverrides: Record<string, Record<string, FieldColor>>`** — loaded from `color_mappings` table on init
- **`loadColorOverrides(storage: Storage): Promise<void>`** — reads from DB, populates `colorOverrides`
- **`resolveFieldColor(field: FieldType, value: string): FieldColor | null`** — resolution chain:
  1. Check `colorOverrides[field][value.toLowerCase()]` — user override
  2. Check keyword defaults for the active theme (default vs high-contrast)
  3. For labels only: deterministic hash into 10-color palette
  4. Return `null` — plain text, no pill

## Smart Defaults

### Keyword matching

Case-insensitive **contains** matching — `"In Progress"` matches a rule for `"progress"`. Rules are checked in order, first match wins. Unmatched values render as plain text (no pill).

### Default theme

| Field | Pattern | bg | fg |
|-------|---------|----|----|
| status | done, closed | green | white |
| status | progress, active | blue | white |
| status | todo, open, new | gray | white |
| status | blocked | red | white |
| priority | critical | red | white |
| priority | high | yellow | black |
| priority | medium | cyan | black |
| priority | low | gray | white |
| type | bug | red | white |
| type | feature | blue | white |
| type | task | gray | white |
| type | epic | magenta | white |

### High-contrast theme

Same patterns but brighter variants (`greenBright`, `blueBright`, etc.). Fg is auto-calculated for readability: `black` for light backgrounds (`yellowBright`, `cyanBright`, `greenBright`), `white` for dark ones.

### Label hashing

```typescript
palette[hash(name.toLowerCase()) % palette.length]
```

10-color palette: `blue, green, magenta, cyan, yellow, red, blueBright, greenBright, magentaBright, cyanBright`. Fg is auto-calculated per background for readability. Deterministic — same label always gets the same color.

## ColorPill Component

`src/components/ColorPill.tsx` — drop-in wrapper that handles all resolution internally.

```tsx
function ColorPill({ field, value }: { field: FieldType; value: string }) {
  const resolved = useThemeStore(s => s.resolveFieldColor(field, value));
  if (!resolved) return <Text>{value}</Text>;
  return (
    <Box backgroundColor={resolved.bg}>
      <Text color={resolved.fg}> {value} </Text>
    </Box>
  );
}
```

Single space padding on each side. Falls back to plain `<Text>` when no color resolves.

## Integration Points

### TableLayout

- Status column: replace `<Text>` with `<ColorPill field="status">`
- Priority column: replace plain text with `<ColorPill field="priority">`
- Labels column: map each label to `<ColorPill field="label">`, `+N` overflow stays plain
- Column width calculations: add 2 chars for pill padding

### DetailPanel

- Remove `priorityColor()` function and priority icons (`▲▲`, `▲`, `●`, `▽`)
- Replace all metadata values (status, priority, type, labels) with `<ColorPill>`

### OverlayPanel

- Add pill preview next to each option in status/priority/type/label pickers
- Selected indicator styling stays as-is, pill appears alongside

### WorkItemForm

- Display values (when not editing) rendered as `<ColorPill>`
- Dropdown option lists show pill preview
- Active text inputs remain plain (no pill while typing)

### Selected row behavior

When a row is selected in TableLayout, pill colors take precedence. Selected row accent styling applies to non-pill text only, keeping pills visually consistent regardless of cursor position.

## Settings UI

### Navigation

New "Colors" group in Settings, after Display:

```
Display
  Theme: default
Colors
  Status colors     →
  Priority colors   →
  Type colors       →
  Label colors      →
```

### Color editor sub-screen

Uses OverlayPanel. Lists all known values for that field type (from configStore statuses/types + backendDataStore labels). Each row shows:

```
 [pill preview]  value name    (default) or (custom)
```

### Color palette picker

Selecting a value opens a grid of 16 named terminal colors as pill previews:

```
  red    green    blue    magenta
  cyan   yellow   gray    white
  redBright  greenBright  blueBright  magentaBright
  cyanBright yellowBright grayBright  whiteBright
```

Fg is auto-calculated: `white` for dark backgrounds, `black` for light ones (`yellow`, `cyan`, `white`, and most `*Bright` variants).

### Actions

- **Select a color** → upserts to `color_mappings`, updates themeStore immediately
- **"Reset to default"** at top of palette → deletes override, reverts to smart default
- **"Reset all"** at top of value list → deletes all overrides for that field type
- Changes are immediate, no save button (consistent with existing Settings behavior)

## Testing Strategy

### Unit tests

- **`resolveFieldColor()`** — full resolution chain: user override wins, keyword default, label hash, null fallback. Case-insensitive matching, contains matching, high-contrast variants.
- **Smart defaults** — snapshot test of all keyword mappings for both themes.
- **Label hashing** — deterministic, covers full palette.
- **Storage methods** — CRUD on `color_mappings` table.
- **Auto fg calculation** — white for dark backgrounds, black for light.

### Component tests

- **ColorPill** — renders pill with bg/fg when color resolves, renders plain text when null.

### Manual verification

- Visual appearance of pills in each screen
- Column width adjustments
- Settings color picker UX flow

## Architecture Summary

- **themeStore** — extended with `colorOverrides`, `loadColorOverrides()`, and `resolveFieldColor()`. Recomputes on theme switch.
- **Storage** — new CRUD methods for `color_mappings` table.
- **Drizzle migration** — new `color_mappings` table.
- **ColorPill** — new reusable component, drop-in replacement at 4 integration points.
- **Settings** — new Colors section with value list + color palette picker.
- **No backend/sync/MCP changes** — purely presentation layer.
