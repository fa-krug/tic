# UI Quick Wins Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add 8 small UI polish improvements across all TUI areas: success toasts, scroll position, empty states, required field markers, autocomplete overflow, description hint, auto-dismiss warnings, responsive help bar.

**Architecture:** All changes are additive. The main new state is a `toast` field on the existing `uiStore`. Everything else is derived from existing state or is a pure rendering change. The autocomplete `filterSuggestions` functions change return type from `string[]` to `{ visible: string[]; totalCount: number }`.

**Tech Stack:** TypeScript, React 19, Ink 6, Zustand (vanilla store)

**Design doc:** `docs/plans/2026-02-06-ui-quick-wins-design.md`

---

### Task 1: Toast State in uiStore

**Files:**
- Modify: `src/stores/uiStore.ts`
- Modify: `src/stores/uiStore.test.ts`

**Step 1: Write the failing tests**

Add to the bottom of the existing describe block in `src/stores/uiStore.test.ts`:

```ts
it('starts with no toast', () => {
  expect(uiStore.getState().toast).toBeNull();
});

it('sets toast with message and timestamp', () => {
  uiStore.getState().setToast('Item created');
  const toast = uiStore.getState().toast;
  expect(toast).not.toBeNull();
  expect(toast!.message).toBe('Item created');
  expect(typeof toast!.timestamp).toBe('number');
});

it('clears toast', () => {
  uiStore.getState().setToast('Item created');
  uiStore.getState().clearToast();
  expect(uiStore.getState().toast).toBeNull();
});

it('reset clears toast', () => {
  uiStore.getState().setToast('test');
  uiStore.getState().reset();
  expect(uiStore.getState().toast).toBeNull();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: FAIL — `toast` property does not exist on UIStoreState

**Step 3: Implement toast state**

In `src/stores/uiStore.ts`:

Add to `UIStoreState` interface (after `warning: string;`):
```ts
toast: { message: string; timestamp: number } | null;
```

Add to interface (after `clearWarning`):
```ts
setToast: (msg: string) => void;
clearToast: () => void;
```

Add to store initial state (after `warning: '',`):
```ts
toast: null,
```

Add to store actions (after `clearWarning`):
```ts
setToast: (msg) => set({ toast: { message: msg, timestamp: Date.now() } }),
clearToast: () => set({ toast: null }),
```

Update `reset` to also clear toast:
```ts
reset: () => set({ activeOverlay: null, warning: '', toast: null }),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: PASS (all tests including new ones)

**Step 5: Commit**

```
feat(uiStore): add toast state for success messages
```

---

### Task 2: Autocomplete "+X more" Indicator

**Files:**
- Modify: `src/components/AutocompleteInput.tsx`
- Modify: `src/components/AutocompleteInput.test.ts`
- Modify: `src/components/MultiAutocompleteInput.tsx`
- Modify: `src/components/MultiAutocompleteInput.test.ts`

**Step 1: Write failing tests for AutocompleteInput**

Add to `src/components/AutocompleteInput.test.ts`:

```ts
import { filterSuggestions } from './AutocompleteInput.js';

// Update the existing 'caps visible suggestions at 5' test AND add new tests:

it('returns totalCount alongside visible suggestions', () => {
  const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const result = filterSuggestions('', suggestions);
  expect(result.visible).toHaveLength(5);
  expect(result.totalCount).toBe(7);
});

it('totalCount equals visible length when under cap', () => {
  const result = filterSuggestions('', ['alice', 'bob']);
  expect(result.visible).toEqual(['alice', 'bob']);
  expect(result.totalCount).toBe(2);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/components/AutocompleteInput.test.ts`
Expected: FAIL — `result.visible` is undefined (result is still a plain array)

**Step 3: Implement in AutocompleteInput**

In `src/components/AutocompleteInput.tsx`, change `filterSuggestions` return type and implementation:

```ts
export function filterSuggestions(
  value: string,
  suggestions: string[],
): { visible: string[]; totalCount: number } {
  const filtered = value
    ? suggestions.filter((s) => s.toLowerCase().includes(value.toLowerCase()))
    : suggestions;
  return { visible: filtered.slice(0, MAX_VISIBLE), totalCount: filtered.length };
}
```

