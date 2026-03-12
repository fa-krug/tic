import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';
import { SyncQueue } from './syncQueue.js';
import type { QueueEntry } from '../sync/types.js';

function makeEntry(overrides?: Partial<QueueEntry>): QueueEntry {
  return {
    action: 'create',
    itemRowId: 1,
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('SyncQueue', () => {
  let db: TicDatabase;
  let queue: SyncQueue;

  beforeEach(() => {
    db = createDatabase(':memory:');
    Storage.createFromDb(db);
    queue = new SyncQueue(db);
  });

  afterEach(() => {
    db.close();
  });

  it('read returns empty queue initially', () => {
    const result = queue.read();
    expect(result.pending).toEqual([]);
  });

  it('append and read round-trip', () => {
    const entry = makeEntry();
    queue.append(entry);
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.action).toBe('create');
    expect(result.pending[0]!.itemRowId).toBe(1);
    expect(result.pending[0]!.timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('deduplicates by itemRowId and action', () => {
    queue.append(makeEntry({ timestamp: 'old' }));
    queue.append(makeEntry({ timestamp: 'new' }));
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.timestamp).toBe('new');
  });

  it('does not deduplicate different actions', () => {
    queue.append(makeEntry({ action: 'create' }));
    queue.append(makeEntry({ action: 'update' }));
    const result = queue.read();
    expect(result.pending).toHaveLength(2);
  });

  it('stores and retrieves commentData', () => {
    queue.append(
      makeEntry({
        action: 'comment',
        commentData: { author: 'alice', body: 'Hello world' },
      }),
    );
    const result = queue.read();
    expect(result.pending[0]!.commentData).toEqual({
      author: 'alice',
      body: 'Hello world',
    });
  });

  it('stores and retrieves templateSlug', () => {
    queue.append(
      makeEntry({
        action: 'template-create',
        templateSlug: 'bug-report',
      }),
    );
    const result = queue.read();
    expect(result.pending[0]!.templateSlug).toBe('bug-report');
  });

  it('remove deletes matching entry', () => {
    queue.append(makeEntry({ itemRowId: 1, action: 'create' }));
    queue.append(makeEntry({ itemRowId: 2, action: 'update' }));
    queue.remove(1, 'create');
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemRowId).toBe(2);
  });

  it('removeByRowIds batch deletes and returns count', () => {
    queue.append(makeEntry({ itemRowId: 1, action: 'delete' }));
    queue.append(makeEntry({ itemRowId: 2, action: 'delete' }));
    queue.append(makeEntry({ itemRowId: 3, action: 'delete' }));
    const removed = queue.removeByRowIds([1, 3], 'delete');
    expect(removed).toBe(2);
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemRowId).toBe(2);
  });

  it('removeByRowIds with empty array returns 0', () => {
    queue.append(makeEntry());
    const removed = queue.removeByRowIds([], 'create');
    expect(removed).toBe(0);
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
  });

  it('removeByRowIds returns 0 when no matching entries', () => {
    queue.append(makeEntry({ itemRowId: 1, action: 'create' }));
    const removed = queue.removeByRowIds([1], 'delete');
    expect(removed).toBe(0);
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
  });

  it('claimNext atomically removes entry', () => {
    queue.append(makeEntry({ itemRowId: 1 }));
    queue.append(makeEntry({ itemRowId: 2, action: 'update' }));
    const claimed = queue.claimNext();
    expect(claimed).toBeDefined();
    expect(claimed!.itemRowId).toBe(1);
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemRowId).toBe(2);
  });

  it('claimNext returns null when empty', () => {
    const claimed = queue.claimNext();
    expect(claimed).toBeNull();
  });

  it('clear removes all entries', () => {
    queue.append(makeEntry({ itemRowId: 1 }));
    queue.append(makeEntry({ itemRowId: 2, action: 'update' }));
    queue.clear();
    const result = queue.read();
    expect(result.pending).toEqual([]);
  });

  it('preserves insertion order', () => {
    queue.append(makeEntry({ itemRowId: 3, action: 'create' }));
    queue.append(makeEntry({ itemRowId: 1, action: 'update' }));
    queue.append(makeEntry({ itemRowId: 2, action: 'delete' }));
    const result = queue.read();
    expect(result.pending.map((e) => e.itemRowId)).toEqual([3, 1, 2]);
  });
});
