# Unified Command Registry Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make `src/commands.ts` the single source of truth for all keyboard shortcuts, help text, and footer hints across all screens — eliminating the manual duplication in HelpScreen.tsx, buildHelpText(), and hardcoded footer strings.

**Architecture:** Expand the `Command` interface with `screen`, `helpGroup`, `footer`, and `footerLabel` fields. Add commands for all screens (not just list). Replace HelpScreen's manual `getShortcuts()` and all footer hint generation with functions that read from the registry.

**Tech Stack:** TypeScript, Vitest

---

### Task 1: Expand Command interface and add new fields to existing commands

**Files:**
- Modify: `src/commands.ts` (Command interface + all existing command objects)

**Step 1: Write failing tests for new interface fields and `getCommandsForScreen()`**

Add to `src/commands.test.ts`:

```typescript
import {
  type CommandContext,
  type Command,
  getVisibleCommands,
  getCommandsForScreen,
  getFooterCommands,
  groupByHelpGroup,
  findCommand,
  filterCommands,
  groupCommandsByCategory,
  CATEGORIES,
} from './commands.js';

// ... existing tests ...

describe('findCommand', () => {
  it('finds command by id', () => {
    const cmd = findCommand('create');
    expect(cmd).toBeDefined();
    expect(cmd!.id).toBe('create');
    expect(cmd!.label).toBe('Create item');
  });

  it('returns undefined for unknown id', () => {
    expect(findCommand('nonexistent')).toBeUndefined();
  });
});

describe('getCommandsForScreen', () => {
  it('returns list-screen commands for list screen', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('create');
    expect(ids).toContain('edit');
    expect(ids).toContain('delete');
  });

  it('returns branch-list commands for branch-list screen', () => {
    const ctx = makeContext({ screen: 'branch-list' });
    const cmds = getCommandsForScreen('branch-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('branch-switch');
    expect(ids).toContain('branch-create');
    expect(ids).toContain('branch-delete');
  });

  it('includes global commands on every screen', () => {
    for (const screen of ['list', 'branch-list', 'pr-list', 'settings'] as const) {
      const ctx = makeContext({ screen });
      const cmds = getCommandsForScreen(screen, ctx);
      const ids = cmds.map((c) => c.id);
      expect(ids).toContain('help');
    }
  });

  it('respects when() guards', () => {
    const ctx = makeContext({ screen: 'list', gitAvailable: false });
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('branch');
  });

  it('does not return commands from other screens', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('branch-switch');
    expect(ids).not.toContain('branch-delete');
  });
});

describe('getFooterCommands', () => {
  it('returns only commands with footer: true', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getFooterCommands('list', ctx);
    expect(cmds.length).toBeGreaterThan(0);
    for (const cmd of cmds) {
      expect(cmd.footer).toBe(true);
    }
  });

  it('returns footer commands for branch-list', () => {
    const ctx = makeContext({ screen: 'branch-list' });
    const cmds = getFooterCommands('branch-list', ctx);
    expect(cmds.length).toBeGreaterThan(0);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('branch-switch');
  });
});

describe('groupByHelpGroup', () => {
  it('groups commands by helpGroup field', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', helpGroup: 'Navigation' }),
      makeCmd({ id: 'b', label: 'B', helpGroup: 'Actions' }),
      makeCmd({ id: 'c', label: 'C', helpGroup: 'Navigation' }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe('Navigation');
    expect(groups[0]!.shortcuts).toHaveLength(2);
    expect(groups[1]!.label).toBe('Actions');
    expect(groups[1]!.shortcuts).toHaveLength(1);
  });

  it('omits commands without helpGroup', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', helpGroup: 'Actions' }),
      makeCmd({ id: 'b', label: 'B' }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups).toHaveLength(1);
    const allShortcuts = groups.flatMap((g) => g.shortcuts);
    expect(allShortcuts).toHaveLength(1);
  });

  it('preserves insertion order of groups', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', helpGroup: 'Other' }),
      makeCmd({ id: 'b', label: 'B', helpGroup: 'Navigation' }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups[0]!.label).toBe('Other');
    expect(groups[1]!.label).toBe('Navigation');
  });

  it('uses shortcut as key and label as description', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'Do thing', shortcut: 'x', helpGroup: 'Actions' }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups[0]!.shortcuts[0]).toEqual({ key: 'x', description: 'Do thing' });
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — `getCommandsForScreen`, `getFooterCommands`, `groupByHelpGroup`, `findCommand` not exported

**Step 3: Update Command interface and add screen/helpGroup/footer fields to all existing commands**

In `src/commands.ts`, update the `Command` interface:

```typescript
export interface Command {
  id: string;
  label: string;
  category: CommandCategory;
  shortcut?: string;
  screen: Screen | Screen[] | 'global';
  helpGroup?: string;
  footer?: boolean;
  footerLabel?: string;
  when?: (ctx: CommandContext) => boolean;
}
```

Update every existing command to add the new fields. Example for `create`:

```typescript
{
  id: 'create',
  label: 'Create item',
  category: 'Actions',
  shortcut: 'c',
  screen: 'list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'create',
  when: (ctx) => ctx.screen === 'list',
},
```

For the `when` field — keep the existing guard but note that screen filtering is now also handled by the `screen` field. The `when` guard is for additional conditions (capability checks, state checks). For commands that only checked `ctx.screen === 'list'`, the `when` can be removed since `screen: 'list'` handles it. But for commands with extra conditions (like `ctx.hasSelectedItem`), keep the `when`.

Here's the full mapping for existing commands. The `when` field should be simplified to only contain non-screen conditions:

| id | screen | helpGroup | footer | footerLabel | simplified when |
|---|---|---|---|---|---|
| create | 'list' | 'Actions' | true | 'create' | _(none)_ |
| edit | 'list' | 'Actions' | true | 'edit' | `hasSelectedItem` |
| delete | 'list' | 'Actions' | true | 'delete' | `hasSelectedItem` |
| open | 'list' | 'Actions' | false | — | `hasSelectedItem` |
| branch | 'list' | 'Other' | false | — | `hasSelectedItem && gitAvailable` |
| sync | 'list' | 'Other' | false | — | `hasSyncManager` |
| sort | 'list' | 'Actions' | false | — | _(none)_ |
| iterations | 'list' | 'Switching' | false | — | `capabilities.iterations` |
| settings | 'list' | 'Switching' | true | 'settings' | _(none)_ |
| status | 'list' | 'Actions' | false | — | _(none)_ |
| help | 'global' | — | true | 'help' | _(none)_ |
| mark | 'list' | 'Actions' | false | — | `hasSelectedItem` |
| clear-marks | 'list' | 'Bulk' | false | — | `markedCount > 0` |
| set-priority | 'list' | 'Bulk' | false | — | `capabilities.fields.priority && (hasSelectedItem \|\| markedCount > 0)` |
| set-assignee | 'list' | 'Actions' | false | — | `capabilities.fields.assignee && (hasSelectedItem \|\| markedCount > 0)` |
| set-labels | 'list' | 'Actions' | false | — | `capabilities.fields.labels && (hasSelectedItem \|\| markedCount > 0)` |
| set-type | 'list' | 'Bulk' | false | — | `capabilities.customTypes && (hasSelectedItem \|\| markedCount > 0)` |
| bulk-menu | 'list' | 'Bulk' | false | — | `markedCount > 0` |
| filter | 'list' | 'Actions' | false | — | _(none)_ |
| clear-filters | 'list' | 'Actions' | false | — | `hasActiveFilters` |
| load-view | 'list' | 'Actions' | false | — | _(none)_ |
| save-view | 'list' | 'Actions' | false | — | `hasActiveFilters` |
| delete-view | 'list' | 'Actions' | false | — | `hasSavedViews` |
| toggle-detail-panel | 'list' | 'Other' | false | — | _(none)_ |
| quit | 'global' | 'Other' | false | — | _(none)_ |

**Important:** The `when` field must still exist for `getVisibleCommands()` (command palette) which needs full context filtering including screen. During this transition, keep `when` on all commands but also add the `screen` field. The `getCommandsForScreen()` function uses `screen` for filtering and `when` for capability guards.

**Step 4: Add new functions**

```typescript
export function findCommand(id: string): Command | undefined {
  return commands.find((cmd) => cmd.id === id);
}

