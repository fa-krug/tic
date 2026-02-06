import { describe, it, expect } from 'vitest';
import { getTargetIds, buildHelpText } from './WorkItemList.js';

describe('getTargetIds', () => {
  it('returns marked IDs when marks present', () => {
    const marked = new Set(['1', '2', '3']);
    const cursor = { id: '5' };
    expect(getTargetIds(marked, cursor)).toEqual(['1', '2', '3']);
  });

  it('returns cursor ID when no marks', () => {
    const marked = new Set<string>();
    const cursor = { id: '5' };
    expect(getTargetIds(marked, cursor)).toEqual(['5']);
  });

  it('returns empty array when no marks and no cursor', () => {
    const marked = new Set<string>();
    expect(getTargetIds(marked, undefined)).toEqual([]);
  });

  it('ignores cursor item when marks present', () => {
    const marked = new Set(['1', '2']);
    const cursor = { id: '5' };
    const result = getTargetIds(marked, cursor);
    expect(result).not.toContain('5');
  });
});

describe('buildHelpText', () => {
  it('returns all shortcuts when width is large enough', () => {
    const text = buildHelpText(200);
    expect(text).toContain('↑↓ navigate');
    expect(text).toContain('? help');
  });

  it('truncates shortcuts when width is narrow', () => {
    const text = buildHelpText(30);
    expect(text).toContain('↑↓ navigate');
    expect(text).not.toContain('? help');
  });

  it('returns empty string when width is zero', () => {
    expect(buildHelpText(0)).toBe('');
  });

  it('separates shortcuts with double space', () => {
    const text = buildHelpText(200);
    expect(text).toContain('navigate  ←→');
  });

  it('includes delete and search shortcuts', () => {
    const text = buildHelpText(200);
    expect(text).toContain('d delete');
    expect(text).toContain('/ search');
  });
});
