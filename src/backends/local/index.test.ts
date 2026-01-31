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

  it('returns capabilities with all features enabled', () => {
    const caps = backend.getCapabilities();
    expect(caps).toEqual({
      relationships: true,
      customTypes: true,
      customStatuses: true,
      iterations: true,
      comments: true,
      fields: {
        priority: true,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: true,
      },
    });
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
    expect(items[0]!.id).toBe('1');
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
    backend.updateWorkItem('1', { title: 'Updated', status: 'in-progress' });
    const item = backend.getWorkItem('1');
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
    backend.deleteWorkItem('1');
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
    backend.addComment('1', { author: 'dev', body: 'A comment.' });
    const item = backend.getWorkItem('1');
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.body).toBe('A comment.');
  });

  it('manages iterations', () => {
    expect(backend.getCurrentIteration()).toBe('default');
    backend.setCurrentIteration('v1');
    expect(backend.getCurrentIteration()).toBe('v1');
    expect(backend.getIterations()).toContain('v1');
  });

  it('returns children of a work item', () => {
    const parent = backend.createWorkItem({
      title: 'Parent',
      type: 'epic',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    backend.createWorkItem({
      title: 'Child 1',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: parent.id,
      dependsOn: [],
    });
    backend.createWorkItem({
      title: 'Child 2',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: parent.id,
      dependsOn: [],
    });
    const children = backend.getChildren(parent.id);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual(
      expect.arrayContaining(['Child 1', 'Child 2']),
    );
  });

  it('returns empty array when item has no children', () => {
    const item = backend.createWorkItem({
      title: 'Lonely',
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
    expect(backend.getChildren(item.id)).toEqual([]);
  });

  it('returns dependents of a work item', () => {
    const dep = backend.createWorkItem({
      title: 'Dependency',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    backend.createWorkItem({
      title: 'Dependent',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [dep.id],
    });
    const dependents = backend.getDependents(dep.id);
    expect(dependents).toHaveLength(1);
    expect(dependents[0]!.title).toBe('Dependent');
  });

  it('returns empty array when item has no dependents', () => {
    const item = backend.createWorkItem({
      title: 'Independent',
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
    expect(backend.getDependents(item.id)).toEqual([]);
  });

  it('rejects self-reference as parent', () => {
    const item = backend.createWorkItem({
      title: 'Self',
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
    expect(() =>
      backend.updateWorkItem(item.id, { parent: item.id }),
    ).toThrow();
  });

  it('rejects self-reference in dependsOn', () => {
    const item = backend.createWorkItem({
      title: 'Self',
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
    expect(() =>
      backend.updateWorkItem(item.id, { dependsOn: [item.id] }),
    ).toThrow();
  });

  it('rejects circular parent chain', () => {
    const a = backend.createWorkItem({
      title: 'A',
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
    backend.createWorkItem({
      title: 'B',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: a.id,
      dependsOn: [],
    });
    const c = backend.createWorkItem({
      title: 'C',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: '2',
      dependsOn: [],
    });
    // Try to make A a child of C — creates cycle A -> B -> C -> A
    expect(() => backend.updateWorkItem(a.id, { parent: c.id })).toThrow();
  });

  it('rejects circular dependency chain', () => {
    const a = backend.createWorkItem({
      title: 'A',
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
    const b = backend.createWorkItem({
      title: 'B',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [a.id],
    });
    // Try to make A depend on B — creates cycle A -> B -> A
    expect(() => backend.updateWorkItem(a.id, { dependsOn: [b.id] })).toThrow();
  });

  it('rejects reference to non-existent parent', () => {
    expect(() =>
      backend.createWorkItem({
        title: 'Orphan',
        type: 'task',
        status: 'todo',
        iteration: 'default',
        priority: 'low',
        assignee: '',
        labels: [],
        description: '',
        parent: '999',
        dependsOn: [],
      }),
    ).toThrow();
  });

  it('rejects reference to non-existent dependency', () => {
    expect(() =>
      backend.createWorkItem({
        title: 'Bad dep',
        type: 'task',
        status: 'todo',
        iteration: 'default',
        priority: 'low',
        assignee: '',
        labels: [],
        description: '',
        parent: null,
        dependsOn: ['999'],
      }),
    ).toThrow();
  });

  it('clears parent reference when parent is deleted', () => {
    const parent = backend.createWorkItem({
      title: 'Parent',
      type: 'epic',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    const child = backend.createWorkItem({
      title: 'Child',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: parent.id,
      dependsOn: [],
    });
    backend.deleteWorkItem(parent.id);
    const updated = backend.getWorkItem(child.id);
    expect(updated.parent).toBeNull();
  });

  it('removes deleted item from dependsOn lists', () => {
    const dep = backend.createWorkItem({
      title: 'Dependency',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    const other = backend.createWorkItem({
      title: 'Other dep',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'medium',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    const dependent = backend.createWorkItem({
      title: 'Dependent',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [dep.id, other.id],
    });
    backend.deleteWorkItem(dep.id);
    const updated = backend.getWorkItem(dependent.id);
    expect(updated.dependsOn).toEqual([other.id]);
  });
});
