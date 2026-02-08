import { describe, it, expect, beforeEach } from 'vitest';
import type { WorkItem } from '../types.js';
import type { UndoEntry } from './undoStore.js';
import { undoStore } from './undoStore.js';

const makeSnapshot = (id: string): WorkItem => ({
  id,
  title: `Item ${id}`,
  type: 'issue',
  status: 'todo',
  iteration: '',
  priority: 'medium',
  assignee: '',
  labels: [],
  created: '2026-01-01',
  updated: '2026-01-01',
  parent: null,
  dependsOn: [],
  description: '',
  comments: [],
});

const makeEntry = (
  id: string,
  type: UndoEntry['type'] = 'delete',
): UndoEntry => ({
  type,
  label: `Undo ${type} item ${id}`,
  itemSnapshots: [makeSnapshot(id)],
  syncItemIds: [id],
  syncAction: type,
});

describe('undoStore', () => {
  beforeEach(() => {
    undoStore.getState().clear();
  });

  it('starts with an empty stack', () => {
    expect(undoStore.getState().stack).toEqual([]);
  });

  it('pushUndo adds to front of stack', () => {
    const entry1 = makeEntry('1');
    const entry2 = makeEntry('2');

    undoStore.getState().pushUndo(entry1);
    undoStore.getState().pushUndo(entry2);

    const { stack } = undoStore.getState();
    expect(stack).toHaveLength(2);
    expect(stack[0]).toBe(entry2);
    expect(stack[1]).toBe(entry1);
  });

  it('pushUndo returns undefined when stack is not full', () => {
    const result = undoStore.getState().pushUndo(makeEntry('1'));
    expect(result).toBeUndefined();
  });

  it('popUndo returns most recent and removes it', () => {
    const entry1 = makeEntry('1');
    const entry2 = makeEntry('2');

    undoStore.getState().pushUndo(entry1);
    undoStore.getState().pushUndo(entry2);

    const popped = undoStore.getState().popUndo();
    expect(popped).toBe(entry2);
    expect(undoStore.getState().stack).toHaveLength(1);
    expect(undoStore.getState().stack[0]).toBe(entry1);
  });

  it('popUndo returns undefined when empty', () => {
    const result = undoStore.getState().popUndo();
    expect(result).toBeUndefined();
  });

  it('enforces max depth of 5 and returns evicted entry', () => {
    // Fill the stack with 5 entries
    for (let i = 1; i <= 5; i++) {
      const result = undoStore.getState().pushUndo(makeEntry(String(i)));
      expect(result).toBeUndefined();
    }

    expect(undoStore.getState().stack).toHaveLength(5);

    // Push a 6th — should evict the oldest (entry "1")
    const entry6 = makeEntry('6');
    const evicted = undoStore.getState().pushUndo(entry6);

    expect(undoStore.getState().stack).toHaveLength(5);
    expect(evicted).toBeDefined();
    expect(evicted!.itemSnapshots[0]!.id).toBe('1');

    // Most recent should be entry6
    expect(undoStore.getState().stack[0]).toBe(entry6);
    // Oldest should be entry "2"
    expect(undoStore.getState().stack[4]!.itemSnapshots[0]!.id).toBe('2');
  });

  it('clear empties the stack and returns all entries', () => {
    const entry1 = makeEntry('1');
    const entry2 = makeEntry('2');
    const entry3 = makeEntry('3');

    undoStore.getState().pushUndo(entry1);
    undoStore.getState().pushUndo(entry2);
    undoStore.getState().pushUndo(entry3);

    const cleared = undoStore.getState().clear();

    expect(undoStore.getState().stack).toEqual([]);
    expect(cleared).toHaveLength(3);
    // Most recent first
    expect(cleared[0]).toBe(entry3);
    expect(cleared[1]).toBe(entry2);
    expect(cleared[2]).toBe(entry1);
  });
});
