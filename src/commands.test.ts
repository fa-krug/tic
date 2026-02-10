import { describe, it, expect } from 'vitest';
import {
  type CommandContext,
  type Command,
  getVisibleCommands,
  filterCommands,
  groupCommandsByCategory,
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
  templates: true,
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
    expect(labels).not.toContain('Refresh/sync');
  });

  it('hides branch/worktree when git not available', () => {
    const ctx = makeContext({ gitAvailable: false });
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).not.toContain('Create branch/worktree');
  });

  it('hides switch commands when backend lacks customTypes', () => {
    const ctx = makeContext({
      capabilities: { ...ALL_CAPS, customTypes: false },
    });
    const commands = getVisibleCommands(ctx);
    const switchCmds = commands.filter((c) => c.id.startsWith('switch-'));
    expect(switchCmds).toHaveLength(0);
  });

  it('shows sort command on list screen', () => {
    const ctx = makeContext();
    const commands = getVisibleCommands(ctx);
    const labels = commands.map((c) => c.label);
    expect(labels).toContain('Order by...');
  });

  it('shows only quit on non-list screens', () => {
    const ctx = makeContext({ screen: 'form' });
    const commands = getVisibleCommands(ctx);
    expect(commands).toHaveLength(1);
    expect(commands[0]!.id).toBe('quit');
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