export function getCommandsForScreen(
  screen: Screen,
  ctx: CommandContext,
): Command[] {
  return commands.filter((cmd) => {
    // Check screen match
    const screens = cmd.screen;
    if (screens === 'global') {
      // global matches all screens
    } else if (Array.isArray(screens)) {
      if (!screens.includes(screen)) return false;
    } else {
      if (screens !== screen) return false;
    }
    // Check when() guard if present
    if (cmd.when && !cmd.when(ctx)) return false;
    return true;
  });
}

export function getFooterCommands(
  screen: Screen,
  ctx: CommandContext,
): Command[] {
  return getCommandsForScreen(screen, ctx).filter((cmd) => cmd.footer);
}

export interface ShortcutGroup {
  label: string;
  shortcuts: { key: string; description: string }[];
}

export function groupByHelpGroup(commands: Command[]): ShortcutGroup[] {
  const groups: ShortcutGroup[] = [];
  const seen = new Map<string, ShortcutGroup>();
  for (const cmd of commands) {
    if (!cmd.helpGroup || !cmd.shortcut) continue;
    let group = seen.get(cmd.helpGroup);
    if (!group) {
      group = { label: cmd.helpGroup, shortcuts: [] };
      seen.set(cmd.helpGroup, group);
      groups.push(group);
    }
    group.shortcuts.push({ key: cmd.shortcut, description: cmd.label });
  }
  return groups;
}
```

**Step 5: Update `makeCmd` in tests**

The test helper `makeCmd` needs to include the new required `screen` field:

```typescript
function makeCmd(overrides: Partial<Command> & { id: string }): Command {
  return {
    label: overrides.id,
    category: 'Actions',
    screen: 'list',
    when: () => true,
    ...overrides,
  };
}
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 7: Fix the existing test "shows only quit on non-list screens"**

