# Full-Row Selection Highlight Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make the selected row in the work item list show a full-width background highlight instead of only bolding individual text segments.

**Architecture:** Add `selectionBg` and `selectedMarkedBg` to the theme color system, apply `backgroundColor` to the outer `<Box>` in `GenericTableRow` based on selection/marked state, and update column renderers to use readable text colors against the new background. Also fix the "medium" priority pill default from cyan to blue so it doesn't blend with the cyan selection background.

**Tech Stack:** TypeScript, React/Ink, Zustand (themeStore), Vitest

---

### Task 1: Add selection colors to ThemeColors interface and theme definitions

**Files:**
- Modify: `src/stores/themeStore.ts:5-16` (ThemeColors interface)
- Modify: `src/stores/themeStore.ts:30-41` (defaultTheme)
- Modify: `src/stores/themeStore.ts:43-54` (highContrastTheme)

**Step 1: Write the failing test**

Add to `src/stores/themeStore.test.ts` at the end of the file (before the closing):

```typescript
describe('selection theme colors', () => {
  it('default theme has selectionBg', () => {
    themeStore.setState({ themeName: 'default', colorOverrides: {} });
    expect(themeStore.getState().colors.selectionBg).toBe('cyanBright');
  });

  it('default theme has selectedMarkedBg', () => {
    themeStore.setState({ themeName: 'default', colorOverrides: {} });
    expect(themeStore.getState().colors.selectedMarkedBg).toBe('magentaBright');
  });

  it('high-contrast theme has selectionBg', () => {
    const { themes } = await import('./themeStore.js');
    expect(themes['high-contrast']!.selectionBg).toBe('whiteBright');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: FAIL — `selectionBg` property doesn't exist on `ThemeColors`

**Step 3: Write minimal implementation**

In `src/stores/themeStore.ts`, add `selectionBg` and `selectedMarkedBg` to:

1. `ThemeColors` interface (after line 15 `marked: string;`):
```typescript
  selectionBg: string;
  selectedMarkedBg: string;
```

2. `defaultTheme` (after line 40 `marked: 'magenta',`):
```typescript
  selectionBg: 'cyanBright',
  selectedMarkedBg: 'magentaBright',
```

3. `highContrastTheme` (after line 53 `marked: 'white',`):
```typescript
  selectionBg: 'whiteBright',
  selectedMarkedBg: 'whiteBright',
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/themeStore.ts src/stores/themeStore.test.ts
git commit -m "feat: add selectionBg and selectedMarkedBg to theme colors"
```

---

### Task 2: Change "medium" priority default color from cyan to blue

**Files:**
- Modify: `src/stores/themeStore.ts:88` (defaultDefaults priority medium)
- Modify: `src/stores/themeStore.ts:120` (highContrastDefaults priority medium)

**Step 1: Update the existing test expectation (if any) or write a new one**

There's no existing test for "medium" priority color. Add to `src/stores/themeStore.test.ts` inside `describe('keyword defaults')`:

```typescript
    it('returns blue for "medium" priority', () => {
      const result = themeStore
        .getState()
        .resolveFieldColor('priority', 'medium');
      expect(result).toEqual({ bg: 'blue', fg: 'white' });
    });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: FAIL — currently returns `{ bg: 'cyan', fg: 'black' }`

**Step 3: Write minimal implementation**

In `src/stores/themeStore.ts`:

1. Line 88 — change `{ patterns: ['medium'], color: { bg: 'cyan', fg: 'black' } }` to:
```typescript
    { patterns: ['medium'], color: { bg: 'blue', fg: 'white' } },
```

2. Line 120 — change `{ patterns: ['medium'], color: { bg: 'cyanBright', fg: 'white' } }` to:
```typescript
    { patterns: ['medium'], color: { bg: 'blueBright', fg: 'white' } },
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/themeStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/themeStore.ts src/stores/themeStore.test.ts
git commit -m "fix: change medium priority pill from cyan to blue to avoid selection bg clash"
```

---

### Task 3: Apply selection background in GenericTableRow

**Files:**
- Modify: `src/components/TableLayout.tsx:129-131`

**Step 1: Write minimal implementation**

In `src/components/TableLayout.tsx`:

1. Line 129 — update the theme selector destructuring from:
```typescript
  const { accent, accentBg } = useThemeStore((s) => s.colors);
```
to:
```typescript
  const { accent, accentBg, selectionBg, selectedMarkedBg } = useThemeStore(
    (s) => s.colors,
  );
```

2. Line 131 — replace the outer Box from:
```typescript
    <Box {...(marked && !selected ? { backgroundColor: accentBg } : {})}>
```
to:
```typescript
    <Box
      backgroundColor={
        selected && marked
          ? selectedMarkedBg
          : selected
            ? selectionBg
            : marked
              ? accentBg
              : undefined
      }
    >
```

