# Help Screen Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a context-aware help screen accessible via `?` from every TUI view, with trimmed hint bars showing only 3 key shortcuts plus `? help`.

**Architecture:** New `HelpScreen` component receives `sourceScreen` prop to render the right shortcuts. `App` tracks `previousScreen` state so help can return without clearing navigation stack. Each existing screen gets a `?` handler (guarded by edit mode where applicable) and a simplified hint bar.

**Tech Stack:** React 19, Ink 6, TypeScript 5.9

---

### Task 1: Add `help` screen type and routing to App

**Files:**
- Modify: `src/app.tsx`

**Step 1: Update the Screen type and add state**

In `src/app.tsx`, change line 12 from:
```typescript
type Screen = 'list' | 'form' | 'iteration-picker' | 'settings' | 'status';
```
to:
```typescript
type Screen = 'list' | 'form' | 'iteration-picker' | 'settings' | 'status' | 'help';
```

Add a `previousScreen` state after line 41:
```typescript
const [previousScreen, setPreviousScreen] = useState<Screen>('list');
```

**Step 2: Add `navigateToHelp` and `navigateBackFromHelp` to AppState**

Update the `AppState` interface to add:
```typescript
navigateToHelp: () => void;
navigateBackFromHelp: () => void;
```

Implement them after `navigateWithStackClear`:
```typescript
const navigateToHelp = () => {
  setPreviousScreen(screen);
  setScreen('help');
};

const navigateBackFromHelp = () => {
  setScreen(previousScreen);
};
```

Add both to the `state` object.

**Step 3: Add HelpScreen placeholder to render**

Add after the status screen render line:
```tsx
{screen === 'help' && (
  <Box><Text>Help screen placeholder</Text></Box>
)}
```

**Step 4: Verify build**

Run: `npm run build`
Expected: No errors

**Step 5: Commit**

```bash
git add src/app.tsx
git commit -m "feat: add help screen type and routing to App"
```

---

### Task 2: Create HelpScreen component

**Files:**
- Create: `src/components/HelpScreen.tsx`

**Step 1: Write the test**

Create `src/components/HelpScreen.test.tsx`:
```typescript
import { describe, it, expect } from 'vitest';
import { getShortcuts } from './HelpScreen.js';
import type { BackendCapabilities } from '../backends/types.js';

const fullCapabilities: BackendCapabilities = {
  relationships: true,
  customTypes: true,
  customStatuses: true,
  iterations: true,
  comments: true,
  fields: {
    priority: true,
    assignee: true,
    labels: true,
    parent: true,
    dependsOn: true,
  },
};

const minimalCapabilities: BackendCapabilities = {
  relationships: false,
  customTypes: false,
  customStatuses: false,
  iterations: false,
  comments: false,
  fields: {
    priority: false,
    assignee: false,
    labels: false,
    parent: false,
    dependsOn: false,
  },
};

describe('getShortcuts', () => {
  it('returns list shortcuts with all capabilities', () => {
    const groups = getShortcuts('list', fullCapabilities, true, true);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('p');
    expect(allKeys).toContain('tab');
    expect(allKeys).toContain('i');
    expect(allKeys).toContain('r');
    expect(allKeys).toContain('b');
  });

  it('omits capability-dependent shortcuts when not supported', () => {
    const groups = getShortcuts('list', minimalCapabilities, false, false);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).not.toContain('p');
    expect(allKeys).not.toContain('tab');
    expect(allKeys).not.toContain('i');
    expect(allKeys).not.toContain('r');
    expect(allKeys).not.toContain('b');
    // Core shortcuts always present
    expect(allKeys).toContain('enter');
    expect(allKeys).toContain('c');
    expect(allKeys).toContain('q');
  });

  it('returns form shortcuts', () => {
    const groups = getShortcuts('form', fullCapabilities, false, false);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('↑/↓');
    expect(allKeys).toContain('enter');
    expect(allKeys).toContain('esc');
  });

  it('returns iteration-picker shortcuts', () => {
    const groups = getShortcuts('iteration-picker', fullCapabilities, false, false);
    expect(groups.length).toBeGreaterThan(0);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('↑/↓');
    expect(allKeys).toContain('enter');
  });

  it('returns settings shortcuts', () => {
    const groups = getShortcuts('settings', fullCapabilities, false, false);
    expect(groups.length).toBeGreaterThan(0);
  });

  it('returns status shortcuts', () => {
    const groups = getShortcuts('status', fullCapabilities, false, false);
    expect(groups.length).toBeGreaterThan(0);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('esc/q');
  });

  it('returns empty for help screen itself', () => {
    const groups = getShortcuts('help', fullCapabilities, false, false);
    expect(groups).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: FAIL — module not found

**Step 3: Create HelpScreen component**

Create `src/components/HelpScreen.tsx`:
```tsx
import { Box, Text, useInput } from 'ink';
import { useAppState } from '../app.js';
import type { BackendCapabilities } from '../backends/types.js';
import type { SyncManager } from '../sync/SyncManager.js';