This test currently expects only `quit` on form screen. With the `help` command now being `'global'`, it will also appear. Update the test:

```typescript
it('shows global commands on non-list screens', () => {
  const ctx = makeContext({ screen: 'form' });
  const commands = getVisibleCommands(ctx);
  const ids = commands.map((c) => c.id);
  expect(ids).toContain('quit');
  // global commands appear, but list-specific ones don't
  expect(ids).not.toContain('create');
});
```

**Note:** `getVisibleCommands()` still uses the `when()` guards which include screen checks. The `help` command currently has `when: (ctx) => ctx.screen === 'list'`, so it won't show on form screen via `getVisibleCommands()`. This is fine — `getVisibleCommands()` is for the command palette, `getCommandsForScreen()` is for help/footer. Keep the existing test as-is if `help`'s `when` still filters by list screen. Just verify the test still passes.

**Step 8: Run full test suite**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 9: Run build, lint, format check**

Run: `npm run build && npm run lint && npm run format:check`
Expected: PASS

**Step 10: Commit**

```
feat: expand Command interface with screen, helpGroup, footer fields

Add getCommandsForScreen(), getFooterCommands(), groupByHelpGroup(),
findCommand() functions to commands.ts registry.
```

---

### Task 2: Add commands for all non-list screens

**Files:**
- Modify: `src/commands.ts` (add new command entries)
- Modify: `src/commands.test.ts` (add tests for new commands)

**Step 1: Write failing tests**

Add to `src/commands.test.ts`:

```typescript
describe('non-list screen commands', () => {
  it('has branch-list commands', () => {
    const ctx = makeContext({ screen: 'branch-list' });
    const cmds = getCommandsForScreen('branch-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('branch-switch');
    expect(ids).toContain('branch-create');
    expect(ids).toContain('branch-delete');
    expect(ids).toContain('branch-merge');
    expect(ids).toContain('branch-push');
    expect(ids).toContain('branch-worktree');
    expect(ids).toContain('branch-refresh');
    expect(ids).toContain('branch-search');
    expect(ids).toContain('nav-back');
  });

  it('has pr-list commands', () => {
    const ctx = makeContext({ screen: 'pr-list' });
    const cmds = getCommandsForScreen('pr-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('pr-open');
    expect(ids).toContain('pr-search');
    expect(ids).toContain('nav-back');
  });

  it('has form commands', () => {
    const ctx = makeContext({ screen: 'form' });
    const cmds = getCommandsForScreen('form', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('form-navigate');
    expect(ids).toContain('form-edit');
    expect(ids).toContain('form-save');
    expect(ids).toContain('form-back');
  });

  it('has settings commands', () => {
    const ctx = makeContext({ screen: 'settings' });
    const cmds = getCommandsForScreen('settings', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('settings-navigate');
    expect(ids).toContain('settings-select');
    expect(ids).toContain('settings-back');
  });

  it('has settings template commands when capability present', () => {
    const ctx = makeContext({ screen: 'settings' });
    const cmds = getCommandsForScreen('settings', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('settings-create-template');
    expect(ids).toContain('settings-delete-template');
  });

  it('hides settings template commands when no template capability', () => {
    const ctx = makeContext({
      screen: 'settings',
      capabilities: { ...ALL_CAPS, templates: false },
    });
    const cmds = getCommandsForScreen('settings', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('settings-create-template');
    expect(ids).not.toContain('settings-delete-template');
  });

  it('has status screen commands', () => {
    const ctx = makeContext({ screen: 'status' });
    const cmds = getCommandsForScreen('status', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('status-scroll');
    expect(ids).toContain('status-back');
  });

  it('has status retry when sync manager present', () => {
    const ctx = makeContext({ screen: 'status', hasSyncManager: true });
    const cmds = getCommandsForScreen('status', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('status-retry');
  });

  it('hides status retry when no sync manager', () => {
    const ctx = makeContext({ screen: 'status', hasSyncManager: false });
    const cmds = getCommandsForScreen('status', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).not.toContain('status-retry');
  });

  it('has iteration-picker commands', () => {
    const ctx = makeContext({ screen: 'iteration-picker' });
    const cmds = getCommandsForScreen('iteration-picker', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('iter-navigate');
    expect(ids).toContain('iter-select');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — new command IDs not found

**Step 3: Add all non-list screen commands to the commands array**

Add to the `commands` array in `src/commands.ts`. Match the shortcuts and descriptions from the current `HelpScreen.tsx` exactly to ensure parity. Here are the commands to add:

```typescript
// ── Navigation (shared across sub-screens) ──
{
  id: 'nav-back',
  label: 'Back to list',
  category: 'Navigation',
  shortcut: 'esc',
  screen: ['pr-list', 'branch-list', 'iteration-picker'],
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'back',
},

