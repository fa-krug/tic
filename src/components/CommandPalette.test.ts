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
