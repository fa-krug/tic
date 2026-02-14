# High-Contrast Theme System Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add an extensible theme system with a Zustand store and two built-in themes (default + high-contrast), replacing all hardcoded colors across ~15 components.

**Architecture:** A `themeStore` (Zustand vanilla store) holds semantic color tokens. Theme name is persisted in SQLite config (`project_config.theme` column). Components subscribe via `useThemeStore(selector)` and use tokens instead of hardcoded color strings. The `default` theme preserves current behavior; `high-contrast` uses white/bold only with no dim text.

**Tech Stack:** Zustand, Drizzle ORM (SQLite migration), Ink/React

---

### Task 1: Add `theme` column to SQLite schema + generate migration

**Files:**
- Modify: `src/storage/schema.ts:121-139` (add `theme` column to `projectConfig`)
- Create: `drizzle/XXXX_*.sql` (auto-generated migration)

**Step 1: Add theme column to schema**

In `src/storage/schema.ts`, add after the `defaultView` line (line 138):

```typescript
  theme: text('theme').notNull().default('default'),
```

**Step 2: Generate migration**

Run: `npx drizzle-kit generate`
Expected: New SQL file in `drizzle/` with `ALTER TABLE project_config ADD COLUMN theme text NOT NULL DEFAULT 'default'`

**Step 3: Verify migration applies**

Run: `npm run build && npm test`
Expected: Build passes. Tests pass (existing DBs get the default value automatically).

**Step 4: Commit**

```
feat: add theme column to project_config schema
```

---

### Task 2: Add `theme` to Config type and read/write functions

**Files:**
- Modify: `src/storage/config.ts:7-50` (Config type + defaultConfig + readConfig + insertConfigTx)

**Step 1: Add `theme` to Config interface**

In `src/storage/config.ts`, add after `defaultView?: string` (line 36):

```typescript
  theme?: string;
```

**Step 2: Add `theme` to defaultConfig**

No change needed — `theme` is optional and the SQLite default handles it.

**Step 3: Update readConfig to read theme**

In the `readConfig` function, after the `defaultView` block (around line 151), add:

```typescript
  if (pc?.theme && pc.theme !== 'default') {
    config.theme = pc.theme;
  }
```

**Step 4: Update insertConfigTx to write theme**

In `insertConfigTx`, add `theme: config.theme ?? 'default'` to both the `values` and `set` objects of the `projectConfig` upsert (around line 231-258).

**Step 5: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```
feat: add theme field to Config type and SQLite read/write
```

---

### Task 3: Create themeStore

**Files:**
- Create: `src/stores/themeStore.ts`

**Step 1: Create themeStore**

```typescript
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';
import { configStore } from './configStore.js';

export interface ThemeColors {
  accent: string;
  accentBg: string;
  muted: string | undefined;
  mutedDim: boolean;
  success: string;
  error: string;
  warning: string;
  info: string;
  border: string;
  marked: string;
}

export interface ThemeDefinition {
  name: string;
  colors: ThemeColors;
}

const defaultTheme: ThemeColors = {
  accent: 'cyan',
  accentBg: 'cyan',
  muted: undefined,
  mutedDim: true,
  success: 'green',
  error: 'red',
  warning: 'yellow',
  info: 'cyan',
  border: 'gray',
  marked: 'magenta',
};

const highContrastTheme: ThemeColors = {
  accent: 'white',
  accentBg: 'white',
  muted: undefined,
  mutedDim: false,
  success: 'white',
  error: 'white',
  warning: 'white',
  info: 'white',
  border: 'white',
  marked: 'white',
};

export const themes: Record<string, ThemeColors> = {
  default: defaultTheme,
  'high-contrast': highContrastTheme,
};

export interface ThemeStoreState {
  themeName: string;
  colors: ThemeColors;
  setTheme: (name: string) => void;
}

export const themeStore = createStore<ThemeStoreState>((set) => ({
  themeName: 'default',
  colors: { ...defaultTheme },

  setTheme(name: string) {
    const colors = themes[name] ?? defaultTheme;
    set({ themeName: name, colors: { ...colors } });
    void configStore
      .getState()
      .update({ theme: name })
      .catch(() => {});
  },
}));

/** Call after configStore.init() to sync theme from persisted config. */
export function initThemeFromConfig(): void {
  const themeName = configStore.getState().config.theme ?? 'default';
  const colors = themes[themeName] ?? defaultTheme;
  themeStore.setState({ themeName, colors: { ...colors } });
}

export function useThemeStore<T>(
  selector: (state: ThemeStoreState) => T,
): T {
  return useStore(themeStore, selector);
}
```

