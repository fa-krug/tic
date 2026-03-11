# Create Child Item Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `Shift-C` keybinding to create a child item with the parent field prefilled, from both the list view and form view.

**Architecture:** Add `createChildParentId: string | null` to `navigationStore`. When set before navigating to the create form, `WorkItemForm` reads it during initialization and prefills the parent field. The field is cleared after use.

**Tech Stack:** TypeScript, Zustand, React/Ink, Vitest

---

### Task 1: Add `createChildParentId` to navigationStore

**Files:**
- Modify: `src/stores/navigationStore.ts`
- Test: `src/stores/navigationStore.test.ts`

**Step 1: Write the failing tests**

Add to `src/stores/navigationStore.test.ts` inside the `form context setters` describe block:

```typescript
it('sets createChildParentId', () => {
  navigationStore.getState().setCreateChildParentId('42');
  expect(navigationStore.getState().createChildParentId).toBe('42');
});

it('clears createChildParentId', () => {
  navigationStore.setState({ createChildParentId: '42' });
  navigationStore.getState().setCreateChildParentId(null);
  expect(navigationStore.getState().createChildParentId).toBeNull();
});
```

Add to the `reset` test — after `navigationStore.setState(...)`, add `createChildParentId: '99'` to the setState call, and add this assertion:

```typescript
expect(navigationStore.getState().createChildParentId).toBeNull();
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/stores/navigationStore.test.ts`
Expected: FAIL — `createChildParentId` and `setCreateChildParentId` don't exist yet.

**Step 3: Implement**

In `src/stores/navigationStore.ts`:

1. Add to `NavigationState` interface:
   ```typescript
   createChildParentId: string | null;
   setCreateChildParentId: (id: string | null) => void;
   ```

2. Add to `initialState`:
   ```typescript
   createChildParentId: null,
   ```

3. Add action in the store creator (after `setSettingsInitialFocus`):
   ```typescript
   setCreateChildParentId: (id: string | null) => {
     set({ createChildParentId: id });
   },
   ```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/stores/navigationStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/navigationStore.ts src/stores/navigationStore.test.ts
git commit -m "feat: add createChildParentId to navigationStore"
```

---

### Task 2: Add `create-child` command

**Files:**
- Modify: `src/commands.ts`
- Test: `src/commands.test.ts`

**Step 1: Write the failing tests**

Add to the `getVisibleCommands` describe block in `src/commands.test.ts`:

```typescript
it('shows create-child when item is selected and parent capability exists', () => {
  const ctx = makeContext({ hasSelectedItem: true });
  const commands = getVisibleCommands(ctx);
  const ids = commands.map((c) => c.id);
  expect(ids).toContain('create-child');
});

it('hides create-child when no item is selected', () => {
  const ctx = makeContext({ hasSelectedItem: false });
  const commands = getVisibleCommands(ctx);
  const ids = commands.map((c) => c.id);
  expect(ids).not.toContain('create-child');
});

it('hides create-child when parent capability is missing', () => {
  const ctx = makeContext({
    capabilities: {
      ...ALL_CAPS,
      fields: { ...ALL_CAPS.fields, parent: false },
    },
  });
  const commands = getVisibleCommands(ctx);
  const ids = commands.map((c) => c.id);
  expect(ids).not.toContain('create-child');
});
```

Add to the `matchesCommand` describe block:

```typescript
it('matches create-child on uppercase C', () => {
  expect(matchesCommand('create-child', 'C', noKey)).toBe(true);
  expect(matchesCommand('create-child', 'c', noKey)).toBe(false);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — `create-child` command doesn't exist yet.

**Step 3: Implement**

Add the command to `src/commands.ts`, right after the `create` command (line ~64):

```typescript
{
  id: 'create-child',
  label: 'Create child item',
  category: 'Actions',
  shortcut: 'C',
  keys: ['C'],
  screen: ['list', 'form'],
  helpGroup: 'Actions',
  when: (ctx) =>
    (ctx.screen === 'list' || ctx.screen === 'form') &&
    ctx.hasSelectedItem &&
    ctx.capabilities.fields.parent,
},
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/commands.ts src/commands.test.ts
git commit -m "feat: add create-child command definition"
```

---

### Task 3: Handle `create-child` in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add the command handler**

In `src/components/WorkItemList.tsx`, find the `handleCommandSelect` function. Add a new case after `case 'create':` (around line 1270):

```typescript
case 'create-child':
  if (treeItems[cursor]) {
    navigationStore
      .getState()
      .setCreateChildParentId(treeItems[cursor].item.id);
    selectWorkItem(null);
    navigate('form');
  }
  break;
```

Also need to import `navigationStore` if not already imported. Check existing imports — `navigationStore` is likely already used via `useNavigationStore`. Need the direct store import for `setCreateChildParentId`. Check line ~30 area for existing imports from navigationStore.

**Step 2: Verify build**

Run: `npm run build`
Expected: PASS — no type errors.

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: handle create-child command in WorkItemList"
```

---

### Task 4: Prefill parent in WorkItemForm on create

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Read `createChildParentId` and prefill parent**

In `src/components/WorkItemForm.tsx`, find the `useEffect` that initializes the form draft (around line 326). Modify it to check `createChildParentId`:

After the draft is pushed (line 351), add logic to prefill parent. The cleanest approach is to add a new `useEffect` right after the init effect (after line 352), before the template prefill effect:

```typescript
// Prefill parent for create-child (create mode only)
useEffect(() => {
  if (selectedWorkItemId !== null) return;
  const { createChildParentId, setCreateChildParentId } =
    navigationStore.getState();
  if (!createChildParentId) return;

  const parentItem = allItems.find((i) => i.id === createChildParentId);
  const parentDisplay = parentItem
    ? `#${createChildParentId} - ${parentItem.title}`
    : `#${createChildParentId}`;
  updateFields({ parentId: parentDisplay });

  // Update initialSnapshot so parent doesn't count as dirty
  formStackStore.setState((state) => {
    if (state.stack.length === 0) return state;
    const updated = [...state.stack];
    const current = updated[updated.length - 1]!;
    updated[updated.length - 1] = {
      ...current,
      initialSnapshot: { ...current.fields, parentId: parentDisplay },
    };
    return { stack: updated };
  });

  // Clear after use
  setCreateChildParentId(null);
}, [selectedWorkItemId, allItems]);
```

**Step 2: Add `C` keybinding in form view**

Find the `useInput` handler in WorkItemForm (around line 796, the `if (!editing)` block). After the `form-save` handler and before the `form-navigate` handler, add:

```typescript
// C: create child of current item
if (_input === 'C' && selectedWorkItemId !== null) {
  navigationStore
    .getState()
    .setCreateChildParentId(selectedWorkItemId);
  // Clear form stack and navigate to fresh create form
  formStackStore.getState().clear();
  selectWorkItem(null);
  navigate('form');
  return;
}
```

Note: `selectWorkItem` and `navigate` should already be available from the store hooks at the top of the component.

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: prefill parent on create-child and add C keybinding in form"
```

---

### Task 5: Verify all tests pass, format, lint

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 2: Format and lint**

Run: `npm run format && npm run lint`
Expected: PASS

**Step 3: Fix any issues, then commit**

```bash
git add -A
git commit -m "chore: format and lint fixes"
```

(Only if there were changes from formatting.)
