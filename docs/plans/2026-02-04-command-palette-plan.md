# Command Palette Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a vim-style `:` command palette to the list screen that provides fuzzy-searchable, context-aware access to all actions with shortcut hints.

**Architecture:** A command registry (`src/commands.ts`) defines all available commands with `when` visibility conditions. A `CommandPalette` component (`src/components/CommandPalette.tsx`) renders the overlay with fuzzy filtering. The palette is triggered by `:` in `WorkItemList` and delegates actions to existing handlers.

**Tech Stack:** React 19, Ink 6, TypeScript, Vitest. Reuses existing `fuzzyMatch` utility and `useScrollViewport` hook.

**Design doc:** `docs/plans/2026-02-04-command-palette-design.md`

---

### Task 1: Command Registry — Types and Exports

**Files:**
- Create: `src/commands.ts`
- Test: `src/commands.test.ts`

**Step 1: Write the failing test**

Create `src/commands.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  type Command,
  type CommandContext,
  getVisibleCommands,
  CATEGORIES,
} from './commands.js';
import type { BackendCapabilities } from './backends/types.js';

const ALL_CAPS: BackendCapabilities = {
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

function makeContext(overrides: Partial<CommandContext> = {}): CommandContext {
  return {
    screen: 'list',
    markedCount: 0,
    hasSelectedItem: true,
    capabilities: ALL_CAPS,
    types: ['epic', 'issue', 'task'],
    activeType: 'issue',
    hasSyncManager: true,
    gitAvailable: true,
    ...overrides,
  };
}

describe('CATEGORIES', () => {
  it('exports category order', () => {
    expect(CATEGORIES).toEqual([
      'Actions',
      'Navigation',
      'Bulk',
      'Switching',
      'Other',
    ]);
  });
});

describe('getVisibleCommands', () => {
  it('returns commands for list screen with item selected', () => {
    const ctx = makeContext();
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain('Create item');
    expect(labels).toContain('Edit item');
    expect(labels).toContain('Delete item');
    expect(labels).toContain('Quit');
  });

  it('hides edit/delete when no item is selected', () => {
    const ctx = makeContext({ hasSelectedItem: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Edit item');
    expect(labels).not.toContain('Delete item');
    expect(labels).toContain('Create item');
  });

  it('hides priority when backend lacks capability', () => {
    const ctx = makeContext({
      capabilities: {
        ...ALL_CAPS,
        fields: { ...ALL_CAPS.fields, priority: false },
      },
    });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Set priority');
  });

  it('hides iteration picker when backend lacks iterations', () => {
    const ctx = makeContext({
      capabilities: { ...ALL_CAPS, iterations: false },
    });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Go to iterations');
  });

  it('hides bulk actions menu when no items are marked', () => {
    const ctx = makeContext({ markedCount: 0 });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Bulk actions menu');
  });

  it('shows bulk actions menu when items are marked', () => {
    const ctx = makeContext({ markedCount: 3 });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain('Bulk actions menu');
  });

  it('hides clear marks when no items are marked', () => {
    const ctx = makeContext({ markedCount: 0 });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Clear all marks');
  });

  it('shows switch commands for each available type', () => {
    const ctx = makeContext({ types: ['epic', 'issue', 'task'], activeType: 'issue' });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain('Switch to epics');
    expect(labels).toContain('Switch to tasks');
    expect(labels).not.toContain('Switch to issues');
  });

  it('hides sync when no sync manager', () => {
    const ctx = makeContext({ hasSyncManager: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Refresh/sync');
  });

  it('hides branch/worktree when git not available', () => {
    const ctx = makeContext({ gitAvailable: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Create branch/worktree');
  });

  it('every command has an id, label, and category', () => {
    const ctx = makeContext();
    const commands = getVisibleCommands(ctx);
    for (const cmd of commands) {
      expect(cmd.id).toBeTruthy();
      expect(cmd.label).toBeTruthy();
      expect(CATEGORIES).toContain(cmd.category);
    }
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — cannot resolve `./commands.js`

**Step 3: Write minimal implementation**

Create `src/commands.ts`:

```ts
import type { BackendCapabilities } from './backends/types.js';
import type { Screen } from './app.js';

export const CATEGORIES = [
  'Actions',
  'Navigation',
  'Bulk',
  'Switching',
  'Other',
] as const;

export type CommandCategory = (typeof CATEGORIES)[number];