**Step 2: Run build**

Run: `npm run build`
Expected: Compiles with no errors.

**Step 3: Commit**

```
feat: add themeStore with default and high-contrast themes
```

---

### Task 4: Initialize themeStore in app lifecycle

**Files:**
- Modify: `src/index.tsx` (add themeStore init + destroy)

**Step 1: Add import and init call**

Add import at top:
```typescript
import { initThemeFromConfig } from './stores/themeStore.js';
```

After `await configStore.getState().init(cwd);` (line 30), add:
```typescript
  initThemeFromConfig();
```

**Step 2: No destroy needed** — themeStore is pure in-memory, no resources to release.

**Step 3: Run build + tests**

Run: `npm run build && npm test`
Expected: Pass.

**Step 4: Commit**

```
feat: initialize themeStore on app startup
```

---

### Task 5: Add theme picker to Settings screen

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/stores/uiStore.ts` (add `theme-picker` overlay type)

**Step 1: Add `theme-picker` overlay type**

In `src/stores/uiStore.ts`, add to the `ActiveOverlay` union:
```typescript
  | { type: 'theme-picker' }
```

**Step 2: Add `theme` nav item kind**

In `src/components/Settings.tsx`, add to the `NavItem` union:
```typescript
  | { kind: 'theme' }
```

**Step 3: Add theme to navItems array**

After `items.push({ kind: 'branch-clipboard-toggle' });` (line 197), add:
```typescript
    items.push({ kind: 'theme' });