Update the component to use the new shape. Change line 34:
```ts
const { visible, totalCount } = filterSuggestions(value, suggestions);
```

After the suggestion map (after closing `</Box>` of the suggestions list, before the outer `</Box>`), add:
```tsx
{totalCount > MAX_VISIBLE && (
  <Box marginLeft={2}>
    <Text dimColor>+{totalCount - MAX_VISIBLE} more</Text>
  </Box>
)}
```

**Step 4: Fix existing tests**

The existing tests return plain arrays. Update all existing tests in `AutocompleteInput.test.ts` to access `.visible` instead of the raw result. For example:

```ts
it('filters suggestions by case-insensitive substring match', () => {
  const result = filterSuggestions('AL', ['alice', 'bob', 'ALBERT']);
  expect(result.visible).toEqual(['alice', 'ALBERT']);
});

it('returns all suggestions (up to cap) when input is empty', () => {
  const result = filterSuggestions('', ['alice', 'bob', 'charlie']);
  expect(result.visible).toEqual(['alice', 'bob', 'charlie']);
});

it('caps visible suggestions at 5', () => {
  const suggestions = ['a', 'b', 'c', 'd', 'e', 'f', 'g'];
  const result = filterSuggestions('', suggestions);
  expect(result.visible).toHaveLength(5);
  expect(result.visible).toEqual(['a', 'b', 'c', 'd', 'e']);
});

it('returns empty array when nothing matches', () => {
  const result = filterSuggestions('zzz', ['alice', 'bob']);
  expect(result.visible).toEqual([]);
});

it('matches anywhere in the string', () => {
  const result = filterSuggestions('ice', ['alice', 'bob']);
  expect(result.visible).toEqual(['alice']);
});

it('handles empty suggestions list', () => {
  const result = filterSuggestions('test', []);
  expect(result.visible).toEqual([]);
});
```

**Step 5: Run tests**

Run: `npx vitest run src/components/AutocompleteInput.test.ts`
Expected: PASS

**Step 6: Same changes for MultiAutocompleteInput**

Apply the identical pattern to `src/components/MultiAutocompleteInput.tsx`:

Change `filterSuggestions` return type:
```ts
export function filterSuggestions(
  value: string,
  suggestions: string[],
): { visible: string[]; totalCount: number } {
  const { current } = parseSegments(value);
  const existing = getExistingLabels(value);
  const filtered = suggestions.filter((s) => {
    const lower = s.toLowerCase();
    if (existing.has(lower)) return false;
    return !current || lower.includes(current.toLowerCase());
  });
  return { visible: filtered.slice(0, MAX_VISIBLE), totalCount: filtered.length };
}
```

Update component line 63:
```ts
const { visible, totalCount } = filterSuggestions(value, suggestions);
```

Add overflow indicator after suggestion list (same as AutocompleteInput):
```tsx
{totalCount > MAX_VISIBLE && (
  <Box marginLeft={2}>
    <Text dimColor>+{totalCount - MAX_VISIBLE} more</Text>
  </Box>
)}
```

Update all tests in `MultiAutocompleteInput.test.ts` to use `.visible` and `.totalCount`.

**Step 7: Run all tests**

Run: `npx vitest run src/components/AutocompleteInput.test.ts src/components/MultiAutocompleteInput.test.ts`
Expected: PASS

**Step 8: Commit**

```
feat(autocomplete): show "+X more" when suggestions are truncated
```

---

### Task 3: Help Bar Responsive Trimming + Scroll Position

These two are tightly coupled (they share the same help bar line), so implement together.

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Replace static helpText with buildHelpText function**

Replace the static `helpText` constant at ~line 704:

```ts
const helpText =
  '↑↓ navigate  ←→ expand/collapse  enter edit  c create  , settings  ? help';
```

With a function (define above the component or inline):

