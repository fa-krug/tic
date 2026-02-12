# Unified Command Bar Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace separate search and command palette with a single `/`-triggered panel that shows commands by default and matching issues when typing.

**Architecture:** Replace `'search'` and `'command-palette'` overlay types with `'command-bar'`. Build a combined item list: recent commands + categorized commands + up to 5 matching issues (when query present). Selection handler dispatches based on item `kind` field.

**Tech Stack:** TypeScript, React/Ink, Zustand stores, Vitest

---

### Task 1: Add `kind` Field to OverlayItem

**Files:**
- Modify: `src/components/OverlayPanel.tsx:6-13`

**Step 1: Update OverlayItem interface**

In `src/components/OverlayPanel.tsx`, add `kind` to the interface:

```typescript
export interface OverlayItem {
  id: string;
  label: string;
  value: string;
  hint?: string;
  category?: string;
  selected?: boolean;
  kind?: 'command' | 'issue';
}
```

This is backwards-compatible — existing overlay users (property pickers etc.) don't need to set `kind`.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS (no breaking changes)

**Step 3: Commit**

```bash
git add src/components/OverlayPanel.tsx
git commit -m "feat: add kind field to OverlayItem for command-bar"
```

---

### Task 2: Replace Overlay Types in uiStore

**Files:**
- Modify: `src/stores/uiStore.ts:4-26`
- Modify: `src/stores/uiStore.test.ts`

**Step 1: Update uiStore test**

In `src/stores/uiStore.test.ts`, find lines using `{ type: 'search' }` and replace them with `{ type: 'command-bar' }`. There are 4 occurrences (lines 15, 40, 57, 72).

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: FAIL — `'command-bar'` is not a valid overlay type yet.

**Step 3: Update ActiveOverlay type**

In `src/stores/uiStore.ts`, replace:

```typescript
  | { type: 'search' }
  | { type: 'command-palette' }
```

with:

```typescript
  | { type: 'command-bar' }
```

**Step 4: Fix TypeScript errors**

Run: `npx tsc --noEmit`
Expected: Errors in `WorkItemList.tsx` referencing old types. That's expected — we'll fix those in Task 3.

**Step 5: Run uiStore test**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/uiStore.ts src/stores/uiStore.test.ts
git commit -m "feat: replace search and command-palette overlay types with command-bar"
```

---

### Task 3: Build Unified Command Bar in WorkItemList

This is the main task. Replace search and command-palette overlay handling with a single command-bar.

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Replace keybindings**

Find the `/` handler (lines 442-445) and `:` handler (lines 447-450). Replace both with a single handler:

```typescript
if (input === '/') {
  openOverlay({ type: 'command-bar' });
  return;
}
```

Remove the `:` handler entirely.

**Step 2: Update item loading useEffect**

Find the useEffect that loads `allSearchItems` (lines 366-375). Change the type check from `'search'` to `'command-bar'`:

```typescript
useEffect(() => {
  if (activeOverlay?.type !== 'command-bar' || !backend) return;
  let cancelled = false;
  void backend.listWorkItems().then((items) => {
    if (!cancelled) setAllSearchItems(items);
  });
  return () => {
    cancelled = true;
  };
}, [activeOverlay?.type, backend]);
```

**Step 3: Build combined item list**

Find the `paletteItems` useMemo (lines 809-837). Replace it with a new `commandBarItems` useMemo that combines commands and issues. It should depend on the overlay query text, so we need to track the overlay input. However, OverlayPanel manages its own input state internally.

The simpler approach: build the full command list (recent + commands) outside, and build issue items outside too. Then pass both to a custom rendering block that combines them based on the OverlayPanel's filter.

Actually, the cleanest approach: build all items upfront (commands + ALL issue items), but cap issue items at 5 and only include them when the panel has a query. Since OverlayPanel filters by its internal query, we need to adjust.

**Better approach**: Build the combined list with commands always present and all issues included but in a separate category. Let OverlayPanel's existing `filterItems` handle matching. But we need to cap issues at 5 in the filtered results.

**Simplest approach**: Since OverlayPanel handles filtering internally, we need to either:
(a) Pass all items and add post-filter capping in OverlayPanel, or
(b) Move filtering logic outside OverlayPanel for the command-bar case.

Go with **(b)**: Don't pass issues to the items list initially. Instead, add an `onQueryChange` callback prop to OverlayPanel. When the query changes, WorkItemList builds the combined list (filtered commands + up to 5 filtered issues) and passes updated items. Actually this creates a React update loop.

**Final approach — use a wrapper that manages the item list**: Replace the `paletteItems` useMemo with a `commandBarItems` state + a `commandBarQuery` state. Add `onQueryChange` to OverlayPanel to get the current filter text. When query changes, rebuild the combined list in WorkItemList:

Replace the paletteItems useMemo (lines 809-837) with:

```typescript
const [commandBarQuery, setCommandBarQuery] = useState('');

