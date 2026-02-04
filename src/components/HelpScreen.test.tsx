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
    expect(allKeys).toContain('b'); // bulk actions menu (always present)
    expect(allKeys).toContain('B'); // branch/worktree (git available)
    expect(allKeys).toContain('/');
  });

  it('omits capability-dependent shortcuts when not supported', () => {
    const groups = getShortcuts('list', minimalCapabilities, false, false);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).not.toContain('p'); // parent - needs capabilities.fields.parent
    expect(allKeys).not.toContain('tab'); // type cycling - needs customTypes
    expect(allKeys).not.toContain('i'); // iteration picker - needs iterations
    expect(allKeys).not.toContain('r'); // sync - needs syncManager
    expect(allKeys).not.toContain('B'); // branch/worktree - needs gitAvailable
    // Core shortcuts always present
    expect(allKeys).toContain('enter');
    expect(allKeys).toContain('c');
    expect(allKeys).toContain('q');
    expect(allKeys).toContain('b'); // bulk actions menu - always present
  });

  it('returns form shortcuts', () => {
    const groups = getShortcuts('form', fullCapabilities, false, false);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('\u2191/\u2193');
    expect(allKeys).toContain('enter');
    expect(allKeys).toContain('esc');
  });

  it('returns iteration-picker shortcuts', () => {
    const groups = getShortcuts(
      'iteration-picker',
      fullCapabilities,
      false,
      false,
    );
    expect(groups.length).toBeGreaterThan(0);
    const allKeys = groups.flatMap((g) => g.shortcuts.map((s) => s.key));
    expect(allKeys).toContain('\u2191/\u2193');
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

  it('includes command palette shortcut on list screen', () => {
    const groups = getShortcuts('list', fullCapabilities, true, true);
    const allShortcuts = groups.flatMap((g) => g.shortcuts);
    const commandPaletteShortcut = allShortcuts.find((s) => s.key === ':');
    expect(commandPaletteShortcut).toBeDefined();
    expect(commandPaletteShortcut?.description).toBe('Command palette');
  });
});
