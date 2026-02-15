import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {
  readWorkItem,
  writeWorkItem,
  deleteWorkItem,
  listItemFiles,
  softDeleteWorkItem,
  restoreWorkItem,
  permanentlyDeleteWorkItem,
  cleanupTrash,
} from './items.js';
import type { WorkItem } from '../../types.js';
import { makeWorkItem } from '../../test-helpers.js';

describe('items', () => {
  let tmpDir: string;
  let itemsDirPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    itemsDirPath = path.join(tmpDir, '.tic', 'items');
    fs.mkdirSync(itemsDirPath, { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('writes and reads a work item', async () => {
    const item: WorkItem = {
      id: '1',
      title: 'Test item',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'high',
      assignee: 'dev',
      labels: ['bug'],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'A test item.',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    await writeWorkItem(tmpDir, item);
    const read = await readWorkItem(tmpDir, '1');
    expect(read.title).toBe('Test item');
    expect(read.type).toBe('task');
    expect(read.labels).toEqual(['bug']);
    expect(read.description).toBe('A test item.');
  });

  it('writes and reads a work item with comments', async () => {
    const item: WorkItem = {
      id: '2',
      title: 'With comments',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'medium',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'Has comments.',
      comments: [
        { author: 'dev', date: '2026-01-31T01:00:00Z', body: 'First comment.' },
        {
          author: 'dev',
          date: '2026-01-31T02:00:00Z',
          body: 'Second comment.',
        },
      ],
      parent: null,
      dependsOn: [],
    };
    await writeWorkItem(tmpDir, item);
    const read = await readWorkItem(tmpDir, '2');
    expect(read.comments).toHaveLength(2);
    expect(read.comments[0]!.body).toBe('First comment.');
  });

  it('deletes a work item file', async () => {
    const item: WorkItem = {
      id: '3',
      title: 'To delete',
      type: 'issue',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    await writeWorkItem(tmpDir, item);
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(true);
    await deleteWorkItem(tmpDir, '3');
    expect(fs.existsSync(path.join(itemsDirPath, '3.md'))).toBe(false);
  });

  it('lists all item files', async () => {
    await writeWorkItem(tmpDir, {
      id: '1',
      title: 'A',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    });
    await writeWorkItem(tmpDir, {
      id: '2',
      title: 'B',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '',
      updated: '',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    });
    const files = await listItemFiles(tmpDir);
    expect(files).toHaveLength(2);
  });

  it('writes and reads a work item with parent and dependsOn', async () => {
    const item: WorkItem = {
      id: '1',
      title: 'Child item',
      type: 'task',
      status: 'todo',
      iteration: 'v1',
      priority: 'high',
      assignee: 'dev',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: 'A child.',
      comments: [],
      parent: '5',
      dependsOn: ['3', '4'],
    };
    await writeWorkItem(tmpDir, item);
    const read = await readWorkItem(tmpDir, '1');
    expect(read.parent).toBe('5');
    expect(read.dependsOn).toEqual(['3', '4']);
  });

  it('reads items without parent/dependsOn as defaults', async () => {
    const item: WorkItem = {
      id: '2',
      title: 'Legacy item',
      type: 'issue',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      created: '2026-01-31T00:00:00Z',
      updated: '2026-01-31T00:00:00Z',
      description: '',
      comments: [],
      parent: null,
      dependsOn: [],
    };
    await writeWorkItem(tmpDir, item);
    const read = await readWorkItem(tmpDir, '2');
    expect(read.parent).toBeNull();
    expect(read.dependsOn).toEqual([]);
  });

  describe('soft-delete and restore', () => {
    const makeItem = (id: string): WorkItem =>
      makeWorkItem(id, {
        iteration: 'v1',
        description: 'Test item.',
        created: '2026-01-31T00:00:00Z',
        updated: '2026-01-31T00:00:00Z',
      });

    it('softDeleteWorkItem moves item to trash so readWorkItem fails', async () => {
      await writeWorkItem(tmpDir, makeItem('10'));
      await softDeleteWorkItem(tmpDir, '10');

      // readWorkItem should fail because file is gone from items/
      await expect(readWorkItem(tmpDir, '10')).rejects.toThrow();

      // but the file should exist in trash/
      const trashFile = path.join(tmpDir, '.tic', 'trash', '10.md');
      expect(fs.existsSync(trashFile)).toBe(true);
    });

    it('restoreWorkItem moves item back so readWorkItem works', async () => {
      await writeWorkItem(tmpDir, makeItem('11'));
      await softDeleteWorkItem(tmpDir, '11');
      await restoreWorkItem(tmpDir, '11');

      const read = await readWorkItem(tmpDir, '11');
      expect(read.id).toBe('11');
      expect(read.title).toBe('Item 11');

      // trash file should be gone
      const trashFile = path.join(tmpDir, '.tic', 'trash', '11.md');
      expect(fs.existsSync(trashFile)).toBe(false);
    });

    it('permanentlyDeleteWorkItem removes from trash', async () => {
      await writeWorkItem(tmpDir, makeItem('12'));
      await softDeleteWorkItem(tmpDir, '12');

      const trashFile = path.join(tmpDir, '.tic', 'trash', '12.md');
      expect(fs.existsSync(trashFile)).toBe(true);

      await permanentlyDeleteWorkItem(tmpDir, '12');
      expect(fs.existsSync(trashFile)).toBe(false);

      // restore should fail because file is gone from trash
      await expect(restoreWorkItem(tmpDir, '12')).rejects.toThrow();
    });

    it('permanentlyDeleteWorkItem ignores missing files', async () => {
      // Should not throw when trash file does not exist
      await expect(
        permanentlyDeleteWorkItem(tmpDir, 'nonexistent'),
      ).resolves.toBeUndefined();
    });

    it('cleanupTrash removes all trashed items', async () => {
      await writeWorkItem(tmpDir, makeItem('20'));
      await writeWorkItem(tmpDir, makeItem('21'));
      await softDeleteWorkItem(tmpDir, '20');
      await softDeleteWorkItem(tmpDir, '21');

      const trashDir = path.join(tmpDir, '.tic', 'trash');
      expect(fs.existsSync(path.join(trashDir, '20.md'))).toBe(true);
      expect(fs.existsSync(path.join(trashDir, '21.md'))).toBe(true);

      await cleanupTrash(tmpDir);
      expect(fs.existsSync(trashDir)).toBe(false);
    });

    it('cleanupTrash is safe when trash dir does not exist', async () => {
      await expect(cleanupTrash(tmpDir)).resolves.toBeUndefined();
    });
  });
});
