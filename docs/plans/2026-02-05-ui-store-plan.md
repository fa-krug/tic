# UIStore Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Centralize all overlay/modal state into a single Zustand store, replacing 15+ useState hooks across WorkItemList and Settings with a discriminated union.

**Architecture:** A new `uiStore` with a single `activeOverlay` field (discriminated union) and a `warning` string. Components read overlay state via `useUIStore(selector)` and open/close overlays via `uiStore.getState().openOverlay(...)` / `closeOverlay()`. Screen navigation calls `reset()` to clean up stale overlays.

**Tech Stack:** Zustand (vanilla + React hook), TypeScript discriminated unions

**Design doc:** `docs/plans/2026-02-05-ui-store-design.md`

---

### Task 1: Create UIStore with types and tests

**Files:**
- Create: `src/stores/uiStore.ts`
- Create: `src/stores/uiStore.test.ts`

**Step 1: Write the store file**

Create `src/stores/uiStore.ts` with the discriminated union type and store:

```typescript
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export type ActiveOverlay =
  // WorkItemList overlays
  | { type: 'search' }
  | { type: 'command-palette' }
  | { type: 'bulk-menu' }
  | { type: 'delete-confirm'; targetIds: string[] }
  | { type: 'template-picker' }
  | { type: 'status-picker'; targetIds: string[] }
  | { type: 'type-picker'; targetIds: string[] }
  | { type: 'priority-picker'; targetIds: string[] }
  | { type: 'parent-input'; targetIds: string[] }
  | { type: 'assignee-input'; targetIds: string[] }
  | { type: 'labels-input'; targetIds: string[] }
  // Settings overlays
  | { type: 'default-type-picker' }
  | { type: 'default-iteration-picker' }
  | { type: 'delete-template-confirm'; templateSlug: string }
  | { type: 'settings-edit' };

export interface UIStoreState {
  activeOverlay: ActiveOverlay | null;
  warning: string;

  openOverlay: (overlay: ActiveOverlay) => void;
  closeOverlay: () => void;
  setWarning: (msg: string) => void;
  clearWarning: () => void;
  reset: () => void;
}

export const uiStore = createStore<UIStoreState>((set) => ({
  activeOverlay: null,
  warning: '',

  openOverlay: (overlay) => set({ activeOverlay: overlay }),
  closeOverlay: () => set({ activeOverlay: null }),
  setWarning: (msg) => set({ warning: msg }),
  clearWarning: () => set({ warning: '' }),
  reset: () => set({ activeOverlay: null, warning: '' }),
}));

export function useUIStore<T>(selector: (state: UIStoreState) => T): T {
  return useStore(uiStore, selector);
}
```

**Step 2: Write the tests**

Create `src/stores/uiStore.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { uiStore } from './uiStore.js';

describe('uiStore', () => {
  beforeEach(() => {
    uiStore.getState().reset();
  });

  it('starts with no active overlay', () => {
    expect(uiStore.getState().activeOverlay).toBeNull();
    expect(uiStore.getState().warning).toBe('');
  });

  it('opens an overlay', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    expect(uiStore.getState().activeOverlay).toEqual({ type: 'search' });
  });

  it('opens an overlay with targetIds', () => {
    uiStore.getState().openOverlay({ type: 'priority-picker', targetIds: ['1', '2'] });
    const overlay = uiStore.getState().activeOverlay;
    expect(overlay).toEqual({ type: 'priority-picker', targetIds: ['1', '2'] });
  });

  it('replaces active overlay when opening another', () => {
    uiStore.getState().openOverlay({ type: 'bulk-menu' });
    uiStore.getState().openOverlay({ type: 'status-picker', targetIds: ['1'] });
    expect(uiStore.getState().activeOverlay).toEqual({ type: 'status-picker', targetIds: ['1'] });
  });

  it('closes overlay', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    uiStore.getState().closeOverlay();
    expect(uiStore.getState().activeOverlay).toBeNull();
  });

  it('sets warning', () => {
    uiStore.getState().setWarning('Something happened');
    expect(uiStore.getState().warning).toBe('Something happened');
  });

  it('clears warning', () => {
    uiStore.getState().setWarning('Something happened');
    uiStore.getState().clearWarning();
    expect(uiStore.getState().warning).toBe('');
  });

  it('reset clears everything', () => {
    uiStore.getState().openOverlay({ type: 'search' });
    uiStore.getState().setWarning('test');
    uiStore.getState().reset();
    expect(uiStore.getState().activeOverlay).toBeNull();
    expect(uiStore.getState().warning).toBe('');
  });

  it('opens settings overlay with templateSlug', () => {
    uiStore.getState().openOverlay({ type: 'delete-template-confirm', templateSlug: 'bug-report' });
    const overlay = uiStore.getState().activeOverlay;
    expect(overlay).toEqual({ type: 'delete-template-confirm', templateSlug: 'bug-report' });
  });
});
```

