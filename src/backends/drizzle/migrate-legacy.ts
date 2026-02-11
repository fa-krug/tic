import fs from 'node:fs';
import path from 'node:path';
import type { TicDatabase, TicTransaction } from './db.js';
import * as schema from './schema.js';
import { insertConfigTx } from './config.js';
import { readConfigSync } from '../local/config.js';
import { parseWorkItemFile } from '../local/items.js';
import { parseTemplateFile } from '../local/templates.js';
import { contentHash } from '../files/hash.js';
import type { WorkItem } from '../../types.js';
import type { QueueEntry, SyncQueueData } from '../../sync/types.js';

/**
 * Migrate a legacy filesystem-based `.tic/` project into a SQLite database.
 *
 * All database writes happen inside a single transaction for atomicity.
 * The `.gitignore` update is a filesystem operation done after the transaction.
 *
 * Malformed `.md` files are skipped with a console.warn — they do not abort
 * the migration.
 */
export function migrateLegacyProject(root: string, db: TicDatabase): void {
  const ticDir = path.join(root, '.tic');

  // 1. Parse config
  const config = readConfigSync(root);

  // Map legacy 'local' backend name to 'filesystem'
  if (config.backend === 'local') {
    config.backend = 'filesystem';
  }

  // 2. Collect items, trash, templates, sync queue BEFORE the transaction
  //    so that parse errors in individual files can be skipped gracefully.
  const items = parseItemFiles(path.join(ticDir, 'items'));
  const trashItems = parseItemFiles(path.join(ticDir, 'trash'));
  const templates = parseTemplateFiles(path.join(ticDir, 'templates'));
  const syncEntries = parseSyncQueue(path.join(ticDir, 'sync-queue.json'));

  // Collect file hashes for items (not trash)
  const fileHashes = computeItemFileHashes(path.join(ticDir, 'items'));

  // 3. Write everything to the database in a single transaction
  db.transaction((tx) => {
    // --- Config tables ---
    insertConfigTx(tx, config);

    // --- Work items ---
    for (const item of items) {
      if (!isValidItem(item)) {
        console.warn(`Skipping item with missing required fields: ${item.id}`);
        continue;
      }
      insertWorkItem(tx, item, null);
    }

    // --- Trash (soft-deleted items) ---
    const now = new Date().toISOString();
    for (const item of trashItems) {
      if (!isValidItem(item)) {
        console.warn(
          `Skipping trash item with missing required fields: ${item.id}`,
        );
        continue;
      }
      insertWorkItem(tx, item, now);
    }

    // --- Templates ---
    for (const tmpl of templates) {
      tx.insert(schema.templates)
        .values({
          slug: tmpl.slug,
          name: tmpl.name,
          type: tmpl.type ?? '',
          status: tmpl.status ?? '',
          priority: tmpl.priority ?? '',
          assignee: tmpl.assignee ?? '',
          iteration: tmpl.iteration ?? '',
          parent: tmpl.parent ?? null,
          description: tmpl.description ?? '',
        })
        .run();

      if (tmpl.labels) {
        for (const label of tmpl.labels) {
          tx.insert(schema.templateLabels)
            .values({ templateSlug: tmpl.slug, label })
            .run();
        }
      }

      if (tmpl.dependsOn) {
        for (const depId of tmpl.dependsOn) {
          tx.insert(schema.templateDeps)
            .values({ templateSlug: tmpl.slug, dependsOnId: depId })
            .run();
        }
      }
    }

    // --- Sync queue ---
    for (const entry of syncEntries) {
      tx.insert(schema.syncQueue)
        .values({
          action: entry.action,
          itemId: entry.itemId,
          timestamp: entry.timestamp,
          commentData: entry.commentData
            ? JSON.stringify(entry.commentData)
            : null,
          templateSlug: entry.templateSlug ?? null,
        })
        .run();
    }

    // --- File sync state (content hashes) ---
    const syncedAt = new Date().toISOString();
    for (const [itemId, hash] of fileHashes) {
      tx.insert(schema.fileSyncState).values({ itemId, hash, syncedAt }).run();
    }
  });

  // 4. Update .gitignore (filesystem operation — outside the transaction)
  updateGitignore(ticDir);
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Validate that a parsed item has the minimum required fields for DB insertion.
 */
function isValidItem(item: WorkItem): boolean {
  return (
    typeof item.id === 'string' &&
    item.id !== '' &&
    item.id !== 'undefined' &&
    typeof item.title === 'string' &&
    item.title !== '' &&
    typeof item.type === 'string' &&
    item.type !== '' &&
    typeof item.status === 'string' &&
    item.status !== '' &&
    typeof item.created === 'string' &&
    item.created !== '' &&
    typeof item.updated === 'string' &&
    item.updated !== ''
  );
}

/**
 * Insert a work item and its related junction rows into the database.
 * @param deletedAt — null for active items, ISO timestamp for trash items.
 */
function insertWorkItem(
  tx: TicTransaction,
  item: WorkItem,
  deletedAt: string | null,
): void {
  tx.insert(schema.workItems)
    .values({
      id: item.id,
      title: item.title,
      type: item.type,
      status: item.status,
      iteration: item.iteration,
      priority: item.priority,
      assignee: item.assignee,
      description: item.description,
      parent: item.parent,
      created: item.created,
      updated: item.updated,
      deletedAt,
    })
    .run();

  for (const label of item.labels) {
    tx.insert(schema.workItemLabels)
      .values({ workItemId: item.id, label })
      .run();
  }

  for (const depId of item.dependsOn) {
    tx.insert(schema.workItemDeps)
      .values({ workItemId: item.id, dependsOnId: depId })
      .run();
  }

  for (const comment of item.comments) {
    tx.insert(schema.comments)
      .values({
        workItemId: item.id,
        author: comment.author,
        body: comment.body,
        created: comment.date,
      })
      .run();
  }
}

function parseItemFiles(dir: string): WorkItem[] {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const items: WorkItem[] = [];

  for (const file of entries) {
    try {
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      const item = parseWorkItemFile(raw);
      items.push(item);
    } catch (err) {
      console.warn(
        `Skipping malformed file ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return items;
}

function parseTemplateFiles(dir: string) {
  if (!fs.existsSync(dir)) return [];

  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  const templates = [];

  for (const file of entries) {
    try {
      const slug = file.replace(/\.md$/, '');
      const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
      templates.push(parseTemplateFile(raw, slug));
    } catch (err) {
      console.warn(
        `Skipping malformed template ${file}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  return templates;
}

function parseSyncQueue(filePath: string): QueueEntry[] {
  if (!fs.existsSync(filePath)) return [];

  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(raw) as SyncQueueData;
    if (!Array.isArray(data.pending)) return [];
    return data.pending;
  } catch {
    return [];
  }
}

function computeItemFileHashes(dir: string): Map<string, string> {
  const hashes = new Map<string, string>();
  if (!fs.existsSync(dir)) return hashes;

  const entries = fs.readdirSync(dir).filter((f) => f.endsWith('.md'));
  for (const file of entries) {
    const id = file.replace(/\.md$/, '');
    const raw = fs.readFileSync(path.join(dir, file), 'utf-8');
    hashes.set(id, contentHash(raw));
  }

  return hashes;
}

/**
 * Ensure .gitignore in .tic/ contains the SQLite database files.
 */
function updateGitignore(ticDir: string): void {
  const gitignorePath = path.join(ticDir, '.gitignore');
  const entries = ['tic.db', 'tic.db-wal', 'tic.db-shm'];

  let existing = '';
  if (fs.existsSync(gitignorePath)) {
    existing = fs.readFileSync(gitignorePath, 'utf-8');
  }

  const lines = existing.split('\n');
  const missing = entries.filter((entry) => !lines.includes(entry));

  if (missing.length > 0) {
    const suffix = existing.endsWith('\n') || existing === '' ? '' : '\n';
    fs.appendFileSync(gitignorePath, suffix + missing.join('\n') + '\n');
  }
}
