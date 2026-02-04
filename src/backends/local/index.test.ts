import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { LocalBackend } from './index.js';

describe('LocalBackend', () => {
  let tmpDir: string;
  let backend: LocalBackend;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-test-'));
    backend = await LocalBackend.create(tmpDir);
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
      templates: true,
      templateFields: {
        type: true,
        status: true,
        priority: true,
        assignee: true,
        labels: true,
        iteration: true,
        parent: true,
        dependsOn: true,
        description: true,
      },
    });
  });

  it('returns default statuses', async () => {
    expect(await backend.getStatuses()).toEqual([
      'backlog',
      'todo',
      'in-progress',
      'review',
      'done',
    ]);
  });

  it('returns default work item types', async () => {
    expect(await backend.getWorkItemTypes()).toEqual(['epic', 'issue', 'task']);
  });

  it('creates and lists work items', async () => {
    await backend.createWorkItem({
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
    const items = await backend.listWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0]!.title).toBe('Test');
    expect(items[0]!.type).toBe('task');
    expect(items[0]!.id).toBe('1');
  });

  it('filters work items by iteration', async () => {
    await backend.createWorkItem({
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
    await backend.createWorkItem({
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
    expect(await backend.listWorkItems('v1')).toHaveLength(1);
    expect(await backend.listWorkItems('v2')).toHaveLength(1);
  });

  it('updates a work item', async () => {
    await backend.createWorkItem({
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
    await backend.updateWorkItem('1', {
      title: 'Updated',
      status: 'in-progress',
    });
    const item = await backend.getWorkItem('1');
    expect(item.title).toBe('Updated');
    expect(item.status).toBe('in-progress');
  });

  it('deletes a work item', async () => {
    await backend.createWorkItem({
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
    expect(await backend.listWorkItems()).toHaveLength(1);
    await backend.deleteWorkItem('1');
    expect(await backend.listWorkItems()).toHaveLength(0);
  });

  it('adds a comment', async () => {
    await backend.createWorkItem({
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
    await backend.addComment('1', { author: 'dev', body: 'A comment.' });
    const item = await backend.getWorkItem('1');
    expect(item.comments).toHaveLength(1);
    expect(item.comments[0]!.body).toBe('A comment.');
  });

  it('manages iterations', async () => {
    expect(await backend.getCurrentIteration()).toBe('default');
    await backend.setCurrentIteration('v1');
    expect(await backend.getCurrentIteration()).toBe('v1');
    expect(await backend.getIterations()).toContain('v1');
  });

  it('returns children of a work item', async () => {
    const parent = await backend.createWorkItem({
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
    await backend.createWorkItem({
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
    await backend.createWorkItem({
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
    const children = await backend.getChildren(parent.id);
    expect(children).toHaveLength(2);
    expect(children.map((c) => c.title)).toEqual(
      expect.arrayContaining(['Child 1', 'Child 2']),
    );
  });

  it('returns empty array when item has no children', async () => {
    const item = await backend.createWorkItem({
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
    expect(await backend.getChildren(item.id)).toEqual([]);
  });

  it('returns dependents of a work item', async () => {
    const dep = await backend.createWorkItem({
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
    await backend.createWorkItem({
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
    const dependents = await backend.getDependents(dep.id);
    expect(dependents).toHaveLength(1);
    expect(dependents[0]!.title).toBe('Dependent');
  });

  it('returns empty array when item has no dependents', async () => {
    const item = await backend.createWorkItem({
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
    expect(await backend.getDependents(item.id)).toEqual([]);
  });

  it('rejects self-reference as parent', async () => {
    const item = await backend.createWorkItem({
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
    await expect(
      backend.updateWorkItem(item.id, { parent: item.id }),
    ).rejects.toThrow();
  });

  it('rejects self-reference in dependsOn', async () => {
    const item = await backend.createWorkItem({
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
    await expect(
      backend.updateWorkItem(item.id, { dependsOn: [item.id] }),
    ).rejects.toThrow();
  });

  it('rejects circular parent chain', async () => {
    const a = await backend.createWorkItem({
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
    await backend.createWorkItem({
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
    const c = await backend.createWorkItem({
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
    await expect(
      backend.updateWorkItem(a.id, { parent: c.id }),
    ).rejects.toThrow();
  });

  it('rejects circular dependency chain', async () => {
    const a = await backend.createWorkItem({
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
    const b = await backend.createWorkItem({
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
    await expect(
      backend.updateWorkItem(a.id, { dependsOn: [b.id] }),
    ).rejects.toThrow();
  });

  it('rejects reference to non-existent parent', async () => {
    await expect(
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
    ).rejects.toThrow();
  });

  it('rejects reference to non-existent dependency', async () => {
    await expect(
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
    ).rejects.toThrow();
  });

  it('clears parent reference when parent is deleted', async () => {
    const parent = await backend.createWorkItem({
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
    const child = await backend.createWorkItem({
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
    await backend.deleteWorkItem(parent.id);
    const updated = await backend.getWorkItem(child.id);
    expect(updated.parent).toBeNull();
  });

  describe('LocalBackend temp IDs', () => {
    it('generates local- prefixed IDs when tempIds option is set', async () => {
      const backend = await LocalBackend.create(tmpDir, { tempIds: true });
      const item = await backend.createWorkItem({
        title: 'Temp',
        type: 'task',
        status: 'backlog',
        priority: 'medium',
        assignee: '',
        labels: [],
        iteration: 'default',
        description: '',
        parent: null,
        dependsOn: [],
      });
      expect(item.id.startsWith('local-')).toBe(true);
    });
  });

  it('removes deleted item from dependsOn lists', async () => {
    const dep = await backend.createWorkItem({
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
    const other = await backend.createWorkItem({
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
    const dependent = await backend.createWorkItem({
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
    await backend.deleteWorkItem(dep.id);
    const updated = await backend.getWorkItem(dependent.id);
    expect(updated.dependsOn).toEqual([other.id]);
  });

  it('returns unique assignees from existing items', async () => {
    await backend.createWorkItem({
      title: 'A',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: 'alice',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    await backend.createWorkItem({
      title: 'B',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: 'bob',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    await backend.createWorkItem({
      title: 'C',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: 'alice',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [],
    });
    await backend.createWorkItem({
      title: 'D',
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
    const assignees = await backend.getAssignees();
    expect(assignees).toHaveLength(2);
    expect(assignees).toContain('alice');
    expect(assignees).toContain('bob');
  });

  it('returns empty array when no items have assignees', async () => {
    expect(await backend.getAssignees()).toEqual([]);
  });
});
