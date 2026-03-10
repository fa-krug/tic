# Dual-ID Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Separate internal storage key (`rowId`) from display identifier (`id`) so relationships are stable and sync never needs to rename items.

**Architecture:** Add `rowId INTEGER PRIMARY KEY AUTOINCREMENT` to `work_items`, make `id TEXT NULL`. All internal references (parent, dependsOn, FKs, stores) use `rowId`. Display `id` is assigned by the backend (Storage for local-only, remote API for synced). SyncManager fills in display ID with a simple UPDATE instead of delete+reimport+rename.

**Tech Stack:** Drizzle ORM, better-sqlite3, TypeScript, Zustand, Vitest

---

## File Structure

| File | Responsibility |
|------|---------------|
| `src/types.ts` | Add `rowId: number`, make `id: string \| null`, change `parent`/`dependsOn` to number types |
| `src/storage/schema.ts` | New `rowId` column, nullable `id`, integer FKs everywhere |
| `src/storage/mappers.ts` | Map `rowId` from DB rows, map integer parent/dependsOn |
| `src/storage/index.ts` | Rewrite create/import/get/update/delete to use rowId internally |
| `src/storage/undo.ts` | Update SerializedSnapshot to use rowId + integer parent/dependsOn |
| `src/storage/syncQueue.ts` | Change itemId to itemRowId (integer) |
| `src/sync/types.ts` | QueueEntry.itemRowId, remove idMappings from PushResult |
| `src/sync/SyncManager.ts` | Remove renameLocalItem, simplify push to UPDATE id |
| `src/backends/types.ts` | Keep Backend interface with string IDs, update SyncableBackend |
| `src/stores/navigationStore.ts` | selectedWorkItemId → selectedWorkItemRowId (number) |
| `src/stores/listViewStore.ts` | expandedIds/markedIds → Set\<number\> |
| `src/stores/undoStore.ts` | syncItemIds/createdIds → number[] |
| `src/stores/formStackStore.ts` | FormDraft.itemId → itemRowId (number) |
| `src/components/buildTree.ts` | Use rowId for maps/sets, use item.parent (number) |
| `src/test-helpers.ts` | Add rowId to makeWorkItem factory |
| `src/implement.ts` | Use display id for clipboard/env vars |
| `drizzle/0006_dual_id.sql` | Migration SQL |
| Various tests | Update to use rowId |

---

## Chunk 1: Core Types, Schema, and Migration

### Task 1: Update WorkItem and NewWorkItem types

**Files:**
- Modify: `src/types.ts:7-36`
- Test: `src/test-helpers.ts:17-38`

- [ ] **Step 1: Update WorkItem interface**

In `src/types.ts`, change `WorkItem`:

```typescript
export interface WorkItem {
  rowId: number;          // NEW
  id: string | null;      // CHANGED from string
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: string;
  labels: string[];
  created: string;
  updated: string;
  description: string;
  comments: Comment[];
  parent: number | null;  // CHANGED from string | null
  dependsOn: number[];    // CHANGED from string[]
}
```

`NewWorkItem` stays as `Pick<WorkItem, ...>` — it will automatically pick up `parent: number | null` and `dependsOn: number[]`.

- [ ] **Step 2: Update PullRequest.linkedItems**

In `src/types.ts`, change `PullRequest.linkedItems` from `string[]` to `number[]`.
Change `NewPullRequest.linkedItems` from `string[]` to `number[]`.

- [ ] **Step 3: Update test-helpers.ts**

In `src/test-helpers.ts`, update `makeWorkItem`:

```typescript
export function makeWorkItem(
  rowId: number,
  overrides: Partial<WorkItem> = {},
): WorkItem {
  return {
    rowId,
    id: String(rowId),     // default display ID matches rowId for convenience
    title: `Item ${rowId}`,
    type: 'task',
    status: 'todo',
    priority: 'medium',
    assignee: '',
    labels: [],
    parent: null,
    dependsOn: [],
    iteration: '',
    description: '',
    comments: [],
    created: '2026-01-01T00:00:00Z',
    updated: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}
```

Update `makeNewWorkItem` — `parent` default stays `null`, `dependsOn` default stays `[]` (types now number).

- [ ] **Step 4: Fix compilation errors from type changes**

Run: `npx tsc --noEmit 2>&1 | head -100`

This will produce hundreds of errors. That's expected — note the error categories but don't fix them yet. The remaining tasks handle each area systematically.

- [ ] **Step 5: Commit**

```bash
git add src/types.ts src/test-helpers.ts
git commit -m "feat: update WorkItem type with rowId and nullable id"
```

---

### Task 2: Update Drizzle schema

**Files:**
- Modify: `src/storage/schema.ts`

- [ ] **Step 1: Update work_items table**

Change the `work_items` table definition:

```typescript
export const workItems = sqliteTable(
  'work_items',
  {
    rowId: integer('row_id').primaryKey({ autoIncrement: true }),
    id: text('id'),  // nullable display ID
    title: text('title').notNull(),
    type: text('type').notNull(),
    status: text('status').notNull(),
    iteration: text('iteration').notNull().default(''),
    priority: text('priority').notNull().default(''),
    assignee: text('assignee').notNull().default(''),
    description: text('description').notNull().default(''),
    parent: integer('parent'),  // self-ref to rowId
    created: text('created').notNull(),
    updated: text('updated').notNull(),
    deletedAt: text('deleted_at'),
  },
  (t) => [
    index('idx_status').on(t.status),
    index('idx_type').on(t.type),
    index('idx_assignee').on(t.assignee),
    index('idx_priority').on(t.priority),
    index('idx_iteration').on(t.iteration),
    index('idx_parent').on(t.parent),
    index('idx_deleted_iteration').on(t.deletedAt, t.iteration),
    index('idx_deleted_status').on(t.deletedAt, t.status),
    index('idx_deleted_assignee').on(t.deletedAt, t.assignee),
    uniqueIndex('idx_display_id').on(t.id),  // unique where not null
  ],
);
```

- [ ] **Step 2: Update junction tables to use integer FKs**

Update `work_item_labels`:
```typescript
export const workItemLabels = sqliteTable(
  'work_item_labels',
  {
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    label: text('label').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.workItemRowId, t.label] }),
    index('idx_label').on(t.label),
  ],
);
```

Update `work_item_deps`:
```typescript
export const workItemDeps = sqliteTable(
  'work_item_deps',
  {
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    dependsOnRowId: integer('depends_on_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.workItemRowId, t.dependsOnRowId] }),
    index('idx_dep_target').on(t.dependsOnRowId),
  ],
);
```

Update `comments`:
```typescript
export const comments = sqliteTable(
  'comments',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    workItemRowId: integer('work_item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
    author: text('author').notNull().default(''),
    body: text('body').notNull(),
    created: text('created').notNull(),
  },
  (t) => [index('idx_comment_item').on(t.workItemRowId)],
);
```

