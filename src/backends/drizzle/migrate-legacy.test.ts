import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import yaml from 'yaml';
import { createDatabase, type TicDatabase } from './db.js';
import { readConfig } from './config.js';
import { migrateLegacyProject } from './migrate-legacy.js';
import * as schema from './schema.js';
import { eq, isNull } from 'drizzle-orm';
import { contentHash } from '../files/hash.js';
import { stringifyFrontmatter } from '../local/frontmatter.js';

/**
 * Helper: write a legacy config.yml into .tic/
 */
function writeConfigYml(root: string, config: Record<string, unknown>): void {
  const ticDir = path.join(root, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(path.join(ticDir, 'config.yml'), yaml.stringify(config));
}

/**
 * Helper: write a work item .md file with frontmatter
 */
function writeItemFile(
  root: string,
  id: string,
  frontmatter: Record<string, unknown>,
  body: string,
  subdir = 'items',
): void {
  const dir = path.join(root, '.tic', subdir);
  fs.mkdirSync(dir, { recursive: true });
  const content = stringifyFrontmatter(body, frontmatter);
  fs.writeFileSync(path.join(dir, `${id}.md`), content);
}

/**
 * Helper: write a template .md file with frontmatter
 */
function writeTemplateFile(
  root: string,
  slug: string,
  frontmatter: Record<string, unknown>,
  body: string,
): void {
  const dir = path.join(root, '.tic', 'templates');
  fs.mkdirSync(dir, { recursive: true });
  const content = stringifyFrontmatter(body, frontmatter);
  fs.writeFileSync(path.join(dir, `${slug}.md`), content);
}

/**
 * Helper: write a sync-queue.json file
 */
function writeSyncQueue(
  root: string,
  entries: Array<Record<string, unknown>>,
): void {
  const ticDir = path.join(root, '.tic');
  fs.mkdirSync(ticDir, { recursive: true });
  fs.writeFileSync(
    path.join(ticDir, 'sync-queue.json'),
    JSON.stringify({ pending: entries }, null, 2),
  );
}

describe('migrateLegacyProject', () => {
  let tmpDir: string;
  let db: TicDatabase;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-migrate-test-'));
    db = createDatabase(':memory:');
  });

  afterEach(() => {
    db.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('migrates config.yml to database tables', () => {
    writeConfigYml(tmpDir, {
      backend: 'github',
      statuses: ['open', 'in-progress', 'closed'],
      types: ['bug', 'feature', 'chore'],
      current_iteration: 'sprint-2',
      iterations: ['sprint-1', 'sprint-2', 'sprint-3'],
      next_id: 42,
      branchMode: 'branch',
      autoUpdate: false,
      defaultType: 'bug',
      showDetailPanel: true,
      branchCommand: 'echo hello',
      copyToClipboard: false,
      defaultView: 'My View',
      jira: {
        site: 'mycompany.atlassian.net',
        project: 'PROJ',
        boardId: 99,
      },
      views: [
        {
          name: 'Bugs',
          filters: { types: ['bug'], priorities: ['high', 'critical'] },
          sort: [{ column: 'priority', direction: 'asc' }],
        },
      ],
    });

    migrateLegacyProject(tmpDir, db);

    const config = readConfig(db);
    expect(config.backend).toBe('github');
    expect(config.statuses).toEqual(['open', 'in-progress', 'closed']);
    expect(config.types).toEqual(['bug', 'feature', 'chore']);
    expect(config.current_iteration).toBe('sprint-2');
    expect(config.iterations).toEqual(['sprint-1', 'sprint-2', 'sprint-3']);
    expect(config.next_id).toBe(42);
    expect(config.branchMode).toBe('branch');
    expect(config.autoUpdate).toBe(false);
    expect(config.defaultType).toBe('bug');
    expect(config.showDetailPanel).toBe(true);
    expect(config.branchCommand).toBe('echo hello');
    expect(config.copyToClipboard).toBe(false);
    expect(config.defaultView).toBe('My View');

    // Jira config
    expect(config.jira).toBeDefined();
    expect(config.jira!.site).toBe('mycompany.atlassian.net');
    expect(config.jira!.project).toBe('PROJ');
    expect(config.jira!.boardId).toBe(99);

    // Saved views
    expect(config.views).toHaveLength(1);
    expect(config.views![0]!.name).toBe('Bugs');
    expect(config.views![0]!.filters.types).toEqual(['bug']);
    expect(config.views![0]!.filters.priorities).toEqual(['high', 'critical']);
    expect(config.views![0]!.sort).toEqual([
      { column: 'priority', direction: 'asc' },
    ]);
  });

  it('migrates work items with labels and deps', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 3,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeItemFile(
      tmpDir,
      '1',
      {
        id: 1,
        title: 'First item',
        type: 'issue',
        status: 'todo',
        iteration: 'default',
        priority: 'high',
        assignee: 'alice',
        labels: ['frontend', 'urgent'],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-02T00:00:00.000Z',
      },
      'Some description here.',
    );

    writeItemFile(
      tmpDir,
      '2',
      {
        id: 2,
        title: 'Second item',
        type: 'issue',
        status: 'done',
        iteration: 'default',
        priority: 'low',
        assignee: '',
        labels: [],
        created: '2025-01-03T00:00:00.000Z',
        updated: '2025-01-04T00:00:00.000Z',
        depends_on: ['1'],
      },
      'Depends on first.',
    );

    migrateLegacyProject(tmpDir, db);

    // Check work items
    const items = db
      .select()
      .from(schema.workItems)
      .where(isNull(schema.workItems.deletedAt))
      .all();
    expect(items).toHaveLength(2);

    const item1 = items.find((i) => i.id === '1')!;
    expect(item1.title).toBe('First item');
    expect(item1.status).toBe('todo');
    expect(item1.priority).toBe('high');
    expect(item1.assignee).toBe('alice');

    // Labels
    const labels = db
      .select()
      .from(schema.workItemLabels)
      .where(eq(schema.workItemLabels.workItemId, '1'))
      .all();
    expect(labels.map((l) => l.label).sort()).toEqual(['frontend', 'urgent']);

    // Dependencies
    const deps = db
      .select()
      .from(schema.workItemDeps)
      .where(eq(schema.workItemDeps.workItemId, '2'))
      .all();
    expect(deps).toHaveLength(1);
    expect(deps[0]!.dependsOnId).toBe('1');
  });

  it('migrates comments from item body', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 2,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    const bodyWithComments = [
      'Main description.',
      '',
      '## Comments',
      '',
      '---',
      'author: alice',
      'date: 2025-01-05T00:00:00.000Z',
      '',
      'First comment body.',
      '',
      '---',
      'author: bob',
      'date: 2025-01-06T00:00:00.000Z',
      '',
      'Second comment body.',
    ].join('\n');

    writeItemFile(
      tmpDir,
      '1',
      {
        id: 1,
        title: 'Item with comments',
        type: 'issue',
        status: 'todo',
        iteration: 'default',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      bodyWithComments,
    );

    migrateLegacyProject(tmpDir, db);

    // Check description (should not include comments section)
    const item = db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, '1'))
      .get()!;
    expect(item.description).toBe('Main description.');

    // Check comments
    const comments = db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.workItemId, '1'))
      .all();
    expect(comments).toHaveLength(2);

    const alice = comments.find((c) => c.author === 'alice')!;
    expect(alice.body).toBe('First comment body.');
    expect(alice.created).toBe('2025-01-05T00:00:00.000Z');

    const bob = comments.find((c) => c.author === 'bob')!;
    expect(bob.body).toBe('Second comment body.');
    expect(bob.created).toBe('2025-01-06T00:00:00.000Z');
  });

  it('migrates trash to soft-deleted items', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 2,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeItemFile(
      tmpDir,
      '99',
      {
        id: 99,
        title: 'Deleted item',
        type: 'issue',
        status: 'done',
        iteration: 'default',
        priority: 'low',
        assignee: '',
        labels: ['old'],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      'This was deleted.',
      'trash',
    );

    migrateLegacyProject(tmpDir, db);

    // Trash item should have deletedAt set
    const trashItem = db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, '99'))
      .get()!;
    expect(trashItem.deletedAt).not.toBeNull();
    expect(trashItem.title).toBe('Deleted item');

    // Should have labels too
    const labels = db
      .select()
      .from(schema.workItemLabels)
      .where(eq(schema.workItemLabels.workItemId, '99'))
      .all();
    expect(labels).toHaveLength(1);
    expect(labels[0]!.label).toBe('old');

    // Active items query should not include it
    const activeItems = db
      .select()
      .from(schema.workItems)
      .where(isNull(schema.workItems.deletedAt))
      .all();
    expect(activeItems).toHaveLength(0);
  });

  it('migrates templates', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue', 'bug'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeTemplateFile(
      tmpDir,
      'bug-report',
      {
        name: 'Bug Report',
        type: 'bug',
        status: 'todo',
        priority: 'high',
        labels: ['bug', 'needs-triage'],
        depends_on: ['1'],
      },
      'Steps to reproduce:\n1. ...',
    );

    migrateLegacyProject(tmpDir, db);

    const tmpl = db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.slug, 'bug-report'))
      .get()!;
    expect(tmpl.name).toBe('Bug Report');
    expect(tmpl.type).toBe('bug');
    expect(tmpl.status).toBe('todo');
    expect(tmpl.priority).toBe('high');
    expect(tmpl.description).toBe('Steps to reproduce:\n1. ...');

    // Labels
    const labels = db
      .select()
      .from(schema.templateLabels)
      .where(eq(schema.templateLabels.templateSlug, 'bug-report'))
      .all();
    expect(labels.map((l) => l.label).sort()).toEqual(['bug', 'needs-triage']);

    // Dependencies
    const deps = db
      .select()
      .from(schema.templateDeps)
      .where(eq(schema.templateDeps.templateSlug, 'bug-report'))
      .all();
    expect(deps).toHaveLength(1);
    expect(deps[0]!.dependsOnId).toBe('1');
  });

  it('migrates sync queue', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeSyncQueue(tmpDir, [
      {
        action: 'create',
        itemId: '1',
        timestamp: '2025-01-01T00:00:00.000Z',
      },
      {
        action: 'comment',
        itemId: '2',
        timestamp: '2025-01-02T00:00:00.000Z',
        commentData: { author: 'alice', body: 'a comment' },
      },
      {
        action: 'template-create',
        itemId: 'bug-report',
        timestamp: '2025-01-03T00:00:00.000Z',
        templateSlug: 'bug-report',
      },
    ]);

    migrateLegacyProject(tmpDir, db);

    const rows = db.select().from(schema.syncQueue).all();
    expect(rows).toHaveLength(3);

    const createRow = rows.find((r) => r.action === 'create')!;
    expect(createRow.itemId).toBe('1');
    expect(createRow.timestamp).toBe('2025-01-01T00:00:00.000Z');
    expect(createRow.commentData).toBeNull();

    const commentRow = rows.find((r) => r.action === 'comment')!;
    expect(commentRow.itemId).toBe('2');
    expect(JSON.parse(commentRow.commentData!)).toEqual({
      author: 'alice',
      body: 'a comment',
    });

    const templateRow = rows.find((r) => r.action === 'template-create')!;
    expect(templateRow.templateSlug).toBe('bug-report');
  });

  it('maps backend local to filesystem', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    migrateLegacyProject(tmpDir, db);

    const config = readConfig(db);
    expect(config.backend).toBe('filesystem');
  });

  it('handles empty project', () => {
    // Create minimal config with no items, templates, or sync queue
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    // No items/, templates/, trash/, or sync-queue.json
    migrateLegacyProject(tmpDir, db);

    const config = readConfig(db);
    expect(config.backend).toBe('filesystem');

    const items = db.select().from(schema.workItems).all();
    expect(items).toHaveLength(0);

    const templates = db.select().from(schema.templates).all();
    expect(templates).toHaveLength(0);

    const queue = db.select().from(schema.syncQueue).all();
    expect(queue).toHaveLength(0);
  });

  it('handles malformed .md files gracefully (skip with warning, not abort)', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 3,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    // Write one good item
    writeItemFile(
      tmpDir,
      '1',
      {
        id: 1,
        title: 'Good item',
        type: 'issue',
        status: 'todo',
        iteration: 'default',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      'Good description.',
    );

    // Write a malformed item (no frontmatter, will parse but produce bad data)
    const malformedDir = path.join(tmpDir, '.tic', 'items');
    fs.writeFileSync(
      path.join(malformedDir, '2.md'),
      'This is not valid frontmatter content with no id or title',
    );

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Should NOT throw
    migrateLegacyProject(tmpDir, db);

    warnSpy.mockRestore();

    // The good item should be migrated
    const items = db
      .select()
      .from(schema.workItems)
      .where(isNull(schema.workItems.deletedAt))
      .all();
    // At least the good item is there; the malformed one may or may not be
    // depending on how it parses — the key is it doesn't abort
    expect(items.length).toBeGreaterThanOrEqual(1);
    expect(items.find((i) => i.id === '1')).toBeDefined();
  });

  it('is atomic — all or nothing', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 2,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeItemFile(
      tmpDir,
      '1',
      {
        id: 1,
        title: 'First item',
        type: 'issue',
        status: 'todo',
        iteration: 'default',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      'First.',
    );

    // To force a transaction failure, we'll insert a duplicate item ID
    // that conflicts. We pre-insert item '1' into the DB so the migration
    // transaction's INSERT of the same ID causes a conflict/error.
    db.insert(schema.workItems)
      .values({
        id: '1',
        title: 'Pre-existing',
        type: 'issue',
        status: 'done',
        iteration: 'default',
        priority: 'medium',
        assignee: '',
        description: '',
        parent: null,
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        deletedAt: null,
      })
      .run();

    // The migration should throw because of the duplicate ID
    expect(() => migrateLegacyProject(tmpDir, db)).toThrow();

    // The pre-existing item should still be there, unchanged
    const item = db
      .select()
      .from(schema.workItems)
      .where(eq(schema.workItems.id, '1'))
      .get()!;
    expect(item.title).toBe('Pre-existing');

    // Config tables should NOT have been modified by the rolled-back transaction.
    // The statuses table should still have the defaults from createDatabase,
    // not the ones from the legacy config.yml.
    const statusRows = db.select().from(schema.statuses).all();
    const statusNames = statusRows.map((r) => r.name);
    expect(statusNames).not.toContain('todo');
    expect(statusNames).not.toContain('done');
  });

  it('updates .gitignore', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    migrateLegacyProject(tmpDir, db);

    const gitignorePath = path.join(tmpDir, '.tic', '.gitignore');
    expect(fs.existsSync(gitignorePath)).toBe(true);

    const content = fs.readFileSync(gitignorePath, 'utf-8');
    expect(content).toContain('tic.db');
    expect(content).toContain('tic.db-wal');
    expect(content).toContain('tic.db-shm');
  });

  it('updates .gitignore without duplicating existing entries', () => {
    // Pre-create a .gitignore with one entry already present
    const ticDir = path.join(tmpDir, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    fs.writeFileSync(path.join(ticDir, '.gitignore'), 'tic.db\n');

    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    migrateLegacyProject(tmpDir, db);

    const content = fs.readFileSync(path.join(ticDir, '.gitignore'), 'utf-8');
    // tic.db should appear only once
    const matches = content.match(/^tic\.db$/gm);
    expect(matches).toHaveLength(1);
    // But wal and shm should be added
    expect(content).toContain('tic.db-wal');
    expect(content).toContain('tic.db-shm');
  });

  it('computes file hashes for sync state', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 2,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeItemFile(
      tmpDir,
      '1',
      {
        id: 1,
        title: 'Hash test item',
        type: 'issue',
        status: 'todo',
        iteration: 'default',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      'Description for hashing.',
    );

    migrateLegacyProject(tmpDir, db);

    // Check file_sync_state table
    const syncRows = db.select().from(schema.fileSyncState).all();
    expect(syncRows).toHaveLength(1);
    expect(syncRows[0]!.itemId).toBe('1');

    // Verify the hash matches what we'd compute directly
    const fileContent = fs.readFileSync(
      path.join(tmpDir, '.tic', 'items', '1.md'),
      'utf-8',
    );
    const expectedHash = contentHash(fileContent);
    expect(syncRows[0]!.hash).toBe(expectedHash);
    expect(syncRows[0]!.syncedAt).toBeTruthy();
  });

  it('does not compute file hashes for trash items', () => {
    writeConfigYml(tmpDir, {
      backend: 'local',
      statuses: ['todo', 'done'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 2,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    writeItemFile(
      tmpDir,
      '99',
      {
        id: 99,
        title: 'Trashed item',
        type: 'issue',
        status: 'done',
        iteration: 'default',
        priority: 'low',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
      },
      'Deleted.',
      'trash',
    );

    migrateLegacyProject(tmpDir, db);

    // No file sync state for trash items
    const syncRows = db.select().from(schema.fileSyncState).all();
    expect(syncRows).toHaveLength(0);
  });

  it('does not map non-local backends', () => {
    writeConfigYml(tmpDir, {
      backend: 'github',
      statuses: ['open', 'closed'],
      types: ['issue'],
      current_iteration: 'default',
      iterations: ['default'],
      next_id: 1,
      branchMode: 'worktree',
      autoUpdate: true,
    });

    migrateLegacyProject(tmpDir, db);

    const config = readConfig(db);
    expect(config.backend).toBe('github');
  });
});
