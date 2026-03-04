# Iteration Picker Page Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the `iteration-switch` inline overlay with a full-screen IterationPicker page for switching the current iteration filter.

**Architecture:** Add `'iteration-picker'` as a new screen route. Create an `IterationPicker` component that lists iterations with dates/status using Ink's `SelectInput`. The `I` keybinding navigates to this screen instead of opening an overlay. Remove the `iteration-switch` overlay type.

**Tech Stack:** TypeScript, React 19, Ink 6, Zustand

---

### Task 1: Add `'iteration-picker'` to Screen type

**Files:**
- Modify: `src/stores/navigationStore.ts:8-16`

**Step 1: Add the screen type**

In `src/stores/navigationStore.ts`, add `'iteration-picker'` to the `Screen` union type:

```typescript
export type Screen =
  | 'list'
  | 'form'
  | 'editor'
  | 'iteration-picker'
  | 'pr-list'
  | 'branch-list'
  | 'settings'
  | 'status'
  | 'help';
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add src/stores/navigationStore.ts
git commit -m "feat: add iteration-picker to Screen type"
```

---

### Task 2: Create the IterationPicker component

**Files:**
- Create: `src/components/IterationPicker.tsx`

**Step 1: Write the component**

Create `src/components/IterationPicker.tsx`:

```tsx
import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useBackendDataStore } from '../stores/backendDataStore.js';
import { navigationStore } from '../stores/navigationStore.js';
import { uiStore } from '../stores/uiStore.js';
import { backendDataStore } from '../stores/backendDataStore.js';
import {
  formatIterationDates,
  getIterationStatus,
} from '../iteration-utils.js';

interface IterationItem {
  label: string;
  value: string;
}

export function IterationPicker() {
  const iterations = useBackendDataStore((s) => s.iterations);
  const currentIteration = useBackendDataStore((s) => s.currentIteration);
  const backend = useBackendDataStore((s) => s.backend);

  useInput((_input, key) => {
    if (key.escape) {
      navigationStore.getState().navigate('list');
    }
  });

  const items: IterationItem[] = iterations.map((it) => {
    const dates = formatIterationDates(it.startDate, it.endDate);
    const status = getIterationStatus(it.startDate, it.endDate);
    let label = it.name;
    if (it.name === currentIteration) label += ' (current)';
    if (dates) label += `  ${dates}`;
    if (status === 'past') label += '  [past]';
    if (status === 'upcoming') label += '  [upcoming]';
    return { label, value: it.name };
  });

  const handleSelect = (item: IterationItem) => {
    if (!backend) return;
    void (async () => {
      await backend.setCurrentIteration(item.value);
      await backendDataStore.getState().refresh();
      uiStore.getState().setToast(`Switched to iteration: ${item.value}`);
      navigationStore.getState().navigate('list');
    })().catch((err: unknown) => {
      uiStore
        .getState()
        .setToast(err instanceof Error ? err.message : 'Switch failed');
      navigationStore.getState().navigate('list');
    });
  };

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold>Switch Iteration</Text>
        <Text dimColor>  (esc to go back)</Text>
      </Box>
      {items.length === 0 ? (
        <Text dimColor>No iterations configured.</Text>
      ) : (
        <SelectInput items={items} onSelect={handleSelect} />
      )}
    </Box>
  );
}
```

Note: Check exact import paths — `backendDataStore` is the vanilla store instance, `useBackendDataStore` is the hook. Both are exported from `src/stores/backendDataStore.ts`.

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "feat: create IterationPicker full-screen component"
```

---

### Task 3: Wire IterationPicker into app.tsx

**Files:**
- Modify: `src/app.tsx:39-43` (add lazy import after BranchList)
- Modify: `src/app.tsx:87-88` (add screen case in JSX)

**Step 1: Add lazy import**

After the `BranchList` lazy import (line 43), add:

```typescript
const IterationPicker = lazy(() =>
  import('./components/IterationPicker.js').then((m) => ({
    default: m.IterationPicker,
  })),
);
```

**Step 2: Add screen rendering**

Inside the `<Suspense>` block, after `{screen === 'branch-list' && <BranchList />}` (line 87), add:

```tsx
{screen === 'iteration-picker' && <IterationPicker />}
```

**Step 3: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Commit**

```bash
git add src/app.tsx
git commit -m "feat: wire IterationPicker into app screen router"
```

---

### Task 4: Change WorkItemList to navigate instead of overlay

**Files:**
- Modify: `src/components/WorkItemList.tsx:720-723` (keybinding handler)
- Modify: `src/components/WorkItemList.tsx:1306-1308` (command palette handler)
- Modify: `src/components/WorkItemList.tsx:2204-2230` (remove overlay JSX)

**Step 1: Update keybinding handler**

At line 720-723, change the `switch-iteration` handler from:

```typescript
      if (
        matchesCommand('switch-iteration', input, key) &&
        capabilities.iterations
      ) {
        openOverlay({ type: 'iteration-switch' });
      }
