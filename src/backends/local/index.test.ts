import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from './index.js';

describe('LocalBackend', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    backend = new LocalBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('returns default statuses', () => {
    expect(backend.getStatuses()).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('returns default work item types', () => {
    expect(backend.getWorkItemTypes()).toEqual(['epic', 'issue', 'task']);
  });

  it('creates and lists work items', () => {
    backend.createWorkItem({
      title: 'Test',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: 'A test.',
      parent: null,
      dependsOn: [],
    });
    const items = backend.listWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Test');
    expect(items[0]!.type).toBe('task');
    expect(items[0]!.id).toBe(1);
  });

  it('filters work items by iteration', () => {
    backend.createWorkItem({
      title: 'A',
      type: 'epic',
      status: 'todo',
      iteration: 'v1',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    backend.createWorkItem({
      title: 'B',
      type: 'issue',
      status: 'todo',
      iteration: 'v2',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    expect(backend.listWorkItems('v1')).toHaveLength(1);
    expect(backend.listWorkItems('v2')).toHaveLength(1);
  });

  it('updates a work item', () => {
    backend.createWorkItem({
      title: 'Original',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    backend.updateWorkItem(1, { title: 'Updated', status: 'in-progress' });
    const item = backend.getWorkItem(1);
    expect(item.title).toBe('Updated');
    expect(item.status).toBe('in-progress');
  });

  it('deletes a work item', () => {
    backend.createWorkItem({
      title: 'Delete me',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    expect(backend.listWorkItems()).toHaveLength(1);
    backend.deleteWorkItem(1);
    expect(backend.listWorkItems()).toHaveLength(0);
  });

  it('adds a comment', () => {
    backend.createWorkItem({
      title: 'Commentable',
      type: 'issue',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    backend.addComment(1, { author: 'dev', body: 'A comment.' });
    const item = backend.getWorkItem(1);
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.body).toBe('A comment.');
  });

  it('manages iterations', () => {
    expect(backend.getCurrentIteration()).toBe('default');
    backend.setCurrentIteration('v1');
    expect(backend.getCurrentIteration()).toBe('v1');
    expect(backend.getIterations()).toContain('v1');
  });
});
