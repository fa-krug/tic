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
