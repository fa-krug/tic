import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import type { TicDatabase } from '../drizzle/db.js';
import * as s from '../drizzle/schema.js';
import { listItemFiles } from '../local/items.js';
import { contentHash } from './hash.js';

/**
 * Extract the item ID from a full file path like `/foo/.tic/items/42.md`.
 */
function idFromPath(filePath: string): string {
  return path.basename(filePath, '.md');
}

/** Compute content hashes for all .tic/items/*.md files on disk. */
export async function computeFileHashes(
  root: string,
): Promise<Map<string, string>> {
  const files = await listItemFiles(root);
  const hashes = new Map<string, string>();
  for (const file of files) {
    const id = idFromPath(file);
    const raw = await fs.readFile(file, 'utf-8');
    hashes.set(id, contentHash(raw));
  }
  return hashes;
}

/** Detect which files changed, were added, or were deleted since last sync. */
export async function detectChanges(
  db: TicDatabase,
  root: string,
): Promise<{
  changed: string[];
  added: string[];
  deleted: string[];
}> {
  const currentHashes = await computeFileHashes(root);

  // Get stored hashes from the file_sync_state table
  const rows = db.select().from(s.fileSyncState).all();
  const storedHashes = new Map<string, string>();
  for (const row of rows) {
    storedHashes.set(row.itemId, row.hash);
  }

  const changed: string[] = [];
  const added: string[] = [];
  const deleted: string[] = [];

  // Check current files against stored
  for (const [id, hash] of currentHashes) {
    const stored = storedHashes.get(id);
    if (!stored) {
      added.push(id);
    } else if (stored !== hash) {
      changed.push(id);
    }
  }

  // Check stored against current for deletions
  for (const [id] of storedHashes) {
    if (!currentHashes.has(id)) {
      deleted.push(id);
    }
  }

  return { changed, added, deleted };
}

/** Update the stored hash for an item (upsert). */
export function updateSyncState(
  db: TicDatabase,
  itemId: string,
  hash: string,
): void {
  const now = new Date().toISOString();
  db.insert(s.fileSyncState)
    .values({ itemId, hash, syncedAt: now })
    .onConflictDoUpdate({
      target: s.fileSyncState.itemId,
      set: { hash, syncedAt: now },
    })
    .run();
}

/** Remove the stored hash for an item. */
export function removeSyncState(db: TicDatabase, itemId: string): void {
  db.delete(s.fileSyncState).where(eq(s.fileSyncState.itemId, itemId)).run();
}
