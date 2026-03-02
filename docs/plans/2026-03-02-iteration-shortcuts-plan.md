# Iteration Shortcuts (`j`/`J`) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add `j` key to set iteration on individual work items via inline overlay, and `J` to switch global iteration via inline overlay, replacing the full-screen `i` picker.

**Architecture:** Two new overlay types in `uiStore`, two new commands in `commands.ts`, overlay rendering + keybinding handlers in `WorkItemList.tsx`. Remove full-screen `IterationPicker` component and `i` keybinding. Follows the exact same pattern as the existing `s` (status), `a` (assignee), `l` (labels), `t` (type) inline pickers.

**Tech Stack:** TypeScript, React/Ink, Zustand stores

---

### Task 1: Add overlay types to uiStore

**Files:**
- Modify: `src/stores/uiStore.ts:4-40`

**Step 1: Add two new overlay type variants**

In the `ActiveOverlay` type union (line 4-40 of `src/stores/uiStore.ts`), add after the `labels-input` line:

```typescript
  | { type: 'iteration-picker'; targetIds: string[] }
  | { type: 'iteration-switch' }
```

The first is for `j` (set iteration on items, needs `targetIds`). The second is for `J` (switch global iteration, no targets).

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS (new union members don't break anything until used)

**Step 3: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "feat: add iteration-picker and iteration-switch overlay types"
```

---

### Task 2: Add commands and remove old `i` keybinding

**Files:**
- Modify: `src/commands.ts:129-138`

**Step 1: Replace the `iterations` command with two new commands**

Find the existing `iterations` command at lines 129-138:

```typescript
{
  id: 'iterations',
  label: 'Go to iterations',
  category: 'Navigation',
  shortcut: 'i',
  keys: ['i'],
  screen: 'list',
  helpGroup: 'Switching',
  when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
},
```

Replace it with:

```typescript
{
  id: 'set-iteration',
  label: 'Set iteration',
  category: 'Actions',
  shortcut: 'j',
  keys: ['j'],
  screen: 'list',
  helpGroup: 'Actions',
  when: (ctx) =>
    ctx.screen === 'list' &&
    ctx.capabilities.iterations &&
    (ctx.hasSelectedItem || ctx.markedCount > 0),
},
{
  id: 'switch-iteration',
  label: 'Switch iteration',
  category: 'Navigation',
  shortcut: 'J',
  keys: ['J'],
  screen: 'list',
  helpGroup: 'Switching',
  when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
},
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: FAIL — `WorkItemList.tsx` still references `matchesCommand('iterations', ...)`. That's fine, we fix it in the next task.

**Step 3: Commit**

```bash
git add src/commands.ts
git commit -m "feat: add set-iteration (j) and switch-iteration (J) commands, remove iterations (i)"
```

---

### Task 3: Update WorkItemList keybinding handlers

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Replace the iterations keybinding handler**

Find the existing handler at line 705-706:

```typescript
if (matchesCommand('iterations', input, key) && capabilities.iterations)
  navigate('iteration-picker');
```

Replace it with:

```typescript
if (
  matchesCommand('set-iteration', input, key) &&
  capabilities.iterations &&
  treeItems.length > 0
) {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length > 0) {
    openOverlay({ type: 'iteration-picker', targetIds });
  }
}

if (
  matchesCommand('switch-iteration', input, key) &&
  capabilities.iterations
) {
  openOverlay({ type: 'iteration-switch' });
}
```

**Step 2: Update the bulk menu handler**

Find the bulk action `case 'iteration'` in `handleBulkAction` (around line 1378):

```typescript
case 'iteration':
  navigate('iteration-picker');
  break;
```

Replace with:

```typescript
case 'iteration':
  openOverlay({ type: 'iteration-picker', targetIds });
  break;
```

**Step 3: Update bulk menu hint**

Find the bulk menu iteration entry (around line 1520-1527):

```typescript
if (capabilities.iterations) {
  bulkItems.push({
    id: 'iteration',
    label: 'Set iteration',
    value: 'iteration',
    hint: 'i',
  });
}
```

Change `hint: 'i'` to `hint: 'j'`.

**Step 4: Update command palette handler**

Find the command palette `case 'iterations'` (around line 1280-1282):

```typescript
case 'iterations':
  navigate('iteration-picker');
  break;
```

Replace with:

```typescript
case 'set-iteration':
  if (treeItems.length > 0) {
    const targetIds = getTargetIds(
      markedIds,
      treeItems[cursor]?.item,
    );
    if (targetIds.length > 0) {
      openOverlay({ type: 'iteration-picker', targetIds });
    }
  }
  break;
case 'switch-iteration':
  openOverlay({ type: 'iteration-switch' });
  break;
```

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS (or close — overlay rendering JSX not added yet but types should compile)

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: wire j/J keybindings to iteration overlay handlers"
```

---

### Task 4: Add OverlayPanel rendering for iteration overlays

**Files:**
- Modify: `src/components/WorkItemList.tsx` (JSX return block)

**Step 1: Add the `iteration-picker` overlay branch**

In the JSX ternary chain (around lines 1587-1700 where other pickers are rendered), add after the last picker overlay (look for the pattern of `activeOverlay?.type === '...-picker'` branches). Add a new branch for `iteration-picker`:

```tsx
) : activeOverlay?.type === 'iteration-picker' ? (
  <OverlayPanel
    title="Set Iteration"
    items={iterations.map((it) => ({ id: it, label: it, value: it }))}
    onSelect={(item) => {
      const targetIds = getOverlayTargetIds();
      closeOverlay();
      if (!backend) return;
      void (async () => {
        pushUpdateUndo(targetIds, 'iteration change');
        for (const id of targetIds) {
          await backend.cachedUpdateWorkItem(id, {
            iteration: item.value,
          });
          await queueWrite('update', id);
        }
        for (const id of targetIds) {
          await backendDataStore.getState().reloadItem(id);
        }
        setToast(
          targetIds.length === 1
            ? 'Iteration updated — press u to undo'
            : `${targetIds.length} items updated — press u to undo`,
        );
      })().catch((err: unknown) => {
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Update failed',
          );
      });
    }}
    onCancel={() => closeOverlay()}
  />
