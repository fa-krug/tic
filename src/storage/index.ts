import fs from 'node:fs';
import path from 'node:path';
import yaml from 'yaml';
import { eq, and, isNull, isNotNull, inArray, sql } from 'drizzle-orm';
import { BaseBackend, UnsupportedOperationError } from '../backends/types.js';
import type {
  BackendCapabilities,
  SoftDeleteBackend,
  ImageUploadBackend,
  PrBackend,
  PrCapabilities,
} from '../backends/types.js';
import { saveImageLocal } from './image-save.js';
import type {
  WorkItem,
  NewWorkItem,
  NewComment,
  Comment,
  Template,
  Iteration,
  PullRequest,
  NewPullRequest,
} from '../types.js';
import { createDatabase, type TicDatabase } from './db.js';
import * as schema from './schema.js';
import { insertConfigTx } from './config.js';
import type { Config } from './config.js';
import {
  rowToWorkItem,
  rowToTemplate,
  rowToPullRequest,
  type WorkItemRow,
  type WorkItemLabelRow,
  type WorkItemDepRow,
  type CommentRow,
  type TemplateLabelRow,
  type TemplateDepRow,
} from './mappers.js';

const DEFAULT_STATUSES = ['backlog', 'todo', 'in-progress', 'review', 'done'];
const DEFAULT_TYPES = ['epic', 'issue', 'task'];
const DEFAULT_ITERATIONS = ['default'];
const DEFAULT_CURRENT_ITERATION = 'default';
const DEFAULT_BRANCH_MODE = 'worktree';
const DEFAULT_AUTO_UPDATE = true;
const DEFAULT_BRANCH_COMMAND = `claude "Brainstorm the implementation of issue #$TIC_ITEM_ID: $TIC_ITEM_TITLE. $TIC_ITEM_DESCRIPTION"`;
const DEFAULT_COPY_TO_CLIPBOARD = true;

