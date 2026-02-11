import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';
import {
  pushUndoEntry,
  popUndoEntry,
  readUndoStack,
  clearUndoStack,
} from './undo.js';
import type { UndoEntry } from '../stores/undoStore.js';

function makeEntry(overrides?: Partial<UndoEntry>): UndoEntry {
  return {
    type: 'delete',
    label: 'Delete item #1',
    itemSnapshots: [
      {
        id: '1',
        title: 'Test',
        type: 'issue',
        status: 'open',
        description: 'desc',
        iteration: '',
        priority: '' as 'low' | 'medium' | 'high' | 'critical',
        assignee: '',
        labels: ['bug'],
        parent: null,
        dependsOn: ['2'],
        comments: [],
        created: '2025-01-01T00:00:00Z',
        updated: '2025-01-01T00:00:00Z',
      },
    ],
    syncItemIds: ['1'],
    syncAction: 'delete',
    ...overrides,
  };
}

describe('undo persistence', () => {
  let db: TicDatabase;

  beforeEach(() => {
    db = createDatabase(':memory:');
    Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  it('push and pop round-trip', () => {
    const entry = makeEntry();
    pushUndoEntry(db, entry);
    const popped = popUndoEntry(db);
    expect(popped).toBeDefined();
    expect(popped!.type).toBe('delete');
    expect(popped!.label).toBe('Delete item #1');
    expect(popped!.itemSnapshots).toHaveLength(1);
    expect(popped!.itemSnapshots[0]!.title).toBe('Test');
    expect(popped!.itemSnapshots[0]!.labels).toEqual(['bug']);
    expect(popped!.itemSnapshots[0]!.dependsOn).toEqual(['2']);
    expect(popped!.syncItemIds).toEqual(['1']);
    expect(popped!.syncAction).toBe('delete');
  });

  it('respects max depth of 5', () => {
    for (let i = 0; i < 6; i++) {
      pushUndoEntry(db, makeEntry({ label: `Entry ${i}` }));
    }
    const stack = readUndoStack(db);
    expect(stack).toHaveLength(5);
    // Oldest entry (Entry 0) should be evicted
    expect(stack.map((e) => e.label)).not.toContain('Entry 0');
    expect(stack[0]!.label).toBe('Entry 5'); // Most recent first
  });

  it('push returns evicted entry when at max depth', () => {
    for (let i = 0; i < 5; i++) {
      pushUndoEntry(db, makeEntry({ label: `Entry ${i}` }));
    }
    const evicted = pushUndoEntry(db, makeEntry({ label: 'Entry 5' }));
    expect(evicted).toBeDefined();
    expect(evicted!.label).toBe('Entry 0');
  });

  it('pop returns undefined when empty', () => {
    const popped = popUndoEntry(db);
    expect(popped).toBeUndefined();
  });

  it('clear returns previous stack', () => {
    pushUndoEntry(db, makeEntry({ label: 'A' }));
    pushUndoEntry(db, makeEntry({ label: 'B' }));
    const cleared = clearUndoStack(db);
    expect(cleared).toHaveLength(2);
    expect(cleared[0]!.label).toBe('B'); // Most recent first
    const stack = readUndoStack(db);
    expect(stack).toHaveLength(0);
  });

  it('stores and restores item snapshot with labels and deps', () => {
    const entry = makeEntry({
      itemSnapshots: [
        {
          id: '42',
          title: 'Complex item',
          type: 'bug',
          status: 'in-progress',
          description: 'A detailed description',
          iteration: 'v2',
          priority: 'high',
          assignee: 'alice',
          labels: ['bug', 'ux', 'critical'],
          parent: '10',
          dependsOn: ['5', '6', '7'],
          comments: [],
          created: '2025-06-01T00:00:00Z',
          updated: '2025-06-15T00:00:00Z',
        },
      ],
    });
    pushUndoEntry(db, entry);
    const popped = popUndoEntry(db);
    const snap = popped!.itemSnapshots[0]!;
    expect(snap.id).toBe('42');
    expect(snap.labels).toEqual(['bug', 'ux', 'critical']);
    expect(snap.dependsOn).toEqual(['5', '6', '7']);
    expect(snap.parent).toBe('10');
    expect(snap.priority).toBe('high');
    expect(snap.assignee).toBe('alice');
  });

  it('handles entry with multiple snapshots (bulk delete)', () => {
    const entry = makeEntry({
      label: 'Delete 3 items',
      itemSnapshots: [
        {
          id: '1',
          title: 'Item 1',
          type: 'issue',
          status: 'open',
          description: '',
          iteration: '',
          priority: '' as 'low' | 'medium' | 'high' | 'critical',
          assignee: '',
          labels: [],
          parent: null,
          dependsOn: [],
          comments: [],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
        {
          id: '2',
          title: 'Item 2',
          type: 'bug',
          status: 'closed',
          description: '',
          iteration: '',
          priority: '' as 'low' | 'medium' | 'high' | 'critical',
          assignee: '',
          labels: ['a'],
          parent: null,
          dependsOn: [],
          comments: [],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
        {
          id: '3',
          title: 'Item 3',
          type: 'task',
          status: 'open',
          description: '',
          iteration: '',
          priority: '' as 'low' | 'medium' | 'high' | 'critical',
          assignee: '',
          labels: [],
          parent: '1',
          dependsOn: ['2'],
          comments: [],
          created: '2025-01-01T00:00:00Z',
          updated: '2025-01-01T00:00:00Z',
        },
      ],
      syncItemIds: ['1', '2', '3'],
    });
    pushUndoEntry(db, entry);
    const popped = popUndoEntry(db);
    expect(popped!.itemSnapshots).toHaveLength(3);
    expect(popped!.itemSnapshots[0]!.title).toBe('Item 1');
    expect(popped!.itemSnapshots[2]!.parent).toBe('1');
    expect(popped!.itemSnapshots[2]!.dependsOn).toEqual(['2']);
  });

  it('handles createdIds field', () => {
    const entry = makeEntry({
      type: 'create',
      syncAction: 'create',
      createdIds: ['1', '2'],
    });
    pushUndoEntry(db, entry);
    const popped = popUndoEntry(db);
    expect(popped!.createdIds).toEqual(['1', '2']);
  });
});
