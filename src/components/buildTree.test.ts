import { describe, it, expect } from 'vitest';
import { buildTree, sortTree } from './buildTree.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { rowId: number }): WorkItem {
  return {
    id: String(overrides.rowId),
    title: `Item ${overrides.rowId}`,
    type: 'task',
    status: 'open',
    iteration: 'sprint-1',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '',
    updated: '',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('buildTree', () => {
  it('returns flat list when no parent relationships', () => {
    const items = [makeItem({ rowId: 1 }), makeItem({ rowId: 2 })];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.rowId)).toEqual([1, 2]);
    expect(result.every((t) => t.depth === 0)).toBe(true);
    expect(result.every((t) => !t.isCrossType)).toBe(true);
    expect(result.every((t) => !t.hasChildren)).toBe(true);
  });

  it('nests same-type children under parent', () => {
    const items = [makeItem({ rowId: 1 }), makeItem({ rowId: 2, parent: 1 })];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.rowId)).toEqual([1, 2]);
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[1]!.prefix).toBe('└─');
    expect(result[1]!.isCrossType).toBe(false);
  });

  it('pulls in cross-type children from allItems', () => {
    const task = makeItem({ rowId: 1, type: 'task' });
    const bug = makeItem({ rowId: 2, type: 'bug', parent: 1 });
    const filteredItems = [task]; // only tasks
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.rowId)).toEqual([1, 2]);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[0]!.hasChildren).toBe(true);
  });

  it('does not show cross-type items as roots', () => {
    const task = makeItem({ rowId: 1, type: 'task' });
    const bug = makeItem({ rowId: 2, type: 'bug' }); // no parent, different type
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.rowId)).toEqual([1]);
  });

  it('recursively includes cross-type grandchildren', () => {
    const task = makeItem({ rowId: 1, type: 'task' });
    const bug = makeItem({ rowId: 2, type: 'bug', parent: 1 });
    const subtask = makeItem({ rowId: 3, type: 'task', parent: 2 });
    const filteredItems = [task, subtask]; // subtask is same type but child of bug
    const allItems = [task, bug, subtask];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.rowId)).toEqual([1, 2, 3]);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[2]!.isCrossType).toBe(false);
    expect(result[2]!.depth).toBe(2);
  });

  it('promotes a filtered item to a root when its only parent is a cross-type root (ADO epic→issue)', () => {
    const epic = makeItem({ rowId: 1, type: 'epic' });
    const issue = makeItem({ rowId: 2, type: 'issue', parent: 1 });
    const filteredItems = [issue]; // viewing "issue" type
    const allItems = [epic, issue];
    const result = buildTree(filteredItems, allItems, 'issue');
    // The epic is a different type and not a root, but the issue must still
    // be visible — promoted to a root rather than hidden behind the epic.
    expect(result.map((t) => t.item.rowId)).toEqual([2]);
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.isCrossType).toBe(false);
  });

  it('keeps cross-type descendants of a promoted item visible (epic→issue→task)', () => {
    const epic = makeItem({ rowId: 1, type: 'epic' });
    const issue = makeItem({ rowId: 2, type: 'issue', parent: 1 });
    const task = makeItem({ rowId: 3, type: 'task', parent: 2 });
    const filteredItems = [issue];
    const allItems = [epic, issue, task];
    const result = buildTree(filteredItems, allItems, 'issue');
    // Issue is promoted to root; its task child nests under it as before.
    expect(result.map((t) => t.item.rowId)).toEqual([2, 3]);
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[1]!.isCrossType).toBe(true);
  });

  it('marks hasChildren correctly for items whose children are all cross-type', () => {
    const task = makeItem({ rowId: 1, type: 'task' });
    const bug = makeItem({ rowId: 2, type: 'bug', parent: 1 });
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.hasChildren).toBe(false);
  });
});

