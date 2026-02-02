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
});