export class Storage
  extends BaseBackend
  implements SoftDeleteBackend, PrBackend, ImageUploadBackend
{
  private db: TicDatabase;
  private root: string;
  private _hasRemoteBackend = false;

  private constructor(db: TicDatabase, root: string) {
    super(0); // No TTL — DB is always fresh
    this.db = db;
    this.root = root;
  }

  get hasRemoteBackend(): boolean {
    return this._hasRemoteBackend;
  }

  setHasRemoteBackend(value: boolean): void {
    this._hasRemoteBackend = value;
  }

  /**
   * Create a Storage instance, initializing the database and seeding defaults.
   */
  static create(root: string): Storage {
    const db = createDatabase(root);
    const backend = new Storage(db, root);
    backend.seedDefaults();
    backend.migrateFromYaml();
    return backend;
  }

  /**
   * Create a Storage instance from an existing database instance (for testing).
   */
  static createFromDb(db: TicDatabase): Storage {
    const backend = new Storage(db, ':memory:');
    backend.seedDefaults();
    return backend;
  }

  getDatabase(): TicDatabase {
    return this.db;
  }

  getRoot(): string {
    return this.root;
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
   * If a legacy config.yml exists and the DB still has seed defaults,
   * migrate the YAML config into the database and rename the file.
   */
  private migrateFromYaml(): void {
    if (this.root === ':memory:') return;
    const yamlPath = path.join(this.root, '.tic', 'config.yml');
    if (!fs.existsSync(yamlPath)) return;

    // Only migrate if DB still has the seed default backend ('drizzle')
    const row = this.db
      .select({ backend: schema.projectConfig.backend })
      .from(schema.projectConfig)
      .where(eq(schema.projectConfig.id, 1))
      .get();
    if (row?.backend !== 'drizzle') return;

    try {
      const raw = fs.readFileSync(yamlPath, 'utf-8');
      const config = yaml.parse(raw) as Config;

      this.db.transaction((tx) => {
        insertConfigTx(tx, config);
      });

      fs.renameSync(yamlPath, yamlPath + '.migrated');
    } catch {
      // Migration failure is not fatal — continue with DB defaults
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
      imageUpload: true,
      requiredFields: ['title'],
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
  override async getClosedStatuses(): Promise<string[]> {
    const rows = this.db
      .select()
      .from(schema.statuses)
      .orderBy(schema.statuses.sortOrder)
      .all();
    return rows.length > 0 ? [rows[rows.length - 1]!.name] : [];
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getIterations(): Promise<Iteration[]> {
    const rows = this.db
      .select()
      .from(schema.iterations)
      .orderBy(schema.iterations.sortOrder)
      .all();
    return rows.map((r) => ({
      name: r.name,
      startDate: r.startDate ?? null,
      endDate: r.endDate ?? null,
    }));
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
      .selectDistinct({ assignee: schema.workItems.assignee })
      .from(schema.workItems)
      .where(
        and(
          isNull(schema.workItems.deletedAt),
          isNotNull(schema.workItems.assignee),
        ),
      )
      .all();
    return rows
      .map((r) => r.assignee)
      .filter(Boolean)
      .sort();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLabels(): Promise<string[]> {
    const rows = this.db
      .selectDistinct({ label: schema.workItemLabels.label })
      .from(schema.workItemLabels)
      .innerJoin(
        schema.workItems,
        eq(schema.workItemLabels.workItemRowId, schema.workItems.rowId),
      )
      .where(isNull(schema.workItems.deletedAt))
      .all();
    return rows.map((r) => r.label).sort();
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

    return this.assembleWorkItemByRowId(row);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getWorkItemByRowId(rowId: number): Promise<WorkItem> {
    const row = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.rowId, rowId),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .get();

    if (!row) {
      throw new Error(`Work item with rowId ${rowId} not found`);
    }

    return this.assembleWorkItemByRowId(row);
  }

  /**
   * Get the display ID for a rowId, including soft-deleted items.
   * Used by SyncManager to resolve display IDs for delete pushes.
   */
  getDisplayIdByRowId(rowId: number): string | null {
    const row = this.db
      .select({ id: schema.workItems.id })
      .from(schema.workItems)
      .where(eq(schema.workItems.rowId, rowId))
      .get();

    if (!row) return null;
    return row.id;
  }

  /**
   * Assemble a single work item from its row, loading labels/deps/comments by rowId.
   */
  private assembleWorkItemByRowId(row: WorkItemRow): WorkItem {
    const labels = this.db
      .select()
      .from(schema.workItemLabels)
      .where(eq(schema.workItemLabels.workItemRowId, row.rowId))
      .all();

    const deps = this.db
      .select()
      .from(schema.workItemDeps)
      .where(eq(schema.workItemDeps.workItemRowId, row.rowId))
      .all();

    const itemComments = this.db
      .select()
      .from(schema.comments)
      .where(eq(schema.comments.workItemRowId, row.rowId))
      .all();

    return rowToWorkItem(row, labels, deps, itemComments);
  }

  // ─── Read: relationships (SQL-optimized overrides) ─────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getChildren(id: string): Promise<WorkItem[]> {
    const parentRowId = this.resolveRowId(id);
    const childRows = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.parent, parentRowId),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .all();

    if (childRows.length === 0) return [];

    return this.assembleWorkItems(childRows);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  override async getDependents(id: string): Promise<WorkItem[]> {
    const targetRowId = this.resolveRowId(id);
    // Find items that depend on `targetRowId`
    const depRows = this.db
      .select({ workItemRowId: schema.workItemDeps.workItemRowId })
      .from(schema.workItemDeps)
      .where(eq(schema.workItemDeps.dependsOnRowId, targetRowId))
      .all();

    if (depRows.length === 0) return [];

    const dependentRowIds = depRows.map((r) => r.workItemRowId);
    const itemRows = this.db
      .select()
      .from(schema.workItems)
      .where(
        and(
          inArray(schema.workItems.rowId, dependentRowIds),
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
  private assembleWorkItems(
    itemRows: WorkItemRow[],
    options?: { includeComments?: boolean },
  ): WorkItem[] {
    const rowIds = itemRows.map((r) => r.rowId);

    const labelRows = this.db
      .select()
      .from(schema.workItemLabels)
      .where(inArray(schema.workItemLabels.workItemRowId, rowIds))
      .all();

    const depRows = this.db
      .select()
      .from(schema.workItemDeps)
      .where(inArray(schema.workItemDeps.workItemRowId, rowIds))
      .all();

    const commentRows = options?.includeComments
      ? this.db
          .select()
          .from(schema.comments)
          .where(inArray(schema.comments.workItemRowId, rowIds))
          .all()
      : [];

    const labelsByItem = new Map<number, WorkItemLabelRow[]>();
    for (const l of labelRows) {
      const arr = labelsByItem.get(l.workItemRowId);
      if (arr) arr.push(l);
      else labelsByItem.set(l.workItemRowId, [l]);
    }

    const depsByItem = new Map<number, WorkItemDepRow[]>();
    for (const d of depRows) {
      const arr = depsByItem.get(d.workItemRowId);
      if (arr) arr.push(d);
      else depsByItem.set(d.workItemRowId, [d]);
    }

    const commentsByItem = new Map<number, CommentRow[]>();
    for (const c of commentRows) {
      const arr = commentsByItem.get(c.workItemRowId);
      if (arr) arr.push(c);
      else commentsByItem.set(c.workItemRowId, [c]);
    }

    return itemRows.map((row) =>
      rowToWorkItem(
        row,
        labelsByItem.get(row.rowId) ?? [],
        depsByItem.get(row.rowId) ?? [],
        commentsByItem.get(row.rowId) ?? [],
      ),
    );
  }

  // ─── Read: item URL ────────────────────────────────────────────────

  getItemUrl(id: string): string {
    return `${this.root}/.tic/items/${id}.md`;
  }

  // ─── Row ID resolution ─────────────────────────────────────────

  /**
   * Resolve a display ID to a rowId. Throws if not found.
   */
  private resolveRowId(displayId: string): number {
    const row = this.db
      .select({ rowId: schema.workItems.rowId })
      .from(schema.workItems)
      .where(
        and(
          eq(schema.workItems.id, displayId),
          isNull(schema.workItems.deletedAt),
        ),
      )
      .get();
    if (!row) throw new Error(`Work item "${displayId}" not found`);
    return row.rowId;
  }

  // ─── Relationship validation ─────────────────────────────────────

  private validateRelationships(
    itemRowId: number | null,
    parent: number | null | undefined,
    dependsOn: number[] | undefined,
  ): void {
    // Validate parent
    if (parent !== null && parent !== undefined) {
      if (parent === itemRowId) {
        throw new Error(
          `Work item #${this.displayIdForRowId(itemRowId)} cannot be its own parent`,
        );
      }

      const parentRow = this.db
        .select({ rowId: schema.workItems.rowId })
        .from(schema.workItems)
        .where(
          and(
            eq(schema.workItems.rowId, parent),
            isNull(schema.workItems.deletedAt),
          ),
        )
        .get();
      if (!parentRow) {
        throw new Error(
          `Parent #${this.displayIdForRowId(parent)} does not exist`,
        );
      }

      // Walk up the parent chain to detect circular references
      let current: number | null = parent;
      const visited = new Set<number>();
      while (current !== null) {
        if (current === itemRowId) {
          throw new Error(
            `Circular parent chain detected for #${this.displayIdForRowId(itemRowId)}`,
          );
        }
        if (visited.has(current)) break;
        visited.add(current);
        const row = this.db
          .select({ parent: schema.workItems.parent })
          .from(schema.workItems)
          .where(
            and(
              eq(schema.workItems.rowId, current),
              isNull(schema.workItems.deletedAt),
            ),
          )
          .get();
        current = row?.parent ?? null;
      }
    }

    // Validate dependencies
    if (dependsOn !== undefined && dependsOn.length > 0) {
      for (const depRowId of dependsOn) {
        if (depRowId === itemRowId) {
          throw new Error(
            `Work item #${this.displayIdForRowId(itemRowId)} cannot depend on itself`,
          );
        }
      }

      // Check all deps exist in one query
      const existingRows = this.db
        .select({ rowId: schema.workItems.rowId })
        .from(schema.workItems)
        .where(
          and(
            inArray(schema.workItems.rowId, dependsOn),
            isNull(schema.workItems.deletedAt),
          ),
        )
        .all();
      const existingRowIds = new Set(existingRows.map((r) => r.rowId));
      for (const depRowId of dependsOn) {
        if (!existingRowIds.has(depRowId)) {
          throw new Error(
            `Dependency #${this.displayIdForRowId(depRowId)} does not exist`,
          );
        }
      }

      // Check for circular dependency chains
      const hasCycle = (startRowId: number, targetRowId: number): boolean => {
        const visited = new Set<number>();
        const stack = [startRowId];
        while (stack.length > 0) {
          const current = stack.pop()!;
          if (current === targetRowId) return true;
          if (visited.has(current)) continue;
          visited.add(current);
          const deps = this.db
            .select({
              dependsOnRowId: schema.workItemDeps.dependsOnRowId,
            })
            .from(schema.workItemDeps)
            .where(eq(schema.workItemDeps.workItemRowId, current))
            .all();
          for (const dep of deps) {
            stack.push(dep.dependsOnRowId);
          }
        }
        return false;
      };
      for (const depRowId of dependsOn) {
        if (hasCycle(depRowId, itemRowId!)) {
          throw new Error(
            `Circular dependency chain detected for #${this.displayIdForRowId(itemRowId)}`,
          );
        }
      }
    }
  }

  /**
   * Get the display id for a rowId, for error messages.
   * Returns the display id if set, otherwise the rowId as string.
   */
  private displayIdForRowId(rowId: number | null): string {
    if (rowId === null) return 'null';
    const row = this.db
      .select({ id: schema.workItems.id })
      .from(schema.workItems)
      .where(eq(schema.workItems.rowId, rowId))
      .get();
    return row?.id ?? String(rowId);
  }

  // ─── Write: createWorkItem ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const now = new Date().toISOString();

    // Single IMMEDIATE transaction: validate + insert atomically.
    // IMMEDIATE acquires a write lock upfront, preventing race conditions
    // with parallel MCP calls (#37).
    const result = this.db.transaction(
      (tx) => {
        // Validate relationships (these are rowIds now)
        this.validateRelationships(null, data.parent, data.dependsOn);

        // Ensure iteration exists
        if (data.iteration) {
          tx.insert(schema.iterations)
            .values({ name: data.iteration, sortOrder: 0 })
            .onConflictDoNothing()
            .run();
        }

        // Insert work item — let SQLite assign rowId via AUTOINCREMENT
        const insertResult = tx
          .insert(schema.workItems)
          .values({
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

        const rowId = Number(insertResult.lastInsertRowid);

        // Assign display ID: if no remote backend, use next sequential ID
        // We can't just use rowId because after migration, existing display IDs
        // may be higher than new rowIds (e.g. old id="54" but new rowId=48).
        let displayId: string | null = null;
        if (!this._hasRemoteBackend) {
          const maxRow = tx
            .select({ maxId: sql<number>`MAX(CAST(id AS INTEGER))` })
            .from(schema.workItems)
            .get();
          displayId = String(Math.max(rowId, (maxRow?.maxId ?? 0) + 1));
        }
        if (displayId !== null) {
          tx.update(schema.workItems)
            .set({ id: displayId })
            .where(eq(schema.workItems.rowId, rowId))
            .run();
        }

        // Insert labels
        if (data.labels.length > 0) {
          tx.insert(schema.workItemLabels)
            .values(
              data.labels.map((label) => ({ workItemRowId: rowId, label })),
            )
            .run();
        }

        // Insert deps
        if (data.dependsOn.length > 0) {
          tx.insert(schema.workItemDeps)
            .values(
              data.dependsOn.map((dependsOnRowId) => ({
                workItemRowId: rowId,
                dependsOnRowId,
              })),
            )
            .run();
        }

        return { rowId, displayId };
      },
      { behavior: 'immediate' },
    );

    this.invalidateCache();

    return {
      rowId: result.rowId,
      id: result.displayId,
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

  // ─── Write: importWorkItem (for sync) ───────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async importWorkItem(item: WorkItem): Promise<WorkItem> {
    const resultRowId = this.db.transaction((tx) => {
      // Ensure iteration exists
      if (item.iteration) {
        tx.insert(schema.iterations)
          .values({ name: item.iteration, sortOrder: 0 })
          .onConflictDoNothing()
          .run();
      }

      // Resolve parent: incoming item.parent is a remote numeric ID (as number).
      // Look up the local rowId by display ID.
      let parentRowId: number | null = null;
      if (item.parent !== null) {
        const parentRow = tx
          .select({ rowId: schema.workItems.rowId })
          .from(schema.workItems)
          .where(eq(schema.workItems.id, String(item.parent)))
          .get();
        parentRowId = parentRow?.rowId ?? null;
      }

      // Resolve dependsOn: same logic
      const depRowIds: number[] = [];
      for (const depId of item.dependsOn) {
        const depRow = tx
          .select({ rowId: schema.workItems.rowId })
          .from(schema.workItems)
          .where(eq(schema.workItems.id, String(depId)))
          .get();
        if (depRow) {
          depRowIds.push(depRow.rowId);
        }
      }

      // Look up existing row by display id
      const existing = item.id
        ? tx
            .select({ rowId: schema.workItems.rowId })
            .from(schema.workItems)
            .where(eq(schema.workItems.id, item.id))
            .get()
        : null;

      let rowId: number;

      if (existing) {
        // Update existing row
        rowId = existing.rowId;
        tx.update(schema.workItems)
          .set({
            title: item.title,
            type: item.type,
            status: item.status,
            iteration: item.iteration,
            priority: item.priority,
            assignee: item.assignee,
            description: item.description,
            parent: parentRowId,
            created: item.created,
            updated: item.updated,
          })
          .where(eq(schema.workItems.rowId, rowId))
          .run();
      } else {
        // Insert new row
        const insertResult = tx
          .insert(schema.workItems)
          .values({
            id: item.id,
            title: item.title,
            type: item.type,
            status: item.status,
            iteration: item.iteration,
            priority: item.priority,
            assignee: item.assignee,
            description: item.description,
            parent: parentRowId,
            created: item.created,
            updated: item.updated,
          })
          .run();
        rowId = Number(insertResult.lastInsertRowid);
      }

      // Replace labels
      tx.delete(schema.workItemLabels)
        .where(eq(schema.workItemLabels.workItemRowId, rowId))
        .run();
      if (item.labels.length > 0) {
        tx.insert(schema.workItemLabels)
          .values(item.labels.map((label) => ({ workItemRowId: rowId, label })))
          .run();
      }

      // Replace deps
      tx.delete(schema.workItemDeps)
        .where(eq(schema.workItemDeps.workItemRowId, rowId))
        .run();
      if (depRowIds.length > 0) {
        tx.insert(schema.workItemDeps)
          .values(
            depRowIds.map((dependsOnRowId) => ({
              workItemRowId: rowId,
              dependsOnRowId,
            })),
          )
          .run();
      }

      // Replace comments
      tx.delete(schema.comments)
        .where(eq(schema.comments.workItemRowId, rowId))
        .run();
      if (item.comments.length > 0) {
        for (const c of item.comments) {
          tx.insert(schema.comments)
            .values({
              workItemRowId: rowId,
              author: c.author,
              body: c.body,
              created: c.date,
            })
            .run();
        }
      }

      return rowId;
    });

    this.invalidateCache();
    return { ...item, rowId: resultRowId };
  }

  // ─── Write: setDisplayId ───────────────────────────────────────────

  setDisplayId(rowId: number, displayId: string): void {
    this.db
      .update(schema.workItems)
      .set({ id: displayId })
      .where(eq(schema.workItems.rowId, rowId))
      .run();
    this.invalidateCache();
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

    const rowId = existingRow.rowId;

    // 2. Validate relationships if parent/dependsOn changed
    const newParent = 'parent' in data ? data.parent : undefined;
    const newDepsOn = 'dependsOn' in data ? data.dependsOn : undefined;
    if (newParent !== undefined || newDepsOn !== undefined) {
      this.validateRelationships(
        rowId,
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
        .where(eq(schema.workItems.rowId, rowId))
        .run();

      // Replace labels if changed
      if ('labels' in data && data.labels !== undefined) {
        tx.delete(schema.workItemLabels)
          .where(eq(schema.workItemLabels.workItemRowId, rowId))
          .run();
        if (data.labels.length > 0) {
          tx.insert(schema.workItemLabels)
            .values(
              data.labels.map((label) => ({ workItemRowId: rowId, label })),
            )
            .run();
        }
      }

      // Replace deps if changed
      if ('dependsOn' in data && data.dependsOn !== undefined) {
        tx.delete(schema.workItemDeps)
          .where(eq(schema.workItemDeps.workItemRowId, rowId))
          .run();
        if (data.dependsOn.length > 0) {
          tx.insert(schema.workItemDeps)
            .values(
              data.dependsOn.map((dependsOnRowId) => ({
                workItemRowId: rowId,
                dependsOnRowId,
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

      // Cascade iteration change to non-closed descendants
      if (
        'iteration' in data &&
        data.iteration !== undefined &&
        data.iteration !== existingRow.iteration
      ) {
        const closedStatuses = new Set(
          this.db
            .select()
            .from(schema.statuses)
            .orderBy(schema.statuses.sortOrder)
            .all()
            .slice(-1)
            .map((r) => r.name),
        );

        const cascadeIteration = (parentRowId: number) => {
          const children = tx
            .select()
            .from(schema.workItems)
            .where(
              and(
                eq(schema.workItems.parent, parentRowId),
                isNull(schema.workItems.deletedAt),
              ),
            )
            .all();

          for (const child of children) {
            if (closedStatuses.has(child.status)) continue;
            tx.update(schema.workItems)
              .set({ iteration: data.iteration!, updated: now })
              .where(eq(schema.workItems.rowId, child.rowId))
              .run();
            cascadeIteration(child.rowId);
          }
        };

        cascadeIteration(rowId);
      }
    });

    this.invalidateCache();

    // 4. Return updated item
    return this.getWorkItem(id);
  }

  // ─── Write: deleteWorkItem ────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteWorkItem(id: string): Promise<void> {
    const rowId = this.resolveRowId(id);
    this.db.transaction((tx) => {
      // 1. Null out parent on children
      tx.update(schema.workItems)
        .set({ parent: null })
        .where(eq(schema.workItems.parent, rowId))
        .run();

      // 2. Remove deps referencing this item (other items depending on this one)
      tx.delete(schema.workItemDeps)
        .where(eq(schema.workItemDeps.dependsOnRowId, rowId))
        .run();

      // 3. Delete the item (cascade handles labels, deps, comments of this item)
      tx.delete(schema.workItems)
        .where(eq(schema.workItems.rowId, rowId))
        .run();
    });

    this.invalidateCache();
  }

  // ─── Write: soft delete ───────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async softDeleteWorkItem(id: string): Promise<void> {
    const now = new Date().toISOString();
    // Resolve without the deletedAt filter since this method may be called on any item
    const row = this.db
      .select({ rowId: schema.workItems.rowId })
      .from(schema.workItems)
      .where(eq(schema.workItems.id, id))
      .get();
    if (!row) return;
    this.db
      .update(schema.workItems)
      .set({ deletedAt: now })
      .where(eq(schema.workItems.rowId, row.rowId))
      .run();
    this.invalidateCache();
  }

  // ─── Write: addComment ────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async addComment(workItemId: string, comment: NewComment): Promise<Comment> {
    // 1. Verify item exists and resolve rowId
    const rowId = this.resolveRowId(workItemId);

    // 2. Insert comment (do NOT update work item's updated timestamp)
    const now = new Date().toISOString();
    this.db
      .insert(schema.comments)
      .values({
        workItemRowId: rowId,
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

  // ─── Write: restore (undo soft delete) ──────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async restoreWorkItem(id: string): Promise<void> {
    // Look up by display id without deletedAt filter (item is soft-deleted)
    const row = this.db
      .select({ rowId: schema.workItems.rowId })
      .from(schema.workItems)
      .where(eq(schema.workItems.id, id))
      .get();
    if (!row) return;
    this.db
      .update(schema.workItems)
      .set({ deletedAt: null })
      .where(eq(schema.workItems.rowId, row.rowId))
      .run();
    this.invalidateCache();
  }

  // ─── Write: permanent delete ───────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async permanentlyDeleteWorkItem(id: string): Promise<void> {
    const row = this.db
      .select({ rowId: schema.workItems.rowId })
      .from(schema.workItems)
      .where(eq(schema.workItems.id, id))
      .get();
    if (!row) return;
    this.db
      .delete(schema.workItems)
      .where(eq(schema.workItems.rowId, row.rowId))
      .run();
    this.invalidateCache();
  }

  // ─── Write: cleanup all soft-deleted items ─────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async cleanupTrash(): Promise<void> {
    this.db
      .delete(schema.workItems)
      .where(isNotNull(schema.workItems.deletedAt))
      .run();
    this.invalidateCache();
  }

  // ─── Open item in editor ───────────────────────────────────────

  async openItem(id: string): Promise<void> {
    const item = await this.getWorkItem(id);
    if (!item) throw new Error(`Work item ${id} not found`);
    const { openCliEditor } = await import('../cli/components/CliEditor.js');
    const edited = await openCliEditor(item.description);
    if (edited !== item.description) {
      await this.cachedUpdateWorkItem(id, { description: edited });
    }
  }

  // ─── Image upload ──────────────────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async uploadImage(data: Buffer, filename: string): Promise<string> {
    return saveImageLocal(this.root, data, filename);
  }

  // ─── Templates ─────────────────────────────────────────────────

  /**
   * Slugify a template name (same logic as LocalBackend).
   */
  private slugifyName(name: string): string {
    return name
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/[\s-]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listTemplates(): Promise<Template[]> {
    const templateRows = this.db.select().from(schema.templates).all();

    if (templateRows.length === 0) return [];

    const slugs = templateRows.map((r) => r.slug);

    const labelRows = this.db
      .select()
      .from(schema.templateLabels)
      .where(inArray(schema.templateLabels.templateSlug, slugs))
      .all();

    const depRows = this.db
      .select()
      .from(schema.templateDeps)
      .where(inArray(schema.templateDeps.templateSlug, slugs))
      .all();

    const labelsBySlug = new Map<string, TemplateLabelRow[]>();
    for (const l of labelRows) {
      const arr = labelsBySlug.get(l.templateSlug);
      if (arr) arr.push(l);
      else labelsBySlug.set(l.templateSlug, [l]);
    }

    const depsBySlug = new Map<string, TemplateDepRow[]>();
    for (const d of depRows) {
      const arr = depsBySlug.get(d.templateSlug);
      if (arr) arr.push(d);
      else depsBySlug.set(d.templateSlug, [d]);
    }

    return templateRows.map((row) =>
      rowToTemplate(
        row,
        labelsBySlug.get(row.slug) ?? [],
        depsBySlug.get(row.slug) ?? [],
      ),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getTemplate(slug: string): Promise<Template> {
    const row = this.db
      .select()
      .from(schema.templates)
      .where(eq(schema.templates.slug, slug))
      .get();

    if (!row) {
      throw new Error(`Template '${slug}' not found`);
    }

    const labels = this.db
      .select()
      .from(schema.templateLabels)
      .where(eq(schema.templateLabels.templateSlug, slug))
      .all();

    const deps = this.db
      .select()
      .from(schema.templateDeps)
      .where(eq(schema.templateDeps.templateSlug, slug))
      .all();

    return rowToTemplate(row, labels, deps);
  }

  async createTemplate(template: Template): Promise<Template> {
    const slug = this.slugifyName(template.name);

    this.db.transaction((tx) => {
      tx.insert(schema.templates)
        .values({
          slug,
          name: template.name,
          type: template.type ?? '',
          status: template.status ?? '',
          priority: template.priority ?? '',
          assignee: template.assignee ?? '',
          iteration: template.iteration ?? '',
          parent: template.parent ?? null,
          description: template.description ?? '',
        })
        .run();

      if (template.labels && template.labels.length > 0) {
        tx.insert(schema.templateLabels)
          .values(
            template.labels.map((label) => ({ templateSlug: slug, label })),
          )
          .run();
      }

      if (template.dependsOn && template.dependsOn.length > 0) {
        tx.insert(schema.templateDeps)
          .values(
            template.dependsOn.map((dependsOnId) => ({
              templateSlug: slug,
              dependsOnId,
            })),
          )
          .run();
      }
    });

    return this.getTemplate(slug);
  }

  async updateTemplate(oldSlug: string, template: Template): Promise<Template> {
    const newSlug = this.slugifyName(template.name);

    this.db.transaction((tx) => {
      if (oldSlug !== newSlug) {
        // Slug changed: delete old (cascade handles labels/deps), insert new
        tx.delete(schema.templates)
          .where(eq(schema.templates.slug, oldSlug))
          .run();

        tx.insert(schema.templates)
          .values({
            slug: newSlug,
            name: template.name,
            type: template.type ?? '',
            status: template.status ?? '',
            priority: template.priority ?? '',
            assignee: template.assignee ?? '',
            iteration: template.iteration ?? '',
            parent: template.parent ?? null,
            description: template.description ?? '',
          })
          .run();
      } else {
        // Same slug: update in place
        tx.update(schema.templates)
          .set({
            name: template.name,
            type: template.type ?? '',
            status: template.status ?? '',
            priority: template.priority ?? '',
            assignee: template.assignee ?? '',
            iteration: template.iteration ?? '',
            parent: template.parent ?? null,
            description: template.description ?? '',
          })
          .where(eq(schema.templates.slug, oldSlug))
          .run();

        // Delete and re-insert labels
        tx.delete(schema.templateLabels)
          .where(eq(schema.templateLabels.templateSlug, oldSlug))
          .run();
      }

      // Insert labels (for both new slug and same slug cases)
      if (template.labels && template.labels.length > 0) {
        tx.insert(schema.templateLabels)
          .values(
            template.labels.map((label) => ({
              templateSlug: newSlug,
              label,
            })),
          )
          .run();
      }

      // Delete and re-insert deps (only for same-slug; new slug cascade already handled it)
      if (oldSlug === newSlug) {
        tx.delete(schema.templateDeps)
          .where(eq(schema.templateDeps.templateSlug, oldSlug))
          .run();
      }

      if (template.dependsOn && template.dependsOn.length > 0) {
        tx.insert(schema.templateDeps)
          .values(
            template.dependsOn.map((dependsOnId) => ({
              templateSlug: newSlug,
              dependsOnId,
            })),
          )
          .run();
      }
    });

    return this.getTemplate(newSlug);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteTemplate(slug: string): Promise<void> {
    this.db
      .delete(schema.templates)
      .where(eq(schema.templates.slug, slug))
      .run();
  }

  // ── Color Mappings ────────────────────────────────

  // eslint-disable-next-line @typescript-eslint/require-await
  async getColorMappings(): Promise<
    { fieldType: string; value: string; bg: string; fg: string }[]
  > {
    return this.db.select().from(schema.colorMappings).all();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async setColorMapping(
    fieldType: string,
    value: string,
    bg: string,
    fg: string,
  ): Promise<void> {
    this.db
      .insert(schema.colorMappings)
      .values({ fieldType, value, bg, fg })
      .onConflictDoUpdate({
        target: [schema.colorMappings.fieldType, schema.colorMappings.value],
        set: { bg, fg },
      })
      .run();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteColorMapping(fieldType: string, value: string): Promise<void> {
    this.db
      .delete(schema.colorMappings)
      .where(
        and(
          eq(schema.colorMappings.fieldType, fieldType),
          eq(schema.colorMappings.value, value),
        ),
      )
      .run();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async deleteColorMappingsByField(fieldType: string): Promise<void> {
    this.db
      .delete(schema.colorMappings)
      .where(eq(schema.colorMappings.fieldType, fieldType))
      .run();
  }

  // ── Pull Requests ────────────────────────────────

  getPrCapabilities(): PrCapabilities {
    return {
      pullRequests: true,
      merge: false,
      create: false,
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async listPullRequests(): Promise<PullRequest[]> {
    const prRows = this.db.select().from(schema.pullRequests).all();

    if (prRows.length === 0) return [];

    const prIds = prRows.map((r) => r.id);
    const linkRows = this.db
      .select()
      .from(schema.prItemLinks)
      .where(inArray(schema.prItemLinks.prId, prIds))
      .all();

    const linksByPr = new Map<string, number[]>();
    for (const link of linkRows) {
      const arr = linksByPr.get(link.prId);
      if (arr) arr.push(link.itemRowId);
      else linksByPr.set(link.prId, [link.itemRowId]);
    }

    return prRows.map((row) =>
      rowToPullRequest(row, linksByPr.get(row.id) ?? []),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getPullRequest(id: string): Promise<PullRequest | null> {
    const row = this.db
      .select()
      .from(schema.pullRequests)
      .where(eq(schema.pullRequests.id, id))
      .get();

    if (!row) return null;

    const linkRows = this.db
      .select()
      .from(schema.prItemLinks)
      .where(eq(schema.prItemLinks.prId, id))
      .all();

    return rowToPullRequest(
      row,
      linkRows.map((l) => l.itemRowId),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async importPullRequest(pr: PullRequest): Promise<void> {
    this.db.transaction((tx) => {
      // Upsert PR
      tx.insert(schema.pullRequests)
        .values({
          id: pr.id,
          number: pr.number,
          title: pr.title,
          description: pr.description,
          status: pr.status,
          sourceBranch: pr.sourceBranch,
          targetBranch: pr.targetBranch,
          author: pr.author,
          url: pr.url,
          created: pr.created,
          updated: pr.updated,
        })
        .onConflictDoUpdate({
          target: schema.pullRequests.id,
          set: {
            number: pr.number,
            title: pr.title,
            description: pr.description,
            status: pr.status,
            sourceBranch: pr.sourceBranch,
            targetBranch: pr.targetBranch,
            author: pr.author,
            url: pr.url,
            created: pr.created,
            updated: pr.updated,
          },
        })
        .run();

      // Replace linked items
      tx.delete(schema.prItemLinks)
        .where(eq(schema.prItemLinks.prId, pr.id))
        .run();

      if (pr.linkedItems.length > 0) {
        tx.insert(schema.prItemLinks)
          .values(
            pr.linkedItems.map((itemRowId) => ({ prId: pr.id, itemRowId })),
          )
          .run();
      }
    });
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLinkedPullRequests(itemId: string): Promise<PullRequest[]> {
    const itemRowId = this.resolveRowId(itemId);
    const linkRows = this.db
      .select({ prId: schema.prItemLinks.prId })
      .from(schema.prItemLinks)
      .where(eq(schema.prItemLinks.itemRowId, itemRowId))
      .all();

    if (linkRows.length === 0) return [];

    const prIds = linkRows.map((r) => r.prId);
    const prRows = this.db
      .select()
      .from(schema.pullRequests)
      .where(inArray(schema.pullRequests.id, prIds))
      .all();

    if (prRows.length === 0) return [];

    // Get all links for these PRs to populate linkedItems
    const allLinks = this.db
      .select()
      .from(schema.prItemLinks)
      .where(inArray(schema.prItemLinks.prId, prIds))
      .all();

    const linksByPr = new Map<string, number[]>();
    for (const link of allLinks) {
      const arr = linksByPr.get(link.prId);
      if (arr) arr.push(link.itemRowId);
      else linksByPr.set(link.prId, [link.itemRowId]);
    }

    return prRows.map((row) =>
      rowToPullRequest(row, linksByPr.get(row.id) ?? []),
    );
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async getLinkedItems(prId: string): Promise<string[]> {
    const rows = this.db
      .select({
        itemRowId: schema.prItemLinks.itemRowId,
        itemId: schema.workItems.id,
      })
      .from(schema.prItemLinks)
      .innerJoin(
        schema.workItems,
        eq(schema.prItemLinks.itemRowId, schema.workItems.rowId),
      )
      .where(eq(schema.prItemLinks.prId, prId))
      .all();

    return rows
      .map((r) => r.itemId ?? String(r.itemRowId))
      .filter((id) => id.length > 0);
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async linkItem(prId: string, itemId: string): Promise<void> {
    const itemRowId = this.resolveRowId(itemId);
    this.db
      .insert(schema.prItemLinks)
      .values({ prId, itemRowId })
      .onConflictDoNothing()
      .run();
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async unlinkItem(prId: string, itemId: string): Promise<void> {
    const itemRowId = this.resolveRowId(itemId);
    this.db
      .delete(schema.prItemLinks)
      .where(
        and(
          eq(schema.prItemLinks.prId, prId),
          eq(schema.prItemLinks.itemRowId, itemRowId),
        ),
      )
      .run();
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async createPullRequest(_pr: NewPullRequest): Promise<PullRequest> {
    throw new UnsupportedOperationError('pull request operations', 'Storage');
  }

  // eslint-disable-next-line @typescript-eslint/require-await
  async updatePullRequest(
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _id: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _updates: Partial<NewPullRequest>,
  ): Promise<PullRequest> {
    throw new UnsupportedOperationError('pull request operations', 'Storage');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async mergePullRequest(_id: string): Promise<PullRequest> {
    throw new UnsupportedOperationError('pull request operations', 'Storage');
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars, @typescript-eslint/require-await
  async closePullRequest(_id: string): Promise<PullRequest> {
    throw new UnsupportedOperationError('pull request operations', 'Storage');
  }
}