```

**Step 4: Add imports**

Add at top of Settings.tsx:
```typescript
import { themeStore, useThemeStore, themes } from '../stores/themeStore.js';
```

**Step 5: Add theme to the null-return guard**

In the `navItems.map` block that renders backends (the big `if` chain around line 427-438), add `item.kind === 'theme'` to the null-return condition.

**Step 6: Handle Enter on theme item**

In the `useInput` handler, in the `key.return` block, add:
```typescript
        } else if (item.kind === 'theme') {
          openOverlay({ type: 'theme-picker' });
```

**Step 7: Render theme section**

After the Branch section (around line 570), add a new "Display" section:
```tsx
      <Box marginTop={1} flexDirection="column">
        <Text bold>Display:</Text>
        {navItems.map((item, idx) => {
          if (item.kind !== 'theme') return null;
          const focused = idx === cursor;
          return (
            <Box key="theme" marginLeft={2}>
              <Text color={focused ? 'cyan' : undefined}>
                {focused ? '>' : ' '}{' '}
              </Text>
              <Text bold={focused} color={focused ? 'cyan' : undefined}>
                Theme: {themeName}
              </Text>
            </Box>
          );
        })}
      </Box>
```

Get `themeName` by adding near the top of the component:
```typescript
  const themeName = useThemeStore((s) => s.themeName);
```

**Step 8: Add theme picker overlay**

After the existing overlay panels (around line 738), add:
```tsx
      {activeOverlay?.type === 'theme-picker' && (
        <OverlayPanel
          title="Theme"
          items={Object.keys(themes).map((t) => ({ id: t, label: t, value: t }))}
          onSelect={(item) => {
            themeStore.getState().setTheme(item.value);
            closeOverlay();
          }}
          onCancel={() => closeOverlay()}
        />
      )}
```

**Step 9: Run build + format**

Run: `npm run format && npm run build`
Expected: Pass.

**Step 10: Commit**

```
feat: add theme picker to Settings screen
```

---

### Task 6: Migrate Header component to use theme tokens

**Files:**
- Modify: `src/components/Header.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component function:
```typescript
const { accent, error, warning, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors**

- `color="cyan"` → `color={accent}`
- `color="red"` → `color={error}`
- `color="yellow"` → `color={warning}`
- `dimColor` (bare) → `dimColor={mutedDim}`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate Header to theme tokens
```

---

### Task 7: Migrate TableLayout component to use theme tokens

**Files:**
- Modify: `src/components/TableLayout.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component:
```typescript
const { accent, accentBg, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors**

- `color="cyan"` → `color={accent}`
- `backgroundColor="cyan"` → `backgroundColor={accentBg}`
- `dimColor` (bare) → `dimColor={mutedDim}`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate TableLayout to theme tokens
```

---

### Task 8: Migrate WorkItemList component to use theme tokens

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component:
```typescript
const { accent, warning, marked, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors**

- `color="cyan"` → `color={accent}`
- `color="yellow"` → `color={warning}`
- `color="magenta"` → `color={marked}`
- `dimColor` (bare) → `dimColor={mutedDim}`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate WorkItemList to theme tokens
```

---

### Task 9: Migrate OverlayPanel component to use theme tokens

**Files:**
- Modify: `src/components/OverlayPanel.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component:
```typescript
const { accent, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors**

- `color="cyan"` → `color={accent}`
- `dimColor` (bare) → `dimColor={mutedDim}`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate OverlayPanel to theme tokens
```

---

### Task 10: Migrate DetailPanel component to use theme tokens

**Files:**
- Modify: `src/components/DetailPanel.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component:
```typescript
const { accent, error, warning, info, border, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors and priorityColor function**

- `color="cyan"` → `color={accent}`
- `borderColor="gray"` → `borderColor={border}`
- `dimColor` (bare) → `dimColor={mutedDim}`
- Replace `priorityColor()` to use theme tokens: `critical` → `error`, `high` → `warning`, `medium` → `info`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate DetailPanel to theme tokens
```

---

### Task 11: Migrate WorkItemForm component to use theme tokens

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add theme import and hook**

```typescript
import { useThemeStore } from '../stores/themeStore.js';
```

Near top of component:
```typescript
const { accent, success, error, warning, mutedDim } = useThemeStore((s) => s.colors);
```

**Step 2: Replace hardcoded colors**

This is the largest component. Replace all instances:
- `color="cyan"` → `color={accent}`
- `color="green"` → `color={success}`
- `color="red"` → `color={error}`
- `color="yellow"` → `color={warning}`
- `dimColor` (bare) → `dimColor={mutedDim}`

**Step 3: Run build**

Run: `npm run build`
Expected: Pass.

**Step 4: Commit**

```
feat: migrate WorkItemForm to theme tokens
```

---

### Task 12: Migrate remaining components to use theme tokens

**Files:**
- Modify: `src/components/ErrorBoundary.tsx`
- Modify: `src/components/StatusScreen.tsx`
- Modify: `src/components/Settings.tsx` (the hardcoded colors in its own JSX)
- Modify: `src/components/AuthPrompt.tsx`
- Modify: `src/components/HelpScreen.tsx`
- Modify: `src/components/AutocompleteInput.tsx`
- Modify: `src/components/MultiAutocompleteInput.tsx`
- Modify: `src/components/Breadcrumbs.tsx`
- Modify: `src/components/IterationPicker.tsx`

**Step 1: For each file, add theme import + hook + replace colors**

Same pattern as previous tasks. Each component:
1. Import `useThemeStore` from `../stores/themeStore.js`
2. Destructure needed tokens: `const { ... } = useThemeStore((s) => s.colors)`
3. Replace hardcoded color strings and `dimColor` props

Key replacements per file:
- **ErrorBoundary**: `color="red"` → `error`, `dimColor` → `mutedDim`
- **StatusScreen**: `color="cyan"` → `accent`, `color="green"` → `success`, `color="red"` → `error`, `dimColor` → `mutedDim`
- **Settings**: `color="cyan"` → `accent`, `color="green"` → `success`, `dimColor` → `mutedDim`
- **AuthPrompt**: `color="cyan"` → `accent`, `color="green"` → `success`, `color="red"` → `error`, `dimColor` → `mutedDim`
- **HelpScreen**: `color="cyan"` → `accent`, `dimColor` → `mutedDim`
- **AutocompleteInput**: `dimColor` → `mutedDim`
- **MultiAutocompleteInput**: `dimColor` → `mutedDim`
- **Breadcrumbs**: `dimColor` → `mutedDim`
- **IterationPicker**: `dimColor` → `mutedDim`

**Step 2: Run build + format + lint**

Run: `npm run format && npm run build && npm run lint`
Expected: All pass.

**Step 3: Commit**

```
feat: migrate remaining components to theme tokens
```

---

### Task 13: Full verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Run full pre-commit checks**

Run: `npm run format:check && npm run lint && npx tsc --noEmit`
Expected: All pass.

**Step 3: Manual smoke test**

Run: `npm start`
Expected: App renders with default theme (visually identical to before).

Run: Go to Settings → Theme → select high-contrast
Expected: All colors switch to white, no dim text.

Run: Exit and restart app
Expected: High-contrast theme persists.

**Step 4: Commit if any fixes needed, then final commit**

```
feat(theme): add high-contrast mode with extensible theme system

Closes #13
```
