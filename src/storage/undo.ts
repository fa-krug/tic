import { eq, desc } from 'drizzle-orm';
import type { TicDatabase } from './db.js';
import type { UndoEntry, UndoActionType } from '../stores/undoStore.js';
import type { QueueAction } from '../sync/types.js';
import type { WorkItem } from '../types.js';
import * as s from './schema.js';

const MAX_DEPTH = 5;

/**
 * Metadata stored as JSON in the undoStack.itemId column.
 * The undoItemSnapshot tables are NOT used — all snapshots are
 * serialized into this JSON blob so we can handle bulk operations
 * (multiple snapshots per undo entry) without schema changes.
 */
interface UndoMetadata {
  label: string;
  syncItemIds: string[];
  syncAction: QueueAction;
  createdIds?: string[];
  itemSnapshots: SerializedSnapshot[];
}

interface SerializedSnapshot {
  id: string;
  title: string;
  type: string;
  status: string;
  description: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string[];
  parent: string | null;
  dependsOn: string[];
  created: string;
  updated: string;
}

function serializeSnapshots(items: WorkItem[]): SerializedSnapshot[] {
  return items.map((snap) => ({
    id: snap.id,
    title: snap.title,
    type: snap.type,
    status: snap.status,
    description: snap.description,
    iteration: snap.iteration,
    priority: snap.priority,
    assignee: snap.assignee,
    labels: snap.labels,
    parent: snap.parent,
    dependsOn: snap.dependsOn,
    created: snap.created,
    updated: snap.updated,
    // comments are intentionally omitted from undo snapshots
  }));
}

function deserializeSnapshots(snapshots: SerializedSnapshot[]): WorkItem[] {
  return snapshots.map((snap) => ({
    ...snap,
    priority: snap.priority as WorkItem['priority'],
    comments: [],
  }));
}

function reconstructEntry(row: { action: string; itemId: string }): UndoEntry {
  const meta = JSON.parse(row.itemId) as UndoMetadata;
  return {
    type: row.action as UndoActionType,
    label: meta.label,
    syncItemIds: meta.syncItemIds,
    syncAction: meta.syncAction,
    createdIds: meta.createdIds,
    itemSnapshots: deserializeSnapshots(meta.itemSnapshots),
  };
}

/**
 * Push an undo entry onto the persistent stack.
 * If the stack exceeds MAX_DEPTH, the oldest entry is evicted and returned.
 */
export function pushUndoEntry(
  db: TicDatabase,
  entry: UndoEntry,
): UndoEntry | undefined {
  const metadata: UndoMetadata = {
    label: entry.label,
    syncItemIds: entry.syncItemIds,
    syncAction: entry.syncAction,
    createdIds: entry.createdIds,
    itemSnapshots: serializeSnapshots(entry.itemSnapshots),
  };

  let evicted: UndoEntry | undefined;

  db.transaction((tx) => {
    tx.insert(s.undoStack)
      .values({
        action: entry.type,
        itemId: JSON.stringify(metadata),
        createdAt: new Date().toISOString(),
      })
      .run();

    // Read all rows ordered newest-first to check depth
    const rows = tx
      .select()
      .from(s.undoStack)
      .orderBy(desc(s.undoStack.id))
      .all();

    if (rows.length > MAX_DEPTH) {
      const toEvict = rows.slice(MAX_DEPTH);
      // Reconstruct the oldest evicted entry before deleting
      evicted = reconstructEntry(toEvict[0]!);
      for (const row of toEvict) {
        tx.delete(s.undoStack).where(eq(s.undoStack.id, row.id)).run();
      }
    }
  });

  return evicted;
}

/**
 * Pop the most recent undo entry from the stack.
 * Returns undefined if the stack is empty.
 */
export function popUndoEntry(db: TicDatabase): UndoEntry | undefined {
  let result: UndoEntry | undefined;

  db.transaction((tx) => {
    const row = tx
      .select()
      .from(s.undoStack)
      .orderBy(desc(s.undoStack.id))
      .limit(1)
      .get();

    if (!row) return;

    result = reconstructEntry(row);
    tx.delete(s.undoStack).where(eq(s.undoStack.id, row.id)).run();
  });

  return result;
}

/**
 * Read the entire undo stack without modifying it.
 * Returns entries ordered most-recent first.
 */
export function readUndoStack(db: TicDatabase): UndoEntry[] {
  const rows = db
    .select()
    .from(s.undoStack)
    .orderBy(desc(s.undoStack.id))
    .all();

  return rows.map(reconstructEntry);
}

/**
 * Clear the undo stack, returning all entries that were removed.
 * Returns entries ordered most-recent first.
 */
export function clearUndoStack(db: TicDatabase): UndoEntry[] {
  let entries: UndoEntry[] = [];

  db.transaction((tx) => {
    const rows = tx
      .select()
      .from(s.undoStack)
      .orderBy(desc(s.undoStack.id))
      .all();

    entries = rows.map(reconstructEntry);

    if (rows.length > 0) {
      tx.delete(s.undoStack).run();
    }
  });

  return entries;
}
