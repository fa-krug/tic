import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createDatabase, type TicDatabase } from './db.js';
import { DrizzleBackend } from './index.js';
import type { NewWorkItem } from '../../types.js';

function makeNewItem(overrides: Partial<NewWorkItem> = {}): NewWorkItem {
  return {
    title: 'Test item',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
    ...overrides,
  };
}

describe('DrizzleBackend', () => {
  let db: TicDatabase;
  let backend: DrizzleBackend;

  beforeEach(() => {
    db = createDatabase(':memory:');
    backend = DrizzleBackend.createFromDb(db);
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
      expect(iterations).toEqual(['default']);
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
      await backend.createWorkItem(makeNewItem({ assignee: 'Charlie' }));
      await backend.createWorkItem(makeNewItem({ assignee: 'Alice' }));
      await backend.createWorkItem(makeNewItem({ assignee: 'Bob' }));
      await backend.createWorkItem(makeNewItem({ assignee: 'Alice' })); // duplicate

      const assignees = await backend.getAssignees();
      expect(assignees).toEqual(['Alice', 'Bob', 'Charlie']);
    });

    it('excludes empty assignees', async () => {
      await backend.createWorkItem(makeNewItem({ assignee: '' }));
      await backend.createWorkItem(makeNewItem({ assignee: 'Alice' }));

      const assignees = await backend.getAssignees();
      expect(assignees).toEqual(['Alice']);
    });

    it('excludes assignees from soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ assignee: 'Deleted' }),
      );
      await backend.createWorkItem(makeNewItem({ assignee: 'Active' }));
      await backend.softDeleteWorkItem(item.id);

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
        makeNewItem({ labels: ['bug', 'frontend'] }),
      );
      await backend.createWorkItem(makeNewItem({ labels: ['backend', 'bug'] })); // 'bug' is duplicate

      const labels = await backend.getLabels();
      expect(labels).toEqual(['backend', 'bug', 'frontend']);
    });

    it('excludes labels from soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ labels: ['deleted-label'] }),
      );
      await backend.createWorkItem(makeNewItem({ labels: ['active-label'] }));
      await backend.softDeleteWorkItem(item.id);

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
      expect(iterations).toContain('sprint-2');
    });
  });

  // ─── listWorkItems ──────────────────────────────────────────────

  describe('listWorkItems', () => {
    it('returns empty array when no items exist', async () => {
      const items = await backend.listWorkItems();
      expect(items).toEqual([]);
    });

    it('returns all non-deleted items', async () => {
      await backend.createWorkItem(makeNewItem({ title: 'Item 1' }));
      await backend.createWorkItem(makeNewItem({ title: 'Item 2' }));

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(2);
      expect(items.map((i) => i.title)).toContain('Item 1');
      expect(items.map((i) => i.title)).toContain('Item 2');
    });

    it('returns items with labels, deps, and comments', async () => {
      const item1 = await backend.createWorkItem(
        makeNewItem({ title: 'Dep target' }),
      );
      const item2 = await backend.createWorkItem(
        makeNewItem({
          title: 'Main item',
          labels: ['bug', 'urgent'],
          dependsOn: [item1.id],
        }),
      );

      const items = await backend.listWorkItems();
      const main = items.find((i) => i.id === item2.id);
      expect(main).toBeDefined();
      expect(main!.labels).toEqual(['bug', 'urgent']);
      expect(main!.dependsOn).toEqual([item1.id]);
    });

    it('filters by iteration', async () => {
      await backend.createWorkItem(
        makeNewItem({ title: 'Sprint 1', iteration: 'sprint-1' }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Sprint 2', iteration: 'sprint-2' }),
      );

      const items = await backend.listWorkItems('sprint-1');
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('Sprint 1');
    });

    it('excludes soft-deleted items', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ title: 'To delete' }),
      );
      await backend.createWorkItem(makeNewItem({ title: 'To keep' }));
      await backend.softDeleteWorkItem(item.id);

      const items = await backend.listWorkItems();
      expect(items).toHaveLength(1);
      expect(items[0]!.title).toBe('To keep');
    });

    it('returns items with correct WorkItem shape', async () => {
      await backend.createWorkItem(
        makeNewItem({
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
      expect(item.id).toBe('1');
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
        makeNewItem({ title: 'Find me' }),
      );

      const item = await backend.getWorkItem(created.id);
      expect(item.id).toBe(created.id);
      expect(item.title).toBe('Find me');
    });

    it('throws when work item not found', async () => {
      await expect(backend.getWorkItem('999')).rejects.toThrow(
        'Work item #999 not found',
      );
    });

    it('throws when work item is soft-deleted', async () => {
      const created = await backend.createWorkItem(
        makeNewItem({ title: 'Deleted' }),
      );
      await backend.softDeleteWorkItem(created.id);

      await expect(backend.getWorkItem(created.id)).rejects.toThrow(
        `Work item #${created.id} not found`,
      );
    });

    it('returns work item with labels and deps', async () => {
      const dep = await backend.createWorkItem(
        makeNewItem({ title: 'Dependency' }),
      );
      const item = await backend.createWorkItem(
        makeNewItem({
          title: 'With relations',
          labels: ['important', 'review'],
          dependsOn: [dep.id],
        }),
      );

      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.labels).toEqual(['important', 'review']);
      expect(fetched.dependsOn).toEqual([dep.id]);
    });
  });

  // ─── getChildren ────────────────────────────────────────────────

  describe('getChildren', () => {
    it('returns empty array when no children', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const children = await backend.getChildren(item.id);
      expect(children).toEqual([]);
    });

    it('returns child items', async () => {
      const parent = await backend.createWorkItem(
        makeNewItem({ title: 'Parent' }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Child 1', parent: parent.id }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Child 2', parent: parent.id }),
      );
      await backend.createWorkItem(makeNewItem({ title: 'Not a child' }));

      const children = await backend.getChildren(parent.id);
      expect(children).toHaveLength(2);
      expect(children.map((c) => c.title).sort()).toEqual([
        'Child 1',
        'Child 2',
      ]);
    });

    it('excludes soft-deleted children', async () => {
      const parent = await backend.createWorkItem(
        makeNewItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewItem({ title: 'Deleted child', parent: parent.id }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Active child', parent: parent.id }),
      );
      await backend.softDeleteWorkItem(child.id);

      const children = await backend.getChildren(parent.id);
      expect(children).toHaveLength(1);
      expect(children[0]!.title).toBe('Active child');
    });
  });

  // ─── getDependents ──────────────────────────────────────────────

  describe('getDependents', () => {
    it('returns empty array when no dependents', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const dependents = await backend.getDependents(item.id);
      expect(dependents).toEqual([]);
    });

    it('returns items that depend on the given item', async () => {
      const target = await backend.createWorkItem(
        makeNewItem({ title: 'Target' }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Depends 1', dependsOn: [target.id] }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Depends 2', dependsOn: [target.id] }),
      );
      await backend.createWorkItem(makeNewItem({ title: 'Independent' }));

      const dependents = await backend.getDependents(target.id);
      expect(dependents).toHaveLength(2);
      expect(dependents.map((d) => d.title).sort()).toEqual([
        'Depends 1',
        'Depends 2',
      ]);
    });

    it('excludes soft-deleted dependents', async () => {
      const target = await backend.createWorkItem(
        makeNewItem({ title: 'Target' }),
      );
      const dep = await backend.createWorkItem(
        makeNewItem({ title: 'Deleted dep', dependsOn: [target.id] }),
      );
      await backend.createWorkItem(
        makeNewItem({ title: 'Active dep', dependsOn: [target.id] }),
      );
      await backend.softDeleteWorkItem(dep.id);

      const dependents = await backend.getDependents(target.id);
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
      const item1 = await backend.createWorkItem(makeNewItem());
      const item2 = await backend.createWorkItem(makeNewItem());
      expect(item1.id).toBe('1');
      expect(item2.id).toBe('2');
    });

    it('sets created and updated timestamps', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      expect(item.created).toBeDefined();
      expect(item.updated).toBeDefined();
      // Timestamps should be ISO 8601
      expect(new Date(item.created).toISOString()).toBe(item.created);
    });

    it('persists parent relationship', async () => {
      const parent = await backend.createWorkItem(
        makeNewItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewItem({ title: 'Child', parent: parent.id }),
      );

      const fetched = await backend.getWorkItem(child.id);
      expect(fetched.parent).toBe(parent.id);
    });

    it('adds new iteration to iterations table', async () => {
      await backend.createWorkItem(makeNewItem({ iteration: 'new-sprint' }));
      const iterations = await backend.getIterations();
      expect(iterations).toContain('new-sprint');
    });
  });

  // ─── createWorkItem (relationship validation) ─────────────────────

  describe('createWorkItem (relationship validation)', () => {
    it('rejects self-referencing parent', async () => {
      // Create an item first so we know what ID "2" would be
      const item = await backend.createWorkItem(makeNewItem());
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
        backend.updateWorkItem(item.id, { parent: item.id }),
      ).rejects.toThrow(`Work item #${item.id} cannot be its own parent`);
    });

    it('rejects non-existent parent', async () => {
      await expect(
        backend.createWorkItem(makeNewItem({ parent: '999' })),
      ).rejects.toThrow('Parent #999 does not exist');
    });

    it('rejects circular parent chain', async () => {
      const grandparent = await backend.createWorkItem(
        makeNewItem({ title: 'Grandparent' }),
      );
      const parent = await backend.createWorkItem(
        makeNewItem({ title: 'Parent', parent: grandparent.id }),
      );
      const child = await backend.createWorkItem(
        makeNewItem({ title: 'Child', parent: parent.id }),
      );

      // Now try to set grandparent's parent to child — creates a cycle
      await expect(
        backend.updateWorkItem(grandparent.id, { parent: child.id }),
      ).rejects.toThrow(
        `Circular parent chain detected for #${grandparent.id}`,
      );
    });

    it('rejects self-referencing dependency', async () => {
      // Create an item, then try to make it depend on itself via update
      const item = await backend.createWorkItem(makeNewItem());
      await expect(
        backend.updateWorkItem(item.id, { dependsOn: [item.id] }),
      ).rejects.toThrow(`Work item #${item.id} cannot depend on itself`);
    });

    it('rejects non-existent dependency', async () => {
      await expect(
        backend.createWorkItem(makeNewItem({ dependsOn: ['999'] })),
      ).rejects.toThrow('Dependency #999 does not exist');
    });

    it('rejects circular dependency chain', async () => {
      const a = await backend.createWorkItem(makeNewItem({ title: 'A' }));
      const b = await backend.createWorkItem(
        makeNewItem({ title: 'B', dependsOn: [a.id] }),
      );
      const c = await backend.createWorkItem(
        makeNewItem({ title: 'C', dependsOn: [b.id] }),
      );

      // Now try to make A depend on C — creates a cycle: A -> C -> B -> A
      await expect(
        backend.updateWorkItem(a.id, { dependsOn: [c.id] }),
      ).rejects.toThrow(`Circular dependency chain detected for #${a.id}`);
    });
  });

  // ─── updateWorkItem ──────────────────────────────────────────────

  describe('updateWorkItem', () => {
    it('updates title', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ title: 'Original' }),
      );
      const updated = await backend.updateWorkItem(item.id, {
        title: 'Updated',
      });
      expect(updated.title).toBe('Updated');

      // Verify persisted
      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.title).toBe('Updated');
    });

    it('updates status', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ status: 'todo' }),
      );
      const updated = await backend.updateWorkItem(item.id, {
        status: 'in-progress',
      });
      expect(updated.status).toBe('in-progress');
    });

    it('updates priority', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ priority: 'low' }),
      );
      const updated = await backend.updateWorkItem(item.id, {
        priority: 'high',
      });
      expect(updated.priority).toBe('high');
    });

    it('updates assignee', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ assignee: 'Alice' }),
      );
      const updated = await backend.updateWorkItem(item.id, {
        assignee: 'Bob',
      });
      expect(updated.assignee).toBe('Bob');
    });

    it('replaces labels', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ labels: ['old-label', 'keep-label'] }),
      );
      const updated = await backend.updateWorkItem(item.id, {
        labels: ['new-label', 'another-label'],
      });
      expect(updated.labels.sort()).toEqual(
        ['another-label', 'new-label'].sort(),
      );

      // Verify old labels are gone
      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.labels.sort()).toEqual(
        ['another-label', 'new-label'].sort(),
      );
      expect(fetched.labels).not.toContain('old-label');
      expect(fetched.labels).not.toContain('keep-label');
    });

    it('replaces dependencies', async () => {
      const dep1 = await backend.createWorkItem(
        makeNewItem({ title: 'Dep 1' }),
      );
      const dep2 = await backend.createWorkItem(
        makeNewItem({ title: 'Dep 2' }),
      );
      const dep3 = await backend.createWorkItem(
        makeNewItem({ title: 'Dep 3' }),
      );
      const item = await backend.createWorkItem(
        makeNewItem({ title: 'Main', dependsOn: [dep1.id, dep2.id] }),
      );

      const updated = await backend.updateWorkItem(item.id, {
        dependsOn: [dep2.id, dep3.id],
      });
      expect(updated.dependsOn).toEqual([dep2.id, dep3.id]);

      // Verify dep1 is no longer referenced
      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.dependsOn).toEqual([dep2.id, dep3.id]);
      expect(fetched.dependsOn).not.toContain(dep1.id);
    });

    it('validates relationships on update', async () => {
      const item = await backend.createWorkItem(makeNewItem());

      // Non-existent parent
      await expect(
        backend.updateWorkItem(item.id, { parent: '999' }),
      ).rejects.toThrow('Parent #999 does not exist');

      // Non-existent dependency
      await expect(
        backend.updateWorkItem(item.id, { dependsOn: ['999'] }),
      ).rejects.toThrow('Dependency #999 does not exist');
    });

    it('sets updated timestamp', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const originalUpdated = item.updated;

      // Small delay to ensure timestamp differs
      await new Promise((r) => setTimeout(r, 10));

      const updated = await backend.updateWorkItem(item.id, {
        title: 'Changed',
      });
      expect(updated.updated).not.toBe(originalUpdated);
      expect(new Date(updated.updated).getTime()).toBeGreaterThan(
        new Date(originalUpdated).getTime(),
      );
    });

    it('does not change created timestamp', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const originalCreated = item.created;

      await new Promise((r) => setTimeout(r, 10));

      const updated = await backend.updateWorkItem(item.id, {
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
        makeNewItem({
          title: 'Original',
          status: 'todo',
          priority: 'high',
          assignee: 'Alice',
          labels: ['bug'],
          description: 'Some description',
        }),
      );

      // Only update title
      const updated = await backend.updateWorkItem(item.id, {
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

  // ─── deleteWorkItem ──────────────────────────────────────────────

  describe('deleteWorkItem', () => {
    it('removes item', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      await backend.deleteWorkItem(item.id);

      await expect(backend.getWorkItem(item.id)).rejects.toThrow(
        `Work item #${item.id} not found`,
      );
    });

    it('cascade deletes labels of the deleted item', async () => {
      const item = await backend.createWorkItem(
        makeNewItem({ labels: ['bug', 'feature'] }),
      );
      await backend.deleteWorkItem(item.id);

      // Verify labels are gone from the database
      const labelCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM work_item_labels WHERE work_item_id = ?',
        )
        .get(item.id) as { count: number };
      expect(labelCount.count).toBe(0);
    });

    it('cascade deletes deps of the deleted item', async () => {
      const dep = await backend.createWorkItem(
        makeNewItem({ title: 'Dep target' }),
      );
      const item = await backend.createWorkItem(
        makeNewItem({ dependsOn: [dep.id] }),
      );
      await backend.deleteWorkItem(item.id);

      // Verify deps are gone
      const depCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM work_item_deps WHERE work_item_id = ?',
        )
        .get(item.id) as { count: number };
      expect(depCount.count).toBe(0);
    });

    it('cascade deletes comments of the deleted item', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      await backend.addComment(item.id, {
        author: 'Alice',
        body: 'A comment',
      });
      await backend.deleteWorkItem(item.id);

      // Verify comments are gone
      const commentCount = db.raw
        .prepare(
          'SELECT COUNT(*) as count FROM comments WHERE work_item_id = ?',
        )
        .get(item.id) as { count: number };
      expect(commentCount.count).toBe(0);
    });

    it('cleans up parent references (children get parent = null)', async () => {
      const parent = await backend.createWorkItem(
        makeNewItem({ title: 'Parent' }),
      );
      const child = await backend.createWorkItem(
        makeNewItem({ title: 'Child', parent: parent.id }),
      );

      await backend.deleteWorkItem(parent.id);

      const fetchedChild = await backend.getWorkItem(child.id);
      expect(fetchedChild.parent).toBeNull();
    });

    it('cleans up dependency references (deps pointing to deleted item removed)', async () => {
      const target = await backend.createWorkItem(
        makeNewItem({ title: 'Target' }),
      );
      const dependent = await backend.createWorkItem(
        makeNewItem({ title: 'Dependent', dependsOn: [target.id] }),
      );

      await backend.deleteWorkItem(target.id);

      const fetchedDependent = await backend.getWorkItem(dependent.id);
      expect(fetchedDependent.dependsOn).toEqual([]);
    });
  });

  // ─── addComment ──────────────────────────────────────────────────

  describe('addComment', () => {
    it('adds comment to existing item', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const comment = await backend.addComment(item.id, {
        author: 'Alice',
        body: 'This is a comment',
      });

      expect(comment.author).toBe('Alice');
      expect(comment.body).toBe('This is a comment');
      expect(comment.date).toBeDefined();
      expect(new Date(comment.date).toISOString()).toBe(comment.date);
    });

    it('comment has author, date, and body', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const comment = await backend.addComment(item.id, {
        author: 'Bob',
        body: 'Hello world',
      });

      expect(comment).toHaveProperty('author', 'Bob');
      expect(comment).toHaveProperty('body', 'Hello world');
      expect(comment).toHaveProperty('date');
    });

    it('comment is retrievable via getWorkItem', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      await backend.addComment(item.id, {
        author: 'Alice',
        body: 'First comment',
      });
      await backend.addComment(item.id, {
        author: 'Bob',
        body: 'Second comment',
      });

      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.comments).toHaveLength(2);
      expect(fetched.comments[0]!.author).toBe('Alice');
      expect(fetched.comments[0]!.body).toBe('First comment');
      expect(fetched.comments[1]!.author).toBe('Bob');
      expect(fetched.comments[1]!.body).toBe('Second comment');
    });

    it('does not change item updated timestamp', async () => {
      const item = await backend.createWorkItem(makeNewItem());
      const originalUpdated = item.updated;

      await new Promise((r) => setTimeout(r, 10));

      await backend.addComment(item.id, {
        author: 'Alice',
        body: 'A comment',
      });

      const fetched = await backend.getWorkItem(item.id);
      expect(fetched.updated).toBe(originalUpdated);
    });

    it('throws if item does not exist', async () => {
      await expect(
        backend.addComment('999', { author: 'Alice', body: 'Nope' }),
      ).rejects.toThrow('Work item #999 not found');
    });
  });

  // ─── seedDefaults (idempotency) ─────────────────────────────────

  describe('seedDefaults', () => {
    it('is idempotent — creating backend twice does not duplicate data', () => {
      // Create another backend from same DB — seedDefaults runs again
      const backend2 = DrizzleBackend.createFromDb(db);
      // Statuses should not be duplicated
      const statuses = db.raw
        .prepare('SELECT COUNT(*) as count FROM statuses')
        .get() as { count: number };
      expect(statuses.count).toBe(5);
      // Suppress unused variable warning
      expect(backend2).toBeDefined();
    });
  });
});