- [ ] **Step 3: Update sync_queue, undo_stack, file_sync_state**

Update `syncQueue`:
```typescript
export const syncQueue = sqliteTable(
  'sync_queue',
  {
    id: integer('id').primaryKey({ autoIncrement: true }),
    action: text('action').notNull(),
    itemRowId: integer('item_row_id').notNull(),
    timestamp: text('timestamp').notNull(),
    commentData: text('comment_data'),
    templateSlug: text('template_slug'),
  },
  (t) => [index('idx_queue_item').on(t.itemRowId, t.action)],
);
```

Update `undoStack`:
```typescript
export const undoStack = sqliteTable('undo_stack', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  action: text('action').notNull(),
  metadata: text('metadata').notNull(),  // renamed from itemId for clarity
  createdAt: text('created_at').notNull(),
});
```

Update `fileSyncState`:
```typescript
export const fileSyncState = sqliteTable('file_sync_state', {
  itemRowId: integer('item_row_id').primaryKey(),
  hash: text('hash').notNull(),
  syncedAt: text('synced_at').notNull(),
});
```

- [ ] **Step 4: Update pr_item_links**

```typescript
export const prItemLinks = sqliteTable(
  'pr_item_links',
  {
    prId: text('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    itemRowId: integer('item_row_id')
      .notNull()
      .references(() => workItems.rowId, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.prId, t.itemRowId] }),
    index('idx_pr_link_item').on(t.itemRowId),
  ],
);
```

- [ ] **Step 5: Remove nextId from project_config**

Remove the `nextId` field from the `projectConfig` table definition.

- [ ] **Step 5b: Remove undo_item_snapshot tables from schema**

Remove `undoItemSnapshot`, `undoItemSnapshotLabels`, and `undoItemSnapshotDeps` table definitions from `schema.ts`. These tables are unused (all undo data is serialized as JSON in the `undo_stack.metadata` column) and will be dropped in the migration.

- [ ] **Step 6: Commit**

```bash
git add src/storage/schema.ts
git commit -m "feat: update schema for dual-ID (rowId + nullable id)"
```

---

### Task 3: Write migration SQL

**Files:**
- Create: `drizzle/0006_dual_id.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 1. Create new work_items table
CREATE TABLE work_items_new (
  row_id INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT,
  title TEXT NOT NULL,
  type TEXT NOT NULL,
  status TEXT NOT NULL,
  iteration TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT '',
  assignee TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  parent INTEGER,
  created TEXT NOT NULL,
  updated TEXT NOT NULL,
  deleted_at TEXT
);

-- 2. Copy existing data (old text id becomes display id, rowid auto-assigned)
INSERT INTO work_items_new (id, title, type, status, iteration, priority, assignee, description, parent, created, updated, deleted_at)
SELECT id, title, type, status, iteration, priority, assignee, description, NULL, created, updated, deleted_at
FROM work_items;

-- 3. Fix parent references: map old text parent to new row_id
UPDATE work_items_new SET parent = (
  SELECT p.row_id FROM work_items_new p WHERE p.id = (
    SELECT wo.parent FROM work_items wo WHERE wo.id = work_items_new.id
  )
) WHERE (SELECT wo.parent FROM work_items wo WHERE wo.id = work_items_new.id) IS NOT NULL;

-- 4. Rebuild junction tables with integer FKs
-- Labels
CREATE TABLE work_item_labels_new (
  work_item_row_id INTEGER NOT NULL REFERENCES work_items_new(row_id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  PRIMARY KEY (work_item_row_id, label)
);
INSERT INTO work_item_labels_new (work_item_row_id, label)
SELECT n.row_id, l.label
FROM work_item_labels l
JOIN work_items_new n ON n.id = l.work_item_id;

-- Dependencies
CREATE TABLE work_item_deps_new (
  work_item_row_id INTEGER NOT NULL REFERENCES work_items_new(row_id) ON DELETE CASCADE,
  depends_on_row_id INTEGER NOT NULL REFERENCES work_items_new(row_id) ON DELETE CASCADE,
  PRIMARY KEY (work_item_row_id, depends_on_row_id)
);
INSERT INTO work_item_deps_new (work_item_row_id, depends_on_row_id)
SELECT n1.row_id, n2.row_id
FROM work_item_deps d
JOIN work_items_new n1 ON n1.id = d.work_item_id
JOIN work_items_new n2 ON n2.id = d.depends_on_id;

-- Comments
CREATE TABLE comments_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  work_item_row_id INTEGER NOT NULL REFERENCES work_items_new(row_id) ON DELETE CASCADE,
  author TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  created TEXT NOT NULL
);
INSERT INTO comments_new (id, work_item_row_id, author, body, created)
SELECT c.id, n.row_id, c.author, c.body, c.created
FROM comments c
JOIN work_items_new n ON n.id = c.work_item_id;

-- Sync queue (clear — transient data)
DELETE FROM sync_queue;
CREATE TABLE sync_queue_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  item_row_id INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  comment_data TEXT,
  template_slug TEXT
);

-- Undo stack (clear — transient data)
DELETE FROM undo_stack;
DROP TABLE IF EXISTS undo_item_snapshot_deps;
DROP TABLE IF EXISTS undo_item_snapshot_labels;
DROP TABLE IF EXISTS undo_item_snapshot;
CREATE TABLE undo_stack_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  action TEXT NOT NULL,
  metadata TEXT NOT NULL,
  created_at TEXT NOT NULL
);

-- File sync state
CREATE TABLE file_sync_state_new (
  item_row_id INTEGER PRIMARY KEY,
  hash TEXT NOT NULL,
  synced_at TEXT NOT NULL
);
INSERT INTO file_sync_state_new (item_row_id, hash, synced_at)
SELECT n.row_id, f.hash, f.synced_at
FROM file_sync_state f
JOIN work_items_new n ON n.id = f.item_id;

-- PR-item links
CREATE TABLE pr_item_links_new (
  pr_id TEXT NOT NULL REFERENCES pull_requests(id) ON DELETE CASCADE,
  item_row_id INTEGER NOT NULL REFERENCES work_items_new(row_id) ON DELETE CASCADE,
  PRIMARY KEY (pr_id, item_row_id)
);
INSERT INTO pr_item_links_new (pr_id, item_row_id)
SELECT l.pr_id, n.row_id
FROM pr_item_links l
JOIN work_items_new n ON n.id = l.item_id;

-- 5. Drop old tables and rename new ones
DROP TABLE pr_item_links;
DROP TABLE file_sync_state;
DROP TABLE undo_stack;
DROP TABLE sync_queue;
DROP TABLE comments;
DROP TABLE work_item_deps;
DROP TABLE work_item_labels;
DROP TABLE work_items;

ALTER TABLE work_items_new RENAME TO work_items;
ALTER TABLE work_item_labels_new RENAME TO work_item_labels;
ALTER TABLE work_item_deps_new RENAME TO work_item_deps;
ALTER TABLE comments_new RENAME TO comments;
ALTER TABLE sync_queue_new RENAME TO sync_queue;
ALTER TABLE undo_stack_new RENAME TO undo_stack;
ALTER TABLE file_sync_state_new RENAME TO file_sync_state;
ALTER TABLE pr_item_links_new RENAME TO pr_item_links;

-- 6. Recreate indexes
CREATE INDEX idx_status ON work_items(status);
CREATE INDEX idx_type ON work_items(type);
CREATE INDEX idx_assignee ON work_items(assignee);
CREATE INDEX idx_priority ON work_items(priority);
CREATE INDEX idx_iteration ON work_items(iteration);
CREATE INDEX idx_parent ON work_items(parent);
CREATE INDEX idx_deleted_iteration ON work_items(deleted_at, iteration);
CREATE INDEX idx_deleted_status ON work_items(deleted_at, status);
CREATE INDEX idx_deleted_assignee ON work_items(deleted_at, assignee);
CREATE INDEX idx_display_id ON work_items(id);
CREATE INDEX idx_label ON work_item_labels(label);
CREATE INDEX idx_dep_target ON work_item_deps(depends_on_row_id);
CREATE INDEX idx_comment_item ON comments(work_item_row_id);
CREATE INDEX idx_queue_item ON sync_queue(item_row_id, action);
CREATE INDEX idx_pr_link_item ON pr_item_links(item_row_id);

-- 7. Drop nextId from project_config (recreate without it)
-- Note: SQLite doesn't support DROP COLUMN before 3.35.0, so we recreate
CREATE TABLE project_config_new (
  id INTEGER PRIMARY KEY DEFAULT 1,
  backend TEXT NOT NULL DEFAULT 'none',
  current_iteration TEXT NOT NULL DEFAULT '',
  branch_mode TEXT NOT NULL DEFAULT 'branch',
  branch_command TEXT NOT NULL DEFAULT '',
  copy_to_clipboard INTEGER NOT NULL DEFAULT 1,
  auto_update INTEGER NOT NULL DEFAULT 1,
  default_type TEXT NOT NULL DEFAULT 'issue',
  show_detail_panel INTEGER NOT NULL DEFAULT 0,
  default_view TEXT NOT NULL DEFAULT '',
  theme TEXT NOT NULL DEFAULT 'default'
);
INSERT INTO project_config_new (id, backend, current_iteration, branch_mode, branch_command, copy_to_clipboard, auto_update, default_type, show_detail_panel, default_view, theme)
SELECT id, backend, current_iteration, branch_mode, branch_command, copy_to_clipboard, auto_update, default_type, show_detail_panel, default_view, theme
FROM project_config;
DROP TABLE project_config;
ALTER TABLE project_config_new RENAME TO project_config;
```

