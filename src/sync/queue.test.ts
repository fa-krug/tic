import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { SyncQueueStore } from './queue.js';

describe('SyncQueueStore', () => {
  let tmpDir: string;
  let store: SyncQueueStore;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic'), { recursive: true });
    store = new SyncQueueStore(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns empty queue when file does not exist', async () => {
    const queue = await store.read();
    expect(queue.pending).toEqual([]);
  });

  it('appends an entry', async () => {
    await store.append({
      action: 'create',
      itemId: '1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    const queue = await store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.itemId).toBe('1');
  });

  it('collapses duplicate entries for same itemId and action', async () => {
    await store.append({
      action: 'update',
      itemId: '1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.append({
      action: 'update',
      itemId: '1',
      timestamp: '2026-01-01T01:00:00Z',
    });
    const queue = await store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.timestamp).toBe('2026-01-01T01:00:00Z');
  });

  it('does not collapse entries with different actions', async () => {
    await store.append({
      action: 'create',
      itemId: '1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.append({
      action: 'update',
      itemId: '1',
      timestamp: '2026-01-01T01:00:00Z',
    });
    const queue = await store.read();
    expect(queue.pending).toHaveLength(2);
  });

  it('removes an entry by itemId and action', async () => {
    await store.append({
      action: 'create',
      itemId: '1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.append({
      action: 'update',
      itemId: '2',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.remove('1', 'create');
    const queue = await store.read();
    expect(queue.pending).toHaveLength(1);
    expect(queue.pending[0]!.itemId).toBe('2');
  });

  it('clears all entries', async () => {
    await store.append({
      action: 'create',
      itemId: '1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.append({
      action: 'update',
      itemId: '2',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.clear();
    const queue = await store.read();
    expect(queue.pending).toEqual([]);
  });

  it('handles corrupt file gracefully', async () => {
    fs.writeFileSync(path.join(tmpDir, '.tic', 'sync-queue.json'), 'not json');
    const queue = await store.read();
    expect(queue.pending).toEqual([]);
  });

  it('renames an itemId across all pending entries', async () => {
    await store.append({
      action: 'create',
      itemId: 'local-1',
      timestamp: '2026-01-01T00:00:00Z',
    });
    await store.append({
      action: 'update',
      itemId: 'local-1',
      timestamp: '2026-01-01T01:00:00Z',
    });
    await store.renameItem('local-1', '42');
    const queue = await store.read();
    expect(queue.pending.every((e) => e.itemId === '42')).toBe(true);
  });
});
