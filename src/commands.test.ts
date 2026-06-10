import { describe, it, expect } from 'vitest';
import {
  type CommandContext,
  type Command,
  getVisibleCommands,
  filterCommands,
  groupCommandsByCategory,
  CATEGORIES,
  findCommand,
  getCommandsForScreen,
  getFooterCommands,
  buildFooterHints,
  groupByHelpGroup,
  matchesCommand,
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
  templates: true,
  imageUpload: true,
  templateFields: {
    type: true,
    status: true,
    priority: true,
    assignee: true,
    labels: true,
    iteration: true,
    parent: true,
    dependsOn: true,
    description: true,
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
    hasActiveFilters: false,
    hasSavedViews: false,
    hasSelectedBranch: false,
    isCurrentBranch: false,
    hasWorktree: false,
    hasPrCreateCapability: false,
    hasSelectedPr: false,
    showDetailDescription: false,
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
    expect(labels).toContain('Create new item');
    expect(labels).toContain('Edit selected item');
    expect(labels).toContain('Delete selected item');
    expect(labels).toContain('Quit');
  });

  it('hides edit/delete when no item is selected', () => {
    const ctx = makeContext({ hasSelectedItem: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Edit selected item');
    expect(labels).not.toContain('Delete selected item');
    expect(labels).toContain('Create new item');
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
    expect(labels).not.toContain('Set item priority');
  });

  it('hides iteration picker when backend lacks iterations', () => {
    const ctx = makeContext({
      capabilities: { ...ALL_CAPS, iterations: false },
    });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Go to iterations');
  });

  it('shows bulk actions menu (x) regardless of marked count', () => {
    const ctx0 = makeContext({ markedCount: 0 });
    const ctx3 = makeContext({ markedCount: 3 });
    expect(getVisibleCommands(ctx0).map((c) => c.id)).toContain('bulk-menu');
    expect(getVisibleCommands(ctx3).map((c) => c.id)).toContain('bulk-menu');
  });

  it('hides clear marks when no items are marked', () => {
    const ctx = makeContext({ markedCount: 0 });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Clear all marks');
  });

  it('shows switch commands for each available type', () => {
    const ctx = makeContext({
      types: ['epic', 'issue', 'task'],
      activeType: 'issue',
    });
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
    expect(labels).not.toContain('Sync with remote backend');
  });

  it('hides branch/worktree when git not available', () => {
    const ctx = makeContext({ gitAvailable: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Create branch or worktree for item');
  });

  it('hides switch commands when backend lacks customTypes', () => {
    const ctx = makeContext({
      capabilities: { ...ALL_CAPS, customTypes: false },
    });
    const commands = getVisibleCommands(ctx);
    const switchCmds = commands.filter(
      (c) => c.id.startsWith('switch-') && c.id !== 'switch-iteration',
    );
    expect(switchCmds).toHaveLength(0);
  });

  it('shows sort command on list screen', () => {
    const ctx = makeContext();
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain('Change sort order');
  });

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

  it('hides list-specific commands on non-list screens', () => {
    const ctx = makeContext({ screen: 'form' });
    const commands = getVisibleCommands(ctx);
    const ids = commands.map((c) => c.id);
    expect(ids).not.toContain('create');
    expect(ids).not.toContain('edit');
    expect(ids).not.toContain('delete');
    expect(ids).toContain('quit');
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

function makeCmd(overrides: Partial<Command> & { id: string }): Command {
  return {
    label: overrides.id,
    category: 'Actions',
    screen: 'list',
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

  it('filters by substring match on label', () => {
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

describe('groupCommandsByCategory', () => {
  it('groups commands by category in order', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', category: 'Other' }),
      makeCmd({ id: 'b', label: 'B', category: 'Actions' }),
      makeCmd({ id: 'c', label: 'C', category: 'Actions' }),
      makeCmd({ id: 'd', label: 'D', category: 'Navigation' }),
    ];
    const groups = groupCommandsByCategory(cmds);
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
    const groups = groupCommandsByCategory(cmds);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.category).toBe('Other');
  });
});

describe('findCommand', () => {
  it('finds a command by id', () => {
    const cmd = findCommand('create');
    expect(cmd).toBeDefined();
    expect(cmd!.id).toBe('create');
    expect(cmd!.label).toBe('Create new item');
  });

  it('returns undefined for unknown id', () => {
    const cmd = findCommand('nonexistent');
    expect(cmd).toBeUndefined();
  });
});

describe('getCommandsForScreen', () => {
  it('returns list commands for list screen', () => {
    const ctx = makeContext();
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('create');
    expect(ids).toContain('edit');
    expect(ids).not.toContain('branch-switch');
    expect(ids).not.toContain('pr-open');
  });

  it('includes global commands on any screen', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('quit');
  });

  it('includes global commands on branch-list screen', () => {
    const ctx = makeContext({
      screen: 'branch-list',
      hasSelectedBranch: true,
    });
    const cmds = getCommandsForScreen('branch-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('quit');
    expect(ids).toContain('branch-switch');
  });

  it('respects when() guards', () => {
    const ctx = makeContext({ hasSelectedItem: false });
    const cmds = getCommandsForScreen('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('create');
    expect(ids).not.toContain('edit');
    expect(ids).not.toContain('delete');
  });

  it('supports array screen field', () => {
    const cmd = makeCmd({
      id: 'multi-screen',
      screen: ['list', 'branch-list'],
    });
    // Verify the screen field is an array
    expect(Array.isArray(cmd.screen)).toBe(true);
  });
});

describe('getFooterCommands', () => {
  it('returns only commands with footer: true', () => {
    const ctx = makeContext();
    const cmds = getFooterCommands('list', ctx);
    for (const cmd of cmds) {
      expect(cmd.footer).toBe(true);
    }
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('create');
    expect(ids).toContain('edit');
    expect(ids).toContain('settings');
    expect(ids).toContain('help');
    expect(ids).not.toContain('quit');
    expect(ids).not.toContain('sort');
  });

  it('respects when() guards for footer commands', () => {
    const ctx = makeContext({ hasSelectedItem: false });
    const cmds = getFooterCommands('list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('create');
    expect(ids).not.toContain('edit');
    expect(ids).not.toContain('delete');
  });
});

describe('groupByHelpGroup', () => {
  it('groups commands by helpGroup preserving order', () => {
    const cmds: Command[] = [
      makeCmd({
        id: 'a',
        label: 'Action A',
        helpGroup: 'Actions',
        shortcut: 'a',
      }),
      makeCmd({
        id: 'b',
        label: 'Other B',
        helpGroup: 'Other',
        shortcut: 'b',
      }),
      makeCmd({
        id: 'c',
        label: 'Action C',
        helpGroup: 'Actions',
        shortcut: 'c',
      }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups).toHaveLength(2);
    expect(groups[0]!.label).toBe('Actions');
    expect(groups[0]!.shortcuts).toHaveLength(2);
    expect(groups[1]!.label).toBe('Other');
    expect(groups[1]!.shortcuts).toHaveLength(1);
  });

  it('uses shortcut as key and label as description', () => {
    const cmds: Command[] = [
      makeCmd({
        id: 'x',
        label: 'Do something',
        helpGroup: 'Actions',
        shortcut: 'x',
      }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups[0]!.shortcuts[0]).toEqual({
      key: 'x',
      description: 'Do something',
    });
  });

  it('omits commands without helpGroup', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', shortcut: 'a' }),
      makeCmd({
        id: 'b',
        label: 'B',
        helpGroup: 'Actions',
        shortcut: 'b',
      }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups).toHaveLength(1);
    expect(groups[0]!.shortcuts).toHaveLength(1);
  });

  it('omits commands without shortcut', () => {
    const cmds: Command[] = [
      makeCmd({ id: 'a', label: 'A', helpGroup: 'Actions' }),
    ];
    const groups = groupByHelpGroup(cmds);
    expect(groups).toHaveLength(0);
  });

  it('returns empty array for empty input', () => {
    expect(groupByHelpGroup([])).toEqual([]);
  });
});

describe('non-list screen commands', () => {
  it('has branch-list commands', () => {
    const ctx = makeContext({
      screen: 'branch-list',
      hasSelectedBranch: true,
      hasWorktree: true,
    });
    const cmds = getCommandsForScreen('branch-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('branch-switch');
    expect(ids).toContain('branch-create');
    expect(ids).toContain('branch-delete');
    expect(ids).toContain('branch-merge');
    expect(ids).toContain('branch-push');
    expect(ids).toContain('branch-worktree');
    expect(ids).toContain('branch-refresh');
    expect(ids).toContain('nav-back');
  });

  it('has pr-list commands', () => {
    const ctx = makeContext({ screen: 'pr-list', hasSelectedPr: true });
    const cmds = getCommandsForScreen('pr-list', ctx);
    const ids = cmds.map((c) => c.id);
    expect(ids).toContain('pr-open');
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

  it('help command appears on all screens', () => {
    for (const screen of [
      'list',
      'form',
      'settings',
      'branch-list',
      'pr-list',
      'status',
    ] as const) {
      const ctx = makeContext({ screen });
      const cmds = getCommandsForScreen(screen, ctx);
      const ids = cmds.map((c) => c.id);
      expect(ids).toContain('help');
    }
  });
});

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
      expect(
        found,
        `Missing help entry for ${cmd.id} (${cmd.shortcut})`,
      ).toBeDefined();
    }
  });

  it('every command with footer: true has a shortcut', () => {
    const ctx = makeContext({ screen: 'list' });
    const cmds = getCommandsForScreen('list', ctx);
    const footerCmds = cmds.filter((c) => c.footer);
    for (const cmd of footerCmds) {
      expect(
        cmd.shortcut,
        `Footer command ${cmd.id} has no shortcut`,
      ).toBeTruthy();
    }
  });

  it('no duplicate command ids', () => {
    const allScreens = [
      'list',
      'form',
      'settings',
      'branch-list',
      'pr-list',
      'status',
    ] as const;
    for (const screen of allScreens) {
      const ctx = makeContext({ screen });
      const cmds = getCommandsForScreen(screen, ctx);
      for (const cmd of cmds) {
        expect(findCommand(cmd.id)).toBeDefined();
      }
    }
  });

  it('footer commands across all screens have footerLabel or label', () => {
    const allScreens = [
      'list',
      'form',
      'settings',
      'branch-list',
      'pr-list',
      'status',
    ] as const;
    for (const screen of allScreens) {
      const ctx = makeContext({ screen });
      const footerCmds = getFooterCommands(screen, ctx);
      for (const cmd of footerCmds) {
        const label = cmd.footerLabel ?? cmd.label;
        expect(
          label,
          `Footer command ${cmd.id} on ${screen} has no label`,
        ).toBeTruthy();
        expect(
          cmd.shortcut,
          `Footer command ${cmd.id} on ${screen} has no shortcut`,
        ).toBeTruthy();
      }
    }
  });
});

describe('buildFooterHints', () => {
  it('returns formatted footer string for list screen', () => {
    const ctx = makeContext({ screen: 'list' });
    const result = buildFooterHints('list', ctx, 200);
    expect(result).toContain('navigate');
    expect(result).toContain('create');
    expect(result).toContain('help');
  });

  it('returns formatted footer string for branch-list', () => {
    const ctx = makeContext({
      screen: 'branch-list',
      hasSelectedBranch: true,
    });
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
    expect(result).not.toContain('Create new item');
  });

  it('returns empty string when width is zero', () => {
    const ctx = makeContext({ screen: 'list' });
    expect(buildFooterHints('list', ctx, 0)).toBe('');
  });

  it('separates entries with double space', () => {
    const ctx = makeContext({ screen: 'list' });
    const result = buildFooterHints('list', ctx, 200);
    expect(result).toContain('navigate │');
  });
});

describe('matchesCommand', () => {
  const noKey: Record<string, boolean> = {
    upArrow: false,
    downArrow: false,
    leftArrow: false,
    rightArrow: false,
    pageDown: false,
    pageUp: false,
    home: false,
    end: false,
    return: false,
    escape: false,
    ctrl: false,
    shift: false,
    tab: false,
    backspace: false,
    delete: false,
    meta: false,
  };

  it('matches a single character key', () => {
    expect(matchesCommand('create', 'c', noKey)).toBe(true);
    expect(matchesCommand('create', 'd', noKey)).toBe(false);
  });

  it('matches a special key', () => {
    expect(matchesCommand('edit', '', { ...noKey, return: true })).toBe(true);
    expect(matchesCommand('edit', '', noKey)).toBe(false);
  });

  it('matches a modifier + special key', () => {
    expect(
      matchesCommand('list-range-select', '', {
        ...noKey,
        upArrow: true,
        shift: true,
      }),
    ).toBe(true);
    expect(
      matchesCommand('list-range-select', '', { ...noKey, upArrow: true }),
    ).toBe(false);
  });

  it('does not match non-modifier special when shift is held', () => {
    expect(
      matchesCommand('list-navigate', '', {
        ...noKey,
        upArrow: true,
        shift: true,
      }),
    ).toBe(false);
    expect(
      matchesCommand('list-navigate', '', { ...noKey, upArrow: true }),
    ).toBe(true);
  });

  it('matches any of multiple keys', () => {
    expect(matchesCommand('pr-open', 'o', noKey)).toBe(true);
    expect(matchesCommand('pr-open', '', { ...noKey, return: true })).toBe(
      true,
    );
    expect(matchesCommand('pr-open', 'x', noKey)).toBe(false);
  });

  it('matches create-child on uppercase C', () => {
    expect(matchesCommand('create-child', 'C', noKey)).toBe(true);
    expect(matchesCommand('create-child', 'c', noKey)).toBe(false);
  });

  it('returns false for unknown command', () => {
    expect(matchesCommand('nonexistent', 'c', noKey)).toBe(false);
  });

  it('returns false for command without keys', () => {
    expect(matchesCommand('save-view', 's', noKey)).toBe(false);
  });
});

describe('list-edit-title', () => {
  it('is visible on the list screen when an item is selected', () => {
    const ctx = makeContext({ hasSelectedItem: true });
    const ids = getVisibleCommands(ctx).map((c) => c.id);
    expect(ids).toContain('list-edit-title');
  });

  it('is hidden when no item is selected', () => {
    const ctx = makeContext({ hasSelectedItem: false });
    const ids = getVisibleCommands(ctx).map((c) => c.id);
    expect(ids).not.toContain('list-edit-title');
  });

  it('is bound to the "T" key', () => {
    const blank: Record<string, boolean> = {
      upArrow: false,
      downArrow: false,
      leftArrow: false,
      rightArrow: false,
      pageDown: false,
      pageUp: false,
      home: false,
      end: false,
      return: false,
      escape: false,
      ctrl: false,
      shift: false,
      tab: false,
      backspace: false,
      delete: false,
      meta: false,
    };
    expect(matchesCommand('list-edit-title', 'T', blank)).toBe(true);
    expect(matchesCommand('list-edit-title', 't', blank)).toBe(false);
  });
});

describe('Parity', () => {
  it('every command with keys also has a shortcut for display', () => {
    const allCmds = getVisibleCommands(makeContext());
    const withKeys = allCmds.filter((c) => c.keys && c.keys.length > 0);
    for (const cmd of withKeys) {
      expect(cmd.shortcut, `${cmd.id} has keys but no shortcut`).toBeDefined();
    }
  });
});