- [ ] **Step 2: Update drizzle migration metadata**

Run: `npx drizzle-kit generate` or manually add the journal entry for `0006_dual_id.sql` in `drizzle/meta/_journal.json`.

- [ ] **Step 3: Test migration on a fresh DB and an existing DB**

Run: `npm test -- --run src/storage/db.test.ts` (if exists) or create a quick smoke test that opens a DB, runs migrations, and verifies the new schema.

- [ ] **Step 4: Commit**

```bash
git add drizzle/0006_dual_id.sql drizzle/meta/
git commit -m "feat: add migration for dual-ID schema"
```

---

### Task 4: Update mappers

**Files:**
- Modify: `src/storage/mappers.ts`

- [ ] **Step 1: Update rowToWorkItem**

```typescript
export function rowToWorkItem(
  row: WorkItemRow,
  labels: WorkItemLabelRow[],
  deps: WorkItemDepRow[],
  itemComments: CommentRow[],
): WorkItem {
  return {
    rowId: row.rowId,
    id: row.id,
    title: row.title,
    type: row.type,
    status: row.status,
    iteration: row.iteration,
    priority: (row.priority || 'medium') as WorkItem['priority'],
    assignee: row.assignee,
    labels: labels.map((l) => l.label),
    created: row.created,
    updated: row.updated,
    description: row.description,
    comments: itemComments.map(rowToComment),
    parent: row.parent,
    dependsOn: deps.map((d) => d.dependsOnRowId),
  };
}
```

- [ ] **Step 2: Update workItemToRow**

```typescript
export function workItemToRow(item: WorkItem): WorkItemInsert {
  return {
    rowId: item.rowId,
    id: item.id,
    title: item.title,
    type: item.type,
    status: item.status,
    iteration: item.iteration,
    priority: item.priority,
    assignee: item.assignee,
    description: item.description,
    parent: item.parent,
    created: item.created,
    updated: item.updated,
    deletedAt: null,
  };
}
```

- [ ] **Step 3: Update rowToPullRequest**

Change `linkedItemIds: string[]` to `linkedItemRowIds: number[]` and update mapping.

- [ ] **Step 4: Commit**

```bash
git add src/storage/mappers.ts
git commit -m "feat: update mappers for rowId and integer relationships"
```

---

## Chunk 2: Storage Layer

### Task 5: Rewrite Storage.createWorkItem

**Files:**
- Modify: `src/storage/index.ts:612-705`

- [ ] **Step 1: Write failing test for createWorkItem returning rowId**

In `src/storage/index.test.ts`, add test:

```typescript
it('createWorkItem returns rowId and assigns display id for local backend', async () => {
  const item = await storage.createWorkItem({
    title: 'Test',
    type: 'task',
    status: 'todo',
    iteration: '',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  expect(item.rowId).toBeTypeOf('number');
  expect(item.rowId).toBeGreaterThan(0);
  expect(item.id).toBe(String(item.rowId)); // local backend assigns display id
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/index.test.ts -t "createWorkItem returns rowId"`
Expected: FAIL

- [ ] **Step 3: Rewrite createWorkItem**

