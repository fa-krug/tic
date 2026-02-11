import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, type TicDatabase } from '../drizzle/db.js';
import { DrizzleBackend } from '../drizzle/index.js';
import { writeWorkItem, readWorkItem } from '../local/items.js';
import { contentHash } from './hash.js';
import {
  computeFileHashes,
  detectChanges,
  updateSyncState,
  removeSyncState,
} from './sync.js';
import type { WorkItem } from '../../types.js';

function makeItem(overrides: Partial<WorkItem> = {}): WorkItem {
  return {
    id: '1',
    title: 'Test item',
    type: 'issue',
    status: 'open',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: [],
    created: '2025-01-01T00:00:00.000Z',
    updated: '2025-01-01T00:00:00.000Z',
    description: 'A test item',
    comments: [],
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('file sync detection', () => {
  let tmpDir: string;
  let db: TicDatabase;
  let backend: DrizzleBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-sync-'));
    fs.mkdirSync(path.join(tmpDir, '.tic', 'items'), { recursive: true });

    db = createDatabase(':memory:');
    backend = DrizzleBackend.createFromDb(db);
  });

  afterEach(() => {
    backend.destroy();
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('computes hashes for files on disk', async () => {
    await writeWorkItem(tmpDir, makeItem({ id: '1' }));
    await writeWorkItem(tmpDir, makeItem({ id: '2', title: 'Second' }));

    const hashes = await computeFileHashes(tmpDir);
    expect(hashes.size).toBe(2);
    expect(hashes.has('1')).toBe(true);
    expect(hashes.has('2')).toBe(true);
    // Hashes should be hex strings
    expect(hashes.get('1')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('detects no changes when hashes match', async () => {
    await writeWorkItem(tmpDir, makeItem({ id: '1' }));

    // Read the file content and compute the hash to store
    const filePath = path.join(tmpDir, '.tic', 'items', '1.md');
    const raw = fs.readFileSync(filePath, 'utf-8');
    const hash = contentHash(raw);
    updateSyncState(db, '1', hash);

    const result = await detectChanges(db, tmpDir);
    expect(result.changed).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('detects changed file (hash mismatch)', async () => {
    await writeWorkItem(tmpDir, makeItem({ id: '1' }));

    // Store an outdated hash
    updateSyncState(db, '1', 'old-hash-that-does-not-match');

    const result = await detectChanges(db, tmpDir);
    expect(result.changed).toEqual(['1']);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('detects new file (no hash entry)', async () => {
    await writeWorkItem(tmpDir, makeItem({ id: '1' }));
    // No sync state stored for item 1

    const result = await detectChanges(db, tmpDir);
    expect(result.added).toEqual(['1']);
    expect(result.changed).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('detects deleted file (hash entry but no file)', async () => {
    // Store a hash for an item that does not exist on disk
    updateSyncState(db, '99', 'some-hash');

    const result = await detectChanges(db, tmpDir);
    expect(result.deleted).toEqual(['99']);
    expect(result.changed).toEqual([]);
    expect(result.added).toEqual([]);
  });

  it('detects mixed changes (added, changed, deleted)', async () => {
    // Item 1: on disk, matching hash (no change)
    await writeWorkItem(tmpDir, makeItem({ id: '1' }));
    const file1 = path.join(tmpDir, '.tic', 'items', '1.md');
    const raw1 = fs.readFileSync(file1, 'utf-8');
    updateSyncState(db, '1', contentHash(raw1));

    // Item 2: on disk, stale hash (changed)
    await writeWorkItem(tmpDir, makeItem({ id: '2', title: 'Changed' }));
    updateSyncState(db, '2', 'stale-hash');

    // Item 3: on disk, no hash entry (added)
    await writeWorkItem(tmpDir, makeItem({ id: '3', title: 'New' }));

    // Item 4: hash entry, no file (deleted)
    updateSyncState(db, '4', 'orphan-hash');

    const result = await detectChanges(db, tmpDir);
    expect(result.changed).toEqual(['2']);
    expect(result.added).toEqual(['3']);
    expect(result.deleted).toEqual(['4']);
  });

  it('updateSyncState upserts correctly', () => {
    updateSyncState(db, 'x', 'hash-v1');

    // Verify it was inserted
    const raw1 = db.raw
      .prepare('SELECT * FROM file_sync_state WHERE item_id = ?')
      .get('x') as { item_id: string; hash: string; synced_at: string };
    expect(raw1.hash).toBe('hash-v1');

    // Update it
    updateSyncState(db, 'x', 'hash-v2');
    const raw2 = db.raw
      .prepare('SELECT * FROM file_sync_state WHERE item_id = ?')
      .get('x') as { item_id: string; hash: string; synced_at: string };
    expect(raw2.hash).toBe('hash-v2');

    // Should still be only one row
    const count = db.raw
      .prepare('SELECT COUNT(*) as cnt FROM file_sync_state WHERE item_id = ?')
      .get('x') as { cnt: number };
    expect(count.cnt).toBe(1);
  });

  it('removeSyncState deletes the entry', () => {
    updateSyncState(db, 'y', 'some-hash');

    // Verify exists
    const before = db.raw
      .prepare('SELECT COUNT(*) as cnt FROM file_sync_state WHERE item_id = ?')
      .get('y') as { cnt: number };
    expect(before.cnt).toBe(1);

    removeSyncState(db, 'y');

    const after = db.raw
      .prepare('SELECT COUNT(*) as cnt FROM file_sync_state WHERE item_id = ?')
      .get('y') as { cnt: number };
    expect(after.cnt).toBe(0);
  });

  it('removeSyncState is a no-op for non-existent entries', () => {
    // Should not throw
    removeSyncState(db, 'nonexistent');
  });

  it('returns empty results when no files and no stored hashes', async () => {
    const result = await detectChanges(db, tmpDir);
    expect(result.changed).toEqual([]);
    expect(result.added).toEqual([]);
    expect(result.deleted).toEqual([]);
  });

  it('serialization round-trip produces stable hash', async () => {
    // Write item → hash → read → re-serialize → hash again → must match
    const item = makeItem({
      id: '42',
      title: 'Round-trip test',
      labels: ['bug', 'urgent'],
      parent: '1',
      dependsOn: ['2', '3'],
      description: 'A description\nwith multiple lines',
    });

    await writeWorkItem(tmpDir, item);

    // Hash the written file
    const filePath = path.join(tmpDir, '.tic', 'items', '42.md');
    const raw1 = fs.readFileSync(filePath, 'utf-8');
    const hash1 = contentHash(raw1);

    // Read back, then re-write
    const readBack = await readWorkItem(tmpDir, '42');
    await writeWorkItem(tmpDir, readBack);

    // Hash again
    const raw2 = fs.readFileSync(filePath, 'utf-8');
    const hash2 = contentHash(raw2);

    expect(hash1).toBe(hash2);
  });
});