```

**Step 2: Add the `iteration-switch` overlay branch**

Add another branch right after:

```tsx
) : activeOverlay?.type === 'iteration-switch' ? (
  <OverlayPanel
    title="Switch Iteration"
    items={iterations.map((it) => ({
      id: it,
      label: it === currentIteration ? `${it} (current)` : it,
      value: it,
    }))}
    onSelect={(item) => {
      closeOverlay();
      if (!backend) return;
      void (async () => {
        await backend.setCurrentIteration(item.value);
        await backendDataStore.getState().refresh();
        setToast(`Switched to iteration: ${item.value}`);
      })().catch((err: unknown) => {
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Switch failed',
          );
      });
    }}
    onCancel={() => closeOverlay()}
  />
```

**Step 3: Ensure `iterations` and `currentIteration` are available in the component**

Check that `WorkItemList` already subscribes to these from `backendDataStore`. Look for existing `useBackendDataStore` calls near the top. The component likely already has `iterations` available (it's used in the bulk menu). If `currentIteration` is not already destructured, add it:

```typescript
const currentIteration = useBackendDataStore((s) => s.currentIteration);
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: add iteration-picker and iteration-switch overlay panels"
```

---

### Task 5: Remove full-screen IterationPicker

**Files:**
- Modify: `src/app.tsx`
- Delete: `src/components/IterationPicker.tsx`

**Step 1: Remove the IterationPicker from app.tsx**

In `src/app.tsx`, remove the lazy import (around line 21-25):

```typescript
const IterationPicker = lazy(() =>
  import('./components/IterationPicker.js').then((m) => ({
    default: m.IterationPicker,
  })),
);
```

Remove the screen rendering line (around line 91):

```typescript
{screen === 'iteration-picker' && <IterationPicker />}
```

**Step 2: Remove the `iteration-picker` from the Screen type**

Search for where `Screen` type is defined (likely in `src/stores/navigationStore.ts`). Remove `'iteration-picker'` from the union. This may cause compile errors in any remaining references — fix them.

**Step 3: Delete `src/components/IterationPicker.tsx`**

```bash
rm src/components/IterationPicker.tsx
```

**Step 4: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS — if there are errors, they'll point to remaining references to `'iteration-picker'` screen or `'iterations'` command ID that need updating.

**Step 5: Run tests**

Run: `npm test`
Expected: PASS — fix any test failures related to the removed screen/command.

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove full-screen IterationPicker, replaced by j/J overlays"
```

---

### Task 6: Verify everything works end-to-end

**Step 1: Run full validation**

```bash
npm run format:check && npm run lint && npx tsc --noEmit && npm test
```

Expected: All pass.

**Step 2: Manual smoke test**

Run `npm start` and verify:
- `j` opens iteration picker overlay on current item
- Selecting an iteration updates the item's iteration field
- `J` opens iteration switch overlay
- Selecting an iteration switches the global current iteration
- `?` help screen shows both `j` and `J` shortcuts
- Bulk select (`m`) + `j` updates multiple items
- Bulk menu (`x`) → "Set iteration" opens the overlay
- `Esc` cancels both overlays

**Step 3: Commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address issues found in iteration shortcuts smoke test"
```
