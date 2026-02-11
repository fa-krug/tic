import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { DrizzleBackend } from './index.js';
import { DrizzleSyncQueue } from './syncQueue.js';
import type { QueueEntry } from '../../sync/types.js';

function makeEntry(overrides?: Partial<QueueEntry>): QueueEntry {
  return {
    action: 'create',
    itemId: '1',
    timestamp: '2025-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('DrizzleSyncQueue', () => {
  let db: TicDatabase;
  let queue: DrizzleSyncQueue;

  beforeEach(() => {
    db = createDatabase(':memory:');
    DrizzleBackend.createFromDb(db);
    queue = new DrizzleSyncQueue(db);
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
    expect(result.pending[0]!.itemId).toBe('1');
    expect(result.pending[0]!.timestamp).toBe('2025-01-01T00:00:00Z');
  });

  it('deduplicates by itemId and action', () => {
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
    queue.append(makeEntry({ itemId: '1', action: 'create' }));
    queue.append(makeEntry({ itemId: '2', action: 'update' }));
    queue.remove('1', 'create');
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemId).toBe('2');
  });

  it('removeByIds batch deletes', () => {
    queue.append(makeEntry({ itemId: '1', action: 'delete' }));
    queue.append(makeEntry({ itemId: '2', action: 'delete' }));
    queue.append(makeEntry({ itemId: '3', action: 'delete' }));
    queue.removeByIds(['1', '3'], 'delete');
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemId).toBe('2');
  });

  it('removeByIds with empty array is no-op', () => {
    queue.append(makeEntry());
    queue.removeByIds([], 'create');
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
  });

  it('renameItem updates itemId', () => {
    queue.append(makeEntry({ itemId: 'local-1', action: 'create' }));
    queue.append(makeEntry({ itemId: 'local-1', action: 'update' }));
    queue.renameItem('local-1', '42');
    const result = queue.read();
    expect(result.pending).toHaveLength(2);
    expect(result.pending.every((e) => e.itemId === '42')).toBe(true);
  });

  it('claimNext atomically removes entry', () => {
    queue.append(makeEntry({ itemId: '1' }));
    queue.append(makeEntry({ itemId: '2', action: 'update' }));
    const claimed = queue.claimNext();
    expect(claimed).toBeDefined();
    expect(claimed!.itemId).toBe('1');
    const result = queue.read();
    expect(result.pending).toHaveLength(1);
    expect(result.pending[0]!.itemId).toBe('2');
  });

  it('claimNext returns null when empty', () => {
    const claimed = queue.claimNext();
    expect(claimed).toBeNull();
  });

  it('clear removes all entries', () => {
    queue.append(makeEntry({ itemId: '1' }));
    queue.append(makeEntry({ itemId: '2', action: 'update' }));
    queue.clear();
    const result = queue.read();
    expect(result.pending).toEqual([]);
  });

  it('preserves insertion order', () => {
    queue.append(makeEntry({ itemId: '3', action: 'create' }));
    queue.append(makeEntry({ itemId: '1', action: 'update' }));
    queue.append(makeEntry({ itemId: '2', action: 'delete' }));
    const result = queue.read();
    expect(result.pending.map((e) => e.itemId)).toEqual(['3', '1', '2']);
  });
});
