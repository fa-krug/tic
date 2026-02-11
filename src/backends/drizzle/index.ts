import { eq, and, isNull, inArray } from 'drizzle-orm';
import { BaseBackend } from '../types.js';
import type { BackendCapabilities, SoftDeleteBackend } from '../types.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
} from '../../types.js';
import { createDatabase, type TicDatabase } from './db.js';
import * as schema from './schema.js';
import {
  rowToWorkItem,
  type WorkItemRow,
  type WorkItemLabelRow,
  type WorkItemDepRow,
  type CommentRow,
} from './mappers.js';

const DEFAULT_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const DEFAULT_TYPES = ['epic', 'issue', 'task'];
const DEFAULT_ITERATIONS = ['default'];
const DEFAULT_CURRENT_ITERATION = 'default';
const DEFAULT_NEXT_ID = 1;
const DEFAULT_BRANCH_MODE = 'worktree';
const DEFAULT_AUTO_UPDATE = true;
const DEFAULT_BRANCH_COMMAND = `claude "Brainstorm the implementation of issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE. $TIC_ITEM_DESCRIPTION"`;
const DEFAULT_COPY_TO_CLIPBOARD = true;

export class DrizzleBackend extends BaseBackend implements SoftDeleteBackend {
  private db: TicDatabase;
  private root: string;

  private constructor(db: TicDatabase, root: string) {
    super(0); // No TTL — DB is always fresh
    this.db = db;
    this.root = root;
  }

  /**
   * Create a DrizzleBackend, initializing the database and seeding defaults.
   */
  static create(root: string): DrizzleBackend {
    const db = createDatabase(root);
    const backend = new DrizzleBackend(db, root);
    backend.seedDefaults();
    return backend;
  }

  /**
   * Create a DrizzleBackend from an existing database instance (for testing).
   */
  static createFromDb(db: TicDatabase): DrizzleBackend {
    const backend = new DrizzleBackend(db, ':memory:');
    backend.seedDefaults();
    return backend;
  }

  /**
   * Seed default configuration, statuses, types, and iterations using INSERT OR IGNORE.
   */
  private seedDefaults(): void {
    // Seed project config (id=1) only if not already present
    this.db
      .insert(schema.projectConfig)
      .values({
        id: 1,
        backend: 'drizzle',
        currentIteration: DEFAULT_CURRENT_ITERATION,
        nextId: DEFAULT_NEXT_ID,
        branchMode: DEFAULT_BRANCH_MODE,
        branchCommand: DEFAULT_BRANCH_COMMAND,
        copyToClipboard: DEFAULT_COPY_TO_CLIPBOARD,
        autoUpdate: DEFAULT_AUTO_UPDATE,
      })
      .onConflictDoNothing()
      .run();

    // Seed statuses
    for (let i = 0; i < DEFAULT_STATUSES.length; i++) {
      this.db
        .insert(schema.statuses)
        .values({ name: DEFAULT_STATUSES[i]!, sortOrder: i })
        .onConflictDoNothing()
        .run();
    }

    // Seed types
    for (let i = 0; i < DEFAULT_TYPES.length; i++) {
      this.db
        .insert(schema.workItemTypes)
        .values({ name: DEFAULT_TYPES[i]!, sortOrder: i })
        .onConflictDoNothing()
        .run();
    }

    // Seed iterations
    for (let i = 0; i < DEFAULT_ITERATIONS.length; i++) {
      this.db
        .insert(schema.iterations)
        .values({ name: DEFAULT_ITERATIONS[i]!, sortOrder: i })
        .onConflictDoNothing()
        .run();
    }
  }

  /**
   * Close the database connection. Call this when done with the backend.
   */
  destroy(): void {
    this.db.close();
  }

  // ─── Capabilities ───────────────────────────────────────────────────

  getCapabilities(): BackendCapabilities {
    return {
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
    };
  }