describe('sortTree', () => {
  it('returns items unchanged when sort stack is empty', () => {
    const items = [makeItem({ rowId: 2 }), makeItem({ rowId: 1 })];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, []);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '1']);
  });

  it('sorts by ID ascending', () => {
    const items = [
      makeItem({ rowId: 3 }),
      makeItem({ rowId: 1 }),
      makeItem({ rowId: 2 }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3']);
  });

  it('sorts by ID descending', () => {
    const items = [
      makeItem({ rowId: 1 }),
      makeItem({ rowId: 3 }),
      makeItem({ rowId: 2 }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['3', '2', '1']);
  });

  it('sorts by title case-insensitive', () => {
    const items = [
      makeItem({ rowId: 1, title: 'Banana' }),
      makeItem({ rowId: 2, title: 'apple' }),
      makeItem({ rowId: 3, title: 'Cherry' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'title', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.title)).toEqual([
      'apple',
      'Banana',
      'Cherry',
    ]);
  });

  it('sorts by priority using ordinal ranking', () => {
    const items = [
      makeItem({ rowId: 1, priority: 'low' }),
      makeItem({ rowId: 2, priority: 'critical' }),
      makeItem({ rowId: 3, priority: 'high' }),
      makeItem({ rowId: 4, priority: 'medium' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.priority)).toEqual([
      'critical',
      'high',
      'medium',
      'low',
    ]);
  });

  it('sorts by priority descending (low first)', () => {
    const items = [
      makeItem({ rowId: 1, priority: 'critical' }),
      makeItem({ rowId: 2, priority: 'low' }),
      makeItem({ rowId: 3, priority: 'high' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.priority)).toEqual([
      'low',
      'high',
      'critical',
    ]);
  });

  it('empty priority sorts last in ascending', () => {
    const items = [
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/no-unsafe-assignment
      makeItem({ rowId: 1, priority: '' as any }),
      makeItem({ rowId: 2, priority: 'high' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'priority', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '1']);
  });

  it('multi-level sort: priority then status', () => {
    const items = [
      makeItem({ rowId: 1, priority: 'high', status: 'closed' }),
      makeItem({ rowId: 2, priority: 'high', status: 'open' }),
      makeItem({ rowId: 3, priority: 'low', status: 'open' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [
      { column: 'priority', direction: 'asc' },
      { column: 'status', direction: 'asc' },
    ]);
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3']);
  });

  it('sorts within each tree level preserving hierarchy', () => {
    const parent1 = makeItem({ rowId: 2, title: 'B' });
    const parent2 = makeItem({ rowId: 1, title: 'A' });
    const child1 = makeItem({ rowId: 4, title: 'D', parent: 2 });
    const child2 = makeItem({ rowId: 3, title: 'C', parent: 2 });
    const items = [parent1, parent2, child1, child2];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'title', direction: 'asc' }]);
    // Parents sorted: A(1), B(2). Children of B sorted: C(3), D(4)
    expect(sorted.map((t) => t.item.id)).toEqual(['1', '2', '3', '4']);
  });

  it('sorts by created date', () => {
    const items = [
      makeItem({ rowId: 1, created: '2026-02-03T00:00:00Z' }),
      makeItem({ rowId: 2, created: '2026-02-01T00:00:00Z' }),
      makeItem({ rowId: 3, created: '2026-02-02T00:00:00Z' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'created', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '3', '1']);
  });

  it('sorts by updated date descending', () => {
    const items = [
      makeItem({ rowId: 1, updated: '2026-02-01T00:00:00Z' }),
      makeItem({ rowId: 2, updated: '2026-02-03T00:00:00Z' }),
      makeItem({ rowId: 3, updated: '2026-02-02T00:00:00Z' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'updated', direction: 'desc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['2', '3', '1']);
  });

  it('handles non-numeric IDs with string fallback', () => {
    const items = [
      makeItem({ rowId: 1, id: 'ABC-10' }),
      makeItem({ rowId: 2, id: 'ABC-2' }),
      makeItem({ rowId: 3, id: 'ABC-1' }),
    ];
    const tree = buildTree(items, items, 'task');
    const sorted = sortTree(tree, [{ column: 'id', direction: 'asc' }]);
    expect(sorted.map((t) => t.item.id)).toEqual(['ABC-1', 'ABC-10', 'ABC-2']);
  });
});