// ── List-screen navigation commands (not currently in commands.ts) ──
{
  id: 'list-navigate',
  label: 'Navigate items',
  category: 'Navigation',
  shortcut: '↑/↓',
  screen: 'list',
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'navigate',
},
{
  id: 'list-page',
  label: 'Page up / page down',
  category: 'Navigation',
  shortcut: 'pgup/pgdn',
  screen: 'list',
  helpGroup: 'Navigation',
},
{
  id: 'list-home-end',
  label: 'Jump to first / last item',
  category: 'Navigation',
  shortcut: 'home/end',
  screen: 'list',
  helpGroup: 'Navigation',
},
{
  id: 'list-collapse',
  label: 'Collapse or jump to parent',
  category: 'Navigation',
  shortcut: '←',
  screen: 'list',
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'expand',  // footer shows ←→ as "expand"
  when: (ctx) => ctx.capabilities.relationships,
},
{
  id: 'list-expand',
  label: 'Expand children',
  category: 'Navigation',
  shortcut: '→',
  screen: 'list',
  helpGroup: 'Navigation',
  when: (ctx) => ctx.capabilities.relationships,
},
{
  id: 'list-undo',
  label: 'Undo last action',
  category: 'Actions',
  shortcut: 'u',
  screen: 'list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'undo',
},
{
  id: 'list-status',
  label: 'Set status',
  category: 'Actions',
  shortcut: 's',
  screen: 'list',
  helpGroup: 'Actions',
},
{
  id: 'list-parent',
  label: 'Set parent',
  category: 'Actions',
  shortcut: 'g',
  screen: 'list',
  helpGroup: 'Actions',
  when: (ctx) => ctx.capabilities.fields.parent,
},
{
  id: 'list-pr-create',
  label: 'Create pull request',
  category: 'Actions',
  shortcut: 'p',
  screen: 'list',
  helpGroup: 'Actions',
},
{
  id: 'list-pr-list',
  label: 'Pull requests',
  category: 'Navigation',
  shortcut: 'P',
  screen: 'list',
  helpGroup: 'Actions',
},
{
  id: 'list-branch-manage',
  label: 'Branch management',
  category: 'Navigation',
  shortcut: 'B',
  screen: 'list',
  helpGroup: 'Actions',
  when: (ctx) => ctx.gitAvailable,
},
{
  id: 'list-range-select',
  label: 'Range select',
  category: 'Bulk',
  shortcut: 'shift+↑↓',
  screen: 'list',
  helpGroup: 'Actions',
},
{
  id: 'list-bulk-actions',
  label: 'Bulk actions menu',
  category: 'Bulk',
  shortcut: 'x',
  screen: 'list',
  helpGroup: 'Actions',
},
{
  id: 'list-tab',
  label: 'Cycle work item type',
  category: 'Switching',
  shortcut: 'tab',
  screen: 'list',
  helpGroup: 'Switching',
  when: (ctx) => ctx.capabilities.customTypes,
},
{
  id: 'list-load-view',
  label: 'Load saved view',
  category: 'Switching',
  shortcut: 'V',
  screen: 'list',
  helpGroup: 'Switching',
},
{
  id: 'list-toggle-description',
  label: 'Toggle full description',
  category: 'Other',
  shortcut: 'space',
  screen: 'list',
  helpGroup: 'Other',
},
{
  id: 'list-command-bar',
  label: 'Command bar',
  category: 'Actions',
  shortcut: '/',
  screen: 'list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'commands',
},

