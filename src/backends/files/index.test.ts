import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { FilesBackend } from './index.js';
import { isSyncableBackend } from '../types.js';
import type { WorkItem } from '../../types.js';

describe('FilesBackend', () => {
  let tmpDir: string;
  let backend: FilesBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-files-'));
    fs.mkdirSync(path.join(tmpDir, '.tic', 'items'), {
      recursive: true,
    });
    backend = new FilesBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('lists empty items directory', async () => {
    const items = await backend.listWorkItems();
    expect(items).toEqual([]);
  });

  it('implements SyncableBackend', () => {
    expect(isSyncableBackend(backend)).toBe(true);
  });

  it('has full capabilities', () => {
    const caps = backend.getCapabilities();
    expect(caps.relationships).toBe(true);
    expect(caps.customTypes).toBe(true);
    expect(caps.customStatuses).toBe(true);
    expect(caps.iterations).toBe(true);
    expect(caps.comments).toBe(true);
    expect(caps.fields.priority).toBe(true);
    expect(caps.fields.assignee).toBe(true);
    expect(caps.fields.labels).toBe(true);
    expect(caps.fields.parent).toBe(true);
    expect(caps.fields.dependsOn).toBe(true);
    expect(caps.templates).toBe(true);
  });

  it('metadata methods return empty values', async () => {
    expect(await backend.getStatuses()).toEqual([]);
    expect(await backend.getIterations()).toEqual([]);
    expect(await backend.getWorkItemTypes()).toEqual([]);
    expect(await backend.getAssignees()).toEqual([]);
    expect(await backend.getLabels()).toEqual([]);
    expect(await backend.getCurrentIteration()).toBe('');
  });

  it('setCurrentIteration is a no-op', async () => {
    // Should not throw
    await backend.setCurrentIteration('sprint-1');
    expect(await backend.getCurrentIteration()).toBe('');
  });

  describe('importWorkItem', () => {
    it('writes item preserving ID', async () => {
      const item: WorkItem = {
        id: '42',
        title: 'Test item',
        type: 'issue',
        status: 'open',
        iteration: 'sprint-1',
        priority: 'high',
        assignee: 'alice',
        labels: ['bug', 'urgent'],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-02T00:00:00.000Z',
        description: 'A test description',
        comments: [],
        parent: null,
        dependsOn: [],
      };

      const result = await backend.importWorkItem(item);
      expect(result.id).toBe('42');
      expect(result.title).toBe('Test item');

      // Verify it was written to disk
      const filePath = path.join(tmpDir, '.tic', 'items', '42.md');
      const stat = await fsp.stat(filePath);
      expect(stat.isFile()).toBe(true);

      // Read back
      const readBack = await backend.getWorkItem('42');
      expect(readBack.id).toBe('42');
      expect(readBack.title).toBe('Test item');
      expect(readBack.type).toBe('issue');
      expect(readBack.status).toBe('open');
      expect(readBack.priority).toBe('high');
      expect(readBack.assignee).toBe('alice');
      expect(readBack.labels).toEqual(['bug', 'urgent']);
      expect(readBack.iteration).toBe('sprint-1');
      expect(readBack.description).toBe('A test description');
      expect(readBack.parent).toBeNull();
      expect(readBack.dependsOn).toEqual([]);
    });

    it('preserves relationships', async () => {
      const parent: WorkItem = {
        id: '1',
        title: 'Parent',
        type: 'epic',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      };

      const child: WorkItem = {
        id: '2',
        title: 'Child',
        type: 'task',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: '1',
        dependsOn: ['1'],
      };

      await backend.importWorkItem(parent);
      await backend.importWorkItem(child);

      const readChild = await backend.getWorkItem('2');
      expect(readChild.parent).toBe('1');
      expect(readChild.dependsOn).toEqual(['1']);
    });

    it('preserves comments', async () => {
      const item: WorkItem = {
        id: '10',
        title: 'Commented item',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: 'Description here',
        comments: [
          {
            author: 'bob',
            date: '2025-01-02T00:00:00.000Z',
            body: 'Comment 1',
          },
          {
            author: 'alice',
            date: '2025-01-03T00:00:00.000Z',
            body: 'Comment 2',
          },
        ],
        parent: null,
        dependsOn: [],
      };

      await backend.importWorkItem(item);
      const readBack = await backend.getWorkItem('10');
      expect(readBack.comments).toHaveLength(2);
      expect(readBack.comments[0]!.author).toBe('bob');
      expect(readBack.comments[0]!.body).toBe('Comment 1');
      expect(readBack.comments[1]!.author).toBe('alice');
    });

    it('overwrites existing item with same ID', async () => {
      const item1: WorkItem = {
        id: '5',
        title: 'Version 1',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'low',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: 'First version',
        comments: [],
        parent: null,
        dependsOn: [],
      };

      const item2: WorkItem = {
        ...item1,
        title: 'Version 2',
        status: 'closed',
        description: 'Second version',
      };

      await backend.importWorkItem(item1);
      await backend.importWorkItem(item2);

      const readBack = await backend.getWorkItem('5');
      expect(readBack.title).toBe('Version 2');
      expect(readBack.status).toBe('closed');
      expect(readBack.description).toBe('Second version');
    });
  });

  describe('CRUD operations', () => {
    const sampleItem: WorkItem = {
      id: '1',
      title: 'Sample item',
      type: 'task',
      status: 'todo',
      iteration: 'sprint-1',
      priority: 'medium',
      assignee: 'charlie',
      labels: ['frontend'],
      created: '2025-01-01T00:00:00.000Z',
      updated: '2025-01-01T00:00:00.000Z',
      description: 'A sample task',
      comments: [],
      parent: null,
      dependsOn: [],
    };

    it('lists items after import', async () => {
      await backend.importWorkItem(sampleItem);
      await backend.importWorkItem({
        ...sampleItem,
        id: '2',
        title: 'Second item',
      });

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      const ids = items.map((i) => i.id).sort();
      expect(ids).toEqual(['1', '2']);
    });

    it('updates a work item', async () => {
      await backend.importWorkItem(sampleItem);

      const updated = await backend.updateWorkItem('1', {
        title: 'Updated title',
        status: 'done',
      });

      expect(updated.title).toBe('Updated title');
      expect(updated.status).toBe('done');
      expect(updated.id).toBe('1');
      // updated timestamp should have changed
      expect(updated.updated).not.toBe(sampleItem.updated);

      const readBack = await backend.getWorkItem('1');
      expect(readBack.title).toBe('Updated title');
      expect(readBack.status).toBe('done');
    });

    it('deletes a work item', async () => {
      await backend.importWorkItem(sampleItem);
      expect(await backend.listWorkItems()).toHaveLength(1);

      await backend.deleteWorkItem('1');
      expect(await backend.listWorkItems()).toHaveLength(0);
    });

    it('delete of non-existent item does not throw', async () => {
      await expect(
        backend.deleteWorkItem('nonexistent'),
      ).resolves.toBeUndefined();
    });
  });

  describe('comments', () => {
    it('adds a comment to an existing item', async () => {
      const item: WorkItem = {
        id: '7',
        title: 'Commentable',
        type: 'issue',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      };
      await backend.importWorkItem(item);

      const comment = await backend.addComment('7', {
        author: 'dave',
        body: 'Nice work!',
      });

      expect(comment.author).toBe('dave');
      expect(comment.body).toBe('Nice work!');
      expect(comment.date).toBeTruthy();

      const readBack = await backend.getWorkItem('7');
      expect(readBack.comments).toHaveLength(1);
      expect(readBack.comments[0]!.author).toBe('dave');
    });
  });

  describe('children and dependents', () => {
    it('finds children of an item', async () => {
      await backend.importWorkItem({
        id: '1',
        title: 'Parent',
        type: 'epic',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      });
      await backend.importWorkItem({
        id: '2',
        title: 'Child 1',
        type: 'task',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: '1',
        dependsOn: [],
      });
      await backend.importWorkItem({
        id: '3',
        title: 'Not a child',
        type: 'task',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      });

      const children = await backend.getChildren('1');
      expect(children).toHaveLength(1);
      expect(children[0]!.id).toBe('2');
    });

    it('finds dependents of an item', async () => {
      await backend.importWorkItem({
        id: '1',
        title: 'Dependency',
        type: 'task',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: [],
      });
      await backend.importWorkItem({
        id: '2',
        title: 'Depends on 1',
        type: 'task',
        status: 'open',
        iteration: '',
        priority: 'medium',
        assignee: '',
        labels: [],
        created: '2025-01-01T00:00:00.000Z',
        updated: '2025-01-01T00:00:00.000Z',
        description: '',
        comments: [],
        parent: null,
        dependsOn: ['1'],
      });

      const dependents = await backend.getDependents('1');
      expect(dependents).toHaveLength(1);
      expect(dependents[0]!.id).toBe('2');
    });
  });

  describe('getItemUrl', () => {
    it('returns path to the item file', () => {
      const url = backend.getItemUrl('42');
      expect(url).toBe(path.resolve(tmpDir, '.tic', 'items', '42.md'));
    });
  });

  describe('openItem', () => {
    it('is a no-op', async () => {
      // Should not throw
      await backend.openItem('42');
    });
  });

  describe('templates', () => {
    it('lists empty templates directory', async () => {
      const templates = await backend.listTemplates();
      expect(templates).toEqual([]);
    });

    it('creates and reads a template', async () => {
      const template = await backend.createTemplate({
        slug: '',
        name: 'Bug Report',
        type: 'bug',
        status: 'open',
        priority: 'high',
        description: 'Steps to reproduce:',
      });

      expect(template.slug).toBe('bug-report');
      expect(template.name).toBe('Bug Report');

      const readBack = await backend.getTemplate('bug-report');
      expect(readBack.name).toBe('Bug Report');
      expect(readBack.type).toBe('bug');
      expect(readBack.priority).toBe('high');
      expect(readBack.description).toBe('Steps to reproduce:');
    });

    it('lists created templates', async () => {
      await backend.createTemplate({
        slug: '',
        name: 'Template A',
        description: 'A',
      });
      await backend.createTemplate({
        slug: '',
        name: 'Template B',
        description: 'B',
      });

      const templates = await backend.listTemplates();
      expect(templates).toHaveLength(2);
    });

    it('updates a template', async () => {
      await backend.createTemplate({
        slug: '',
        name: 'Old Name',
        description: 'Old desc',
      });

      const updated = await backend.updateTemplate('old-name', {
        slug: '',
        name: 'New Name',
        description: 'New desc',
      });

      expect(updated.slug).toBe('new-name');
      expect(updated.name).toBe('New Name');

      // Old slug file should be gone
      const templates = await backend.listTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0]!.slug).toBe('new-name');
    });

    it('deletes a template', async () => {
      await backend.createTemplate({
        slug: '',
        name: 'To Delete',
        description: '',
      });
      expect(await backend.listTemplates()).toHaveLength(1);

      await backend.deleteTemplate('to-delete');
      expect(await backend.listTemplates()).toHaveLength(0);
    });
  });

  describe('getRoot', () => {
    it('returns the root directory', () => {
      expect(backend.getRoot()).toBe(tmpDir);
    });
  });
});
