# High-Contrast Mode / Theme System Design

**Issue:** #13 — Add high-contrast mode flag
**Date:** 2026-02-14

## Problem

The app may be illegible on some terminal themes due to hardcoded color choices. Colors like `cyan`, `green`, `red`, `yellow`, `gray`, and `magenta` are scattered across ~15 component files with no centralization.

## Solution

An extensible Zustand-based theme system with semantic color tokens, starting with two built-in themes: `default` (current colors) and `high-contrast` (bold white/default only, no dim text).

## Design

### Theme Token Schema

```typescript
interface ThemeColors {
  // Primary UI
  accent: string;            // focused/selected items (default: "cyan")
  accentBg: string;          // background highlight for marked rows (default: "cyan")
  muted: string | undefined; // secondary text color override
  mutedDim: boolean;         // whether to use dimColor prop (true in default, false in high-contrast)

  // Semantic
  success: string;           // positive states (default: "green")
  error: string;             // errors/critical priority (default: "red")
  warning: string;           // warnings/high priority (default: "yellow")
  info: string;              // medium priority (default: "cyan")

  // Structural
  border: string;            // panel borders (default: "gray")
  marked: string;            // marked item indicator (default: "magenta")
}
```

### Built-in Themes

**default** — preserves current color behavior:
- `accent: 'cyan'`, `accentBg: 'cyan'`, `mutedDim: true`
- `success: 'green'`, `error: 'red'`, `warning: 'yellow'`, `info: 'cyan'`
- `border: 'gray'`, `marked: 'magenta'`

**high-contrast** — maximum compatibility, bold white only:
- All color tokens: `'white'`
- `mutedDim: false` (no dim text, all text renders at full weight)

### Zustand Store (`src/stores/themeStore.ts`)

- State: `{ themeName: string, colors: ThemeColors }`
- Actions: `setTheme(name)` — updates colors + persists `theme` field to SQLite config
- Initialized from `configStore` during app startup
- Follows existing vanilla `createStore` + `useThemeStore(selector)` hook pattern

### Config Change

Add `theme?: string` to `Config` type in `src/storage/config.ts`, defaulting to `'default'`.

Settable via: Settings screen in TUI, or `tic config set theme high-contrast` CLI.

### Component Migration

Mechanical replacement across ~15 files:

| Current pattern | Replacement |
|---|---|
| `color="cyan"` (selection/focus) | `color={accent}` |
| `color="green"` (success) | `color={success}` |
| `color="red"` (error) | `color={error}` |
| `color="yellow"` (warning) | `color={warning}` |
| `color="gray"` (borders) | `color={border}` |
| `color="magenta"` (marked) | `color={marked}` |
| `dimColor` (secondary text) | `dimColor={mutedDim}` |
| `backgroundColor="cyan"` | `backgroundColor={accentBg}` |
| `priorityColor()` function | Uses `error`/`warning`/`info` tokens |

### Files Touched

**New:**
- `src/stores/themeStore.ts`

**Modified:**
- `src/storage/config.ts` — add `theme` field to Config
- `src/components/WorkItemList.tsx`
- `src/components/WorkItemForm.tsx`
- `src/components/TableLayout.tsx`
- `src/components/Header.tsx`
- `src/components/OverlayPanel.tsx`
- `src/components/DetailPanel.tsx`
- `src/components/ErrorBoundary.tsx`
- `src/components/StatusScreen.tsx`
- `src/components/Settings.tsx`
- `src/components/AuthPrompt.tsx`
- `src/components/HelpScreen.tsx`
- `src/components/AutocompleteInput.tsx`
- `src/components/MultiAutocompleteInput.tsx`
- `src/components/Breadcrumbs.tsx`
- `src/components/IterationPicker.tsx`

### Not in Scope

- Custom user-defined themes (future work)
- Per-field color overrides
- `--high-contrast` CLI flag (use config instead)
