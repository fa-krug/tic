import { describe, it, expect } from 'vitest';
import {
  getTargetIds,
  collectDescendants,
  scopeToIteration,
  commonIteration,
} from './WorkItemList.js';
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

describe('collectDescendants', () => {
  function makeTree(): WorkItem[] {
    const root = makeItem(1, '1');
    const child1 = { ...makeItem(2, '2'), parent: 1 };
    const child2 = { ...makeItem(3, '3'), parent: 1 };
    const grandchild = { ...makeItem(4, '4'), parent: 2 };
    const unrelated = makeItem(5, '5');
    return [root, child1, child2, grandchild, unrelated];
  }

  it('collects direct children', () => {
    const items = makeTree();
    const result = collectDescendants(new Set([1]), items);
    const ids = result.map((i) => i.rowId).sort();
    expect(ids).toEqual([2, 3, 4]);
  });

  it('collects grandchildren recursively', () => {
    const items = makeTree();
    const result = collectDescendants(new Set([2]), items);
    expect(result.map((i) => i.rowId)).toEqual([4]);
  });

  it('returns empty for leaf items', () => {
    const items = makeTree();
    expect(collectDescendants(new Set([5]), items)).toEqual([]);
  });

  it('does not duplicate items already in target set', () => {
    const items = makeTree();
    // Target both parent and child — grandchild should appear once
    const result = collectDescendants(new Set([1, 2]), items);
    const ids = result.map((i) => i.rowId).sort();
    expect(ids).toEqual([3, 4]);
  });
});

describe('scopeToIteration', () => {
  function withIteration(rowId: number, iteration: string): WorkItem {
    return { ...makeItem(rowId, String(rowId)), iteration };
  }

  const items = [
    withIteration(1, 'sprint-1'),
    withIteration(2, 'sprint-2'),
    withIteration(3, 'sprint-1'),
    withIteration(4, ''),
  ];

  it('keeps only items in the given iteration', () => {
    expect(scopeToIteration(items, 'sprint-1').map((i) => i.rowId)).toEqual([
      1, 3,
    ]);
  });

  it('returns all items when no iteration is active', () => {
    expect(scopeToIteration(items, '')).toHaveLength(4);
  });

  it('returns empty when nothing matches', () => {
    expect(scopeToIteration(items, 'sprint-9')).toEqual([]);
  });
});

describe('commonIteration', () => {
  function withIteration(rowId: number, iteration: string): WorkItem {
    return { ...makeItem(rowId, String(rowId)), iteration };
  }

  it('returns the shared iteration', () => {
    expect(
      commonIteration([
        withIteration(1, 'sprint-1'),
        withIteration(2, 'sprint-1'),
      ]),
    ).toBe('sprint-1');
  });

  it('returns null when items disagree', () => {
    expect(
      commonIteration([
        withIteration(1, 'sprint-1'),
        withIteration(2, 'sprint-2'),
      ]),
    ).toBeNull();
  });

  it('returns null for an empty selection', () => {
    expect(commonIteration([])).toBeNull();
  });

  it('returns empty string when items share no iteration', () => {
    expect(commonIteration([withIteration(1, ''), withIteration(2, '')])).toBe(
      '',
    );
  });
});