// ── Branch list ──
{
  id: 'branch-navigate',
  label: 'Navigate branches',
  category: 'Navigation',
  shortcut: 'j/k',
  screen: 'branch-list',
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'navigate',
},
{
  id: 'branch-switch',
  label: 'Switch to branch',
  category: 'Actions',
  shortcut: 'enter',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'switch',
},
{
  id: 'branch-create',
  label: 'New branch',
  category: 'Actions',
  shortcut: 'n',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'new',
},
{
  id: 'branch-delete',
  label: 'Delete branch',
  category: 'Actions',
  shortcut: 'd',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'delete',
},
{
  id: 'branch-merge',
  label: 'Merge into current',
  category: 'Actions',
  shortcut: 'm',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'merge',
},
{
  id: 'branch-push',
  label: 'Push to remote',
  category: 'Actions',
  shortcut: 'P',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'push',
},
{
  id: 'branch-worktree',
  label: 'Open worktree shell',
  category: 'Actions',
  shortcut: 'w',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'worktree',
},
{
  id: 'branch-refresh',
  label: 'Refresh (re-fetch)',
  category: 'Actions',
  shortcut: 'r',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'refresh',
},
{
  id: 'branch-search',
  label: 'Search branches',
  category: 'Actions',
  shortcut: '/',
  screen: 'branch-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'search',
},
{
  id: 'branch-pr',
  label: 'Create pull request',
  category: 'Actions',
  shortcut: 'p',
  screen: 'branch-list',
  helpGroup: 'Actions',
},

// ── PR list ──
{
  id: 'pr-navigate',
  label: 'Navigate pull requests',
  category: 'Navigation',
  shortcut: 'j/k',
  screen: 'pr-list',
  helpGroup: 'Navigation',
  footer: true,
  footerLabel: 'navigate',
},
{
  id: 'pr-open',
  label: 'Open in browser',
  category: 'Actions',
  shortcut: 'enter/o',
  screen: 'pr-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'open in browser',
},
{
  id: 'pr-search',
  label: 'Search pull requests',
  category: 'Actions',
  shortcut: '/',
  screen: 'pr-list',
  helpGroup: 'Actions',
  footer: true,
  footerLabel: 'search',
},

// ── Form ──
{
  id: 'form-navigate',
  label: 'Move between fields',
  category: 'Navigation',
  shortcut: '↑/↓',
  screen: 'form',
  helpGroup: 'Navigation',
},
{
  id: 'form-edit',
  label: 'Edit field / open $EDITOR (description) / navigate to related item',
  category: 'Actions',
  shortcut: 'enter',
  screen: 'form',
  helpGroup: 'Editing',
},
{
  id: 'form-revert',
  label: 'Revert field to previous value (in edit mode)',
  category: 'Actions',
  shortcut: 'esc',
  screen: 'form',
  helpGroup: 'Editing',
},
{
  id: 'form-confirm',
  label: 'Confirm field value',
  category: 'Actions',
  shortcut: 'enter/select',
  screen: 'form',
  helpGroup: 'Editing',
},
{
  id: 'form-save',
  label: 'Save and go back',
  category: 'Actions',
  shortcut: 's',
  screen: 'form',
  helpGroup: 'Save & Exit',
},
{
  id: 'form-back',
  label: 'Go back (prompts to save/discard if unsaved changes)',
  category: 'Navigation',
  shortcut: 'esc',
  screen: 'form',
  helpGroup: 'Save & Exit',
},

// ── Iteration picker ──
{
  id: 'iter-navigate',
  label: 'Navigate iterations',
  category: 'Navigation',
  shortcut: '↑/↓',
  screen: 'iteration-picker',
  helpGroup: 'Navigation',
},
{
  id: 'iter-select',
  label: 'Select iteration',
  category: 'Actions',
  shortcut: 'enter',
  screen: 'iteration-picker',
  helpGroup: 'Navigation',
},

