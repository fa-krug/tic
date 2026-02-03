import { describe, it, expect } from 'vitest';
import { getTargetIds } from './WorkItemList.js';

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