type Screen = 'list' | 'form' | 'iteration-picker' | 'settings' | 'status' | 'help';

interface ShortcutEntry {
  key: string;
  description: string;
}

interface ShortcutGroup {
  label: string;
  shortcuts: ShortcutEntry[];
}

const SCREEN_LABELS: Record<string, string> = {
  list: 'List View',
  form: 'Form View',
  'iteration-picker': 'Iteration Picker',
  settings: 'Settings',
  status: 'Status',
};

export function getShortcuts(
  screen: Screen,
  capabilities: BackendCapabilities,
  gitAvailable: boolean,
  hasSyncManager: boolean,
): ShortcutGroup[] {
  switch (screen) {
    case 'list': {
      const nav: ShortcutEntry[] = [
        { key: '↑/↓', description: 'Navigate items' },
      ];
      if (capabilities.relationships) {
        nav.push({ key: '←', description: 'Collapse or jump to parent' });
        nav.push({ key: '→', description: 'Expand children' });
      }

      const actions: ShortcutEntry[] = [
        { key: 'enter', description: 'Edit item' },
        { key: 'c', description: 'Create new item' },
        { key: 'd', description: 'Delete item' },
        { key: 'o', description: 'Open in browser' },
        { key: 's', description: 'Status screen' },
      ];
      if (capabilities.fields.parent) {
        actions.push({ key: 'p', description: 'Set parent' });
      }

      const switching: ShortcutEntry[] = [];
      if (capabilities.customTypes) {
        switching.push({ key: 'tab', description: 'Cycle work item type' });
      }
      if (capabilities.iterations) {
        switching.push({ key: 'i', description: 'Iteration picker' });
      }
      switching.push({ key: ',', description: 'Settings' });

      const other: ShortcutEntry[] = [];
      if (hasSyncManager) {
        other.push({ key: 'r', description: 'Sync' });
      }
      if (gitAvailable) {
        other.push({ key: 'b', description: 'Branch / worktree' });
      }
      other.push({ key: 'q', description: 'Quit' });

      const groups: ShortcutGroup[] = [
        { label: 'Navigation', shortcuts: nav },
        { label: 'Actions', shortcuts: actions },
      ];
      if (switching.length > 0) {
        groups.push({ label: 'Switching', shortcuts: switching });
      }
      groups.push({ label: 'Other', shortcuts: other });
      return groups;
    }

    case 'form': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '↑/↓', description: 'Move between fields' },
          ],
        },
        {
          label: 'Editing',
          shortcuts: [
            { key: 'enter', description: 'Edit field / open related item' },
            { key: 'esc', description: 'Confirm edit (text) or cancel (select)' },
          ],
        },
        {
          label: 'Save',
          shortcuts: [
            { key: 'esc', description: 'Save and go back (in navigation mode)' },
          ],
        },
      ];
    }

    case 'iteration-picker': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '↑/↓', description: 'Navigate iterations' },
            { key: 'enter', description: 'Select iteration' },
          ],
        },
      ];
    }

    case 'settings': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '↑/↓', description: 'Navigate options' },
            { key: 'enter', description: 'Select or edit' },
            { key: 'esc/,', description: 'Go back' },
          ],
        },
        {
          label: 'Editing',
          shortcuts: [
            { key: 'type', description: 'Edit field value' },
            { key: 'enter/esc', description: 'Confirm' },
          ],
        },
      ];
    }

    case 'status': {
      return [
        {
          label: 'Navigation',
          shortcuts: [
            { key: '↑/↓', description: 'Scroll errors' },
            { key: 'esc/q', description: 'Go back' },
          ],
        },
      ];
    }

    default:
      return [];
  }
}