// ── Settings ──
{
  id: 'settings-navigate',
  label: 'Navigate options',
  category: 'Navigation',
  shortcut: '↑/↓',
  screen: 'settings',
  helpGroup: 'Navigation',
},
{
  id: 'settings-select',
  label: 'Select or edit',
  category: 'Actions',
  shortcut: 'enter',
  screen: 'settings',
  helpGroup: 'Navigation',
},
{
  id: 'settings-back',
  label: 'Go back',
  category: 'Navigation',
  shortcut: 'esc/,',
  screen: 'settings',
  helpGroup: 'Navigation',
},
{
  id: 'settings-edit',
  label: 'Edit field value',
  category: 'Actions',
  shortcut: 'type',
  screen: 'settings',
  helpGroup: 'Editing',
},
{
  id: 'settings-confirm',
  label: 'Confirm',
  category: 'Actions',
  shortcut: 'enter/esc',
  screen: 'settings',
  helpGroup: 'Editing',
},
{
  id: 'settings-create-template',
  label: 'Create template',
  category: 'Actions',
  shortcut: 'c',
  screen: 'settings',
  helpGroup: 'Templates',
  when: (ctx) => ctx.capabilities.templates,
},
{
  id: 'settings-delete-template',
  label: 'Delete template',
  category: 'Actions',
  shortcut: 'd',
  screen: 'settings',
  helpGroup: 'Templates',
  when: (ctx) => ctx.capabilities.templates,
},
{
  id: 'settings-edit-template',
  label: 'Edit template',
  category: 'Actions',
  shortcut: 'enter',
  screen: 'settings',
  helpGroup: 'Templates',
  when: (ctx) => ctx.capabilities.templates,
},

// ── Status screen ──
{
  id: 'status-scroll',
  label: 'Scroll errors',
  category: 'Navigation',
  shortcut: '↑/↓',
  screen: 'status',
  helpGroup: 'Navigation',
},
{
  id: 'status-back',
  label: 'Go back',
  category: 'Navigation',
  shortcut: 'esc/q',
  screen: 'status',
  helpGroup: 'Navigation',
},
{
  id: 'status-retry',
  label: 'Retry failed sync operations',
  category: 'Actions',
  shortcut: 'r',
  screen: 'status',
  helpGroup: 'Actions',
  when: (ctx) => ctx.hasSyncManager,
},
```

**Important notes:**
- Some list-screen commands that were in HelpScreen but not in `commands.ts` need to be added (navigate, undo, status overlay, parent, range select, tab, etc.). Some of these overlap with existing command IDs — be careful not to create conflicts with existing IDs. Use new IDs prefixed with `list-` for the new ones.
- The existing commands (create, edit, delete, etc.) keep their current IDs — they're used by `handleCommandSelect()` in WorkItemList.
- Do NOT remove the existing `status` command (id: 'status', which navigates to status screen). The new `list-status` (id: 'list-status', shortcut 's') is for the set-status overlay on the list screen. These are different.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 5: Run build + lint + format**

Run: `npm run build && npm run lint && npm run format && npm run format:check`
Expected: PASS

**Step 6: Commit**

```
feat: add commands for all screens to unified registry

Branch list, PR list, form, settings, iteration picker, and status
screen commands now registered in commands.ts.
```

---

### Task 3: Replace HelpScreen.tsx to read from command registry

**Files:**
- Modify: `src/components/HelpScreen.tsx`
- Modify: `src/commands.ts` (export `ShortcutGroup` type if not already)

**Step 1: Write a failing test**

The existing HelpScreen tests (if any) should be checked. The key behavior to test: `getShortcuts()` should return groups that match what `groupByHelpGroup(getCommandsForScreen(...))` returns.

Add to `src/commands.test.ts`:

```typescript
describe('help screen parity', () => {
  it('list screen has Navigation, Actions, Switching, and Other groups', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const groups = groupByHelpGroup(cmds);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('Navigation');
    expect(labels).toContain('Actions');
    expect(labels).toContain('Other');
  });

  it('branch-list screen has Navigation and Actions groups', () => {
    const ctx = makeContext({ screen: 'branch-list' });
    const cmds = getCommandsForScreen('branch-list', ctx);
    const groups = groupByHelpGroup(cmds);
    const labels = groups.map((g) => g.label);
    expect(labels).toContain('Navigation');
    expect(labels).toContain('Actions');
  });
});
```

**Step 2: Run test to verify it passes (these should pass already)**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 3: Replace `getShortcuts()` in HelpScreen.tsx**

Replace the entire `getShortcuts()` function (~230 lines) with:

```typescript
import {
  getCommandsForScreen,
  groupByHelpGroup,
  type ShortcutGroup,
} from '../commands.js';
import type { CommandContext } from '../commands.js';

