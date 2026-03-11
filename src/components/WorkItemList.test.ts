import { describe, it, expect } from 'vitest';
import { getTargetIds } from './WorkItemList.js';
import type { WorkItem } from '../types.js';

function makeItem(rowId: number, id: string | null): WorkItem {
  return {
    rowId,
    id,
    title: `Item ${id ?? rowId}`,
    type: 'task',
    status: 'open',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
  };
}

const allItems = [
  makeItem(1, '1'),
  makeItem(2, '2'),
  makeItem(3, '3'),
  makeItem(5, '5'),
];

describe('getTargetIds', () => {
  it('returns marked IDs when marks present', () => {
    const marked = new Set([1, 2, 3]);
    const cursor = makeItem(5, '5');
    expect(getTargetIds(marked, cursor, allItems)).toEqual(['1', '2', '3']);
  });

  it('returns cursor ID when no marks', () => {
    const marked = new Set<number>();
    const cursor = makeItem(5, '5');
    expect(getTargetIds(marked, cursor, allItems)).toEqual(['5']);
  });

  it('returns empty array when no marks and no cursor', () => {
    const marked = new Set<number>();
    expect(getTargetIds(marked, undefined, allItems)).toEqual([]);
  });

  it('ignores cursor item when marks present', () => {
    const marked = new Set([1, 2]);
    const cursor = makeItem(5, '5');
    const result = getTargetIds(marked, cursor, allItems);
    expect(result).not.toContain('5');
  });
});