**Step 3: Run tests to verify they pass**

Run: `npx vitest run src/stores/uiStore.test.ts`
Expected: All 9 tests PASS

**Step 4: Run full test suite to verify nothing broke**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit**

```bash
git add src/stores/uiStore.ts src/stores/uiStore.test.ts
git commit -m "feat: add Zustand UI store for overlay state management"
```

---

### Task 2: Wire up navigation cleanup in AppContext

**Files:**
- Modify: `src/app.tsx:1-16` (add import)
- Modify: `src/app.tsx:99-104` (add reset call in `navigateWithStackClear`)

**Step 1: Add import and reset call**

In `src/app.tsx`, add the import:

```typescript
import { uiStore } from './stores/uiStore.js';
```

Then modify `navigateWithStackClear` (currently at line 99) to call `uiStore.getState().reset()`:

```typescript
const navigateWithStackClear = (newScreen: Screen) => {
  uiStore.getState().reset();
  if (newScreen !== 'form') {
    setNavigationStack([]);
  }
  setScreen(newScreen);
};
```

**Step 2: Run tests**

Run: `npm test`
Expected: All tests pass (no behavioral change yet — store is reset but nothing reads from it)

**Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "feat: reset UI store on screen navigation"
```

---

### Task 3: Migrate WorkItemList overlays to uiStore

This is the largest task. It replaces 15 useState hooks with uiStore reads/writes.

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add uiStore imports, remove overlay useState hooks**

Add imports at top of `WorkItemList.tsx`:

```typescript
import { uiStore, useUIStore } from '../stores/uiStore.js';
```

Remove these useState hooks (lines 64-84):
- `confirmDelete` (line 64)
- `warning` (line 65)
- `settingParent` (line 66)
- `isSearching` (line 68)
- `deleteTargetIds` (line 72)
- `parentTargetIds` (line 73)
- `showBulkMenu` (line 74)
- `showStatusPicker` (line 75)
- `showTypePicker` (line 76)
- `showPriorityPicker` (line 77)
- `settingAssignee` (line 78)
- `settingLabels` (line 80)
- `bulkTargetIds` (line 82)
- `showCommandPalette` (line 83)
- `showTemplatePicker` (line 84)

Keep these useState hooks (they are NOT overlay state):
- `cursor` (line 63)
- `parentInput` (line 67) — transient input value
- `allSearchItems` (line 69)
- `markedIds` (line 71)
- `assigneeInput` (line 79)
- `labelsInput` (line 81)
- `templates` (line 85)
- `expandedIds` (line 157)

**Step 2: Add uiStore selectors at top of component**

Replace the removed hooks with:

```typescript
const activeOverlay = useUIStore((s) => s.activeOverlay);
const warning = useUIStore((s) => s.warning);
const { openOverlay, closeOverlay, setWarning, clearWarning } = uiStore.getState();
```

**Step 3: Replace the guard chain in useInput (lines 213-269)**

The current chain of 8 `if (X) return;` guards becomes a single `isActive` check. But some overlays handle Escape within the guard chain (settingParent, settingAssignee, settingLabels, confirmDelete). Those Escape handlers need to move to their own `useInput` block.

Replace the current `useInput` with two blocks:

Block 1 — Overlay escape handlers (new):
```typescript
useInput(
  (_input, key) => {
    if (key.escape) {
      closeOverlay();
    }
  },
  {
    isActive:
      activeOverlay?.type === 'parent-input' ||
      activeOverlay?.type === 'assignee-input' ||
      activeOverlay?.type === 'labels-input',
  },
);
```

Block 2 — Delete confirmation handler (replaces inline guard at lines 245-268):
```typescript
useInput(
  (input) => {
    if (activeOverlay?.type !== 'delete-confirm') return;
    if (input === 'y' || input === 'Y') {
      const targetIds = activeOverlay.targetIds;
      void (async () => {
        for (const id of targetIds) {
          await backend.cachedDeleteWorkItem(id);
          await queueWrite('delete', id);
        }
        closeOverlay();
        setMarkedIds((prev) => {
          const next = new Set(prev);
          for (const id of targetIds) {
            next.delete(id);
          }
          return next;
        });
        setCursor((c) => Math.max(0, c - 1));
        refreshData();
      })();
    } else {
      closeOverlay();
    }
  },
  { isActive: activeOverlay?.type === 'delete-confirm' },
);
```

Block 3 — Main useInput (the existing one, simplified):
Add `isActive: activeOverlay === null` to disable when any overlay is open. Remove all the guard `if` blocks from lines 214-243. The body starts at the `/` handler (line 271).

**Step 4: Update all overlay open calls in the main useInput body**

Replace each `set*` call pair with a single `openOverlay(...)`:

| Old code | New code |
|---|---|
| `setIsSearching(true)` | `openOverlay({ type: 'search' })` |
| `setShowCommandPalette(true)` | `openOverlay({ type: 'command-palette' })` |
| `setShowTemplatePicker(true)` | `openOverlay({ type: 'template-picker' })` |
| `setDeleteTargetIds(ids); setConfirmDelete(true)` | `openOverlay({ type: 'delete-confirm', targetIds: ids })` |
| `setBulkTargetIds(ids); setShowPriorityPicker(true)` | `openOverlay({ type: 'priority-picker', targetIds: ids })` |
| `setBulkTargetIds(ids); setShowTypePicker(true)` | `openOverlay({ type: 'type-picker', targetIds: ids })` |
| `setShowBulkMenu(true)` | `openOverlay({ type: 'bulk-menu' })` |
| `setParentTargetIds(ids); setSettingParent(true)` | `openOverlay({ type: 'parent-input', targetIds: ids })` |
| `setBulkTargetIds(ids); setSettingAssignee(true)` | `openOverlay({ type: 'assignee-input', targetIds: ids })` |
| `setBulkTargetIds(ids); setSettingLabels(true)` | `openOverlay({ type: 'labels-input', targetIds: ids })` |
| `setWarning(msg)` | `setWarning(msg)` (same name, now from store) |
| `setWarning('')` | `clearWarning()` |

**Step 5: Update handleSearchSelect and handleSearchCancel (lines 489-497)**

```typescript
const handleSearchSelect = (item: WorkItem) => {
  closeOverlay();
  selectWorkItem(item.id);
  navigate('form');
};

