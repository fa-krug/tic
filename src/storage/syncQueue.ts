import { eq, and, inArray, asc } from 'drizzle-orm';
import type { TicDatabase } from './db.js';
import type {
  QueueAction,
  QueueEntry,
  SyncQueueData,
  SyncQueueAdapter,
} from '../sync/types.js';
import * as s from './schema.js';

export class SyncQueue implements SyncQueueAdapter {
  db: TicDatabase;

  constructor(db: TicDatabase) {
    this.db = db;
  }

  read(): SyncQueueData {
    const rows = this.db
      .select()
      .from(s.syncQueue)
      .orderBy(asc(s.syncQueue.id))
      .all();
    return {
      pending: rows.map((row) => ({
        action: row.action as QueueAction,
        itemRowId: row.itemRowId,
        timestamp: row.timestamp,
        ...(row.commentData
          ? {
              commentData: JSON.parse(row.commentData) as {
                author: string;
                body: string;
              },
            }
          : {}),
        ...(row.templateSlug ? { templateSlug: row.templateSlug } : {}),
      })),
    };
  }

  append(entry: QueueEntry): void {
    // Deduplicate: delete existing with same itemRowId + action, then insert
    this.db
      .delete(s.syncQueue)
      .where(
        and(
          eq(s.syncQueue.itemRowId, entry.itemRowId),
          eq(s.syncQueue.action, entry.action),
        ),
      )
      .run();

    this.db
      .insert(s.syncQueue)
      .values({
        action: entry.action,
        itemRowId: entry.itemRowId,
        timestamp: entry.timestamp,
        commentData: entry.commentData
          ? JSON.stringify(entry.commentData)
          : null,
        templateSlug: entry.templateSlug ?? null,
      })
      .run();
  }

  remove(itemRowId: number, action: QueueAction): void {
    this.db
      .delete(s.syncQueue)
      .where(
        and(
          eq(s.syncQueue.itemRowId, itemRowId),
          eq(s.syncQueue.action, action),
        ),
      )
      .run();
  }

  removeByRowIds(itemRowIds: number[], action: QueueAction): number {
    if (itemRowIds.length === 0) return 0;
    const result = this.db
      .delete(s.syncQueue)
      .where(
        and(
          inArray(s.syncQueue.itemRowId, itemRowIds),
          eq(s.syncQueue.action, action),
        ),
      )
      .run();
    return result.changes;
  }

  clear(): void {
    this.db.delete(s.syncQueue).run();
  }

  claimNext(): QueueEntry | null {
    // Atomic SELECT + DELETE in a transaction
    return this.db.transaction((tx) => {
      const rows = tx
        .select()
        .from(s.syncQueue)
        .orderBy(asc(s.syncQueue.id))
        .limit(1)
        .all();
      if (rows.length === 0) return null;
      const row = rows[0]!;
      tx.delete(s.syncQueue).where(eq(s.syncQueue.id, row.id)).run();
      return {
        action: row.action as QueueAction,
        itemRowId: row.itemRowId,
        timestamp: row.timestamp,
        ...(row.commentData
          ? {
              commentData: JSON.parse(row.commentData) as {
                author: string;
                body: string;
              },
            }
          : {}),
        ...(row.templateSlug ? { templateSlug: row.templateSlug } : {}),
      };
    });
  }
}
