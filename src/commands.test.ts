import { describe, it, expect } from 'vitest';
import {
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