const commandBarItems: OverlayItem[] = useMemo(() => {
  const query = commandBarQuery.toLowerCase();

  // Build command items (recent + categorized)
  const commandMap = new Map(paletteCommands.map((c) => [c.id, c]));
  const recentItems: OverlayItem[] = [];
  for (const id of recentIds) {
    const cmd = commandMap.get(id);
    if (cmd) {
      recentItems.push({
        id: `recent-${cmd.id}`,
        label: cmd.label,
        value: cmd.id,
        category: 'Recent',
        kind: 'command',
      });
    }
  }

  const commandItems: OverlayItem[] = paletteCommands.map((cmd) => ({
    id: cmd.id,
    label: cmd.label,
    value: cmd.id,
    category: cmd.category,
    kind: 'command' as const,
  }));

  let allItems = [...recentItems, ...commandItems];

  // Filter commands by query
  if (query) {
    allItems = allItems.filter((item) =>
      item.label.toLowerCase().includes(query),
    );

    // Add up to 5 matching issues
    const matchingIssues = allSearchItems
      .filter(
        (item) =>
          item.title.toLowerCase().includes(query) ||
          item.id.toLowerCase().includes(query),
      )
      .slice(0, 5)
      .map((item) => ({
        id: `issue-${item.id}`,
        label: `#${item.id} ${item.title}`,
        value: item.id,
        hint: item.type,
        category: 'Issues',
        kind: 'issue' as const,
      }));

    allItems = [...allItems, ...matchingIssues];
  }

  return allItems;
}, [paletteCommands, recentIds, commandBarQuery, allSearchItems]);
```

**Step 4: Add onQueryChange prop to OverlayPanel**

In `src/components/OverlayPanel.tsx`, add `onQueryChange?: (query: string) => void` to the component props. Call it whenever the input value changes. Find where `setQuery` is called and add `onQueryChange?.(newValue)` alongside it.

In the OverlayPanel props interface (around line 17), add:

```typescript
onQueryChange?: (query: string) => void;
```

In the component body, find where query state is managed. There's a `TextInput` `onChange` handler. Add the callback there. Also, since OverlayPanel does its own filtering, we need to **disable** internal filtering when `onQueryChange` is provided (the parent handles it). Add a `disableInternalFilter?: boolean` prop. When true, skip the `filterItems` call and show all items as-is.

Actually, cleaner: add a single `externalFilter?: boolean` prop. When true:
- Don't filter items internally
- Call `onQueryChange` when input changes
- Parent rebuilds the items list

Add to OverlayPanel props:

```typescript
externalFilter?: boolean;
onQueryChange?: (query: string) => void;
```

In the filtering logic, wrap it:

```typescript
const filteredItems = externalFilter ? items : filterItems(items, query);
```

In the onChange handler for TextInput, add:

```typescript
if (onQueryChange) onQueryChange(newValue);
```

**Step 5: Replace overlay rendering**

Find the search overlay rendering (line ~1260) and command-palette rendering (line ~1363). Replace both with a single command-bar block:

```typescript
) : activeOverlay?.type === 'command-bar' ? (
  <OverlayPanel
    title="Commands"
    items={commandBarItems}
    placeholder="Type to search..."
    externalFilter
    onQueryChange={setCommandBarQuery}
    onSelect={(item) => {
      if (item.kind === 'issue') {
        const workItem = allSearchItems.find((i) => i.id === item.value);
        if (workItem) handleSearchSelect(workItem);
      } else {
        const cmd = paletteCommands.find((c) => c.id === item.value);
        if (cmd) handleCommandSelect(cmd);
      }
    }}
    onCancel={() => {
      setCommandBarQuery('');
      closeOverlay();
    }}
  />
```

**Step 6: Reset query on close**

Make sure `commandBarQuery` resets when overlay closes. The `onCancel` handler above does this. Also reset in `handleSearchSelect` and `handleCommandSelect`:

In `handleSearchSelect`, add `setCommandBarQuery('')` before `closeOverlay()`.

In `handleCommandSelect`, the function already calls `closeOverlay()` at the top. Add `setCommandBarQuery('')` right before it.

**Step 7: Run build**

Run: `npm run build`
Expected: PASS

**Step 8: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/OverlayPanel.tsx
git commit -m "feat: unified command bar replacing search and command palette"
```

---

### Task 4: Update Tests

**Files:**
- Modify: `src/components/WorkItemList.test.ts`

**Step 1: Update shortcut help text test**

Find the test at line 52 that checks for `'/ search'`. Update it to reflect the new behavior. The help text may reference `/ commands` or similar. Check what the HelpScreen renders and update accordingly.

**Step 2: Run all tests**

Run: `npm test`
Expected: PASS (or identify remaining failures)

**Step 3: Fix any remaining test failures**

Any test referencing `'search'` or `'command-palette'` overlay types needs updating to `'command-bar'`.

**Step 4: Commit**

```bash
git add -A
git commit -m "test: update tests for unified command bar"
```

---

### Task 5: Update Help Screen and Keybinding References

**Files:**
- Modify: `src/components/HelpScreen.tsx` (if it references `/` and `:` separately)
- Modify: `src/commands.ts` (if any commands reference search/command-palette)

**Step 1: Check HelpScreen**

Read `src/components/HelpScreen.tsx` and find references to `/` (search) and `:` (command palette). Merge them into a single entry like `/ commands` or `/ command bar`.

**Step 2: Check commands.ts**

Verify no commands have `when` conditions referencing the old overlay types.

**Step 3: Update and commit**

```bash
git add -A
git commit -m "docs: update help screen for unified command bar"
```

---

### Task 6: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: PASS (run `npm run format` first if needed)

**Step 4: Manual smoke test**

Run: `npm start`
- Press `/` — command bar opens with Recent + categorized commands
- Type text — commands filter, matching issues appear in "Issues" section (capped at 5)
- Select a command — executes it
- Select an issue — opens edit form
- Press Escape — closes cleanly
- Verify `:` does nothing

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup for unified command bar"
```