export function HelpScreen({ sourceScreen }: { sourceScreen: Screen }) {
  const { backend, syncManager, navigateBackFromHelp } = useAppState();
  const capabilities = backend.getCapabilities();

  // Approximate git availability — same check as WorkItemList
  let gitAvailable = false;
  try {
    const { isGitRepo } = await import('../git.js');
    gitAvailable = isGitRepo(process.cwd());
  } catch {
    gitAvailable = false;
  }

  const groups = getShortcuts(
    sourceScreen,
    capabilities,
    gitAvailable,
    syncManager !== null,
  );

  useInput((_input, key) => {
    if (key.escape) {
      navigateBackFromHelp();
    }
  });

  const title = SCREEN_LABELS[sourceScreen] ?? 'Help';

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold color="cyan">
          Keyboard Shortcuts — {title}
        </Text>
      </Box>

      {groups.map((group) => (
        <Box key={group.label} flexDirection="column" marginBottom={1}>
          <Text bold>{group.label}:</Text>
          {group.shortcuts.map((shortcut) => (
            <Box key={shortcut.key} marginLeft={2}>
              <Box width={12}>
                <Text color="cyan">{shortcut.key}</Text>
              </Box>
              <Text>{shortcut.description}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>esc: back</Text>
      </Box>
    </Box>
  );
}
```

**Important note:** The `await import('../git.js')` pattern above won't work in a synchronous component. Instead, pass `gitAvailable` and `hasSyncManager` as props, or compute them in the component using `useMemo`. Here is the corrected approach — use `useMemo` with the synchronous `isGitRepo`:

Replace the git check block with:
```tsx
import { useMemo } from 'react';
import { isGitRepo } from '../git.js';

// Inside HelpScreen:
const gitAvailable = useMemo(() => isGitRepo(process.cwd()), []);
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: PASS

**Step 5: Verify build**

Run: `npm run build`
Expected: No errors

**Step 6: Commit**

```bash
git add src/components/HelpScreen.tsx src/components/HelpScreen.test.tsx
git commit -m "feat: add HelpScreen component with capability-aware shortcuts"
```

---

### Task 3: Wire HelpScreen into App rendering

**Files:**
- Modify: `src/app.tsx`

**Step 1: Import HelpScreen and wire rendering**

Add import at top of `src/app.tsx`:
```typescript
import { HelpScreen } from './components/HelpScreen.js';
```

Replace the placeholder added in Task 1 with:
```tsx
{screen === 'help' && <HelpScreen sourceScreen={previousScreen} />}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "feat: wire HelpScreen into App rendering"
```

---

### Task 4: Add `?` handler and trim hints in WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add `?` handler**

In the `useInput` callback in `WorkItemList.tsx`, add after the `settingParent` and `confirmDelete` guards (after line 157, before the arrow key handlers), add:
```typescript
if (input === '?') {
  navigateToHelp();
  return;
}
```

Also update the destructured `useAppState()` call at the top to include `navigateToHelp`:
```typescript
const {
  backend,
  syncManager,
  navigate,
  navigateToHelp,
  selectWorkItem,
  activeType,
  setActiveType,
} = useAppState();
```

**Step 2: Trim the help bar**

Replace lines 276-292 (the `helpParts` and `compactHelpParts` blocks) with:
```typescript
const helpText = '↑↓ navigate  enter edit  c create  ? help';
```

Replace lines 394-398 (the help bar rendering) — change:
```tsx
<Text dimColor>
  {terminalWidth >= 80 ? helpText : compactHelpText}
</Text>
```
to:
```tsx
<Text dimColor>{helpText}</Text>
```

Remove the now-unused `compactHelpText` variable and the `compactHelpParts` block entirely.

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: add ? help handler and trim hint bar in WorkItemList"
```

---

### Task 5: Add `?` handler and trim hints in WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add `?` handler**

Update the destructured `useAppState()` to include `navigateToHelp`.

In the `useInput` callback (line 284), inside the `if (!editing)` block (line 287), add before the arrow key handlers:
```typescript
if (_input === '?') {
  navigateToHelp();
  return;
}
```

This is inside `!editing`, so `?` only triggers help when not editing a field.

**Step 2: Trim the help bar**

Replace lines 771-783 (the entire help bar rendering) with:
```tsx
<Box marginTop={1}>
  <Text dimColor>↑↓ navigate  enter edit field  esc save & back  ? help</Text>
</Box>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: add ? help handler and trim hint bar in WorkItemForm"
```

---

### Task 6: Add `?` handler and trim hints in IterationPicker

**Files:**
- Modify: `src/components/IterationPicker.tsx`

**Step 1: Add `useInput` import and `?` handler**

IterationPicker currently does NOT use `useInput` — it relies on `SelectInput`. Add:
```typescript
import { Box, Text, useInput } from 'ink';
```

Add `navigateToHelp` to the destructured `useAppState()`:
```typescript
const { backend, navigate, navigateToHelp } = useAppState();
```

Add a `useInput` hook inside the component (after the `useBackendData` call):
```typescript
useInput((input) => {
  if (input === '?') {
    navigateToHelp();
  }
});
```

**Step 2: Trim the help bar**

Replace line 43:
```tsx
<Text dimColor>up/down: navigate enter: select</Text>
```
with:
```tsx
<Text dimColor>↑↓ navigate  enter select  esc back  ? help</Text>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "feat: add ? help handler and trim hint bar in IterationPicker"
```

---

### Task 7: Add `?` handler and trim hints in Settings

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Add `?` handler**

Update destructured `useAppState()` to include `navigateToHelp`:
```typescript
const { navigate, navigateToHelp } = useAppState();
```

In the navigation-mode `useInput` callback (line 97, the one with `{ isActive: !editing }`), add after the `if (!config) return;` guard:
```typescript
if (input === '?') {
  navigateToHelp();
  return;
}
```

**Step 2: Trim the help bar**

Replace lines 260-268 (the help bar) with:
```tsx
<Box marginTop={1}>
  <Text dimColor>↑↓ navigate  enter select  esc back  ? help</Text>
</Box>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "feat: add ? help handler and trim hint bar in Settings"
```

---

### Task 8: Add `?` handler and trim hints in StatusScreen

**Files:**
- Modify: `src/components/StatusScreen.tsx`

**Step 1: Add `?` handler**

Update destructured `useAppState()` to include `navigateToHelp`:
```typescript
const { backend, syncManager, navigate, navigateToHelp } = useAppState();
```

In the `useInput` callback (line 55), add after the escape/q check:
```typescript
if (input === '?') {
  navigateToHelp();
  return;
}
```

**Step 2: Trim the help bar**

Replace line 182:
```tsx
<Text dimColor>esc: back</Text>
```
with:
```tsx
<Text dimColor>↑↓ scroll  esc back  ? help</Text>
```

**Step 3: Verify build**

Run: `npm run build`
Expected: No errors

**Step 4: Commit**

```bash
git add src/components/StatusScreen.tsx
git commit -m "feat: add ? help handler and trim hint bar in StatusScreen"
```

---

### Task 9: Final verification

**Step 1: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 3: Manual smoke test**

Run: `npm start`
- Verify trimmed hint bars on each screen
- Press `?` on list screen → help shows list shortcuts
- Press `esc` → returns to list with state preserved
- Navigate to form → press `?` → help shows form shortcuts
- Press `esc` → returns to form with field state preserved
- Check settings, status, iteration picker all work the same

**Step 4: Run format fix if needed**

Run: `npm run format`

**Step 5: Final commit if any formatting changes**

```bash
git add -A
git commit -m "style: format help screen changes"
```
