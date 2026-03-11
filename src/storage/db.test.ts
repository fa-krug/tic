import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, type TicDatabase } from './db.js';

describe('createDatabase', () => {
  let tmpDir: string | undefined;
  let db: TicDatabase;

  afterEach(() => {
    db?.close();
    if (tmpDir) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
      tmpDir = undefined;
    }
  });

  it('creates database file in .tic directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.tic', 'tic.db'))).toBe(true);
  });

  it('creates in-memory database when path is :memory:', () => {
    db = createDatabase(':memory:');
    expect(db).toBeDefined();
  });

  it('enables WAL mode for file databases', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    const result = db.raw.pragma('journal_mode') as Array<{
      journal_mode: string;
    }>;
    expect(result[0]!.journal_mode).toBe('wal');
  });

  it('enables foreign keys', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    const result = db.raw.pragma('foreign_keys') as Array<{
      foreign_keys: number;
    }>;
    expect(result[0]!.foreign_keys).toBe(1);
  });

  it('applies schema (tables exist)', () => {
    db = createDatabase(':memory:');
    const tables = db.raw
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '__drizzle%' AND name != 'sqlite_sequence' ORDER BY name",
      )
      .all() as Array<{ name: string }>;
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('work_items');
    expect(tableNames).toContain('work_item_labels');
    expect(tableNames).toContain('work_item_deps');
    expect(tableNames).toContain('comments');
    expect(tableNames).toContain('templates');
    expect(tableNames).toContain('template_labels');
    expect(tableNames).toContain('template_deps');
    expect(tableNames).toContain('project_config');
    expect(tableNames).toContain('statuses');
    expect(tableNames).toContain('work_item_types');
    expect(tableNames).toContain('iterations');
    expect(tableNames).toContain('jira_config');
    expect(tableNames).toContain('saved_views');
    expect(tableNames).toContain('saved_view_filters');
    expect(tableNames).toContain('saved_view_sort_entries');
    expect(tableNames).toContain('sync_queue');
    expect(tableNames).toContain('undo_stack');
    expect(tableNames).toContain('file_sync_state');
    expect(tableNames).toContain('color_mappings');
    expect(tableNames).toContain('pull_requests');
    expect(tableNames).toContain('pr_item_links');
    expect(tableNames).toHaveLength(21);
  });
});