```typescript
async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
  this.validateFields(data);
  const now = new Date().toISOString();

  const result = this.db.transaction(
    (tx) => {
      // Validate relationships (parent/dependsOn are rowIds now)
      if (data.parent !== null) {
        const parentRow = tx
          .select({ rowId: schema.workItems.rowId })
          .from(schema.workItems)
          .where(eq(schema.workItems.rowId, data.parent))
          .get();
        if (!parentRow) {
          throw new Error(`Parent item #${data.parent} not found`);
        }
      }
      for (const depRowId of data.dependsOn) {
        const depRow = tx
          .select({ rowId: schema.workItems.rowId })
          .from(schema.workItems)
          .where(eq(schema.workItems.rowId, depRowId))
          .get();
        if (!depRow) {
          throw new Error(`Dependency item #${depRowId} not found`);
        }
      }

      // Ensure iteration exists
      if (data.iteration) {
        tx.insert(schema.iterations)
          .values({ name: data.iteration, sortOrder: 0 })
          .onConflictDoNothing()
          .run();
      }

      // Insert work item (no id yet — will be assigned below)
      const insertResult = tx.insert(schema.workItems)
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

      // For local-only: assign display id = rowId
      // For synced: leave id as null (sync will fill it in)
      const displayId = this.hasRemoteBackend ? null : String(rowId);
      if (displayId !== null) {
        tx.update(schema.workItems)
          .set({ id: displayId })
          .where(eq(schema.workItems.rowId, rowId))
          .run();
      }

      // Insert labels
      if (data.labels.length > 0) {
        tx.insert(schema.workItemLabels)
          .values(data.labels.map((label) => ({ workItemRowId: rowId, label })))
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
```

Note: `this.hasRemoteBackend` is a new boolean property set during Storage construction (or via a setter called by `backendDataStore` after remote detection).

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/storage/index.test.ts -t "createWorkItem returns rowId"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/storage/index.ts src/storage/index.test.ts
git commit -m "feat: rewrite createWorkItem with rowId and display id"
```

---

### Task 6: Rewrite Storage.importWorkItem and add setDisplayId

**Files:**
- Modify: `src/storage/index.ts`

- [ ] **Step 1: Write failing test for importWorkItem (upsert by display id)**

```typescript
it('importWorkItem upserts by display id', async () => {
  const item = makeWorkItem(1, { id: '42', title: 'Remote item' });
  const imported = await storage.importWorkItem(item);
  expect(imported.id).toBe('42');
  expect(imported.rowId).toBeTypeOf('number');
  expect(imported.title).toBe('Remote item');

  // Second import updates existing
  const updated = await storage.importWorkItem({ ...item, title: 'Updated' });
  expect(updated.rowId).toBe(imported.rowId); // same rowId
  expect(updated.title).toBe('Updated');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/storage/index.test.ts -t "importWorkItem upserts"`
Expected: FAIL

- [ ] **Step 3: Rewrite importWorkItem**

The new `importWorkItem` does an upsert by display `id`. If a row with that display ID exists, update it. Otherwise, insert a new row.

```typescript
async importWorkItem(item: WorkItem): Promise<WorkItem> {
  const rowId = this.db.transaction((tx) => {
    // Ensure iteration exists
    if (item.iteration) {
      tx.insert(schema.iterations)
        .values({ name: item.iteration, sortOrder: 0 })
        .onConflictDoNothing()
        .run();
    }

    // Check if item with this display id already exists
    const existing = item.id
      ? tx.select({ rowId: schema.workItems.rowId })
          .from(schema.workItems)
          .where(eq(schema.workItems.id, item.id))
          .get()
      : undefined;

    // Resolve parent: item.parent is the remote's numeric ID.
    // Look up the local rowId by display ID.
    // The caller (SyncManager.pull) must have already imported parent items
    // before children, so the parent's display ID exists locally.
    let localParentRowId: number | null = null;
    if (item.parent !== null) {
      // item.parent from remote is a number (remote's ID).
      // Look up by display ID (String of remote ID).
      const parentRow = tx
        .select({ rowId: schema.workItems.rowId })
        .from(schema.workItems)
        .where(eq(schema.workItems.id, String(item.parent)))
        .get();
      localParentRowId = parentRow?.rowId ?? null;
    }

    // Resolve dependsOn similarly
    const localDepRowIds: number[] = [];
    for (const depId of item.dependsOn) {
      const depRow = tx
        .select({ rowId: schema.workItems.rowId })
        .from(schema.workItems)
        .where(eq(schema.workItems.id, String(depId)))
        .get();
      if (depRow) localDepRowIds.push(depRow.rowId);
    }

    let resultRowId: number;

    if (existing) {
      // Update existing row
      resultRowId = existing.rowId;
      tx.update(schema.workItems)
        .set({
          id: item.id,
          title: item.title,
          type: item.type,
          status: item.status,
          iteration: item.iteration,
          priority: item.priority,
          assignee: item.assignee,
          description: item.description,
          parent: localParentRowId,
          created: item.created,
          updated: item.updated,
        })
        .where(eq(schema.workItems.rowId, resultRowId))
        .run();
    } else {
      // Insert new row
      const result = tx.insert(schema.workItems)
        .values({
          id: item.id,
          title: item.title,
          type: item.type,
          status: item.status,
          iteration: item.iteration,
          priority: item.priority,
          assignee: item.assignee,
          description: item.description,
          parent: localParentRowId,
          created: item.created,
          updated: item.updated,
        })
        .run();
      resultRowId = Number(result.lastInsertRowid);
    }

    // Replace labels
    tx.delete(schema.workItemLabels)
      .where(eq(schema.workItemLabels.workItemRowId, resultRowId))
      .run();
    if (item.labels.length > 0) {
      tx.insert(schema.workItemLabels)
        .values(item.labels.map((label) => ({ workItemRowId: resultRowId, label })))
        .run();
    }

    // Replace deps (using resolved local rowIds)
    tx.delete(schema.workItemDeps)
      .where(eq(schema.workItemDeps.workItemRowId, resultRowId))
      .run();
    if (localDepRowIds.length > 0) {
      tx.insert(schema.workItemDeps)
        .values(
          localDepRowIds.map((depRowId) => ({
            workItemRowId: resultRowId,
            dependsOnRowId: depRowId,
          })),
        )
        .run();
    }

    // Replace comments
    tx.delete(schema.comments)
      .where(eq(schema.comments.workItemRowId, resultRowId))
      .run();
    if (item.comments.length > 0) {
      for (const c of item.comments) {
        tx.insert(schema.comments)
          .values({
            workItemRowId: resultRowId,
            author: c.author,
            body: c.body,
            created: c.date,
          })
          .run();
      }
    }

    return resultRowId;
  });

  this.invalidateCache();
  return { ...item, rowId };
}
```

- [ ] **Step 4: Add setDisplayId method**

```typescript
/** Set the display ID for an item (called after sync push). */
setDisplayId(rowId: number, displayId: string): void {
  this.db
    .update(schema.workItems)
    .set({ id: displayId })
    .where(eq(schema.workItems.rowId, rowId))
    .run();
  this.invalidateCache();
}
```

- [ ] **Step 5: Run tests**

Run: `npx vitest run src/storage/index.test.ts -t "importWorkItem"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/storage/index.ts src/storage/index.test.ts
git commit -m "feat: rewrite importWorkItem as upsert-by-display-id, add setDisplayId"
```

---

### Task 7: Update remaining Storage methods

**Files:**
- Modify: `src/storage/index.ts`

- [ ] **Step 1: Update getWorkItem to accept both rowId and display id**

Storage needs a way to look up by display `id` (for the Backend interface) and by `rowId` (for internal use). Add a `getWorkItemByRowId(rowId: number)` method alongside the existing `getWorkItem(id: string)` which looks up by display id.

- [ ] **Step 2: Update updateWorkItem**

Change all internal references from `schema.workItems.id` to `schema.workItems.rowId`. The `id: string` parameter in the Backend interface is a display ID — resolve to rowId first.

- [ ] **Step 3: Update deleteWorkItem, softDeleteWorkItem, restoreWorkItem**

Same pattern: accept display `id` string, resolve to `rowId`, operate on `rowId`.

- [ ] **Step 4: Update getChildren and getDependents**

Accept display `id` string, resolve to `rowId`, then filter by `parent === rowId` and `dependsOn.includes(rowId)`.

- [ ] **Step 5: Update assembleWorkItems (list query)**

Change all junction table joins from `workItemId` to `workItemRowId`. The query uses `schema.workItems.rowId` as the join key.

- [ ] **Step 6: Update addComment**

Resolve display `id` to `rowId`, insert with `workItemRowId`.

- [ ] **Step 7: Update PR methods (importPullRequest, linkItem, unlinkItem, getLinkedPullRequests)**

`linkItem`/`unlinkItem` now take `itemRowId: number`. `getLinkedPullRequests(itemRowId: number)` queries by `prItemLinks.itemRowId`. `importPullRequest` maps `linkedItems` (now `number[]`) to `prItemLinks.itemRowId`.

- [ ] **Step 8: Remove tempIds option and nextId logic**

Remove `this.tempIds` property, `StorageOptions.tempIds`, and all references to `nextId` from `project_config`. Also update `src/storage/config.ts`: remove `next_id` from the `Config` type, `defaultConfig`, `readConfig()`, and `insertConfigTx()`. Update `readBackendTypeSync()` if it references nextId. No changes to template tables (they keep `text` parent/dependsOn per spec).

- [ ] **Step 9: Add hasRemoteBackend property**

Add `hasRemoteBackend: boolean` property (default `false`), with a `setHasRemoteBackend(value: boolean)` setter. Called by `backendDataStore` after detecting whether a remote backend exists.

- [ ] **Step 10: Run all storage tests**

Run: `npx vitest run src/storage/index.test.ts`
Fix failing tests — update test assertions to use `rowId`, expect `id` to be `string | null`, update parent/dependsOn to use numbers.

- [ ] **Step 11: Commit**

```bash
git add src/storage/
git commit -m "feat: update all Storage methods for rowId-based operations"
```

---

## Chunk 3: Undo, Sync Queue, and SyncManager

### Task 8: Update undo system

**Files:**
- Modify: `src/storage/undo.ts`
- Modify: `src/stores/undoStore.ts`

- [ ] **Step 1: Update SerializedSnapshot**

```typescript
interface SerializedSnapshot {
  rowId: number;
  id: string | null;
  title: string;
  type: string;
  status: string;
  description: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string[];
  parent: number | null;
  dependsOn: number[];
  created: string;
  updated: string;
}
```

Update `serializeSnapshots` and `deserializeSnapshots` accordingly.

- [ ] **Step 2: Update UndoMetadata**

```typescript
interface UndoMetadata {
  label: string;
  syncItemRowIds: number[];  // was syncItemIds: string[]
  syncAction: QueueAction;
  createdRowIds?: number[];  // was createdIds?: string[]
  itemSnapshots: SerializedSnapshot[];
}
```

- [ ] **Step 3: Update UndoEntry in undoStore.ts**

```typescript
export interface UndoEntry {
  type: UndoActionType;
  label: string;
  itemSnapshots: WorkItem[];
  syncItemRowIds: number[];  // was syncItemIds: string[]
  syncAction: QueueAction;
  createdRowIds?: number[];  // was createdIds?: string[]
}
```

- [ ] **Step 4: Update undo_stack schema column**

The undo_stack now uses `metadata` column instead of `itemId`. Update `pushUndoEntry` and `reconstructEntry` to use the new column name.

- [ ] **Step 5: Run undo tests**

Run: `npx vitest run src/storage/undo.test.ts src/stores/undoStore.test.ts`
Fix any failures.

- [ ] **Step 6: Commit**

```bash
git add src/storage/undo.ts src/stores/undoStore.ts
git commit -m "feat: update undo system for rowId references"
```

---

### Task 9: Update sync queue

**Files:**
- Modify: `src/storage/syncQueue.ts`
- Modify: `src/sync/types.ts`

- [ ] **Step 1: Update QueueEntry type**

In `src/sync/types.ts`:
```typescript
export interface QueueEntry {
  action: QueueAction;
  itemRowId: number;  // was itemId: string
  timestamp: string;
  commentData?: { author: string; body: string };
  templateSlug?: string;
}
```

- [ ] **Step 2: Update SyncQueueAdapter interface**

```typescript
export interface SyncQueueAdapter {
  read(): SyncQueueData | Promise<SyncQueueData>;
  append(entry: QueueEntry): void | Promise<void>;
  remove(itemRowId: number, action: QueueAction): void | Promise<void>;
  removeByIds(itemRowIds: number[], action: QueueAction): void | Promise<void>;
  claimNext(): QueueEntry | null | Promise<QueueEntry | null>;
  clear(): void | Promise<void>;
  // renameItem removed!
}
```

- [ ] **Step 3: Update PushResult**

Remove `idMappings` from `PushResult`:
```typescript
export interface PushResult {
  pushed: number;
  failed: number;
  errors: SyncError[];
  // idMappings removed
}
```

- [ ] **Step 4: Update SyncLogEntry**

Change `itemId: string` to `itemRowId: number`.

- [ ] **Step 5: Update syncQueue.ts implementation**

Update all methods to use `schema.syncQueue.itemRowId` instead of `schema.syncQueue.itemId`. Remove the `renameItem` method.

- [ ] **Step 6: Run sync queue tests**

Run: `npx vitest run src/storage/syncQueue.test.ts`
Fix any failures.

- [ ] **Step 7: Commit**

```bash
git add src/storage/syncQueue.ts src/sync/types.ts
git commit -m "feat: update sync queue for integer rowId references"
```

---

### Task 10: Rewrite SyncManager

**Files:**
- Modify: `src/sync/SyncManager.ts`

- [ ] **Step 1: Remove renameLocalItem method**

Delete the entire `renameLocalItem` method (lines 313-343).

- [ ] **Step 2: Rewrite pushEntry for 'create' action**

The create case now:
1. Gets local item by rowId (not display id)
2. Resolves parent/dependsOn from rowIds to display IDs for the remote
3. Calls remote.createWorkItem
4. Sets display ID on local item via `storage.setDisplayId(entry.itemRowId, remoteItem.id)`

```typescript
case 'create': {
  const storage = this.primary as import('../storage/index.js').Storage;
  const localItem = await storage.getWorkItemByRowId(entry.itemRowId);

  // Resolve rowId relationships to display IDs for remote
  const parentDisplayId = localItem.parent !== null
    ? (await storage.getWorkItemByRowId(localItem.parent)).id
    : null;
  const dependsOnDisplayIds = await Promise.all(
    localItem.dependsOn.map(async (depRowId) => {
      const dep = await storage.getWorkItemByRowId(depRowId);
      return dep.id!;  // must be synced already
    })
  );

  const remoteData = {
    title: localItem.title,
    type: localItem.type,
    status: localItem.status,
    priority: localItem.priority,
    assignee: localItem.assignee,
    labels: localItem.labels,
    iteration: localItem.iteration,
    description: localItem.description,
    parent: parentDisplayId,
    dependsOn: dependsOnDisplayIds,
  };

  const { data: stripped } = this.stripUnsupportedFields(remoteData);
  const remoteItem = await this.remote.createWorkItem(stripped);

  // Set the display ID locally
  if (remoteItem.id) {
    storage.setDisplayId(entry.itemRowId, remoteItem.id);
  }

  return entry.itemRowId;
}
```

Note: `stripUnsupportedFields` needs updating since `parent` and `dependsOn` are now `string | null` and `string[]` in the remote-facing data (not numbers).

- [ ] **Step 3: Update pushEntry for 'update' action**

Similar pattern: resolve relationships to display IDs before sending to remote.

- [ ] **Step 4: Update pushEntry for 'delete' action**

Look up display ID from rowId. If display ID is null (never synced), skip remote delete.

- [ ] **Step 5: Update pushEntry for 'comment' action**

Look up display ID from rowId for the remote `addComment` call.

- [ ] **Step 6: Update pushPending return type**

Remove `idMappings` from the returned `PushResult`.

- [ ] **Step 7: Update pull method**

The pull method now uses `importWorkItem` which upserts by display ID. The `localIds` and `remoteIds` sets should use display IDs for comparison (to decide what to delete from local).

For the delete reconciliation: items with null display ID (unsynced local items) should never be deleted during pull.

- [ ] **Step 8: Update stripUnsupportedFields**

Create a `RemoteNewWorkItem` type in `src/sync/types.ts` for the remote-facing data:

```typescript
/** NewWorkItem with display ID strings for parent/dependsOn (for remote backends). */
export interface RemoteNewWorkItem {
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  assignee: string;
  labels: string[];
  description: string;
  parent: string | null;      // display ID
  dependsOn: string[];        // display IDs
}
```

Change `stripUnsupportedFields` signature from `(data: NewWorkItem)` to `(data: RemoteNewWorkItem)`. The remote backend's `createWorkItem` accepts `NewWorkItem` where parent/dependsOn are numbers — but remote backends interpret these numbers as their own IDs. Actually, remote backends' `createWorkItem` still takes `NewWorkItem`. So the simplest fix: cast `RemoteNewWorkItem` to `NewWorkItem` at the call site (`as unknown as NewWorkItem`), since remote backends treat the parent/dependsOn values as their own ID type anyway. The type safety at this boundary is already loose (remote backends convert these to their own API formats internally).

- [ ] **Step 9: Run sync tests**

Run: `npx vitest run src/sync/SyncManager.test.ts src/sync/integration.test.ts`
Fix any failures.

- [ ] **Step 10: Commit**

```bash
git add src/sync/SyncManager.ts
git commit -m "feat: simplify SyncManager - remove renameLocalItem, use setDisplayId"
```

---

## Chunk 4: Stores

### Task 11: Update navigationStore

**Files:**
- Modify: `src/stores/navigationStore.ts`

- [ ] **Step 1: Change string IDs to numbers**

```typescript
interface NavigationState {
  // ...
  selectedWorkItemId: number | null;  // was string | null
  navigationStack: number[];          // was string[]
  createChildParentId: number | null; // was string | null
  // ...
  selectWorkItem: (id: number | null) => void;
  pushWorkItem: (id: number) => void;
  setCreateChildParentId: (id: number | null) => void;
  // ...
}
```

- [ ] **Step 2: Update action implementations**

Update `selectWorkItem`, `pushWorkItem`, `popWorkItem`, `setCreateChildParentId` to use `number`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/stores/navigationStore.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/stores/navigationStore.ts
git commit -m "feat: update navigationStore for rowId (number) references"
```

---

### Task 12: Update listViewStore

**Files:**
- Modify: `src/stores/listViewStore.ts`

- [ ] **Step 1: Change Set<string> to Set<number>**

```typescript
interface ListViewState {
  // ...
  expandedIds: Set<number>;  // was Set<string>
  markedIds: Set<number>;    // was Set<string>
  // ...
  toggleExpanded: (id: number) => void;
  toggleMarked: (id: number) => void;
  setMarkedIds: (ids: Set<number>) => void;
  removeDeletedItem: (id: number) => void;
}
```

- [ ] **Step 2: Update initialState and action implementations**

- [ ] **Step 3: Commit**

```bash
git add src/stores/listViewStore.ts
git commit -m "feat: update listViewStore for rowId (number) references"
```

---

### Task 13: Update formStackStore

**Files:**
- Modify: `src/stores/formStackStore.ts`

- [ ] **Step 1: Update FormDraft**

```typescript
export interface FormDraft {
  itemRowId: number | null;  // was itemId: string | null
  itemTitle: string;
  fields: FormFields;
  initialSnapshot: FormFields;
  focusedField: number;
}
```

`FormFields.parentId` and `FormFields.dependsOn` stay as `string` — they're user-facing text input fields. The component translates between display text and rowIds when reading/writing.

- [ ] **Step 2: Commit**

```bash
git add src/stores/formStackStore.ts
git commit -m "feat: update formStackStore itemId to itemRowId"
```

---

## Chunk 5: Backend Interface, BaseBackend, and Remote Backends

### Task 14: Update Backend interface and BaseBackend

**Files:**
- Modify: `src/backends/types.ts`

- [ ] **Step 1: Keep Backend interface signatures with string IDs**

The `Backend` interface keeps `id: string` for `getWorkItem`, `updateWorkItem`, etc. This is the display ID. Storage resolves to rowId internally.

- [ ] **Step 2: Update SyncableBackend doc comment**

Update the doc comment to reflect that `importWorkItem` now does upsert-by-display-id. The `renameItem` concept is gone.

- [ ] **Step 3: Update BaseBackend.getChildren/getDependents**

Since `WorkItem.parent` and `WorkItem.dependsOn` are now numbers (rowIds), `getChildren(id: string)` needs to:
1. Find the item by display id to get its rowId
2. Filter all items where `item.parent === rowId`

But `BaseBackend` default implementations use cached items. Remote backends (GitHub, etc.) set `rowId` to a sentinel or self-consistent value. For remote backends, parent/dependsOn store the *remote* numeric value, so the comparison still works within that backend's items.

Actually, the simpler approach: remote backends construct `WorkItem` objects where `rowId` equals some numeric representation of their ID, and `parent`/`dependsOn` match those. This keeps `BaseBackend.getChildren` working without change.

For each remote backend mapper, set `rowId` to the numeric ID:
- GitHub: `rowId = issue.number`
- GitLab: `rowId = iid` (number)
- ADO: `rowId = workItem.id` (number)
- Jira: `rowId = Number(key.split('-')[1])` or a hash

- [ ] **Step 4: Update PrBackend interface**

```typescript
export interface PrBackend {
  // ...
  getLinkedPullRequests(itemId: string): Promise<PullRequest[]>;
  getLinkedItems(prId: string): Promise<number[]>;  // was string[]
  linkItem(prId: string, itemId: string): Promise<void>;
  unlinkItem(prId: string, itemId: string): Promise<void>;
}
```

Keep `itemId: string` for link/unlink (display ID) since remote backends use display IDs. `getLinkedItems` returns `number[]` (rowIds) for Storage, but remote backends return their own numeric IDs.

Actually, keeping `string` for `getLinkedItems` return type is simpler for remote backends. The key insight is: Storage overrides these with rowId-based implementations, while remote backends keep strings. Let's keep PrBackend as-is with strings, and Storage casts appropriately.

**Decision:** Keep `PrBackend` interface unchanged (all strings). Storage's implementation internally maps to rowIds. This minimizes changes to remote backend code.

- [ ] **Step 5: Commit**

```bash
git add src/backends/types.ts
git commit -m "feat: update BaseBackend for rowId-based parent/dependsOn"
```

---

### Task 15: Update remote backend mappers

**Files:**
- Modify: `src/backends/github/mappers.ts`
- Modify: `src/backends/gitlab/mappers.ts`
- Modify: `src/backends/ado/mappers.ts`
- Modify: `src/backends/jira/mappers.ts`

- [ ] **Step 1: Add rowId to each backend's WorkItem construction**

Each remote backend needs to set `rowId` when constructing `WorkItem` objects. Use the backend's native numeric ID:

GitHub mappers: `rowId: issue.number`
GitLab mappers: `rowId: iid` (the project-scoped integer)
ADO mappers: `rowId: workItem.id` (Azure DevOps integer ID)
Jira mappers: `rowId: 0` (Jira uses string keys like PROJ-42, no natural numeric ID — use 0 as sentinel, Storage will assign real rowId on import)

- [ ] **Step 2: Set parent and dependsOn as numbers**

Remote backends that support parent/dependsOn need to map their string references to numbers:
- GitHub: parent sub-issue number → `parent: Number(parentId)`
- GitLab: parent work item iid → `parent: Number(parentIid)`
- ADO: parent work item id → `parent: Number(parentId)`
- Jira: parent key → `parent: 0` (sentinel — resolved during import)

Note: These rowIds are *remote* rowIds, not local SQLite rowIds. They're only meaningful within that backend's context. When imported to local via `importWorkItem`, the local rowId is assigned by SQLite and the remote's rowId in the WorkItem is ignored.

- [ ] **Step 3: Run remote backend tests**

Run: `npx vitest run src/backends/github/ src/backends/gitlab/ src/backends/ado/ src/backends/jira/`
Fix mapper test assertions.

- [ ] **Step 4: Commit**

```bash
git add src/backends/github/ src/backends/gitlab/ src/backends/ado/ src/backends/jira/
git commit -m "feat: add rowId to remote backend WorkItem mappers"
```

---

### Task 16: Update FilesBackend and local/items.ts

**Files:**
- Modify: `src/backends/files/index.ts`
- Modify: `src/backends/local/items.ts`

- [ ] **Step 1: Update file naming**

Files use display ID for naming (`{displayId}.md`). Items with null display ID are skipped during file sync.

- [ ] **Step 2: Update parseWorkItemFile**

When reading markdown files back, `rowId` is set to 0 (sentinel — the real rowId comes from SQLite). `parent` and `dependsOn` parsed from frontmatter stay as numbers.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/backends/files/ src/backends/local/`

- [ ] **Step 4: Commit**

```bash
git add src/backends/files/ src/backends/local/
git commit -m "feat: update FilesBackend for dual-ID"
```

---

## Chunk 6: UI Components

### Task 17: Update buildTree

**Files:**
- Modify: `src/components/buildTree.ts`

- [ ] **Step 1: Update maps to use rowId**

```typescript
export function buildTree(
  filteredItems: WorkItem[],
  allItems: WorkItem[],
  activeType: string,
): TreeItem[] {
  const allItemMap = new Map(allItems.map((i) => [i.rowId, i]));

  const childrenMap = new Map<number | null, WorkItem[]>();
  for (const item of allItems) {
    const parentId =
      item.parent !== null && allItemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  const filteredIds = new Set(filteredItems.map((i) => i.rowId));
  const idsWithChildren = new Set<number>();
  for (const item of allItems) {
    if (item.parent !== null && allItemMap.has(item.parent)) {
      idsWithChildren.add(item.parent);
    }
  }

  // ... walk function uses rowId for recursion
  function walk(parentId: number | null, depth: number, parentPrefix: string) {
    // ...
    // At depth 0, check filteredIds.has(child.rowId)
    // hasChildren: idsWithChildren.has(child.rowId)
    // Recurse: walk(child.rowId, depth + 1, nextParentPrefix)
  }
}
```

- [ ] **Step 2: Update sortTree**

Change `item.parent` comparisons and `item.id` references to use `rowId`. The sort by 'id' column should sort by display ID (numeric if possible, then string compare).

```typescript
case 'id': {
  const aId = a.id ?? '';
  const bId = b.id ?? '';
  const aNum = Number(aId);
  const bNum = Number(bId);
  if (!isNaN(aNum) && !isNaN(bNum)) {
    result = aNum - bNum;
  } else {
    result = aId.localeCompare(bId);
  }
  break;
}
```

- [ ] **Step 3: Run buildTree tests**

Run: `npx vitest run src/components/buildTree.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/components/buildTree.ts src/components/buildTree.test.ts
git commit -m "feat: update buildTree for rowId-based parent/child maps"
```

---

### Task 18: Update WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

- [ ] **Step 1: Update all item.id references to item.rowId for internal logic**

- Selection: `selectWorkItem(item.rowId)` instead of `selectWorkItem(item.id)`
- Expansion: `toggleExpanded(item.rowId)` instead of `toggleExpanded(item.id)`
- Marking: `toggleMarked(item.rowId)` instead of `toggleMarked(item.id)`
- Undo: use `rowId` in undo entry construction

- [ ] **Step 2: Display id column**

Show `item.id ?? '·'` in the ID column (placeholder icon when null).

- [ ] **Step 3: Update keyboard handlers**

Any handler that references `selectedWorkItemId` or `item.id` for navigation/selection should use `rowId`.

- [ ] **Step 4: Run WorkItemList tests**

Run: `npx vitest run src/components/WorkItemList.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: update WorkItemList for rowId selection and nullable display id"
```

---

### Task 19: Update WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

- [ ] **Step 1: Update form loading**

When loading an existing item for editing, use `rowId` for the `FormDraft.itemRowId`. The `parentId` field in `FormFields` stays as a string (display ID shown to user).

- [ ] **Step 2: Update form submission**

When building `NewWorkItem` for create/update, resolve the `parentId` text field to a `rowId` number. Same for `dependsOn` (comma-separated display IDs → rowId numbers).

- [ ] **Step 3: Update relationship navigation**

When clicking a parent/child link in the form, navigate by `rowId`.

- [ ] **Step 4: Run WorkItemForm tests**

Run: `npx vitest run src/components/WorkItemForm.test.ts`

- [ ] **Step 5: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: update WorkItemForm for rowId relationships"
```

---

### Task 20: Update remaining components

**Files:**
- Modify: `src/components/DetailPanel.tsx`
- Modify: `src/components/CommandBar.tsx`
- Modify: `src/components/OverlayPanel.tsx`

- [ ] **Step 1: Update DetailPanel**

Show `item.id ?? '·'` for display. Parent/dependsOn links show display ID and navigate by rowId.

- [ ] **Step 2: Update CommandBar**

Search matches on display ID (when not null) and title. Selection uses rowId.

- [ ] **Step 3: Update OverlayPanel**

Item selection uses rowId.

- [ ] **Step 4: Run component tests**

Run: `npx vitest run src/components/`

- [ ] **Step 5: Commit**

```bash
git add src/components/
git commit -m "feat: update DetailPanel, CommandBar, OverlayPanel for rowId"
```

---

## Chunk 7: CLI, MCP, Utilities, and Final Test Fixes

### Task 21: Update CLI commands

**Files:**
- Modify: `src/cli/commands/item.ts`
- Modify: `src/cli/commands/pr.ts`
- Modify: `src/cli/commands/mcp.ts`
- Modify: `src/cli/commands/branch.ts`

- [ ] **Step 1: Update item commands**

`item show <id>`, `item update <id>`, `item delete <id>` — the `<id>` argument is a display ID. Look up by display ID via `storage.getWorkItem(id)`.

`item create --parent <id>` — the `<id>` is a display ID. Resolve to rowId before passing to `createWorkItem`. Add a helper: `resolveDisplayIdToRowId(storage, displayId)`.

- [ ] **Step 2: Update pr commands**

`pr link <prId> <itemId>` — `itemId` is display ID. Resolve appropriately.

- [ ] **Step 3: Update MCP tool handlers**

All MCP tools that accept `itemId` accept display IDs. Resolve to rowId as needed.

`tic-show_item`, `tic-update_item`, `tic-delete_item`, `tic-add_comment`, `tic-get_children`, `tic-get_dependents`, `tic-create_item` (parent/dependsOn params are display IDs — resolve to rowIds).

- [ ] **Step 4: Run CLI/MCP tests**

Run: `npx vitest run src/cli/`

- [ ] **Step 5: Commit**

```bash
git add src/cli/
git commit -m "feat: update CLI and MCP handlers for display ID input"
```

---

### Task 22: Update implement.ts and branch-links.ts

**Files:**
- Modify: `src/implement.ts`
- Modify: `src/branch-links.ts`

- [ ] **Step 1: Update formatItemForClipboard**

Use `item.id ?? '(unsynced)'` for display. The `item.parent` is a rowId now — for clipboard, look up the parent's display ID. Actually, `formatItemForClipboard` should probably receive pre-resolved display strings. Or keep it simple: show rowId with a `#` prefix if display ID is null.

For `TIC_ITEM_ID` env var, use `item.id ?? ''`.

- [ ] **Step 2: Update branch-links.ts**

`tic/{id}-*` pattern uses display ID. The `slugify` function takes display ID. If display ID is null, branch creation should be blocked (checked at call site).

`extractItemId` from branch name returns a display ID string. Resolving back to rowId is the caller's responsibility.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/implement.test.ts src/branch-links.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/implement.ts src/branch-links.ts
git commit -m "feat: update implement and branch-links for nullable display id"
```

---

### Task 23: Update backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`

- [ ] **Step 1: Update init to set hasRemoteBackend on Storage**

After detecting the remote backend in `createBackendAndSync()`, call `storage.setHasRemoteBackend(true)` if a remote backend was created.

- [ ] **Step 2: Update any item ID references in store**

If the store references `item.id` for selection or comparison, switch to `item.rowId`.

- [ ] **Step 3: Run tests**

Run: `npx vitest run src/stores/backendDataStore.test.ts`

- [ ] **Step 4: Commit**

```bash
git add src/stores/backendDataStore.ts
git commit -m "feat: update backendDataStore for rowId and hasRemoteBackend"
```

---

### Task 24: Fix remaining test failures

**Files:**
- Various test files

- [ ] **Step 1: Run full test suite**

Run: `npm test 2>&1 | tail -50`

- [ ] **Step 2: Fix test-helpers.ts callers**

All tests calling `makeWorkItem('1', ...)` now need `makeWorkItem(1, ...)`. Use find/replace across test files.

- [ ] **Step 3: Fix parent/dependsOn in test data**

Tests that set `parent: '1'` need `parent: 1`. Tests that set `dependsOn: ['2']` need `dependsOn: [2]`.

- [ ] **Step 4: Fix assertions**

Tests that assert `item.id === '1'` may need to assert `item.rowId === 1` or `item.id === '1'` (display ID).

- [ ] **Step 5: Run full test suite again**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 6: Commit**

```bash
git add .
git commit -m "test: fix all tests for dual-ID refactor"
```

---

### Task 25: Final verification

- [ ] **Step 1: Run full build**

Run: `npm run build`
Expected: Clean compile

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 3: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: Clean

- [ ] **Step 4: Manual smoke test**

Run: `npm start`
Verify:
- Items display with numeric IDs (local backend)
- Creating an item shows the ID immediately
- Parent/child relationships work
- Expanding/collapsing works
- Undo works
- Settings page works

- [ ] **Step 5: Final commit if any fixups needed**

```bash
git add .
git commit -m "fix: final dual-ID cleanup"
```