export function getShortcuts(
  screen: Screen,
  capabilities: BackendCapabilities,
  gitAvailable: boolean,
  hasSyncManager: boolean,
): ShortcutGroup[] {
  const ctx: CommandContext = {
    screen,
    markedCount: 0,
    hasSelectedItem: true,
    capabilities,
    types: [],
    activeType: null,
    hasSyncManager,
    gitAvailable,
    hasActiveFilters: false,
    hasSavedViews: false,
  };
  return groupByHelpGroup(getCommandsForScreen(screen, ctx));
}
```

Remove the local `ShortcutEntry` and `ShortcutGroup` interfaces — import `ShortcutGroup` from commands.ts instead.

Keep the `flattenGroups()`, `HelpScreen` component, and `SCREEN_LABELS` unchanged — they render the groups returned by `getShortcuts()`.

Update the imports: remove `BackendCapabilities` import if no longer needed directly (it's used in the fallback capabilities object in the component). Actually, `BackendCapabilities` is still used in the component body for the fallback — keep it.

**Step 4: Verify the `ShortcutGroup` type matches**

The existing `flattenGroups()` expects `ShortcutGroup` with `{ label: string; shortcuts: { key: string; description: string }[] }`. The `groupByHelpGroup()` function returns exactly this shape. Verify the types are compatible.

**Step 5: Run tests**

Run: `npx vitest run src/commands.test.ts && npx vitest run src/components/`
Expected: PASS

**Step 6: Run build + lint + format**

Run: `npm run build && npm run lint && npm run format && npm run format:check`
Expected: PASS

**Step 7: Commit**

```
refactor: HelpScreen reads shortcuts from command registry

Replace ~230 lines of manual shortcut definitions with a 15-line
function that reads from the unified command registry.
```

---

### Task 4: Create shared `buildFooterHints()` and replace all footer hint generation

**Files:**
- Modify: `src/commands.ts` (add `buildFooterHints()`)
- Modify: `src/components/WorkItemList.tsx` (replace `buildHelpText()`)
- Modify: `src/components/BranchList.tsx` (replace hardcoded footer string)
- Modify: `src/components/PullRequestList.tsx` (replace hardcoded footer string)
- Modify: `src/commands.test.ts` (add tests)

**Step 1: Write failing tests for `buildFooterHints()`**

Add to `src/commands.test.ts`:

```typescript
import {
  // ... existing imports ...
  buildFooterHints,
} from './commands.js';