3. Line 134 — update the marker `>` text. When selected with a cyanBright background, cyan text is hard to read. Change:
```typescript
          <Text color={accent}>{selected ? '>' : ' '}</Text>
```
to:
```typescript
          <Text color={selected ? autoFg(selectionBg) : accent}>
            {selected ? '>' : ' '}
          </Text>
```

This requires importing `autoFg` at the top of the file. Add to the existing import line:
```typescript
import { useThemeStore, autoFg } from '../stores/themeStore.js';
```

**Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/TableLayout.tsx
git commit -m "feat: apply full-row selection background in GenericTableRow"
```

---

### Task 4: Update WorkItemList column renderers for readable text on selection background

**Files:**
- Modify: `src/components/WorkItemList.tsx:55-151` (column render functions)

**Step 1: Write minimal implementation**

The `buildWorkItemColumns` function currently receives `accent: string` and uses `color={selected ? accent : undefined}` in ID, title, and assignee columns. Since `accent` is `'cyan'` and `selectionBg` is `'cyanBright'`, cyan text on cyanBright is unreadable.

Change the function signature at line 55-59 from:
```typescript
function buildWorkItemColumns(
  capabilities: BackendCapabilities,
  collapsedIds: Set<string>,
  accent: string,
): ColumnDef<TreeItem>[] {
```
to:
```typescript
function buildWorkItemColumns(
  capabilities: BackendCapabilities,
  collapsedIds: Set<string>,
  accent: string,
  selectionFg: string,
): ColumnDef<TreeItem>[] {
```

Then update the three column renderers that use `selected ? accent`:

1. **ID column** (line 71) — change `color={selected ? accent : undefined}` to:
```typescript
        color={selected ? selectionFg : undefined}
```

2. **Title column** (line 97) — change `color={selected ? accent : undefined}` to:
```typescript
          color={selected ? selectionFg : undefined}
```

3. **Assignee column** (line 142) — change `color={selected ? accent : undefined}` to:
```typescript
          color={selected ? selectionFg : undefined}
```

Then find the caller of `buildWorkItemColumns` in the same file — it's inside a `useMemo`. Update it to pass `autoFg(colors.selectionBg)` as the fourth argument. Search for the call site:

```typescript
// Current:
buildWorkItemColumns(capabilities, collapsedIds, colors.accent)
// Change to:
buildWorkItemColumns(capabilities, collapsedIds, colors.accent, autoFg(colors.selectionBg))
```

The file needs to import `autoFg` from themeStore. Add it to the existing import:
```typescript
import { useThemeStore, autoFg } from '../stores/themeStore.js';
```

Also update the `useMemo` deps array to include `colors.selectionBg`.

**Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: use readable text colors for selected rows in WorkItemList"
```

---

### Task 5: Update PullRequestList and BranchList column renderers

**Files:**
- Modify: `src/components/PullRequestList.tsx` (3 instances of `selected ? accent`)
- Modify: `src/components/BranchList.tsx` (1 instance of `selected ? accent`)

**Step 1: Write minimal implementation**

Apply the same pattern as Task 4. In each file:

1. Import `autoFg` from themeStore (add to existing import)
2. Get `selectionBg` from the theme colors where `accent` is already destructured
3. Replace `color={selected ? accent : undefined}` with `color={selected ? autoFg(selectionBg) : undefined}`

For `BranchList.tsx` line 69, the expression is more complex:
```typescript
color={selected ? accent : isTic ? accent : undefined}
```
Change to:
```typescript
color={selected ? autoFg(selectionBg) : isTic ? accent : undefined}
```

**Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: no errors

**Step 3: Commit**

```bash
git add src/components/PullRequestList.tsx src/components/BranchList.tsx
git commit -m "feat: use readable text colors for selected rows in PR and branch lists"
```

---

### Task 6: Run full test suite and lint

**Step 1: Run tests**

Run: `npm test`
Expected: all tests pass

**Step 2: Run lint**

Run: `npm run lint`
Expected: no errors

**Step 3: Run format check**

Run: `npm run format:check`
Expected: all files formatted. If not, run `npm run format` and commit.

**Step 4: Run build**

Run: `npm run build`
Expected: clean build

**Step 5: Final commit (if formatting fix needed)**

```bash
git add -A
git commit -m "chore: format"
```

---

### Task 7: Manual visual verification

**Step 1: Start the TUI**

Run: `npm start`

**Step 2: Verify visually**

- Navigate up/down in the work item list — selected row should have a `cyanBright` background spanning the full row width
- Mark a row with `m` — should show `cyan` background (existing behavior)
- Navigate cursor to a marked row — should show `magentaBright` background (combined state)
- Check that ColorPills (status, priority, labels) retain their own background colors
- Check that "medium" priority pills now show blue instead of cyan
- Check text readability on the selection background (should be black text, not cyan)

**Step 3: Switch to high-contrast theme (Settings > Theme)**

Verify selection background uses `whiteBright` in high-contrast mode.