```ts
function buildHelpText(availableWidth: number): string {
  const shortcuts = [
    { key: '↑↓', label: 'navigate' },
    { key: '←→', label: 'expand' },
    { key: 'enter', label: 'edit' },
    { key: 'c', label: 'create' },
    { key: 'd', label: 'delete' },
    { key: '/', label: 'search' },
    { key: ',', label: 'settings' },
    { key: '?', label: 'help' },
  ];
  const sep = '  ';
  let result = '';
  for (const s of shortcuts) {
    const entry = `${s.key} ${s.label}`;
    const candidate = result ? result + sep + entry : entry;
    if (candidate.length > availableWidth) break;
    result = candidate;
  }
  return result;
}
```

**Step 2: Add scroll position indicator and responsive help bar**

Inside the component, compute `positionText`:

```ts
const positionText =
  treeItems.length > viewport.maxVisible
    ? `${cursor + 1}/${treeItems.length}`
    : '';
```

Replace the help bar rendering at ~line 957. Change:
```tsx
<Text dimColor>{helpText}</Text>
```
To:
```tsx
<Box>
  <Text dimColor>
    {buildHelpText(
      terminalWidth - (positionText ? positionText.length + 2 : 0),
    )}
  </Text>
  {positionText && (
    <Text dimColor>
      {' '}
      {positionText}
    </Text>
  )}
</Box>
```

Use `<Box justifyContent="space-between">` if the above doesn't space correctly — test and adjust. The key point: help text on left, position on right, help text trims to fit.

**Step 3: Run build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```
feat(WorkItemList): responsive help bar + scroll position indicator
```

---

### Task 4: Better Empty States

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Update empty state text**

At ~line 838-842, change:
```tsx
{treeItems.length === 0 && !loading && (
  <Box marginTop={1}>
    <Text dimColor>No {activeType}s in this iteration.</Text>
  </Box>
)}
```
To:
```tsx
{treeItems.length === 0 && !loading && (
  <Box marginTop={1}>
    <Text dimColor>
      No {activeType}s in this iteration. Press c to create, / to search
      all.
    </Text>
  </Box>
)}
```

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```
feat(WorkItemList): add actionable hints to empty state
```

---

### Task 5: Success Toasts in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add toast selector and auto-dismiss effect**

Add `toast` to the uiStore selector (~line 124). Change:
```ts
const { activeOverlay, warning } = useUIStore(
  useShallow((s) => ({
    activeOverlay: s.activeOverlay,
    warning: s.warning,
  })),
);
const { openOverlay, closeOverlay, setWarning, clearWarning } =
  uiStore.getState();
```
To:
```ts
const { activeOverlay, warning, toast } = useUIStore(
  useShallow((s) => ({
    activeOverlay: s.activeOverlay,
    warning: s.warning,
    toast: s.toast,
  })),
);
const { openOverlay, closeOverlay, setWarning, clearWarning, setToast, clearToast } =
  uiStore.getState();
```

Add auto-dismiss effect (after the existing useEffects, before the useInput blocks):
```ts
useEffect(() => {
  if (!toast) return;
  const timer = setTimeout(() => clearToast(), 3000);
  return () => clearTimeout(timer);
}, [toast, clearToast]);
```

**Step 2: Show toast in help bar area**

In the help bar rendering (~line 957), change the default case from:
```tsx
) : (
  <Text dimColor>{helpText}</Text>
)}
```
To:
```tsx
) : toast ? (
  <Box>
    <Text color="green">{toast.message}</Text>
    {positionText && <Text dimColor> {positionText}</Text>}
  </Box>
) : (
  <Box>
    <Text dimColor>
      {buildHelpText(
        terminalWidth - (positionText ? positionText.length + 2 : 0),
      )}
    </Text>
    {positionText && <Text dimColor> {positionText}</Text>}
  </Box>
)}
```

**Step 3: Add toast calls after delete**