  // ─── Read: metadata lists ──────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async getStatuses(): Promise<string[]> {
    const rows = this.db
      .select()
      .from(schema.statuses)
      .orderBy(schema.statuses.sortOrder)
      .all();
    return rows.map((r) => r.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<string[]> {
    const rows = this.db
      .select()
      .from(schema.iterations)
      .orderBy(schema.iterations.sortOrder)
      .all();
    return rows.map((r) => r.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemTypes(): Promise<string[]> {
    const rows = this.db
      .select()
      .from(schema.workItemTypes)
      .orderBy(schema.workItemTypes.sortOrder)
      .all();
    return rows.map((r) => r.name);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getAssignees(): Promise<string[]> {
    const rows = this.db
      .select({ assignee: schema.workItems.assignee })
      .from(schema.workItems)
      .where(isNull(schema.workItems.deletedAt))
      .all();
    // Filter out empty assignees in JS (they don't represent real assignees)
    const assignees = new Set<string>();
    for (const r of rows) {
      if (r.assignee) assignees.add(r.assignee);
    }
    return [...assignees].sort();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLabels(): Promise<string[]> {
    // Get labels only for non-deleted items
    const rows = this.db
      .select({ label: schema.workItemLabels.label })
      .from(schema.workItemLabels)
      .innerJoin(
        schema.workItems,
        eq(schema.workItemLabels.workItemId, schema.workItems.id),
      )
      .where(isNull(schema.workItems.deletedAt))
      .all();
    const labels = new Set<string>();
    for (const r of rows) {
      labels.add(r.label);
    }
    return [...labels].sort();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getCurrentIteration(): Promise<string> {
    const row = this.db
      .select({ currentIteration: schema.projectConfig.currentIteration })
      .from(schema.projectConfig)
      .where(eq(schema.projectConfig.id, 1))
      .get();
    return row?.currentIteration ?? DEFAULT_CURRENT_ITERATION;
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setCurrentIteration(name: string): Promise<void> {
    // Ensure iteration exists
    this.db
      .insert(schema.iterations)
      .values({ name, sortOrder: 0 })
      .onConflictDoNothing()
      .run();

    this.db
      .update(schema.projectConfig)
      .set({ currentIteration: name })
      .where(eq(schema.projectConfig.id, 1))
      .run();
  }

  // ─── Read: work items ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    const itemRows = iteration
      ? this.db
          .select()
          .from(schema.workItems)
          .where(
            and(
              isNull(schema.workItems.deletedAt),
              eq(schema.workItems.iteration, iteration),
            ),
          )
          .all()
      : this.db
          .select()
          .from(schema.workItems)
          .where(isNull(schema.workItems.deletedAt))
          .all();

    if (itemRows.length === 0) return [];

    return this.assembleWorkItems(itemRows);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItem(id: string): Promise<WorkItem> {
    const row = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(eq(schema.workItems.id, id), isNull(schema.workItems.deletedAt)),
      )
      .get();

    if (!row) {
      throw new Error(`Work item #${id} not found`);
    }

    const labels = this.db
      .select()
      .from(schema.workItemLabels)
      .where(eq(schema.workItemLabels.workItemId, id))
      .all();

    const deps = this.db
      .select()
      .from(schema.workItemDeps)
      .where(eq(schema.workItemDeps.workItemId, id))
      .all();

    const itemComments = this.db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.workItemId, id))
      .all();

    return rowToWorkItem(row, labels, deps, itemComments);
  }

  // ─── Read: relationships (SQL-optimized overrides) ─────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getChildren(id: string): Promise<WorkItem[]> {
    const childRows = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.parent, id),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .all();

    if (childRows.length === 0) return [];

    return this.assembleWorkItems(childRows);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getDependents(id: string): Promise<WorkItem[]> {
    // Find items that depend on `id`
    const depRows = this.db
      .select({ workItemId: schema.workItemDeps.workItemId })
      .from(schema.workItemDeps)
      .where(eq(schema.workItemDeps.dependsOnId, id))
      .all();

    if (depRows.length === 0) return [];

    const dependentIds = depRows.map((r) => r.workItemId);
    const itemRows = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(
          inArray(schema.workItems.id, dependentIds),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .all();

    if (itemRows.length === 0) return [];

    return this.assembleWorkItems(itemRows);
  }

  /**
   * Helper: given a set of work item rows, fetch their labels/deps/comments and assemble.
   */
  private assembleWorkItems(itemRows: WorkItemRow[]): WorkItem[] {
    const itemIds = itemRows.map((r) => r.id);

    const labelRows = this.db
      .select()
      .from(schema.workItemLabels)
      .where(inArray(schema.workItemLabels.workItemId, itemIds))
      .all();

    const depRows = this.db
      .select()
      .from(schema.workItemDeps)
      .where(inArray(schema.workItemDeps.workItemId, itemIds))
      .all();

    const commentRows = this.db
      .select()
      .from(schema.comments)
      .where(inArray(schema.comments.workItemId, itemIds))
      .all();

    const labelsByItem = new Map<string, WorkItemLabelRow[]>();
    for (const l of labelRows) {
      const arr = labelsByItem.get(l.workItemId);
      if (arr) arr.push(l);
      else labelsByItem.set(l.workItemId, [l]);
    }

    const depsByItem = new Map<string, WorkItemDepRow[]>();
    for (const d of depRows) {
      const arr = depsByItem.get(d.workItemId);
      if (arr) arr.push(d);
      else depsByItem.set(d.workItemId, [d]);
    }

    const commentsByItem = new Map<string, CommentRow[]>();
    for (const c of commentRows) {
      const arr = commentsByItem.get(c.workItemId);
      if (arr) arr.push(c);
      else commentsByItem.set(c.workItemId, [c]);
    }

    return itemRows.map((row) =>
      rowToWorkItem(
        row,
        labelsByItem.get(row.id) ?? [],
        depsByItem.get(row.id) ?? [],
        commentsByItem.get(row.id) ?? [],
      ),
    );
  }

  // ─── Read: item URL ────────────────────────────────────────────────

  getItemUrl(id: string): string {
    return `${this.root}/.tic/items/${id}.md`;
  }

  // ─── Relationship validation ─────────────────────────────────────

  private validateRelationships(
    id: string,
    parent: string | null | undefined,
    dependsOn: string[] | undefined,
  ): void {
    // Validate parent
    if (parent !== null && parent !== undefined) {
      if (parent === id) {
        throw new Error(`Work item #${id} cannot be its own parent`);
      }

      const parentRow = this.db
        .select({ id: schema.workItems.id })
        .from(schema.workItems)
        .where(
          and(
            eq(schema.workItems.id, parent),
            isNull(schema.workItems.deletedAt),
          ),
        )
        .get();
      if (!parentRow) {
        throw new Error(`Parent #${parent} does not exist`);
      }

      // Walk up the parent chain to detect circular references
      let current: string | null = parent;
      const visited = new Set<string>();
      while (current !== null) {
        if (current === id) {
          throw new Error(`Circular parent chain detected for #${id}`);
        }
        if (visited.has(current)) break;
        visited.add(current);
        const row = this.db
          .select({ parent: schema.workItems.parent })
          .from(schema.workItems)
          .where(
            and(
              eq(schema.workItems.id, current),
              isNull(schema.workItems.deletedAt),
            ),
          )
          .get();
        current = row?.parent ?? null;
      }
    }

    // Validate dependencies
    if (dependsOn !== undefined && dependsOn.length > 0) {
      for (const depId of dependsOn) {
        if (depId === id) {
          throw new Error(`Work item #${id} cannot depend on itself`);
        }
      }

      // Check all deps exist in one query
      const existingRows = this.db
        .select({ id: schema.workItems.id })
        .from(schema.workItems)
        .where(
          and(
            inArray(schema.workItems.id, dependsOn),
            isNull(schema.workItems.deletedAt),
          ),
        )
        .all();
      const existingIds = new Set(existingRows.map((r) => r.id));
      for (const depId of dependsOn) {
        if (!existingIds.has(depId)) {
          throw new Error(`Dependency #${depId} does not exist`);
        }
      }

      // Check for circular dependency chains
      const hasCycle = (startId: string, targetId: string): boolean => {
        const visited = new Set<string>();
        const stack = [startId];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (current === targetId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          const deps = this.db
            .select({ dependsOnId: schema.workItemDeps.dependsOnId })
            .from(schema.workItemDeps)
            .where(eq(schema.workItemDeps.workItemId, current))
            .all();
          for (const dep of deps) {
            stack.push(dep.dependsOnId);
          }
        }
        return false;
      };
      for (const depId of dependsOn) {
        if (hasCycle(depId, id)) {
          throw new Error(`Circular dependency chain detected for #${id}`);
        }
      }
    }
  }

  // ─── Write: createWorkItem ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const now = new Date().toISOString();

    // Get and increment nextId
    const config = this.db
      .select()
      .from(schema.projectConfig)
      .where(eq(schema.projectConfig.id, 1))
      .get();
    const nextId = config?.nextId ?? 1;
    const id = String(nextId);

    // Validate relationships before inserting
    this.validateRelationships(id, data.parent, data.dependsOn);

    this.db.transaction((tx) => {
      tx.update(schema.projectConfig)
        .set({ nextId: nextId + 1 })
        .where(eq(schema.projectConfig.id, 1))
        .run();

      // Ensure iteration exists
      if (data.iteration) {
        tx.insert(schema.iterations)
          .values({ name: data.iteration, sortOrder: 0 })
          .onConflictDoNothing()
          .run();
      }

      // Insert work item
      tx.insert(schema.workItems)
        .values({
          id,
          title: data.title,
          type: data.type,
          status: data.status,
          iteration: data.iteration,
          priority: data.priority,
          assignee: data.assignee,
          description: data.description,
          parent: data.parent,
          created: now,
          updated: now,
        })
        .run();

      // Insert labels
      if (data.labels.length > 0) {
        tx.insert(schema.workItemLabels)
          .values(data.labels.map((label) => ({ workItemId: id, label })))
          .run();
      }

      // Insert deps
      if (data.dependsOn.length > 0) {
        tx.insert(schema.workItemDeps)
          .values(
            data.dependsOn.map((dependsOnId) => ({
              workItemId: id,
              dependsOnId,
            })),
          )
          .run();
      }
    });

    this.invalidateCache();

    return {
      id,
      title: data.title,
      type: data.type,
      status: data.status,
      iteration: data.iteration,
      priority: data.priority,
      assignee: data.assignee,
      labels: [...data.labels],
      description: data.description,
      parent: data.parent,
      dependsOn: [...data.dependsOn],
      created: now,
      updated: now,
      comments: [],
    };
  }

  // ─── Write: updateWorkItem ────────────────────────────────────────

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    this.validateFields(data);

    // 1. Read existing item (throw if not found)
    const existingRow = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(eq(schema.workItems.id, id), isNull(schema.workItems.deletedAt)),
      )
      .get();

    if (!existingRow) {
      throw new Error(`Work item #${id} not found`);
    }

    // 2. Validate relationships if parent/dependsOn changed
    const newParent = 'parent' in data ? data.parent : undefined;
    const newDepsOn = 'dependsOn' in data ? data.dependsOn : undefined;
    if (newParent !== undefined || newDepsOn !== undefined) {
      this.validateRelationships(
        id,
        newParent !== undefined ? (newParent ?? null) : undefined,
        newDepsOn,
      );
    }

    const now = new Date().toISOString();

    // 3. In a transaction: update workItems row, delete+re-insert labels/deps
    this.db.transaction((tx) => {
      // Build the set of fields to update on the work_items row
      const updateSet: Record<string, unknown> = { updated: now };
      if ('title' in data) updateSet['title'] = data.title;
      if ('type' in data) updateSet['type'] = data.type;
      if ('status' in data) updateSet['status'] = data.status;
      if ('iteration' in data) updateSet['iteration'] = data.iteration;
      if ('priority' in data) updateSet['priority'] = data.priority;
      if ('assignee' in data) updateSet['assignee'] = data.assignee;
      if ('description' in data) updateSet['description'] = data.description;
      if ('parent' in data) updateSet['parent'] = data.parent ?? null;

      tx.update(schema.workItems)
        .set(updateSet)
        .where(eq(schema.workItems.id, id))
        .run();

      // Replace labels if changed
      if ('labels' in data && data.labels !== undefined) {
        tx.delete(schema.workItemLabels)
          .where(eq(schema.workItemLabels.workItemId, id))
          .run();
        if (data.labels.length > 0) {
          tx.insert(schema.workItemLabels)
            .values(data.labels.map((label) => ({ workItemId: id, label })))
            .run();
        }
      }

      // Replace deps if changed
      if ('dependsOn' in data && data.dependsOn !== undefined) {
        tx.delete(schema.workItemDeps)
          .where(eq(schema.workItemDeps.workItemId, id))
          .run();
        if (data.dependsOn.length > 0) {
          tx.insert(schema.workItemDeps)
            .values(
              data.dependsOn.map((dependsOnId) => ({
                workItemId: id,
                dependsOnId,
              })),
            )
            .run();
        }
      }

      // Ensure iteration exists if changed
      if ('iteration' in data && data.iteration) {
        tx.insert(schema.iterations)
          .values({ name: data.iteration, sortOrder: 0 })
          .onConflictDoNothing()
          .run();
      }
    });

    this.invalidateCache();

    // 4. Return updated item
    return this.getWorkItem(id);
  }

  // ─── Write: deleteWorkItem ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    this.db.transaction((tx) => {
      // 1. Null out parent on children
      tx.update(schema.workItems)
        .set({ parent: null })
        .where(eq(schema.workItems.parent, id))
        .run();

      // 2. Remove deps referencing this item (other items depending on this one)
      tx.delete(schema.workItemDeps)
        .where(eq(schema.workItemDeps.dependsOnId, id))
        .run();

      // 3. Delete the item (cascade handles labels, deps, comments of this item)
      tx.delete(schema.workItems).where(eq(schema.workItems.id, id)).run();
    });

    this.invalidateCache();
  }

  // ─── Write: soft delete ───────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async softDeleteWorkItem(id: string): Promise<void> {
    const now = new Date().toISOString();
    this.db
      .update(schema.workItems)
      .set({ deletedAt: now })
      .where(eq(schema.workItems.id, id))
      .run();
    this.invalidateCache();
  }

  // ─── Write: addComment ────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    // 1. Verify item exists
    const row = this.db
      .select({ id: schema.workItems.id })
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.id, workItemId),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .get();

    if (!row) {
      throw new Error(`Work item #${workItemId} not found`);
    }

    // 2. Insert comment (do NOT update work item's updated timestamp)
    const now = new Date().toISOString();
    this.db
      .insert(schema.comments)
      .values({
        workItemId,
        author: comment.author,
        body: comment.body,
        created: now,
      })
      .run();

    this.invalidateCache();

    return {
      author: comment.author,
      date: now,
      body: comment.body,
    };
  }

  // ─── Stubs: not yet implemented ────────────────────────────────────

  /* eslint-disable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */

  async restoreWorkItem(_id: string): Promise<void> {
    throw new Error('Not yet implemented');
  }

  async permanentlyDeleteWorkItem(_id: string): Promise<void> {
    throw new Error('Not yet implemented');
  }

  async openItem(_id: string): Promise<void> {
    throw new Error('Not yet implemented');
  }

  async listTemplates(): Promise<Template[]> {
    throw new Error('Not yet implemented');
  }

  async getTemplate(_slug: string): Promise<Template> {
    throw new Error('Not yet implemented');
  }

  async createTemplate(_template: Template): Promise<Template> {
    throw new Error('Not yet implemented');
  }

  async updateTemplate(
    _oldSlug: string,
    _template: Template,
  ): Promise<Template> {
    throw new Error('Not yet implemented');
  }

  async deleteTemplate(_slug: string): Promise<void> {
    throw new Error('Not yet implemented');
  }

  /* eslint-enable @typescript-eslint/require-await, @typescript-eslint/no-unused-vars */
}
