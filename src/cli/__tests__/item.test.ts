import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from '../../backends/local/index.js';
import {
  runItemList,
  runItemShow,
  runItemCreate,
  runItemUpdate,
  runItemDelete,
  runItemComment,
} from '../commands/item.js';

describe('item commands', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-cli-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  describe('runItemCreate', () => {
    it('creates an item with title and defaults', () => {
      const item = runItemCreate(backend, 'Fix bug', {});
      expect(item.title).toBe('Fix bug');
      expect(item.type).toBe('task');
      expect(item.status).toBe('backlog');
      expect(item.id).toBe(1);
    });

    it('creates an item with all options', () => {
      const item = runItemCreate(backend, 'Epic thing', {
        type: 'epic',
        status: 'todo',
        priority: 'high',
        assignee: 'alice',
        labels: 'auth,backend',
        iteration: 'sprint-1',
      });
      expect(item.type).toBe('epic');
      expect(item.status).toBe('todo');
      expect(item.priority).toBe('high');
      expect(item.assignee).toBe('alice');
      expect(item.labels).toEqual(['auth', 'backend']);
      expect(item.iteration).toBe('sprint-1');
    });

    it('accepts description option', () => {
      const item = runItemCreate(backend, 'Bug', {
        description: 'Details here',
      });
      expect(item.description).toBe('Details here');
    });
  });

  describe('runItemList', () => {
    it('lists items for current iteration', () => {
      runItemCreate(backend, 'A', {});
      runItemCreate(backend, 'B', {});
      const items = runItemList(backend, {});
      expect(items).toHaveLength(2);
    });

    it('filters by status', () => {
      runItemCreate(backend, 'A', { status: 'todo' });
      runItemCreate(backend, 'B', { status: 'done' });
      const items = runItemList(backend, { status: 'todo' });
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('A');
    });

    it('filters by type', () => {
      runItemCreate(backend, 'A', { type: 'epic' });
      runItemCreate(backend, 'B', { type: 'task' });
      const items = runItemList(backend, { type: 'epic' });
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('A');
    });

    it('shows all iterations with --all', () => {
      runItemCreate(backend, 'A', { iteration: 'v1' });
      runItemCreate(backend, 'B', { iteration: 'v2' });
      const items = runItemList(backend, { all: true });
      expect(items).toHaveLength(2);
    });
  });

  describe('runItemShow', () => {
    it('returns a single item by id', () => {
      runItemCreate(backend, 'Bug', {});
      const item = runItemShow(backend, 1);
      expect(item.title).toBe('Bug');
      expect(item.id).toBe(1);
    });

    it('throws for non-existent id', () => {
      expect(() => runItemShow(backend, 999)).toThrow();
    });
  });

  describe('runItemUpdate', () => {
    it('updates specified fields only', () => {
      runItemCreate(backend, 'Original', {});
      const item = runItemUpdate(backend, 1, {
        title: 'Updated',
        status: 'done',
      });
      expect(item.title).toBe('Updated');
      expect(item.status).toBe('done');
      expect(item.type).toBe('task'); // unchanged
    });
  });

  describe('runItemDelete', () => {
    it('deletes an item', () => {
      runItemCreate(backend, 'Delete me', {});
      runItemDelete(backend, 1);
      const items = runItemList(backend, { all: true });
      expect(items).toHaveLength(0);
    });
  });

  describe('runItemComment', () => {
    it('adds a comment to an item', () => {
      runItemCreate(backend, 'Commentable', {});
      const comment = runItemComment(backend, 1, 'Looks good', {
        author: 'alice',
      });
      expect(comment.body).toBe('Looks good');
      expect(comment.author).toBe('alice');
    });

    it('defaults author to anonymous', () => {
      runItemCreate(backend, 'Commentable', {});
      const comment = runItemComment(backend, 1, 'Note', {});
      expect(comment.author).toBe('anonymous');
    });
  });

  describe('item workflow integration', () => {
    it('create → list → show → update → comment → delete', () => {
      const created = runItemCreate(backend, 'Workflow test', {
        type: 'issue',
        status: 'todo',
        priority: 'high',
      });
      expect(created.id).toBe(1);

      const listed = runItemList(backend, { all: true });
      expect(listed).toHaveLength(1);

      const shown = runItemShow(backend, 1);
      expect(shown.title).toBe('Workflow test');

      const updated = runItemUpdate(backend, 1, { status: 'in-progress' });
      expect(updated.status).toBe('in-progress');

      const comment = runItemComment(backend, 1, 'Working on it', {
        author: 'dev',
      });
      expect(comment.body).toBe('Working on it');

      runItemDelete(backend, 1);
      const afterDelete = runItemList(backend, { all: true });
      expect(afterDelete).toHaveLength(0);
    });
  });
});