describe('buildFooterHints', () => {
  it('returns formatted footer string for list screen', () => {
    const ctx = makeContext({ screen: 'list' });
    const result = buildFooterHints('list', ctx, 200);
    expect(result).toContain('navigate');
    expect(result).toContain('create');
    expect(result).toContain('help');
  });

  it('returns formatted footer string for branch-list', () => {
    const ctx = makeContext({ screen: 'branch-list' });
    const result = buildFooterHints('branch-list', ctx, 200);
    expect(result).toContain('switch');
    expect(result).toContain('delete');
    expect(result).toContain('merge');
  });

  it('truncates to available width', () => {
    const ctx = makeContext({ screen: 'list' });
    const result = buildFooterHints('list', ctx, 30);
    expect(result.length).toBeLessThanOrEqual(30);
  });

  it('uses footerLabel when available', () => {
    const ctx = makeContext({ screen: 'list' });
    const result = buildFooterHints('list', ctx, 200);
    // 'create' is the footerLabel, not 'Create item'
    expect(result).toContain('create');
    expect(result).not.toContain('Create item');
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/commands.test.ts`
Expected: FAIL — `buildFooterHints` not exported

**Step 3: Implement `buildFooterHints()`**

Add to `src/commands.ts`:

```typescript
export function buildFooterHints(
  screen: Screen,
  ctx: CommandContext,
  availableWidth: number,
): string {
  const footerCmds = getFooterCommands(screen, ctx);
  const sep = '  ';
  let result = '';
  for (const cmd of footerCmds) {
    if (!cmd.shortcut) continue;
    const label = cmd.footerLabel ?? cmd.label;
    const entry = `${cmd.shortcut} ${label}`;
    const candidate = result ? result + sep + entry : entry;
    if (candidate.length > availableWidth) break;
    result = candidate;
  }
  return result;
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/commands.test.ts`
Expected: PASS

**Step 5: Replace `buildHelpText()` in WorkItemList.tsx**

In `src/components/WorkItemList.tsx`:

1. Remove the `buildHelpText()` function (lines ~235-256).
2. Import `buildFooterHints` from `../commands.js`.
3. At the call site (line ~2186), replace:
   ```tsx
   {buildHelpText(terminalWidth - (positionText ? positionText.length + 2 : 0))}
   ```
   with:
   ```tsx
   {buildFooterHints('list', commandContext, terminalWidth - (positionText ? positionText.length + 2 : 0))}
   ```
4. Build the `commandContext` object from existing state. The component already has access to all the fields needed for `CommandContext`. Look for where `getVisibleCommands()` is called — it already builds a context object. Reuse that. If it's built inline in a `useMemo`, extract it so it can be shared.

**Step 6: Replace hardcoded footer in BranchList.tsx**

In `src/components/BranchList.tsx`, replace lines ~500-505:
```tsx
<Text color={muted} dimColor={mutedDim}>
  j/k navigate · Enter switch · d delete · m merge · P push · n new · w worktree · r refresh · / search · Esc back · ? help
</Text>
```
with:
```tsx
<Text color={muted} dimColor={mutedDim}>
  {buildFooterHints('branch-list', branchCommandContext, termWidth)}
</Text>
```

Build a `CommandContext` object. Most fields can use defaults since branch-list commands don't use capability guards. The key fields are `screen: 'branch-list'` and any capability/state fields that branch commands' `when()` guards check.

**Step 7: Replace hardcoded footer in PullRequestList.tsx**

Same pattern — replace the hardcoded string at line ~256 with `buildFooterHints('pr-list', prCommandContext, termWidth)`.

**Step 8: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 9: Run build + lint + format**

Run: `npm run build && npm run lint && npm run format && npm run format:check`
Expected: PASS

**Step 10: Commit**

```
refactor: replace all hardcoded footer hints with buildFooterHints()

Footer hint bars in WorkItemList, BranchList, and PullRequestList
now read from the unified command registry.
```

---

### Task 5: Clean up and verify full parity

**Files:**
- Modify: `src/commands.test.ts` (add parity tests)
- Modify: `src/components/WorkItemList.test.ts` (update if `buildHelpText` was tested)

**Step 1: Check if `buildHelpText` had tests**

Search `src/components/WorkItemList.test.ts` for `buildHelpText`. If tests exist, update them to test `buildFooterHints` instead.

**Step 2: Write a parity test ensuring all HelpScreen shortcuts come from registry**

Add to `src/commands.test.ts`:

```typescript
describe('registry completeness', () => {
  it('every command with a helpGroup and shortcut appears in help output', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const withHelp = cmds.filter((c) => c.helpGroup && c.shortcut);
    const groups = groupByHelpGroup(cmds);
    const allShortcuts = groups.flatMap((g) => g.shortcuts);
    for (const cmd of withHelp) {
      const found = allShortcuts.find(
        (s) => s.key === cmd.shortcut && s.description === cmd.label,
      );
      expect(found, `Missing help entry for ${cmd.id} (${cmd.shortcut})`).toBeDefined();
    }
  });

  it('every command with footer: true has a shortcut', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const footerCmds = cmds.filter((c) => c.footer);
    for (const cmd of footerCmds) {
      expect(cmd.shortcut, `Footer command ${cmd.id} has no shortcut`).toBeTruthy();
    }
  });
});
```

**Step 3: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 4: Run build + lint + format**

Run: `npm run build && npm run lint && npm run format && npm run format:check`
Expected: PASS

**Step 5: Commit**

```
test: add parity tests for unified command registry

Verify all commands with helpGroup appear in help output and all
footer commands have shortcuts.
```

---

## Notes for Implementation

- **Ordering matters for help groups**: `groupByHelpGroup()` preserves insertion order. Make sure commands in the array are ordered so that help groups appear in the right order (Navigation first, then Actions, then Switching, then Other) for the list screen. Match the current HelpScreen group order.

- **`getVisibleCommands()` backward compat**: This function is used by the command palette. It must continue to work with `when()` guards. The new `screen` field is NOT used by `getVisibleCommands()` — it still relies on `when()` for filtering. Only `getCommandsForScreen()` uses the `screen` field.

- **Duplicate shortcut keys across screens are fine**: `d` means "delete item" on list, "delete branch" on branch-list. The `screen` field keeps them separate.

- **Some commands have no shortcut** (save-view, delete-view): these only appear in the command palette, not in help or footer. They should have `helpGroup` omitted.

- **The `help` command**: Currently has `when: (ctx) => ctx.screen === 'list'` which means it only shows in the command palette on list screen. Change its `screen` to `'global'` but keep its `when` for command palette filtering. Or remove `when` and let `screen: 'global'` handle it — but then it would appear in the command palette on all screens. Decide based on desired behavior.

- **Footer separator**: The current BranchList/PullRequestList use `·` (middle dot) as separator. `buildFooterHints()` uses double-space. Pick one and be consistent. Recommend double-space to match the existing `buildHelpText()` pattern.