export interface CommandContext {
  screen: Screen;
  markedCount: number;
  hasSelectedItem: boolean;
  capabilities: BackendCapabilities;
  types: string[];
  activeType: string | null;
  hasSyncManager: boolean;
  gitAvailable: boolean;
}

export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  when: (ctx: CommandContext) => boolean;
}

const commands: Command[] = [
  // Actions
  {
    id: 'create',
    label: 'Create item',
    category: 'Actions',
    shortcut: 'c',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'edit',
    label: 'Edit item',
    category: 'Actions',
    shortcut: 'enter',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'delete',
    label: 'Delete item',
    category: 'Actions',
    shortcut: 'd',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'open',
    label: 'Open in browser',
    category: 'Actions',
    shortcut: 'o',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'branch',
    label: 'Create branch/worktree',
    category: 'Actions',
    shortcut: 'B',
    when: (ctx) =>
      ctx.screen === 'list' && ctx.hasSelectedItem && ctx.gitAvailable,
  },
  {
    id: 'sync',
    label: 'Refresh/sync',
    category: 'Actions',
    shortcut: 'r',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSyncManager,
  },
  // Navigation
  {
    id: 'iterations',
    label: 'Go to iterations',
    category: 'Navigation',
    shortcut: 'i',
    when: (ctx) => ctx.screen === 'list' && ctx.capabilities.iterations,
  },
  {
    id: 'settings',
    label: 'Go to settings',
    category: 'Navigation',
    shortcut: ',',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'status',
    label: 'Go to status',
    category: 'Navigation',
    shortcut: 's',
    when: (ctx) => ctx.screen === 'list',
  },
  {
    id: 'help',
    label: 'Go to help',
    category: 'Navigation',
    shortcut: '?',
    when: (ctx) => ctx.screen === 'list',
  },
  // Bulk
  {
    id: 'mark',
    label: 'Mark/unmark item',
    category: 'Bulk',
    shortcut: 'm',
    when: (ctx) => ctx.screen === 'list' && ctx.hasSelectedItem,
  },
  {
    id: 'clear-marks',
    label: 'Clear all marks',
    category: 'Bulk',
    shortcut: 'M',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  {
    id: 'set-priority',
    label: 'Set priority',
    category: 'Bulk',
    shortcut: 'P',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.priority &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-assignee',
    label: 'Set assignee',
    category: 'Bulk',
    shortcut: 'a',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.assignee &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-labels',
    label: 'Set labels',
    category: 'Bulk',
    shortcut: 'l',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.fields.labels &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'set-type',
    label: 'Set type',
    category: 'Bulk',
    shortcut: 't',
    when: (ctx) =>
      ctx.screen === 'list' &&
      ctx.capabilities.customTypes &&
      (ctx.hasSelectedItem || ctx.markedCount > 0),
  },
  {
    id: 'bulk-menu',
    label: 'Bulk actions menu',
    category: 'Bulk',
    shortcut: 'b',
    when: (ctx) => ctx.screen === 'list' && ctx.markedCount > 0,
  },
  // Other
  {
    id: 'quit',
    label: 'Quit',
    category: 'Other',
    shortcut: 'q',
    when: () => true,
  },
];

export function getVisibleCommands(ctx: CommandContext): Command[] {
  const visible = commands.filter((cmd) => cmd.when(ctx));

  // Add dynamic switch-type commands
  if (ctx.screen === 'list' && ctx.capabilities.customTypes) {
    for (const type of ctx.types) {
      if (type === ctx.activeType) continue;
      const plural = type + 's';
      visible.push({
        id: `switch-${type}`,
        label: `Switch to ${plural}`,
        category: 'Switching',
        shortcut: 'tab',
        when: () => true,
      });
    }
  }

  return visible;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS — all tests green

**Step 5: Commit**

```bash
git add src/commands.ts src/commands.test.ts
git commit -m "feat: add command registry with visibility conditions"
```

---

### Task 2: Command Palette Fuzzy Filter Logic

**Files:**
- Create: `src/components/CommandPalette.tsx`
- Test: `src/components/CommandPalette.test.ts`

**Step 1: Write the failing test**

Create `src/components/CommandPalette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { filterCommands, groupByCategory } from './CommandPalette.js';
import type { Command } from '../commands.js';

function makeCmd(overrides: Partial<Command> & { id: string }): Command {
  return {
    label: overrides.id,
    category: 'Actions',
    when: () => true,
    ...overrides,
  };
}

describe('filterCommands', () => {
  const cmds: Command[] = [
    makeCmd({ id: 'create', label: 'Create item', shortcut: 'c' }),
    makeCmd({ id: 'delete', label: 'Delete item', shortcut: 'd' }),
    makeCmd({
      id: 'settings',
      label: 'Go to settings',
      category: 'Navigation',
      shortcut: ',',
    }),
    makeCmd({ id: 'quit', label: 'Quit', category: 'Other', shortcut: 'q' }),
  ];

  it('returns all commands when query is empty', () => {
    const result = filterCommands(cmds, '');
    expect(result).toHaveLength(4);
  });

  it('filters by fuzzy match on label', () => {
    const result = filterCommands(cmds, 'cre');
    const labels = result.map((c) => c.label);
    expect(labels).toContain('Create item');
    expect(labels).not.toContain('Quit');
  });

  it('returns empty array when nothing matches', () => {
    const result = filterCommands(cmds, 'zzzzz');
    expect(result).toHaveLength(0);
  });

  it('is case insensitive', () => {
    const result = filterCommands(cmds, 'DELETE');
    expect(result.map((c) => c.label)).toContain('Delete item');
  });
});

describe('groupByCategory', () => {
  it('groups commands by category in order', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', category: 'Other' }),
      makeCmd({ id: 'b', label: 'B', category: 'Actions' }),
      makeCmd({ id: 'c', label: 'C', category: 'Actions' }),
      makeCmd({ id: 'd', label: 'D', category: 'Navigation' }),
    ];
    const groups = groupByCategory(cmds);
    expect(groups[0]!.category).toBe('Actions');
    expect(groups[0]!.commands).toHaveLength(2);
    expect(groups[1]!.category).toBe('Navigation');
    expect(groups[1]!.commands).toHaveLength(1);
    expect(groups[2]!.category).toBe('Other');
    expect(groups[2]!.commands).toHaveLength(1);
  });

  it('omits empty categories', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', category: 'Other' }),
    ];
    const groups = groupByCategory(cmds);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('Other');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/CommandPalette.test.ts`
Expected: FAIL — cannot resolve `./CommandPalette.js`

**Step 3: Write minimal implementation**

Create `src/components/CommandPalette.tsx` with the exported filter/group functions:

```tsx
import { useState } from 'react';
import { Box, Text, useInput } from 'ink';
import TextInput from 'ink-text-input';
import { type Command, CATEGORIES } from '../commands.js';

export interface CommandGroup {
  category: string;
  commands: Command[];
}

export function filterCommands(commands: Command[], query: string): Command[] {
  if (query.trim() === '') return commands;
  const q = query.toLowerCase();
  return commands.filter((cmd) => cmd.label.toLowerCase().includes(q));
}

export function groupByCategory(commands: Command[]): CommandGroup[] {
  const groups: CommandGroup[] = [];
  for (const category of CATEGORIES) {
    const cmds = commands.filter((c) => c.category === category);
    if (cmds.length > 0) {
      groups.push({ category, commands: cmds });
    }
  }
  return groups;
}

export interface CommandPaletteProps {
  commands: Command[];
  onSelect: (command: Command) => void;
  onCancel: () => void;
}

export function CommandPalette({
  commands,
  onSelect,
  onCancel,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);

  const filtered = filterCommands(commands, query);
  const groups = groupByCategory(filtered);

  // Build flat list of selectable items (skipping category headers)
  const selectableItems: Command[] = groups.flatMap((g) => g.commands);

  useInput((_input, key) => {
    if (key.escape) {
      onCancel();
      return;
    }
    if (key.upArrow) {
      setSelectedIndex((i) => Math.max(0, i - 1));
    }
    if (key.downArrow) {
      setSelectedIndex((i) => Math.min(selectableItems.length - 1, i + 1));
    }
    if (key.return && selectableItems.length > 0) {
      const selected = selectableItems[selectedIndex];
      if (selected) {
        onSelect(selected);
      }
    }
  });

  const handleQueryChange = (value: string) => {
    setQuery(value);
    setSelectedIndex(0);
  };

  // Track which selectable index we're at while rendering
  let selectableIdx = 0;

  return (
    <Box
      flexDirection="column"
      borderStyle="round"
      borderColor="cyan"
      paddingX={1}
    >
      <Box marginBottom={1}>
        <Text dimColor>: </Text>
        <TextInput
          value={query}
          onChange={handleQueryChange}
          focus={true}
          placeholder="Type a command..."
        />
      </Box>

      {selectableItems.length === 0 && query.trim() !== '' && (
        <Text dimColor>No matching commands</Text>
      )}

      {groups.map((group) => (
        <Box key={group.category} flexDirection="column">
          <Text dimColor bold>
            {group.category}
          </Text>
          {group.commands.map((cmd) => {
            const idx = selectableIdx++;
            const isSelected = idx === selectedIndex;
            return (
              <Box key={cmd.id}>
                <Text
                  color={isSelected ? 'cyan' : undefined}
                  bold={isSelected}
                >
                  {isSelected ? '> ' : '  '}
                </Text>
                <Box flexGrow={1}>
                  <Text
                    color={isSelected ? 'cyan' : undefined}
                    bold={isSelected}
                  >
                    {cmd.label}
                  </Text>
                </Box>
                {cmd.shortcut && (
                  <Text dimColor>  {cmd.shortcut}</Text>
                )}
              </Box>
            );
          })}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc cancel'}</Text>
      </Box>
    </Box>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/CommandPalette.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/CommandPalette.tsx src/components/CommandPalette.test.ts
git commit -m "feat: add CommandPalette component with fuzzy filtering"
```

---

### Task 3: Integrate Command Palette into WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Add import and state**

At top of `WorkItemList.tsx`, add imports:

```ts
import { CommandPalette } from './CommandPalette.js';
import { getVisibleCommands, type Command, type CommandContext } from '../commands.js';
```

Inside the `WorkItemList` function, add state:

```ts
const [showCommandPalette, setShowCommandPalette] = useState(false);
```

**Step 2: Add `:` key handler**

In the `useInput` callback, after the line `if (isSearching) return;` (line 209) and before the `confirmDelete` block, add:

```ts
if (showCommandPalette) return;
```

In the key handler section (after `if (input === '/') {` block, around line 237), add:

```ts
if (input === ':') {
  setShowCommandPalette(true);
  return;
}
```

**Step 3: Build the CommandContext and action handler**

After the `handleSearchCancel` function, add:

```ts
const commandContext: CommandContext = {
  screen: 'list',
  markedCount: markedIds.size,
  hasSelectedItem: treeItems.length > 0 && treeItems[cursor] !== undefined,
  capabilities,
  types,
  activeType,
  hasSyncManager: syncManager !== null,
  gitAvailable,
};

const paletteCommands = useMemo(
  () => getVisibleCommands(commandContext),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [commandContext.markedCount, commandContext.hasSelectedItem, capabilities, types, activeType, syncManager, gitAvailable],
);

const handleCommandSelect = (command: Command) => {
  setShowCommandPalette(false);
  switch (command.id) {
    case 'create':
      selectWorkItem(null);
      navigate('form');
      break;
    case 'edit':
      if (treeItems[cursor]) {
        selectWorkItem(treeItems[cursor]!.item.id);
        navigate('form');
      }
      break;
    case 'delete':
      if (treeItems.length > 0) {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          setDeleteTargetIds(targetIds);
          setConfirmDelete(true);
        }
      }
      break;
    case 'open':
      if (treeItems[cursor]) {
        void (async () => {
          await backend.openItem(treeItems[cursor]!.item.id);
          refreshData();
        })();
      }
      break;
    case 'branch':
      if (treeItems[cursor]) {
        const item = treeItems[cursor]!.item;
        const comments = item.comments;
        const config = readConfigSync(process.cwd());
        try {
          const result = beginImplementation(
            item,
            comments,
            { branchMode: config.branchMode ?? 'worktree' },
            process.cwd(),
          );
          setWarning(
            result.resumed
              ? `Resumed work on #${item.id}`
              : `Started work on #${item.id}`,
          );
        } catch (e) {
          setWarning(
            e instanceof Error ? e.message : 'Failed to start implementation',
          );
        }
        refreshData();
      }
      break;
    case 'sync':
      if (syncManager) {
        void syncManager.sync().then(() => refreshData());
      }
      break;
    case 'iterations':
      navigate('iteration-picker');
      break;
    case 'settings':
      navigate('settings');
      break;
    case 'status':
      navigate('status');
      break;
    case 'help':
      navigateToHelp();
      break;
    case 'mark':
      if (treeItems[cursor]) {
        const itemId = treeItems[cursor]!.item.id;
        setMarkedIds((prev) => {
          const next = new Set(prev);
          if (next.has(itemId)) next.delete(itemId);
          else next.add(itemId);
          return next;
        });
      }
      break;
    case 'clear-marks':
      setMarkedIds(new Set());
      break;
    case 'set-priority':
      {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          setBulkTargetIds(targetIds);
          setShowPriorityPicker(true);
        }
      }
      break;
    case 'set-assignee':
      {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          setBulkTargetIds(targetIds);
          setSettingAssignee(true);
          setAssigneeInput('');
        }
      }
      break;
    case 'set-labels':
      {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          setBulkTargetIds(targetIds);
          setSettingLabels(true);
          setLabelsInput('');
        }
      }
      break;
    case 'set-type':
      {
        const targetIds = getTargetIds(markedIds, treeItems[cursor]?.item);
        if (targetIds.length > 0) {
          setBulkTargetIds(targetIds);
          setShowTypePicker(true);
        }
      }
      break;
    case 'bulk-menu':
      setShowBulkMenu(true);
      break;
    case 'quit':
      exit();
      break;
    default:
      // Handle dynamic switch-type commands
      if (command.id.startsWith('switch-')) {
        const type = command.id.replace('switch-', '');
        setActiveType(type);
        setCursor(0);
        setWarning('');
      }
      break;
  }
};
```

**Step 4: Render the palette overlay**

In the JSX, inside the `{!isSearching && (` block, right after `{showBulkMenu && (` block (around line 503), add:

```tsx
{showCommandPalette && (
  <CommandPalette
    commands={paletteCommands}
    onSelect={handleCommandSelect}
    onCancel={() => setShowCommandPalette(false)}
  />
)}
```

**Step 5: Run full test suite**

Run: `npx vitest run`
Expected: All existing tests still pass

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: integrate command palette into list view"
```

---

### Task 4: Update Help Screen with Command Palette Shortcut

**Files:**
- Modify: `src/components/HelpScreen.tsx`

**Step 1: Write the failing test**

Add to `src/components/HelpScreen.test.tsx` (or create it if tests are structured differently):

```ts
it('includes colon shortcut for command palette on list screen', () => {
  const groups = getShortcuts('list', ALL_CAPS, true, true);
  const allShortcuts = groups.flatMap((g) => g.shortcuts);
  const palette = allShortcuts.find((s) => s.key === ':');
  expect(palette).toBeDefined();
  expect(palette!.description).toBe('Command palette');
});
```

Where `ALL_CAPS` is a full `BackendCapabilities` object (match pattern from existing test file).

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: FAIL — no shortcut with key `:`

**Step 3: Add the shortcut to HelpScreen**

In `src/components/HelpScreen.tsx`, in the `case 'list':` block, in the `actions` array (around line 49, after the search entry), add:

```ts
actions.push({ key: ':', description: 'Command palette' });
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/HelpScreen.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/HelpScreen.tsx src/components/HelpScreen.test.tsx
git commit -m "feat: add command palette shortcut to help screen"
```

---

### Task 5: Lint, Format, and Build

**Step 1: Format**

Run: `npm run format`

**Step 2: Lint**

Run: `npm run lint:fix`
Fix any issues.

**Step 3: Build**

Run: `npm run build`
Fix any TypeScript errors.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 5: Commit any formatting/lint fixes**

```bash
git add -A
git commit -m "chore: format and lint command palette code"
```

(Skip if no changes.)

---

### Task 6: Manual Smoke Test

**Step 1: Run the app**

Run: `npm start`

**Step 2: Test command palette**

- Press `:` — palette should appear
- Type "cre" — should filter to "Create item"
- Press Enter — should open the form
- Press Esc on form to go back
- Press `:` again, type "set" — should show "Set priority", "Set assignee", "Set labels", "Set type"
- Arrow down to "Set priority", Enter — should open priority picker
- Esc to cancel picker
- Press `:`, type "qui" — should show "Quit"
- Press Esc to close palette

**Step 3: Test context awareness**

- With no items: `:` should not show "Edit item" or "Delete item"
- Mark an item with `m`, then `:` — should show "Bulk actions menu" and "Clear all marks"

**Step 4: Verify existing shortcuts still work**

- `c` still creates, `d` still deletes, `/` still searches, `?` still shows help
- No regressions