In the delete confirmation handler (~line 265-279), after the `refreshData()` call, add:
```ts
setToast(
  targetIds.length === 1
    ? `Item #${targetIds[0]} deleted`
    : `${targetIds.length} items deleted`,
);
```

**Step 4: Add toast calls after bulk operations**

Find each bulk operation completion in the file (after inline property updates like parent, assignee, labels). After the `refreshData()` call in each, add appropriate toast:
- Parent update: `setToast(targetIds.length === 1 ? 'Parent updated' : \`${targetIds.length} items updated\`);`
- Assignee update: same pattern
- Labels update: same pattern
- Status/Type/Priority picker completions: same pattern

Search for all `refreshData()` calls in the file and add toasts where a user action triggered it.

**Step 5: Run build**

Run: `npm run build`
Expected: PASS

**Step 6: Commit**

```
feat(WorkItemList): show success toasts after mutations
```

---

### Task 6: Success Toasts in WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Import setToast**

Add import at top of file:
```ts
import { uiStore } from '../stores/uiStore.js';
```

**Step 2: Add toast calls in save function**

In the `save()` function (~line 449-575):

After the update path (~line 517, after `await queueWrite('update', selectedWorkItemId);`):
```ts
uiStore.getState().setToast(`Item #${selectedWorkItemId} updated`);
```

After the create path (~line 543, after `await queueWrite('create', created.id);`):
```ts
uiStore.getState().setToast(`Item #${created.id} created`);
```

After the template save paths (~line 490 and 496):
```ts
uiStore.getState().setToast(`Template "${template.name}" saved`);
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```
feat(WorkItemForm): show success toast after save
```

---

### Task 7: Required Field Markers

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add requiredFields set**

Inside the component, after the `fields` memo (~line 239), add:

```ts
const requiredFields = useMemo(() => {
  const required = new Set<FieldName>(['title']);
  if (selectedWorkItemId === null) {
    // Create mode: status and type are also required
    required.add('status');
    if (capabilities.customTypes) required.add('type');
  }
  return required;
}, [selectedWorkItemId, capabilities.customTypes]);
```

**Step 2: Update renderField to show marker**

In `renderField()` (~line 937), after the `label` computation (~line 940-943), add:

```ts
const isRequired = requiredFields.has(field as FieldName);
```

Then everywhere `{label}:` appears in the JSX of `renderField`, change to show the marker. There are multiple render paths. The cleanest approach: define a helper at the top of `renderField`:

```ts
const labelSuffix = isRequired ? (
  <Text dimColor> *</Text>
) : null;
```

Then in each `<Text>` that renders `{label}:`, append after the colon:
```tsx
<Text bold={focused} color={focused ? 'cyan' : undefined}>
  {label}:{labelSuffix}{' '}
</Text>
```

This needs to be done for: select fields (line 1002-1003, 1022-1023), autocomplete fields (assignee line 1036-1037, labels, parent, dependsOn), text fields (title), description, and comments. Only the fields that can actually be required (title, status, type) will show the marker — the `isRequired` check handles the rest.

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```
feat(WorkItemForm): show * marker on required fields
```

---

### Task 8: Auto-dismiss Warnings

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add auto-dismiss effect**

Add a `useEffect` near the other effects (after the toast auto-dismiss effect):

```ts
useEffect(() => {
  if (!warning) return;
  const timer = setTimeout(() => clearWarning(), 5000);
  return () => clearTimeout(timer);
}, [warning, clearWarning]);
```

This works alongside the existing cursor-movement clearing — whichever happens first wins.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```
feat(WorkItemList): auto-dismiss warning banner after 5 seconds
```

---

### Task 9: Description Field Hint (Verify/Polish)

**Files:**
- Modify: `src/components/WorkItemForm.tsx` (only if needed)

**Step 1: Read the description field rendering**

Read `src/components/WorkItemForm.tsx` around line 1103-1123 to verify what hint is shown.

The code at line 1119 already shows `[enter opens $EDITOR]` when the description field is focused. Verify this is correct and clear.

**Step 2: Polish if needed**

If the hint is already clear (e.g., `[enter opens $EDITOR]`), skip this task — it's already good.

If `$EDITOR` is empty/unset, the hint should say `[enter to edit]` instead of showing a blank variable. Check if there's logic for that and add it if missing.

**Step 3: Commit (if changes made)**

```
fix(WorkItemForm): polish description field editor hint
```

---

### Task 10: Final Verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linter and formatter**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 3: Run build**

Run: `npm run build`
Expected: Clean compilation

**Step 4: Run format if needed**

Run: `npm run format`

**Step 5: Final commit if format changed files**

```
style: format
```
