import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createDatabase, type TicDatabase } from './db.js';
import { Storage } from './index.js';
import { isSoftDeleteBackend } from '../backends/types.js';
import { makeNewWorkItem, makeTemplate } from '../test-helpers.js';
import { updateConfig } from './config.js';

describe('Storage', () => {
  let db: TicDatabase;
  let backend: Storage;

  beforeEach(() => {
    db = createDatabase(':memory:');
    backend = Storage.createFromDb(db);
  });

  afterEach(() => {
    db.close();
  });

  // ─── getCapabilities ────────────────────────────────────────────

  describe('getCapabilities', () => {
    it('returns all capabilities as true', () => {
      const caps = backend.getCapabilities();
      expect(caps.relationships).toBe(true);
      expect(caps.customTypes).toBe(true);
      expect(caps.customStatuses).toBe(true);
      expect(caps.iterations).toBe(true);
      expect(caps.comments).toBe(true);
      expect(caps.templates).toBe(true);
      expect(caps.fields.priority).toBe(true);
      expect(caps.fields.assignee).toBe(true);
      expect(caps.fields.labels).toBe(true);
      expect(caps.fields.parent).toBe(true);
      expect(caps.fields.dependsOn).toBe(true);
      expect(caps.templateFields.type).toBe(true);
      expect(caps.templateFields.status).toBe(true);
      expect(caps.templateFields.priority).toBe(true);
      expect(caps.templateFields.assignee).toBe(true);
      expect(caps.templateFields.labels).toBe(true);
      expect(caps.templateFields.iteration).toBe(true);
      expect(caps.templateFields.parent).toBe(true);
      expect(caps.templateFields.dependsOn).toBe(true);
      expect(caps.templateFields.description).toBe(true);
    });
  });

  // ─── getStatuses ────────────────────────────────────────────────

  describe('getStatuses', () => {
    it('returns default statuses in order', async () => {
      const statuses = await backend.getStatuses();
      expect(statuses).toEqual([
        'backlog',
        'todo',
        'in-progress',
        'review',
        'done',
      ]);
    });
  });

  // ─── getIterations ──────────────────────────────────────────────

  describe('getIterations', () => {
    it('returns default iterations', async () => {
      const iterations = await backend.getIterations();
      expect(iterations).toEqual([
        { name: 'default', startDate: null, endDate: null },
      ]);
    });
  });

  // ─── getWorkItemTypes ───────────────────────────────────────────

  describe('getWorkItemTypes', () => {
    it('returns default types in order', async () => {
      const types = await backend.getWorkItemTypes();
      expect(types).toEqual(['epic', 'issue', 'task']);
    });
  });

  // ─── getAssignees ───────────────────────────────────────────────

  describe('getAssignees', () => {
    it('returns empty array when no items exist', async () => {
      const assignees = await backend.getAssignees();
      expect(assignees).toEqual([]);
    });

    it('returns unique sorted assignees from work items', async () => {
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Charlie' }));
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Alice' }));
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Bob' }));
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Alice' })); // duplicate

      const assignees = await backend.getAssignees();
      expect(assignees).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('excludes empty assignees', async () => {
      await backend.createWorkItem(makeNewWorkItem({ assignee: '' }));
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Alice' }));

      const assignees = await backend.getAssignees();
      expect(assignees).toEqual(['Alice']);
    });

    it('excludes assignees from soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ assignee: 'Deleted' }),
      );
      await backend.createWorkItem(makeNewWorkItem({ assignee: 'Active' }));
      await backend.softDeleteWorkItem(item.id!);

      const assignees = await backend.getAssignees();
      expect(assignees).toEqual(['Active']);
    });
  });

  // ─── getLabels ──────────────────────────────────────────────────

  describe('getLabels', () => {
    it('returns empty array when no items exist', async () => {
      const labels = await backend.getLabels();
      expect(labels).toEqual([]);
    });

    it('returns unique sorted labels from work items', async () => {
      await backend.createWorkItem(
        makeNewWorkItem({ labels: ['bug', 'frontend'] }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ labels: ['backend', 'bug'] }),
      ); // 'bug' is duplicate

      const labels = await backend.getLabels();
      expect(labels).toEqual(['backend', 'bug', 'frontend']);
    });

    it('excludes labels from soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ labels: ['deleted-label'] }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ labels: ['active-label'] }),
      );
      await backend.softDeleteWorkItem(item.id!);

      const labels = await backend.getLabels();
      expect(labels).toEqual(['active-label']);
    });
  });

  // ─── getCurrentIteration ────────────────────────────────────────

  describe('getCurrentIteration', () => {
    it('returns default iteration', async () => {
      const iteration = await backend.getCurrentIteration();
      expect(iteration).toBe('default');
    });

    it('returns updated iteration after setCurrentIteration', async () => {
      await backend.setCurrentIteration('sprint-1');
      const iteration = await backend.getCurrentIteration();
      expect(iteration).toBe('sprint-1');
    });
  });

  // ─── setCurrentIteration ────────────────────────────────────────

  describe('setCurrentIteration', () => {
    it('sets current iteration and adds it to iterations list', async () => {
      await backend.setCurrentIteration('sprint-2');
      const current = await backend.getCurrentIteration();
      expect(current).toBe('sprint-2');

      const iterations = await backend.getIterations();
      expect(iterations.map((i) => i.name)).toContain('sprint-2');
    });
  });

  // ─── listWorkItems ──────────────────────────────────────────────

  describe('listWorkItems', () => {
    it('returns empty array when no items exist', async () => {
      const items = await backend.listWorkItems();
      expect(items).toEqual([]);
    });

    it('returns all non-deleted items', async () => {
      await backend.createWorkItem(makeNewWorkItem({ title: 'Item 1' }));
      await backend.createWorkItem(makeNewWorkItem({ title: 'Item 2' }));

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.title)).toContain('Item 1');
      expect(items.map((i) => i.title)).toContain('Item 2');
    });

    it('returns items with labels, deps, and comments', async () => {
      const item1 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dep target' }),
      );
      const item2 = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Main item',
          labels: ['bug', 'urgent'],
          dependsOn: [item1.rowId],
        }),
      );

      const items = await backend.listWorkItems();
      const main = items.find((i) => i.id === item2.id!);
      expect(main).toBeDefined();
      expect(main!.labels).toEqual(['bug', 'urgent']);
      expect(main!.dependsOn).toEqual([item1.rowId]);
    });

    it('filters by iteration', async () => {
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Sprint 1', iteration: 'sprint-1' }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Sprint 2', iteration: 'sprint-2' }),
      );

      const items = await backend.listWorkItems('sprint-1');
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('Sprint 1');
    });

    it('excludes soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ title: 'To delete' }),
      );
      await backend.createWorkItem(makeNewWorkItem({ title: 'To keep' }));
      await backend.softDeleteWorkItem(item.id!);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('To keep');
    });

    it('returns items with correct WorkItem shape', async () => {
      await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Full item',
          type: 'issue',
          status: 'in-progress',
          iteration: 'default',
          priority: 'high',
          assignee: 'Alice',
          labels: ['feature'],
          description: 'A description',
        }),
      );

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(1);
      const item = items[0]!;
      expect(item.id!).toBe('1');
      expect(item.title).toBe('Full item');
      expect(item.type).toBe('issue');
      expect(item.status).toBe('in-progress');
      expect(item.iteration).toBe('default');
      expect(item.priority).toBe('high');
      expect(item.assignee).toBe('Alice');
      expect(item.labels).toEqual(['feature']);
      expect(item.description).toBe('A description');
      expect(item.comments).toEqual([]);
      expect(item.parent).toBeNull();
      expect(item.dependsOn).toEqual([]);
      expect(item.created).toBeDefined();
      expect(item.updated).toBeDefined();
    });
  });

  // ─── getWorkItem ────────────────────────────────────────────────

  describe('getWorkItem', () => {
    it('returns work item by id', async () => {
      const created = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Find me' }),
      );

      const item = await backend.getWorkItem(created.id!);
      expect(item.id!).toBe(created.id!);
      expect(item.title).toBe('Find me');
    });

    it('throws when work item not found', async () => {
      await expect(backend.getWorkItem('999')).rejects.toThrow(
        'Work item #999 not found',
      );
    });

    it('throws when work item is soft-deleted', async () => {
      const created = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Deleted' }),
      );
      await backend.softDeleteWorkItem(created.id!);

      await expect(backend.getWorkItem(created.id!)).rejects.toThrow(
        `Work item #${created.id!} not found`,
      );
    });

    it('returns work item with labels and deps', async () => {
      const dep = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dependency' }),
      );
      const item = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'With relations',
          labels: ['important', 'review'],
          dependsOn: [dep.rowId],
        }),
      );

      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.labels).toEqual(['important', 'review']);
      expect(fetched.dependsOn).toEqual([dep.rowId]);
    });
  });

  // ─── getChildren ────────────────────────────────────────────────

  describe('getChildren', () => {
    it('returns empty array when no children', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const children = await backend.getChildren(item.id!);
      expect(children).toEqual([]);
    });

    it('returns child items', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent' }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Child 1', parent: parent.rowId }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Child 2', parent: parent.rowId }),
      );
      await backend.createWorkItem(makeNewWorkItem({ title: 'Not a child' }));

      const children = await backend.getChildren(parent.id!);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.title).sort()).toEqual([
        'Child 1',
        'Child 2',
      ]);
    });

    it('excludes soft-deleted children', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Deleted child', parent: parent.rowId }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Active child', parent: parent.rowId }),
      );
      await backend.softDeleteWorkItem(child.id!);

      const children = await backend.getChildren(parent.id!);
      expect(children).toHaveLength(1);
      expect(children[0]!.title).toBe('Active child');
    });
  });

  // ─── getDependents ──────────────────────────────────────────────

  describe('getDependents', () => {
    it('returns empty array when no dependents', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const dependents = await backend.getDependents(item.id!);
      expect(dependents).toEqual([]);
    });

    it('returns items that depend on the given item', async () => {
      const target = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Target' }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Depends 1', dependsOn: [target.rowId] }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Depends 2', dependsOn: [target.rowId] }),
      );
      await backend.createWorkItem(makeNewWorkItem({ title: 'Independent' }));

      const dependents = await backend.getDependents(target.id!);
      expect(dependents).toHaveLength(2);
      expect(dependents.map((d) => d.title).sort()).toEqual([
        'Depends 1',
        'Depends 2',
      ]);
    });

    it('excludes soft-deleted dependents', async () => {
      const target = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Target' }),
      );
      const dep = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Deleted dep', dependsOn: [target.rowId] }),
      );
      await backend.createWorkItem(
        makeNewWorkItem({ title: 'Active dep', dependsOn: [target.rowId] }),
      );
      await backend.softDeleteWorkItem(dep.id!);

      const dependents = await backend.getDependents(target.id!);
      expect(dependents).toHaveLength(1);
      expect(dependents[0]!.title).toBe('Active dep');
    });
  });

  // ─── getItemUrl ─────────────────────────────────────────────────

  describe('getItemUrl', () => {
    it('returns file path for item', () => {
      const url = backend.getItemUrl('1');
      expect(url).toBe(':memory:/.tic/items/1.md');
    });
  });

  // ─── createWorkItem (basic verification) ────────────────────────

  describe('createWorkItem', () => {
    it('auto-increments IDs', async () => {
      const item1 = await backend.createWorkItem(makeNewWorkItem());
      const item2 = await backend.createWorkItem(makeNewWorkItem());
      expect(item1.id).toBe('1');
      expect(item2.id).toBe('2');
    });

    it('sets created and updated timestamps', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      expect(item.created).toBeDefined();
      expect(item.updated).toBeDefined();
      // Timestamps should be ISO 8601
      expect(new Date(item.created).toISOString()).toBe(item.created);
    });

    it('persists parent relationship', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Child', parent: parent.rowId }),
      );

      const fetched = await backend.getWorkItem(child.id!);
      expect(fetched.parent).toBe(parent.rowId);
    });

    it('assigns unique rowIds when two connections create items', async () => {
      // Regression test for #37: UNIQUE constraint errors with concurrent MCP calls.
      // With AUTOINCREMENT rowIds, SQLite handles uniqueness natively.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-race-'));
      const storage1 = Storage.create(tmpDir);
      const storage2 = Storage.create(tmpDir);

      try {
        const [item1, item2] = await Promise.all([
          storage1.createWorkItem(makeNewWorkItem({ title: 'From conn 1' })),
          storage2.createWorkItem(makeNewWorkItem({ title: 'From conn 2' })),
        ]);

        expect(item1.rowId).not.toBe(item2.rowId);
        expect(item1.id).not.toBe(item2.id);

        const all = await storage1.listWorkItems();
        expect(all).toHaveLength(2);
      } finally {
        storage1.destroy();
        storage2.destroy();
        fs.rmSync(tmpDir, { recursive: true, force: true });
      }
    });

    it('adds new iteration to iterations table', async () => {
      await backend.createWorkItem(
        makeNewWorkItem({ iteration: 'new-sprint' }),
      );
      const iterations = await backend.getIterations();
      expect(iterations.map((i) => i.name)).toContain('new-sprint');
    });

    it('auto-increment IDs are stable across config updates', async () => {
      await backend.createWorkItem(makeNewWorkItem({ title: 'Item 1' }));
      await backend.createWorkItem(makeNewWorkItem({ title: 'Item 2' }));

      // Simulate a config update (e.g., changing statuses from Settings)
      updateConfig(db, { statuses: ['open', 'closed', 'in progress'] });

      // Creating another item should get the next rowId, not collide
      const item3 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Item 3' }),
      );
      expect(item3.rowId).toBe(3);
      expect(item3.id).toBe('3');
    });
  });

  // ─── createWorkItem (relationship validation) ─────────────────────

  describe('createWorkItem (relationship validation)', () => {
    it('rejects self-referencing parent', async () => {
      // Create an item first so we know what ID "2" would be
      const item = await backend.createWorkItem(makeNewWorkItem());
      // Now try to create an item that would be its own parent
      // Since the next ID will be "2", we can't directly self-reference on create
      // But we CAN verify it rejects a non-existent parent (which covers the lookup)
      // A more realistic scenario: set parent = the item's own id via update
      // For create, self-reference is tricky because the ID hasn't been assigned yet.
      // The validation runs after ID assignment, so let's test via update instead.
      // However, we can test the case where parent is set to a future ID
      // that doesn't exist yet — that should fail with "does not exist"
      expect(item).toBeDefined();

      // The most realistic self-ref test is via updateWorkItem
      await expect(
        backend.updateWorkItem(item.id!, { parent: item.rowId }),
      ).rejects.toThrow(`Work item #${item.id!} cannot be its own parent`);
    });

    it('rejects non-existent parent', async () => {
      await expect(
        backend.createWorkItem(makeNewWorkItem({ parent: 999 })),
      ).rejects.toThrow('Parent #999 does not exist');
    });

    it('rejects circular parent chain', async () => {
      const grandparent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Grandparent' }),
      );
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', parent: grandparent.rowId }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Child', parent: parent.rowId }),
      );

      // Now try to set grandparent's parent to child — creates a cycle
      await expect(
        backend.updateWorkItem(grandparent.id!, { parent: child.rowId }),
      ).rejects.toThrow(
        `Circular parent chain detected for #${grandparent.id!}`,
      );
    });

    it('rejects self-referencing dependency', async () => {
      // Create an item, then try to make it depend on itself via update
      const item = await backend.createWorkItem(makeNewWorkItem());
      await expect(
        backend.updateWorkItem(item.id!, { dependsOn: [item.rowId] }),
      ).rejects.toThrow(`Work item #${item.id!} cannot depend on itself`);
    });

    it('rejects non-existent dependency', async () => {
      await expect(
        backend.createWorkItem(makeNewWorkItem({ dependsOn: [999] })),
      ).rejects.toThrow('Dependency #999 does not exist');
    });

    it('rejects circular dependency chain', async () => {
      const a = await backend.createWorkItem(makeNewWorkItem({ title: 'A' }));
      const b = await backend.createWorkItem(
        makeNewWorkItem({ title: 'B', dependsOn: [a.rowId] }),
      );
      const c = await backend.createWorkItem(
        makeNewWorkItem({ title: 'C', dependsOn: [b.rowId] }),
      );

      // Now try to make A depend on C — creates a cycle: A -> C -> B -> A
      await expect(
        backend.updateWorkItem(a.id!, { dependsOn: [c.rowId] }),
      ).rejects.toThrow(`Circular dependency chain detected for #${a.id!}`);
    });
  });

  // ─── updateWorkItem ──────────────────────────────────────────────

  describe('updateWorkItem', () => {
    it('updates title', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Original' }),
      );
      const updated = await backend.updateWorkItem(item.id!, {
        title: 'Updated',
      });
      expect(updated.title).toBe('Updated');

      // Verify persisted
      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.title).toBe('Updated');
    });

    it('updates status', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ status: 'todo' }),
      );
      const updated = await backend.updateWorkItem(item.id!, {
        status: 'in-progress',
      });
      expect(updated.status).toBe('in-progress');
    });

    it('updates priority', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ priority: 'low' }),
      );
      const updated = await backend.updateWorkItem(item.id!, {
        priority: 'high',
      });
      expect(updated.priority).toBe('high');
    });

    it('updates assignee', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ assignee: 'Alice' }),
      );
      const updated = await backend.updateWorkItem(item.id!, {
        assignee: 'Bob',
      });
      expect(updated.assignee).toBe('Bob');
    });

    it('replaces labels', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ labels: ['old-label', 'keep-label'] }),
      );
      const updated = await backend.updateWorkItem(item.id!, {
        labels: ['new-label', 'another-label'],
      });
      expect(updated.labels.sort()).toEqual(
        ['another-label', 'new-label'].sort(),
      );

      // Verify old labels are gone
      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.labels.sort()).toEqual(
        ['another-label', 'new-label'].sort(),
      );
      expect(fetched.labels).not.toContain('old-label');
      expect(fetched.labels).not.toContain('keep-label');
    });

    it('replaces dependencies', async () => {
      const dep1 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dep 1' }),
      );
      const dep2 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dep 2' }),
      );
      const dep3 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dep 3' }),
      );
      const item = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Main', dependsOn: [dep1.rowId, dep2.rowId] }),
      );

      const updated = await backend.updateWorkItem(item.id!, {
        dependsOn: [dep2.rowId, dep3.rowId],
      });
      expect(updated.dependsOn).toEqual([dep2.rowId, dep3.rowId]);

      // Verify dep1 is no longer referenced
      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.dependsOn).toEqual([dep2.rowId, dep3.rowId]);
      expect(fetched.dependsOn).not.toContain(dep1.rowId);
    });

    it('validates relationships on update', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());

      // Non-existent parent
      await expect(
        backend.updateWorkItem(item.id!, { parent: 999 }),
      ).rejects.toThrow('Parent #999 does not exist');

      // Non-existent dependency
      await expect(
        backend.updateWorkItem(item.id!, { dependsOn: [999] }),
      ).rejects.toThrow('Dependency #999 does not exist');
    });

    it('sets updated timestamp', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const originalUpdated = item.updated;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      const updated = await backend.updateWorkItem(item.id!, {
        title: 'Changed',
      });
      expect(updated.updated).not.toBe(originalUpdated);
      expect(new Date(updated.updated).getTime()).toBeGreaterThan(
        new Date(originalUpdated).getTime(),
      );
    });

    it('does not change created timestamp', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const originalCreated = item.created;

      await new Promise((r) => setTimeout(r, 10));

      const updated = await backend.updateWorkItem(item.id!, {
        title: 'Changed',
      });
      expect(updated.created).toBe(originalCreated);
    });

    it('throws when work item not found', async () => {
      await expect(
        backend.updateWorkItem('999', { title: 'Nope' }),
      ).rejects.toThrow('Work item #999 not found');
    });

    it('handles partial updates without affecting other fields', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Original',
          status: 'todo',
          priority: 'high',
          assignee: 'Alice',
          labels: ['bug'],
          description: 'Some description',
        }),
      );

      // Only update title
      const updated = await backend.updateWorkItem(item.id!, {
        title: 'New Title',
      });

      expect(updated.title).toBe('New Title');
      expect(updated.status).toBe('todo');
      expect(updated.priority).toBe('high');
      expect(updated.assignee).toBe('Alice');
      expect(updated.labels).toEqual(['bug']);
      expect(updated.description).toBe('Some description');
    });
  });

  // ─── getClosedStatuses ──────────────────────────────────────────

  describe('getClosedStatuses', () => {
    it('returns the last status as closed by default', async () => {
      const closed = await backend.getClosedStatuses();
      expect(closed).toEqual(['done']);
    });

    it('returns last status when statuses are customized', async () => {
      updateConfig(db, { statuses: ['open', 'wip', 'closed'] });
      const closed = await backend.getClosedStatuses();
      expect(closed).toEqual(['closed']);
    });
  });

  // ─── updateWorkItem iteration cascade ─────────────────────────────

  describe('updateWorkItem iteration cascade', () => {
    it('cascades iteration change to direct children', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', iteration: 'sprint-1' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Child',
          iteration: 'sprint-1',
          parent: parent.rowId,
        }),
      );

      await backend.updateWorkItem(parent.id!, { iteration: 'sprint-2' });

      const updatedChild = await backend.getWorkItem(child.id!);
      expect(updatedChild.iteration).toBe('sprint-2');
    });

    it('cascades iteration change to all descendants recursively', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', iteration: 'sprint-1' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Child',
          iteration: 'sprint-1',
          parent: parent.rowId,
        }),
      );
      const grandchild = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Grandchild',
          iteration: 'sprint-1',
          parent: child.rowId,
        }),
      );

      await backend.updateWorkItem(parent.id!, { iteration: 'sprint-2' });

      const updatedChild = await backend.getWorkItem(child.id!);
      const updatedGrandchild = await backend.getWorkItem(grandchild.id!);
      expect(updatedChild.iteration).toBe('sprint-2');
      expect(updatedGrandchild.iteration).toBe('sprint-2');
    });

    it('does not cascade to closed descendants', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', iteration: 'sprint-1' }),
      );
      const openChild = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Open Child',
          iteration: 'sprint-1',
          status: 'todo',
          parent: parent.rowId,
        }),
      );
      const closedChild = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Closed Child',
          iteration: 'sprint-1',
          status: 'done',
          parent: parent.rowId,
        }),
      );

      await backend.updateWorkItem(parent.id!, { iteration: 'sprint-2' });

      const updatedOpen = await backend.getWorkItem(openChild.id!);
      const updatedClosed = await backend.getWorkItem(closedChild.id!);
      expect(updatedOpen.iteration).toBe('sprint-2');
      expect(updatedClosed.iteration).toBe('sprint-1');
    });

    it('does not cascade through closed descendants', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', iteration: 'sprint-1' }),
      );
      const closedChild = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Closed Child',
          iteration: 'sprint-1',
          status: 'done',
          parent: parent.rowId,
        }),
      );
      const grandchild = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Grandchild under closed',
          iteration: 'sprint-1',
          status: 'todo',
          parent: closedChild.rowId,
        }),
      );

      await backend.updateWorkItem(parent.id!, { iteration: 'sprint-2' });

      const updatedClosed = await backend.getWorkItem(closedChild.id!);
      const updatedGrandchild = await backend.getWorkItem(grandchild.id!);
      expect(updatedClosed.iteration).toBe('sprint-1');
      expect(updatedGrandchild.iteration).toBe('sprint-1');
    });

    it('does not cascade when iteration does not change', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent', iteration: 'sprint-1' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({
          title: 'Child',
          iteration: 'sprint-1',
          parent: parent.rowId,
        }),
      );

      // Update title only, not iteration
      await backend.updateWorkItem(parent.id!, { title: 'New Title' });

      const updatedChild = await backend.getWorkItem(child.id!);
      expect(updatedChild.iteration).toBe('sprint-1');
    });
  });

  // ─── deleteWorkItem ──────────────────────────────────────────────

  describe('deleteWorkItem', () => {
    it('removes item', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.deleteWorkItem(item.id!);

      await expect(backend.getWorkItem(item.id!)).rejects.toThrow(
        `Work item #${item.id!} not found`,
      );
    });

    it('cascade deletes labels of the deleted item', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ labels: ['bug', 'feature'] }),
      );
      await backend.deleteWorkItem(item.id!);

      // Verify labels are gone from the database
      const labelCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM work_item_labels WHERE work_item_row_id = ?',
        )
        .get(item.rowId) as { count: number };
      expect(labelCount.count).toBe(0);
    });

    it('cascade deletes deps of the deleted item', async () => {
      const dep = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dep target' }),
      );
      const item = await backend.createWorkItem(
        makeNewWorkItem({ dependsOn: [dep.rowId] }),
      );
      await backend.deleteWorkItem(item.id!);

      // Verify deps are gone
      const depCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM work_item_deps WHERE work_item_row_id = ?',
        )
        .get(item.rowId) as { count: number };
      expect(depCount.count).toBe(0);
    });

    it('cascade deletes comments of the deleted item', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.addComment(item.id!, {
        author: 'Alice',
        body: 'A comment',
      });
      await backend.deleteWorkItem(item.id!);

      // Verify comments are gone
      const commentCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM comments WHERE work_item_row_id = ?',
        )
        .get(item.rowId) as { count: number };
      expect(commentCount.count).toBe(0);
    });

    it('cleans up parent references (children get parent = null)', async () => {
      const parent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Child', parent: parent.rowId }),
      );

      await backend.deleteWorkItem(parent.id!);

      const fetchedChild = await backend.getWorkItem(child.id!);
      expect(fetchedChild.parent).toBeNull();
    });

    it('cleans up dependency references (deps pointing to deleted item removed)', async () => {
      const target = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Target' }),
      );
      const dependent = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Dependent', dependsOn: [target.rowId] }),
      );

      await backend.deleteWorkItem(target.id!);

      const fetchedDependent = await backend.getWorkItem(dependent.id!);
      expect(fetchedDependent.dependsOn).toEqual([]);
    });
  });

  // ─── addComment ──────────────────────────────────────────────────

  describe('addComment', () => {
    it('adds comment to existing item', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const comment = await backend.addComment(item.id!, {
        author: 'Alice',
        body: 'This is a comment',
      });

      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('This is a comment');
      expect(comment.date).toBeDefined();
      expect(new Date(comment.date).toISOString()).toBe(comment.date);
    });

    it('comment has author, date, and body', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const comment = await backend.addComment(item.id!, {
        author: 'Bob',
        body: 'Hello world',
      });

      expect(comment).toHaveProperty('author', 'Bob');
      expect(comment).toHaveProperty('body', 'Hello world');
      expect(comment).toHaveProperty('date');
    });

    it('comment is retrievable via getWorkItem', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.addComment(item.id!, {
        author: 'Alice',
        body: 'First comment',
      });
      await backend.addComment(item.id!, {
        author: 'Bob',
        body: 'Second comment',
      });

      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.comments).toHaveLength(2);
      expect(fetched.comments[0]!.author).toBe('Alice');
      expect(fetched.comments[0]!.body).toBe('First comment');
      expect(fetched.comments[1]!.author).toBe('Bob');
      expect(fetched.comments[1]!.body).toBe('Second comment');
    });

    it('does not change item updated timestamp', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      const originalUpdated = item.updated;

      await new Promise((r) => setTimeout(r, 10));

      await backend.addComment(item.id!, {
        author: 'Alice',
        body: 'A comment',
      });

      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.updated).toBe(originalUpdated);
    });

    it('throws if item does not exist', async () => {
      await expect(
        backend.addComment('999', { author: 'Alice', body: 'Nope' }),
      ).rejects.toThrow('Work item "999" not found');
    });
  });

  // ─── seedDefaults (idempotency) ─────────────────────────────────

  describe('seedDefaults', () => {
    it('is idempotent — creating backend twice does not duplicate data', () => {
      // Create another backend from same DB — seedDefaults runs again
      const backend2 = Storage.createFromDb(db);
      // Statuses should not be duplicated
      const statuses = db.raw
        .prepare('SELECT COUNT(*) as count FROM statuses')
        .get() as { count: number };
      expect(statuses.count).toBe(5);
      // Suppress unused variable warning
      expect(backend2).toBeDefined();
    });
  });

  // ─── SoftDeleteBackend ───────────────────────────────────────────

  describe('SoftDeleteBackend', () => {
    it('soft-deletes by setting deletedAt', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.softDeleteWorkItem(item.id!);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(0);
    });

    it('restores soft-deleted item', async () => {
      const item = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Restore me' }),
      );
      await backend.softDeleteWorkItem(item.id!);

      // Verify it's gone from list
      let items = await backend.listWorkItems();
      expect(items).toHaveLength(0);

      // Restore it
      await backend.restoreWorkItem(item.id!);

      // Verify it's back
      items = await backend.listWorkItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(item.id!);
      expect(items[0]!.title).toBe('Restore me');
    });

    it('permanently deletes from trash', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.softDeleteWorkItem(item.id!);
      await backend.permanentlyDeleteWorkItem(item.id!);

      // Verify completely gone — even a direct DB query should return nothing
      const row = db.raw
        .prepare('SELECT COUNT(*) as count FROM work_items WHERE row_id = ?')
        .get(item.rowId) as { count: number };
      expect(row.count).toBe(0);
    });

    it('cleanup removes all soft-deleted items', async () => {
      const item1 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Item 1' }),
      );
      const item2 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Item 2' }),
      );
      const item3 = await backend.createWorkItem(
        makeNewWorkItem({ title: 'Item 3 (keep)' }),
      );
      await backend.softDeleteWorkItem(item1.id!);
      await backend.softDeleteWorkItem(item2.id!);

      await backend.cleanupTrash();

      // Both soft-deleted items should be permanently gone
      const trashCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM work_items WHERE deleted_at IS NOT NULL',
        )
        .get() as { count: number };
      expect(trashCount.count).toBe(0);

      // The non-deleted item should still exist
      const items = await backend.listWorkItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.id).toBe(item3.id!);
    });

    it('isSoftDeleteBackend returns true', () => {
      expect(isSoftDeleteBackend(backend)).toBe(true);
    });
  });

  // ─── Templates ──────────────────────────────────────────────────

  describe('templates', () => {
    it('lists templates (empty)', async () => {
      const templates = await backend.listTemplates();
      expect(templates).toEqual([]);
    });

    it('creates and retrieves template', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'Bug Report' }),
      );
      expect(t.slug).toBe('bug-report');
      expect(t.name).toBe('Bug Report');

      const fetched = await backend.getTemplate('bug-report');
      expect(fetched.name).toBe('Bug Report');
      expect(fetched.slug).toBe('bug-report');
    });

    it('creates template with all fields', async () => {
      const t = await backend.createTemplate(
        makeTemplate({
          name: 'Full Template',
          type: 'issue',
          status: 'in-progress',
          priority: 'high',
          assignee: 'Alice',
          iteration: 'sprint-1',
          parent: null,
          description: 'Full description',
        }),
      );

      const fetched = await backend.getTemplate(t.slug);
      expect(fetched.type).toBe('issue');
      expect(fetched.status).toBe('in-progress');
      expect(fetched.priority).toBe('high');
      expect(fetched.assignee).toBe('Alice');
      expect(fetched.iteration).toBe('sprint-1');
      expect(fetched.description).toBe('Full description');
    });

    it('creates template with labels and deps', async () => {
      const t = await backend.createTemplate(
        makeTemplate({
          name: 'Feature',
          labels: ['frontend', 'ux'],
          dependsOn: ['1', '2'],
        }),
      );

      const fetched = await backend.getTemplate(t.slug);
      expect(fetched.labels).toEqual(['frontend', 'ux']);
      expect(fetched.dependsOn).toEqual(['1', '2']);
    });

    it('lists multiple templates', async () => {
      await backend.createTemplate(makeTemplate({ name: 'Bug Report' }));
      await backend.createTemplate(makeTemplate({ name: 'Feature Request' }));

      const templates = await backend.listTemplates();
      expect(templates).toHaveLength(2);
      const slugs = templates.map((t) => t.slug).sort();
      expect(slugs).toEqual(['bug-report', 'feature-request']);
    });

    it('lists templates with labels and deps assembled', async () => {
      await backend.createTemplate(
        makeTemplate({
          name: 'Labeled',
          labels: ['important'],
          dependsOn: ['dep-1'],
        }),
      );

      const templates = await backend.listTemplates();
      expect(templates).toHaveLength(1);
      expect(templates[0]!.labels).toEqual(['important']);
      expect(templates[0]!.dependsOn).toEqual(['dep-1']);
    });

    it('updates template (same slug)', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'Bug Report', type: 'bug', priority: 'low' }),
      );

      const updated = await backend.updateTemplate(t.slug, {
        ...t,
        type: 'issue',
        priority: 'high',
      });

      expect(updated.slug).toBe('bug-report');
      expect(updated.type).toBe('issue');
      expect(updated.priority).toBe('high');
    });

    it('updates template with slug rename', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'Old Name', type: 'task' }),
      );

      const updated = await backend.updateTemplate(t.slug, {
        ...t,
        name: 'New Name',
        type: 'issue',
      });

      expect(updated.slug).toBe('new-name');
      expect(updated.name).toBe('New Name');
      expect(updated.type).toBe('issue');

      // Old slug gone
      await expect(backend.getTemplate('old-name')).rejects.toThrow(
        "Template 'old-name' not found",
      );
    });

    it('updates template labels and deps', async () => {
      const t = await backend.createTemplate(
        makeTemplate({
          name: 'With Relations',
          labels: ['old-label'],
          dependsOn: ['old-dep'],
        }),
      );

      const updated = await backend.updateTemplate(t.slug, {
        ...t,
        labels: ['new-label-1', 'new-label-2'],
        dependsOn: ['new-dep'],
      });

      expect(updated.labels).toEqual(['new-label-1', 'new-label-2']);
      expect(updated.dependsOn).toEqual(['new-dep']);

      // Verify old labels/deps are gone via direct fetch
      const fetched = await backend.getTemplate(t.slug);
      expect(fetched.labels).toEqual(['new-label-1', 'new-label-2']);
      expect(fetched.dependsOn).toEqual(['new-dep']);
    });

    it('updates template with slug rename preserves labels and deps', async () => {
      const t = await backend.createTemplate(
        makeTemplate({
          name: 'Rename Me',
          labels: ['keep-label'],
          dependsOn: ['keep-dep'],
        }),
      );

      const updated = await backend.updateTemplate(t.slug, {
        ...t,
        name: 'Renamed Template',
        labels: ['keep-label'],
        dependsOn: ['keep-dep'],
      });

      expect(updated.slug).toBe('renamed-template');
      expect(updated.labels).toEqual(['keep-label']);
      expect(updated.dependsOn).toEqual(['keep-dep']);
    });

    it('deletes template', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'Delete Me' }),
      );

      await backend.deleteTemplate(t.slug);

      const templates = await backend.listTemplates();
      expect(templates).toEqual([]);
    });

    it('deletes template cascades to labels and deps', async () => {
      const t = await backend.createTemplate(
        makeTemplate({
          name: 'Cascade Delete',
          labels: ['label-1'],
          dependsOn: ['dep-1'],
        }),
      );

      await backend.deleteTemplate(t.slug);

      // Verify labels are gone
      const labelCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM template_labels WHERE template_slug = ?',
        )
        .get(t.slug) as { count: number };
      expect(labelCount.count).toBe(0);

      // Verify deps are gone
      const depCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM template_deps WHERE template_slug = ?',
        )
        .get(t.slug) as { count: number };
      expect(depCount.count).toBe(0);
    });

    it('getTemplate throws for non-existent slug', async () => {
      await expect(backend.getTemplate('non-existent')).rejects.toThrow(
        "Template 'non-existent' not found",
      );
    });

    it('handles template with optional fields undefined', async () => {
      const t = await backend.createTemplate({
        slug: '',
        name: 'Minimal',
      });

      const fetched = await backend.getTemplate(t.slug);
      expect(fetched.slug).toBe('minimal');
      expect(fetched.name).toBe('Minimal');
      // Optional fields should be undefined when not set
      expect(fetched.type).toBeUndefined();
      expect(fetched.status).toBeUndefined();
      expect(fetched.priority).toBeUndefined();
      expect(fetched.assignee).toBeUndefined();
      expect(fetched.labels).toBeUndefined();
      expect(fetched.iteration).toBeUndefined();
      expect(fetched.description).toBeUndefined();
    });

    it('slugifies special characters in name', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'Feature: Add Login' }),
      );
      expect(t.slug).toBe('feature-add-login');
    });

    it('slugifies multiple spaces and hyphens', async () => {
      const t = await backend.createTemplate(
        makeTemplate({ name: 'My  Template--Name' }),
      );
      expect(t.slug).toBe('my-template-name');
    });
  });

  // ─── hasRemoteBackend ────────────────────────────────────────────

  describe('hasRemoteBackend', () => {
    it('assigns display id = rowId when hasRemoteBackend is false (default)', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      expect(item.id).toBe(String(item.rowId));
      expect(item.id).toBe('1');
    });

    it('leaves display id null when hasRemoteBackend is true', async () => {
      const tempDb = createDatabase(':memory:');
      const tempBackend = Storage.createFromDb(tempDb);
      tempBackend.setHasRemoteBackend(true);

      const item = await tempBackend.createWorkItem(makeNewWorkItem());
      expect(item.id).toBeNull();
      expect(item.rowId).toBe(1);

      tempBackend.destroy();
    });

    it('allows setting display id later via setDisplayId', async () => {
      const tempDb = createDatabase(':memory:');
      const tempBackend = Storage.createFromDb(tempDb);
      tempBackend.setHasRemoteBackend(true);

      const item = await tempBackend.createWorkItem(makeNewWorkItem());
      expect(item.id).toBeNull();

      tempBackend.setDisplayId(item.rowId, '42');
      const fetched = await tempBackend.getWorkItem('42');
      expect(fetched.id).toBe('42');
      expect(fetched.rowId).toBe(item.rowId);

      tempBackend.destroy();
    });
  });

  // ─── openItem ─────────────────────────────────────────────────

  describe('openItem', () => {
    it('getItemUrl returns expected path', () => {
      // openItem relies on getItemUrl — verify it returns a path based on root
      const url = backend.getItemUrl('42');
      expect(url).toContain('.tic/items/42.md');
    });
  });

  // ─── comment loading optimization ──────────────────────────────

  describe('comment loading', () => {
    it('listWorkItems omits comments by default', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.addComment(item.id!, { body: 'hello', author: 'me' });
      const items = await backend.listWorkItems();
      expect(items[0]!.comments).toEqual([]);
    });

    it('getWorkItem includes comments', async () => {
      const item = await backend.createWorkItem(makeNewWorkItem());
      await backend.addComment(item.id!, { body: 'hello', author: 'me' });
      const fetched = await backend.getWorkItem(item.id!);
      expect(fetched.comments).toHaveLength(1);
      expect(fetched.comments[0]!.body).toBe('hello');
    });
  });

  // ─── YAML migration ──────────────────────────────────────────────

  describe('migrateFromYaml', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-migrate-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('new items after migration use AUTOINCREMENT rowId', async () => {
      // 1. Create initial Storage to get a DB with some items
      const initial = Storage.create(tmpDir);
      await initial.createWorkItem(makeNewWorkItem({ title: 'Item 1' }));
      await initial.createWorkItem(makeNewWorkItem({ title: 'Item 2' }));
      await initial.createWorkItem(makeNewWorkItem({ title: 'Item 3' }));
      initial.destroy();

      // 2. Re-open Storage
      const reopened = Storage.create(tmpDir);

      // 3. New items use AUTOINCREMENT rowId — will get 4 since 1,2,3 are taken
      const item = await reopened.createWorkItem(
        makeNewWorkItem({ title: 'Item 4' }),
      );
      expect(item.rowId).toBe(4);
      expect(item.id).toBe('4');

      reopened.destroy();
    });
  });
});
