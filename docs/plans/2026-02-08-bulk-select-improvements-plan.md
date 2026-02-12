# Bulk Select Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add toggle-all (`M`) and shift+arrow range selection to the mark/select system.

**Architecture:** Extend `listViewStore` with `setMarkedIds`, `rangeAnchor`, and `setRangeAnchor`. Update keybinding handlers in `WorkItemList` for `M` (toggle-all) and shift+up/down (range select). Update help screen.

**Tech Stack:** TypeScript, Zustand, Ink (React terminal), Vitest

---

### Task 1: Add `setMarkedIds` to listViewStore

**Files:**
- Modify: `src/stores/listViewStore.ts:4-18` (interface)
- Modify: `src/stores/listViewStore.ts:59` (actions)
- Test: `src/stores/listViewStore.test.ts`

**Step 1: Write the failing tests**

Add to `src/stores/listViewStore.test.ts` inside the `markedIds` describe block:

```typescript
it('sets marked ids to exact set', () => {
  listViewStore.getState().toggleMarked('item-1');
  listViewStore.getState().setMarkedIds(new Set(['item-2', 'item-3']));
  expect(listViewStore.getState().markedIds).toEqual(
    new Set(['item-2', 'item-3']),
  );
});

it('sets marked ids to empty set', () => {
  listViewStore.getState().toggleMarked('item-1');
  listViewStore.getState().setMarkedIds(new Set());
  expect(listViewStore.getState().markedIds.size).toBe(0);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: FAIL — `setMarkedIds is not a function`

**Step 3: Implement `setMarkedIds`**

In `src/stores/listViewStore.ts`:

Add to the `ListViewState` interface (after line 14):
```typescript
setMarkedIds: (ids: Set<string>) => void;
```

Add to the store (after the `clearMarked` action, line 59):
```typescript
setMarkedIds: (ids) => set({ markedIds: ids }),
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(store): add setMarkedIds to listViewStore
```

---

### Task 2: Add `rangeAnchor` and `setRangeAnchor` to listViewStore

**Files:**
- Modify: `src/stores/listViewStore.ts:4-18` (interface)
- Modify: `src/stores/listViewStore.ts:20-25` (initialState)
- Modify: `src/stores/listViewStore.ts:72-78` (reset)
- Test: `src/stores/listViewStore.test.ts`

**Step 1: Write the failing tests**

Add a new describe block in `src/stores/listViewStore.test.ts`:

```typescript
describe('rangeAnchor', () => {
  it('sets range anchor', () => {
    listViewStore.getState().setRangeAnchor(3);
    expect(listViewStore.getState().rangeAnchor).toBe(3);
  });

  it('clears range anchor', () => {
    listViewStore.getState().setRangeAnchor(3);
    listViewStore.getState().setRangeAnchor(null);
    expect(listViewStore.getState().rangeAnchor).toBeNull();
  });

  it('resets range anchor on reset', () => {
    listViewStore.getState().setRangeAnchor(5);
    listViewStore.getState().reset();
    expect(listViewStore.getState().rangeAnchor).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: FAIL — `rangeAnchor` / `setRangeAnchor` not found

**Step 3: Implement `rangeAnchor` and `setRangeAnchor`**

In `src/stores/listViewStore.ts`:

Add to the `ListViewState` interface:
```typescript
rangeAnchor: number | null;
setRangeAnchor: (index: number | null) => void;
```

Add to `initialState`:
```typescript
rangeAnchor: null as number | null,
```

Add to the store actions:
```typescript
setRangeAnchor: (index) => set({ rangeAnchor: index }),
```

Update `reset` to include `rangeAnchor: null`.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(store): add rangeAnchor to listViewStore
```

---

### Task 3: Update `M` keybinding to toggle-all

**Files:**
- Modify: `src/components/WorkItemList.tsx:601-608` (keybinding handler)

**Step 1: Update the `M` handler**

Replace the current `M` handler at lines 607-608:

```typescript
// Old:
if (input === 'M') {
  clearMarked();
}
```

With:

```typescript
if (input === 'M' && treeItems.length > 0) {
  setRangeAnchor(null);
  const visibleIds = treeItems.map((t) => t.item.id);
  const allMarked = visibleIds.every((id) => markedIds.has(id));
  if (allMarked) {
    clearMarked();
  } else {
    setMarkedIds(new Set(visibleIds));
  }
}
```

This requires pulling `setMarkedIds` and `setRangeAnchor` from the store. Find where `toggleMarked` and `clearMarked` are destructured from the store (search for `useListViewStore` calls) and add `setMarkedIds` and `setRangeAnchor` to the destructuring.

**Step 2: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS (existing tests still pass)

**Step 4: Commit**

```
feat(list): change M from clear-marks to toggle-all-marks
```

---

### Task 4: Add shift+arrow range selection

**Files:**
- Modify: `src/components/WorkItemList.tsx:392-407` (cursor movement handler)

**Step 1: Update the up/down arrow handlers**

Replace the current up/down handlers at lines 392-399:

```typescript
// Old:
if (key.upArrow) {
  setCursor(Math.max(0, cursor - 1));
  clearWarning();
}
if (key.downArrow) {
  setCursor(Math.min(treeItems.length - 1, cursor + 1));
  clearWarning();
}
```

With:

```typescript
if (key.upArrow) {
  if (key.shift) {
    const anchor = rangeAnchor ?? cursor;
    if (rangeAnchor === null) setRangeAnchor(cursor);
    const newCursor = Math.max(0, cursor - 1);
    setCursor(newCursor);
    const start = Math.min(anchor, newCursor);
    const end = Math.max(anchor, newCursor);
    setMarkedIds(
      new Set(treeItems.slice(start, end + 1).map((t) => t.item.id)),
    );
  } else {
    if (rangeAnchor !== null) setRangeAnchor(null);
    setCursor(Math.max(0, cursor - 1));
  }
  clearWarning();
}
if (key.downArrow) {
  if (key.shift) {
    const anchor = rangeAnchor ?? cursor;
    if (rangeAnchor === null) setRangeAnchor(cursor);
    const newCursor = Math.min(treeItems.length - 1, cursor + 1);
    setCursor(newCursor);
    const start = Math.min(anchor, newCursor);
    const end = Math.max(anchor, newCursor);
    setMarkedIds(
      new Set(treeItems.slice(start, end + 1).map((t) => t.item.id)),
    );
  } else {
    if (rangeAnchor !== null) setRangeAnchor(null);
    setCursor(Math.min(treeItems.length - 1, cursor + 1));
  }
  clearWarning();
}
```

This also requires destructuring `rangeAnchor` from the store (read value, not action).

**Step 2: Clear anchor on `m` press**

Update the `m` handler at lines 601-604. Add `setRangeAnchor(null)`:

```typescript
if (input === 'm' && treeItems.length > 0) {
  setRangeAnchor(null);
  const itemId = treeItems[cursor]!.item.id;
  toggleMarked(itemId);
}
```

**Step 3: Add useEffect to clear stale anchor on treeItems change**

Find the existing `useEffect` that clamps cursor (lines 292-294):

```typescript
useEffect(() => {
  clampCursor(treeItems.length - 1);
}, [treeItems.length, clampCursor]);
```

Add `setRangeAnchor(null)` inside this effect:

```typescript
useEffect(() => {
  clampCursor(treeItems.length - 1);
  setRangeAnchor(null);
}, [treeItems.length, clampCursor, setRangeAnchor]);
```

**Step 4: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 6: Commit**

```
feat(list): add shift+arrow range selection
```

---

### Task 5: Update HelpScreen

**Files:**
- Modify: `src/components/HelpScreen.tsx:58-60`

**Step 1: Update keybinding descriptions**

Replace lines 58-60:

```typescript
// Old:
actions.push({ key: 'm', description: 'Toggle mark' });
actions.push({ key: 'M', description: 'Clear all marks' });
actions.push({ key: 'B', description: 'Bulk actions menu' });
```

With:

```typescript
actions.push({ key: 'm', description: 'Toggle mark' });
actions.push({ key: 'M', description: 'Toggle mark all' });
actions.push({ key: 'shift+↑↓', description: 'Range select' });
actions.push({ key: 'B', description: 'Bulk actions menu' });
```

**Step 2: Run build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```
docs(help): update mark keybindings for toggle-all and range select
```

---

### Task 6: Format, lint, and verify

**Step 1: Run format**

Run: `npm run format`

**Step 2: Run full verification**

Run: `npm run format:check && npm run lint && npx tsc --noEmit && npm test`
Expected: All PASS

**Step 3: Commit any formatting changes if needed**

```
chore: format
```

---

### Task 7: Update tic issues

**Step 1: Close issues #9 and #10**

Update both issues to status `done`.