```

to:

```typescript
      if (
        matchesCommand('switch-iteration', input, key) &&
        capabilities.iterations
      ) {
        navigate('iteration-picker');
      }
```

**Step 2: Update command palette handler**

At line 1306-1308, change:

```typescript
      case 'switch-iteration':
        openOverlay({ type: 'iteration-switch' });
        break;
```

to:

```typescript
      case 'switch-iteration':
        navigate('iteration-picker');
        break;
```

**Step 3: Remove the iteration-switch overlay JSX**

Remove lines 2204-2230 (the entire `activeOverlay?.type === 'iteration-switch'` branch). Make sure the ternary chain connects the previous branch (ending at line 2203) directly to the `delete-confirm` branch (starting at what was line 2231).

The line before (2203) ends with:
```
          />
```

The line after (2231) starts with:
```
        ) : activeOverlay?.type === 'delete-confirm' ? (
```

So the edit is: remove everything from `) : activeOverlay?.type === 'iteration-switch' ? (` through its closing `/>` and the following `) :`.

**Step 4: Remove the `formatIterationDates` import if unused**

After removing the overlay JSX, check if `formatIterationDates` is still used in WorkItemList. It IS still used at line 1464 (in the iteration-picker overlay for setting iteration on items), so keep the import.

**Step 5: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: switch iteration via page navigation instead of overlay"
```

---

### Task 5: Remove `iteration-switch` from ActiveOverlay type

**Files:**
- Modify: `src/stores/uiStore.ts:42-43`

**Step 1: Remove the type**

Remove lines 42-43:

```typescript
  // Iteration switch overlay
  | { type: 'iteration-switch' };
```

The union should now end with the `branch-merge-confirm` entry (line 41). Make sure the semicolon stays at the end of the type.

**Step 2: Verify build and tests**

Run: `npx tsc --noEmit`
Expected: PASS

Run: `npm test`
Expected: All tests pass

**Step 3: Run lint and format**

Run: `npm run lint && npm run format`

**Step 4: Commit**

```bash
git add src/stores/uiStore.ts
git commit -m "refactor: remove iteration-switch overlay type"
```

---

### Task 6: Add iteration-picker commands for help screen

**Files:**
- Modify: `src/commands.ts:142-151`

**Step 1: Update the switch-iteration command screen**

The `switch-iteration` command at line 142-151 currently has `screen: 'list'`. This is still correct because the keybinding is handled in WorkItemList. The command navigates away to the iteration-picker screen. No change needed to the command definition itself.

However, add Escape/back command for the iteration-picker screen so the help screen shows it:

After the `nav-back` command (lines 462-473), update its `screen` array to include `'iteration-picker'`:

```typescript
  {
    id: 'nav-back',
    label: 'Back to list',
    category: 'Navigation',
    shortcut: 'esc',
    keys: [{ special: 'escape' }],
    screen: ['pr-list', 'branch-list', 'iteration-picker'],
    helpGroup: 'Navigation',
    footer: true,
    footerLabel: 'back',
    when: (ctx) =>
      ctx.screen === 'pr-list' ||
      ctx.screen === 'branch-list' ||
      ctx.screen === 'iteration-picker',
  },
```

**Step 2: Verify build**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 3: Commit**

```bash
git add src/commands.ts
git commit -m "feat: add iteration-picker to nav-back command for help screen"
```

---

### Task 7: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 3: Build**

Run: `npm run build`
Expected: PASS

**Step 4: Manual smoke test**

Run: `npm start`
- Press `I` from the work item list — should navigate to full-screen IterationPicker page
- Select an iteration — should switch and return to list with toast
- Press `Escape` — should return to list
- Press `i` on an item — should still open the inline overlay for setting iteration
- Press `?` — help screen should show iteration-picker navigation commands
