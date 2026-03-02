# Fix: TUI closes when saving a child item after drill-down navigation — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix the bug where saving a child item after drill-down navigation freezes/exits the TUI instead of returning to the parent form.

**Architecture:** Add `.finally(() => setSaving(false))` to the async save IIFE in WorkItemForm's `form-save` handler. The `saving` state is currently only reset in `.catch()`, leaving the form permanently frozen on the success path when returning to a parent form.

**Tech Stack:** TypeScript, React (Ink), Zustand

---

### Task 1: Write the failing test

**Files:**
- Create: `src/components/WorkItemForm.test.tsx`

**Step 1: Write a test that verifies saving resets the `saving` guard**

The bug is in the async save handler's state management. Since WorkItemForm is an Ink component that's hard to unit test in isolation, write an integration-style test that exercises the save handler logic. However, this component has heavy dependencies (backend, stores, Ink rendering). A more pragmatic approach: write a focused test for the specific state transition.

Since the fix is a one-line `.finally()` addition and the component is deeply integrated with Ink rendering, skip the component test and instead verify the fix manually + rely on existing tests passing.

**Step 2: Run existing tests to establish baseline**

Run: `cd /Users/skrug/PycharmProjects/tic/.worktrees/44-fix-tui-closes-when-saving-a-child-item-after-drill-down-navigation && npm test`
Expected: All tests pass

### Task 2: Apply the fix

**Files:**
- Modify: `src/components/WorkItemForm.tsx:812-828`

**Step 1: Add `.finally()` to reset saving state**

In `src/components/WorkItemForm.tsx`, find the save handler (around line 812):

```typescript
// BEFORE:
          setSaving(true);
          void (async () => {
            await save();
            formStackStore.getState().pop();
            if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })().catch((err: unknown) => {
            setSaving(false);
            uiStore
              .getState()
              .setToast(err instanceof Error ? err.message : 'Save failed');
          });
```

```typescript
// AFTER:
          setSaving(true);
          void (async () => {
            await save();
            formStackStore.getState().pop();
            if (formMode === 'template') {
              setFormMode('item');
              setEditingTemplateSlug(null);
              navigate('settings');
            } else {
              const prev = popWorkItem();
              if (prev === null) navigate('list');
            }
          })()
            .catch((err: unknown) => {
              uiStore
                .getState()
                .setToast(err instanceof Error ? err.message : 'Save failed');
            })
            .finally(() => {
              setSaving(false);
            });
```

Note: `setSaving(false)` moves from `.catch()` to `.finally()` so it runs on both success and error paths.

**Step 2: Run tests to verify nothing breaks**

Run: `cd /Users/skrug/PycharmProjects/tic/.worktrees/44-fix-tui-closes-when-saving-a-child-item-after-drill-down-navigation && npm test`
Expected: All tests pass

**Step 3: Run build, lint, and format checks**

Run: `cd /Users/skrug/PycharmProjects/tic/.worktrees/44-fix-tui-closes-when-saving-a-child-item-after-drill-down-navigation && npm run build && npm run lint && npm run format:check`
Expected: All pass

### Task 3: Commit

**Step 1: Commit the fix**

```bash
cd /Users/skrug/PycharmProjects/tic/.worktrees/44-fix-tui-closes-when-saving-a-child-item-after-drill-down-navigation
git add src/components/WorkItemForm.tsx
git commit -m "fix: reset saving state after drill-down child save

setSaving(true) was never reset on the success path in the form-save
handler. When saving a child item reached via drill-down, popWorkItem()
returned non-null (the parent ID), so navigate('list') was skipped.
But saving stayed true, permanently disabling the useInput hook and
freezing the form.

Move setSaving(false) from .catch() to .finally() so it always resets.

Closes #44"
```

### Task 4: Manual verification

**Step 1: Test the fix in the TUI**

Run: `cd /Users/skrug/PycharmProjects/tic/.worktrees/44-fix-tui-closes-when-saving-a-child-item-after-drill-down-navigation && npm start`

1. Open a parent item that has a child (Enter on an item with children)
2. Navigate to a child via the relationship link (arrow to `rel-child-*` field, Enter)
3. Make a small edit to the child (e.g. change priority)
4. Press `S` to save
5. Verify: you return to the parent form with working keyboard input
6. Press Escape to go back to the list
