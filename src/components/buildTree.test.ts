import { describe, it, expect } from 'vitest';
import { buildTree } from './buildTree.js';
import type { WorkItem } from '../types.js';

function makeItem(overrides: Partial<WorkItem> & { id: string }): WorkItem {
  return {
    title: `Item ${overrides.id}`,
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
    const items = [makeItem({ id: '1' }), makeItem({ id: '2' })];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result.every((t) => t.depth === 0)).toBe(true);
    expect(result.every((t) => !t.isCrossType)).toBe(true);
    expect(result.every((t) => !t.hasChildren)).toBe(true);
  });

  it('nests same-type children under parent', () => {
    const items = [makeItem({ id: '1' }), makeItem({ id: '2', parent: '1' })];
    const result = buildTree(items, items, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result[0]!.depth).toBe(0);
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[1]!.prefix).toBe('└─');
    expect(result[1]!.isCrossType).toBe(false);
  });

  it('pulls in cross-type children from allItems', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const filteredItems = [task]; // only tasks
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2']);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[1]!.depth).toBe(1);
    expect(result[0]!.hasChildren).toBe(true);
  });

  it('does not show cross-type items as roots', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug' }); // no parent, different type
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1']);
  });

  it('recursively includes cross-type grandchildren', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const subtask = makeItem({ id: '3', type: 'task', parent: '2' });
    const filteredItems = [task, subtask]; // subtask is same type but child of bug
    const allItems = [task, bug, subtask];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result.map((t) => t.item.id)).toEqual(['1', '2', '3']);
    expect(result[1]!.isCrossType).toBe(true);
    expect(result[2]!.isCrossType).toBe(false);
    expect(result[2]!.depth).toBe(2);
  });

  it('marks hasChildren correctly for items whose children are all cross-type', () => {
    const task = makeItem({ id: '1', type: 'task' });
    const bug = makeItem({ id: '2', type: 'bug', parent: '1' });
    const filteredItems = [task];
    const allItems = [task, bug];
    const result = buildTree(filteredItems, allItems, 'task');
    expect(result[0]!.hasChildren).toBe(true);
    expect(result[1]!.hasChildren).toBe(false);
  });
});