const handleSearchCancel = () => {
  closeOverlay();
};
```

**Step 6: Update handleCommandSelect (lines 523-661)**

Change `setShowCommandPalette(false)` at line 524 to `closeOverlay()`.

For commands that open overlays, replace the setState pairs with `openOverlay(...)`:

- `case 'delete'`: replace `setDeleteTargetIds(ids); setConfirmDelete(true)` with `openOverlay({ type: 'delete-confirm', targetIds: ids })`
- `case 'set-priority'`: replace `setBulkTargetIds(ids); setShowPriorityPicker(true)` with `openOverlay({ type: 'priority-picker', targetIds: ids })`
- `case 'set-assignee'`: replace `setBulkTargetIds(ids); setSettingAssignee(true); setAssigneeInput('')` with `openOverlay({ type: 'assignee-input', targetIds: ids }); setAssigneeInput('')`
- `case 'set-labels'`: replace `setBulkTargetIds(ids); setSettingLabels(true); setLabelsInput('')` with `openOverlay({ type: 'labels-input', targetIds: ids }); setLabelsInput('')`
- `case 'set-type'`: replace `setBulkTargetIds(ids); setShowTypePicker(true)` with `openOverlay({ type: 'type-picker', targetIds: ids })`
- `case 'bulk-menu'`: replace `setShowBulkMenu(true)` with `openOverlay({ type: 'bulk-menu' })`

**Step 7: Update handleBulkAction (lines 664-700)**

Replace each action's setState calls with `openOverlay(...)`. The `setBulkTargetIds(targetIds)` at line 667 is no longer needed — targetIds are embedded in the overlay.

```typescript
const handleBulkAction = (action: BulkAction) => {
  const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
  if (targetIds.length === 0) return;

  switch (action) {
    case 'status':
      openOverlay({ type: 'status-picker', targetIds });
      break;
    case 'iteration':
      navigate('iteration-picker');
      break;
    case 'parent':
      openOverlay({ type: 'parent-input', targetIds });
      setParentInput('');
      break;
    case 'type':
      openOverlay({ type: 'type-picker', targetIds });
      break;
    case 'priority':
      openOverlay({ type: 'priority-picker', targetIds });
      break;
    case 'assignee':
      openOverlay({ type: 'assignee-input', targetIds });
      setAssigneeInput('');
      break;
    case 'labels':
      openOverlay({ type: 'labels-input', targetIds });
      setLabelsInput('');
      break;
    case 'delete':
      openOverlay({ type: 'delete-confirm', targetIds });
      break;
  }
};
```

**Step 8: Update the JSX rendering (lines 711-998)**

Replace boolean checks with `activeOverlay?.type` checks:

- `{isSearching && (` → `{activeOverlay?.type === 'search' && (`
- `{!isSearching && (` → `{activeOverlay?.type !== 'search' && (`
- `{showBulkMenu && (` → `{activeOverlay?.type === 'bulk-menu' && (`
- `{showCommandPalette && (` → `{activeOverlay?.type === 'command-palette' && (`
- `{showStatusPicker && (` → `{activeOverlay?.type === 'status-picker' && (`
- `{showTypePicker && (` → `{activeOverlay?.type === 'type-picker' && (`
- `{showPriorityPicker && (` → `{activeOverlay?.type === 'priority-picker' && (`
- `{showTemplatePicker && (` → `{activeOverlay?.type === 'template-picker' && (`
- `{capabilities.fields.parent && settingParent ? (` → `{activeOverlay?.type === 'parent-input' ? (`
- `} : settingAssignee ? (` → `} : activeOverlay?.type === 'assignee-input' ? (`
- `} : settingLabels ? (` → `} : activeOverlay?.type === 'labels-input' ? (`
- `} : confirmDelete ? (` → `} : activeOverlay?.type === 'delete-confirm' ? (`

For overlay callbacks that close + clear state:

Bulk menu `onCancel`:
```typescript
onCancel={() => closeOverlay()}
```

Status picker `onSelect` — replace `setShowStatusPicker(false)` with `closeOverlay()`, replace `for (const id of bulkTargetIds)` with `for (const id of activeOverlay.targetIds)` (requires narrowing — extract targetIds before the async):
```typescript
onSelect={(status) => {
  const targetIds = (activeOverlay as { targetIds: string[] }).targetIds;
  closeOverlay();
  void (async () => {
    for (const id of targetIds) {
      await backend.cachedUpdateWorkItem(id, { status });
      await queueWrite('update', id);
    }
    refreshData();
  })();
}}
```

Apply the same pattern for TypePicker, PriorityPicker `onSelect` and `onCancel` — extract `targetIds` from `activeOverlay` before `closeOverlay()`, then use extracted value in async block.

For `onCancel` handlers on pickers, simplify to just `closeOverlay()` (no need to clear `bulkTargetIds` separately).

For the parent input `onSubmit`, replace `parentTargetIds` with `(activeOverlay as { targetIds: string[] }).targetIds`. Replace `setSettingParent(false); setParentInput(''); setParentTargetIds([])` with `closeOverlay(); setParentInput('')`.

For the assignee input `onSubmit`, same pattern: extract targetIds from overlay, replace close calls with `closeOverlay(); setAssigneeInput('')`.

For labels input `onSubmit`, same pattern: extract targetIds, replace close calls with `closeOverlay(); setLabelsInput('')`.

For the parent input section rendering (line 875-914), replace `settingParent` guard:
- `{capabilities.fields.parent && settingParent ? (` becomes `{activeOverlay?.type === 'parent-input' ? (`
- `parentTargetIds.length` becomes `activeOverlay.targetIds.length` (safe due to type narrowing)

For delete confirmation text (line 972-975):
- `deleteTargetIds.length` becomes `(activeOverlay as { targetIds: string[] }).targetIds.length`

For the update info display guard (lines 986-989):
- Replace `!confirmDelete && !settingParent && !settingAssignee && !settingLabels` with `activeOverlay === null`

**Step 9: Update the search effect (lines 194-203)**

Replace `isSearching` with overlay check:
```typescript
useEffect(() => {
  if (activeOverlay?.type !== 'search') return;
  let cancelled = false;
  void backend.listWorkItems().then((items) => {
    if (!cancelled) setAllSearchItems(items);
  });
  return () => {
    cancelled = true;
  };
}, [activeOverlay?.type, backend]);
```

**Step 10: Update parent input opening (lines 399-417)**

Replace:
```typescript
if (input === 'p' && capabilities.fields.parent && treeItems.length > 0 && !settingParent) {
```
With:
```typescript
if (input === 'p' && capabilities.fields.parent && treeItems.length > 0) {
```
(The `!settingParent` guard is no longer needed since the main useInput is `isActive: activeOverlay === null`.)

Replace the body:
```typescript
const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
if (targetIds.length > 0) {
  openOverlay({ type: 'parent-input', targetIds });
  if (targetIds.length === 1) {
    const item = treeItems.find((t) => t.item.id === targetIds[0]);
    setParentInput(item?.item.parent ?? '');
  } else {
    setParentInput('');
  }
}
```

**Step 11: Run format and tests**

Run: `npm run format`
Run: `npm test`
Expected: All tests pass

**Step 12: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor: migrate WorkItemList overlay state to uiStore"
```

---

### Task 4: Migrate Settings overlays to uiStore

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Add uiStore imports, remove overlay useState hooks**

Add imports:
```typescript
import { uiStore, useUIStore } from '../stores/uiStore.js';
```

Remove these useState hooks (lines 62-69):
- `confirmDeleteTemplate` (line 62)
- `templateToDelete` (line 63)
- `showDefaultTypePicker` (line 67)
- `showDefaultIterationPicker` (line 68-69)

Keep these (not overlay state):
- `cursor`, `editing`, `jiraSite`, `jiraProject`, `jiraBoardId` (lines 55-59)
- `templates` (line 61)
- `updateInfo`, `updateChecking` (lines 65-66)
- `availability` (lines 71-79)

Note: `editing` stays as local state since Jira field editing is a text-input mode, not an overlay with the same semantics. However, per the design doc it's mapped to `{ type: 'settings-edit' }`. **Migrate `editing` too**:
- Remove `const [editing, setEditing] = useState(false);` (line 56)

Add selectors:
```typescript
const activeOverlay = useUIStore((s) => s.activeOverlay);
const { openOverlay, closeOverlay } = uiStore.getState();
```

**Step 2: Update the delete confirmation guard (lines 192-216)**

Replace `if (confirmDeleteTemplate)` with `if (activeOverlay?.type === 'delete-template-confirm')`.

Replace `templateToDelete` references with `activeOverlay.templateSlug`.

Replace `setConfirmDeleteTemplate(false); setTemplateToDelete(null)` with `closeOverlay()`.

```typescript
if (activeOverlay?.type === 'delete-template-confirm') {
  if (input === 'y' || input === 'Y') {
    const slug = activeOverlay.templateSlug;
    void backend.deleteTemplate(slug).then(async () => {
      setTemplates((prev) => prev.filter((t) => t.slug !== slug));
      if (queueStore) {
        await queueStore.append({
          action: 'template-delete',
          itemId: slug,
          timestamp: new Date().toISOString(),
          templateSlug: slug,
        });
        syncManager?.pushPending().catch(() => {});
      }
    });
  }
  closeOverlay();
  return;
}
```

**Step 3: Update Enter handlers (lines 270-280)**

Replace:
- `setEditing(true)` → `openOverlay({ type: 'settings-edit' })`
- `setShowDefaultTypePicker(true)` → `openOverlay({ type: 'default-type-picker' })`
- `setShowDefaultIterationPicker(true)` → `openOverlay({ type: 'default-iteration-picker' })`

**Step 4: Update delete template handler (lines 314-320)**

Replace:
```typescript
setTemplateToDelete(item.slug);
setConfirmDeleteTemplate(true);
```
With:
```typescript
openOverlay({ type: 'delete-template-confirm', templateSlug: item.slug });
```

**Step 5: Update `isActive` on navigation useInput (line 322-326)**

Replace:
```typescript
{ isActive: !editing && !showDefaultTypePicker && !showDefaultIterationPicker }
```
With:
```typescript
{ isActive: activeOverlay === null }
```

**Step 6: Update edit mode useInput (lines 328-337)**

Replace `{ isActive: editing }` with `{ isActive: activeOverlay?.type === 'settings-edit' }`.

Replace `setEditing(false)` with `closeOverlay()`:
```typescript
useInput(
  (_input, key) => {
    if (key.escape) {
      closeOverlay();
      saveJiraConfig();
    }
  },
  { isActive: activeOverlay?.type === 'settings-edit' },
);
```

**Step 7: Update inline edit rendering**

In the navItems map for Jira fields (around line 416), replace:
```typescript
const isEditing = focused && editing;
```
With:
```typescript
const isEditing = focused && activeOverlay?.type === 'settings-edit';
```

Also update the TextInput `onSubmit` to use `closeOverlay()` instead of `setEditing(false)`:
```typescript
onSubmit={() => {
  closeOverlay();
  saveJiraConfig();
}}
```

**Step 8: Update picker overlays in JSX (lines 564-588)**

Replace `{showDefaultTypePicker && (` with `{activeOverlay?.type === 'default-type-picker' && (`.

Update `onSelect`:
```typescript
onSelect={(type) => {
  void configStore.getState().update({ defaultType: type });
  closeOverlay();
}}
onCancel={() => closeOverlay()}
```

Replace `{showDefaultIterationPicker && (` with `{activeOverlay?.type === 'default-iteration-picker' && (`.

Same pattern for `onSelect` and `onCancel`.

**Step 9: Update delete confirmation rendering (lines 590-599)**

Replace `{confirmDeleteTemplate && (` with `{activeOverlay?.type === 'delete-template-confirm' && (`.

Replace `templateToDelete` reference:
```typescript
{activeOverlay?.type === 'delete-template-confirm' && (
  <Box marginTop={1}>
    <Text color="red">
      Delete template &quot;
      {templates.find((t) => t.slug === activeOverlay.templateSlug)?.name ??
        activeOverlay.templateSlug}
      &quot;? (y/n)
    </Text>
  </Box>
)}
```

**Step 10: Run format and tests**

Run: `npm run format`
Run: `npm test`
Expected: All tests pass

**Step 11: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "refactor: migrate Settings overlay state to uiStore"
```

---

### Task 5: Verify build, lint, and full test suite

**Files:** None (verification only)

**Step 1: Run format check**

Run: `npm run format:check`
Expected: No formatting issues

**Step 2: Run lint**

Run: `npm run lint`
Expected: No lint errors

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass (551+ tests)

**Step 5: Commit any format/lint fixes if needed**

If format or lint produced fixes:
```bash
npm run format
git add -A
git commit -m "style: format after uiStore migration"
```

---

### Summary

| Task | What | Removes | Adds |
|------|------|---------|------|
| 1 | Create uiStore + tests | — | 1 store file, 1 test file |
| 2 | Navigation cleanup | — | 2 lines in app.tsx |
| 3 | Migrate WorkItemList | 15 useState hooks, 8-line guard chain | uiStore reads/writes |
| 4 | Migrate Settings | 4 useState hooks, isActive boolean chain | uiStore reads/writes |
| 5 | Verify build | — | — |

**Net effect:** ~19 useState hooks removed, replaced by 1 discriminated union field in a shared store.
