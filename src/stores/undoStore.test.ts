import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { makeWorkItem } from '../test-helpers.js';
import type { UndoEntry } from './undoStore.js';
import { undoStore } from './undoStore.js';
import { createDatabase, type TicDatabase } from '../storage/db.js';
import { Storage } from '../storage/index.js';

const makeEntry = (
  id: string,
  type: UndoEntry['type'] = 'delete',
): UndoEntry => ({
  type,
  label: `Undo ${type} item ${id}`,
  itemSnapshots: [makeWorkItem(id)],
  syncItemIds: [id],
  syncAction: type,
});

describe('undoStore', () => {
  beforeEach(() => {
    undoStore.getState().destroy();
  });

  afterEach(() => {
    undoStore.getState().destroy();
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

describe('undoStore with SQLite backing', () => {
  let db: TicDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    Storage.createFromDb(db);
    undoStore.getState().setDatabase(db);
  });

  afterEach(() => {
    undoStore.getState().destroy();
    db.close();
  });

  it('push and pop with SQLite backing', () => {
    const entry = makeEntry('1');
    undoStore.getState().pushUndo(entry);
    expect(undoStore.getState().stack).toHaveLength(1);

    const popped = undoStore.getState().popUndo();
    expect(popped).toBeDefined();
    expect(popped!.label).toBe('Undo delete item 1');
    expect(undoStore.getState().stack).toHaveLength(0);
  });

  it('respects max depth with SQLite backing', () => {
    for (let i = 1; i <= 6; i++) {
      undoStore.getState().pushUndo(makeEntry(String(i)));
    }
    expect(undoStore.getState().stack).toHaveLength(5);
    expect(undoStore.getState().stack[0]!.label).toContain('6');
  });

  it('clear returns entries and empties stack', () => {
    undoStore.getState().pushUndo(makeEntry('1'));
    undoStore.getState().pushUndo(makeEntry('2'));
    const cleared = undoStore.getState().clear();
    expect(cleared).toHaveLength(2);
    expect(undoStore.getState().stack).toHaveLength(0);
  });

  it('recovers stack from DB on setDatabase', () => {
    undoStore.getState().pushUndo(makeEntry('1'));
    undoStore.getState().pushUndo(makeEntry('2'));

    // Simulate crash: destroy store, set new DB reference
    undoStore.getState().destroy();

    // Re-set the same DB — should recover the stack
    undoStore.getState().setDatabase(db);
    expect(undoStore.getState().stack).toHaveLength(2);
    expect(undoStore.getState().stack[0]!.label).toContain('2');
  });

  it('falls back to in-memory when no database set', () => {
    undoStore.getState().destroy();
    // No DB set, should work in-memory
    undoStore.getState().pushUndo(makeEntry('1'));
    expect(undoStore.getState().stack).toHaveLength(1);
    undoStore.getState().clear();
  });

  it('preserves item snapshots through SQLite round-trip', () => {
    const entry: UndoEntry = {
      type: 'delete',
      label: 'Delete complex',
      itemSnapshots: [
        {
          id: '42',
          title: 'Complex',
          type: 'bug',
          status: 'in-progress',
          description: 'desc',
          iteration: 'v2',
          priority: 'high',
          assignee: 'alice',
          labels: ['bug', 'ux'],
          parent: '10',
          dependsOn: ['5', '6'],
          comments: [],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-06-15T00:00:00Z',
        },
      ],
      syncItemIds: ['42'],
      syncAction: 'delete',
      createdIds: ['42'],
    };
    undoStore.getState().pushUndo(entry);
    const popped = undoStore.getState().popUndo();
    expect(popped!.itemSnapshots[0]!.labels).toEqual(['bug', 'ux']);
    expect(popped!.itemSnapshots[0]!.dependsOn).toEqual(['5', '6']);
    expect(popped!.createdIds).toEqual(['42']);
  });
});
