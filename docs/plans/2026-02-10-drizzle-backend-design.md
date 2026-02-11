# Drizzle ORM SQLite Backend Design

## Motivation

The current `LocalBackend` plays a dual role — it's both the primary backend for local-only projects and the local cache for remote sync. This creates architectural asymmetry: the sync layer (`SyncManager`) reaches past the `Backend` interface to call low-level file I/O functions (`writeWorkItem`, `removeWorkItemFile`) directly. Every query is a full table scan (read N files, parse YAML, filter in-memory), and any mutation invalidates the entire cache, triggering a full re-read.

This design replaces the filesystem-based `LocalBackend` with a `DrizzleBackend` backed by SQLite (via Drizzle ORM + `better-sqlite3`), making it the always-present primary backend. The current filesystem storage becomes a `FilesBackend` — an optional sync destination, just like GitHub or GitLab. The `SyncManager` becomes fully backend-agnostic, interacting only through the `Backend` interface.

### Goals

1. **Architectural cleanliness** — remove the "local is special" asymmetry in the sync layer
2. **Performance** — indexed queries replace full file scans; targeted reloads replace full cache invalidation
3. **Concurrent safety** — SQLite WAL mode allows TUI + MCP + CLI to share the same database
4. **Unified factory** — single backend creation path for TUI, CLI, and MCP

## Architecture Overview

```
┌─────────────────────────────────────────────────┐
│  TUI / CLI / MCP                                │
│       ↕ Backend interface                       │
│  DrizzleBackend (SQLite — source of truth)      │
│       ↕ SyncManager (Backend ↔ Backend)         │
│  ┌──────────────┬──────────────┬──────────────┐ │
│  │ FilesBackend │ GitHubBackend│ GitLabBackend │ │
│  │ (.tic/items/)│   (optional) │   (optional)  │ │
│  └──────────────┴──────────────┴──────────────┘ │
└─────────────────────────────────────────────────┘
```

- **`DrizzleBackend`** implements the full `Backend` + `SoftDeleteBackend` interfaces backed by SQLite tables. All reads go through indexed queries. All writes are transactional.
- **`FilesBackend`** wraps the current filesystem I/O (`items.ts`, `frontmatter.ts`, `templates.ts`) as a `Backend` implementation. It's the current `LocalBackend` repositioned as an optional remote sync destination.
- **`SyncManager`** takes any two `Backend` implementations and syncs between them. No direct file I/O. No special-casing.

### Backend configuration

```yaml
backend: filesystem  # or github, gitlab, ado, jira, none
```

- `none` — pure SQLite, no sync destination
- `filesystem` — two-way sync with `.tic/items/*.md` files (opt-in, replaces old `local`)
- `github` / `gitlab` / `ado` / `jira` — remote sync destinations (same as today)

Only one sync destination at a time.

## SQLite Schema

### Work Items

```typescript
export const workItems = sqliteTable('work_items', {
  id:          text('id').primaryKey(),
  title:       text('title').notNull(),
  type:        text('type').notNull(),
  status:      text('status').notNull(),
  iteration:   text('iteration').notNull().default(''),
  priority:    text('priority').notNull().default(''),
  assignee:    text('assignee').notNull().default(''),
  description: text('description').notNull().default(''),
  parent:      text('parent'),
  created:     text('created').notNull(),
  updated:     text('updated').notNull(),
  deletedAt:   text('deleted_at'),              // null = active, ISO timestamp = soft-deleted
}, (t) => [
  index('idx_status').on(t.status),
  index('idx_type').on(t.type),
  index('idx_assignee').on(t.assignee),
  index('idx_priority').on(t.priority),
  index('idx_iteration').on(t.iteration),
  index('idx_parent').on(t.parent),
]);
```

### Labels (junction table)

```typescript
export const workItemLabels = sqliteTable('work_item_labels', {
  workItemId: text('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  label:      text('label').notNull(),
}, (t) => [
  primaryKey({ columns: [t.workItemId, t.label] }),
  index('idx_label').on(t.label),
]);
```

### Dependencies (junction table)

```typescript
export const workItemDeps = sqliteTable('work_item_deps', {
  workItemId:  text('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  dependsOnId: text('depends_on_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
}, (t) => [
  primaryKey({ columns: [t.workItemId, t.dependsOnId] }),
  index('idx_dep_target').on(t.dependsOnId),
]);
```

### Comments

```typescript
export const comments = sqliteTable('comments', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  workItemId: text('work_item_id').notNull().references(() => workItems.id, { onDelete: 'cascade' }),
  author:     text('author').notNull().default(''),
  body:       text('body').notNull(),
  created:    text('created').notNull(),
}, (t) => [
  index('idx_comment_item').on(t.workItemId),
]);
```

### Templates

```typescript
export const templates = sqliteTable('templates', {
  slug:        text('slug').primaryKey(),
  name:        text('name').notNull(),
  type:        text('type').notNull().default(''),
  status:      text('status').notNull().default(''),
  priority:    text('priority').notNull().default(''),
  assignee:    text('assignee').notNull().default(''),
  iteration:   text('iteration').notNull().default(''),
  parent:      text('parent'),
  description: text('description').notNull().default(''),
});

export const templateLabels = sqliteTable('template_labels', {
  templateSlug: text('template_slug').notNull().references(() => templates.slug, { onDelete: 'cascade' }),
  label:        text('label').notNull(),
}, (t) => [
  primaryKey({ columns: [t.templateSlug, t.label] }),
]);

export const templateDeps = sqliteTable('template_deps', {
  templateSlug: text('template_slug').notNull().references(() => templates.slug, { onDelete: 'cascade' }),
  dependsOnId:  text('depends_on_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.templateSlug, t.dependsOnId] }),
]);
```

### Project Configuration (structured tables)

```typescript
export const projectConfig = sqliteTable('project_config', {
  id:               integer('id').primaryKey().default(1),  // singleton row
  backend:          text('backend').notNull().default('none'),
  currentIteration: text('current_iteration').notNull().default(''),
  nextId:           integer('next_id').notNull().default(1),
  branchMode:       text('branch_mode').notNull().default('branch'),
  branchCommand:    text('branch_command').notNull().default(''),
  copyToClipboard:  integer('copy_to_clipboard', { mode: 'boolean' }).notNull().default(true),
  autoUpdate:       integer('auto_update', { mode: 'boolean' }).notNull().default(true),
  defaultType:      text('default_type').notNull().default('issue'),
  showDetailPanel:  integer('show_detail_panel', { mode: 'boolean' }).notNull().default(false),
});

export const statuses = sqliteTable('statuses', {
  name:      text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const workItemTypes = sqliteTable('work_item_types', {
  name:      text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const iterations = sqliteTable('iterations', {
  name:      text('name').primaryKey(),
  sortOrder: integer('sort_order').notNull().default(0),
});

export const jiraConfig = sqliteTable('jira_config', {
  id:      integer('id').primaryKey().default(1),  // singleton row
  site:    text('site').notNull().default(''),
  project: text('project').notNull().default(''),
  boardId: text('board_id').notNull().default(''),
});
```

### Saved Views (fully normalized)

```typescript
export const savedViews = sqliteTable('saved_views', {
  name: text('name').primaryKey(),
});

export const savedViewFilters = sqliteTable('saved_view_filters', {
  viewName: text('view_name').notNull().references(() => savedViews.name, { onDelete: 'cascade' }),
  field:    text('field').notNull(),     // 'status', 'type', 'priority', 'assignee', 'label'
  value:    text('value').notNull(),
}, (t) => [
  primaryKey({ columns: [t.viewName, t.field, t.value] }),
]);

export const savedViewSortEntries = sqliteTable('saved_view_sort_entries', {
  viewName:  text('view_name').notNull().references(() => savedViews.name, { onDelete: 'cascade' }),
  column:    text('column').notNull(),
  direction: text('direction').notNull(),   // 'asc', 'desc'
  sortOrder: integer('sort_order').notNull(),
}, (t) => [
  primaryKey({ columns: [t.viewName, t.sortOrder] }),
]);
```

### Sync Queue

```typescript
export const syncQueue = sqliteTable('sync_queue', {
  id:            integer('id').primaryKey({ autoIncrement: true }),
  action:        text('action').notNull(),
  itemId:        text('item_id').notNull(),
  timestamp:     text('timestamp').notNull(),
  commentData:   text('comment_data'),
  templateSlug:  text('template_slug'),
}, (t) => [
  index('idx_queue_item').on(t.itemId, t.action),
]);
```

### Undo Stack (persistent, survives crashes)

```typescript
export const undoStack = sqliteTable('undo_stack', {
  id:        integer('id').primaryKey({ autoIncrement: true }),
  action:    text('action').notNull(),      // 'create', 'update', 'delete'
  itemId:    text('item_id').notNull(),
  createdAt: text('created_at').notNull(),
});

export const undoItemSnapshot = sqliteTable('undo_item_snapshot', {
  undoId:      integer('undo_id').primaryKey().references(() => undoStack.id, { onDelete: 'cascade' }),
  title:       text('title').notNull(),
  type:        text('type').notNull(),
  status:      text('status').notNull(),
  iteration:   text('iteration').notNull(),
  priority:    text('priority').notNull(),
  assignee:    text('assignee').notNull(),
  description: text('description').notNull(),
  parent:      text('parent'),
  created:     text('created').notNull(),
  updated:     text('updated').notNull(),
});

export const undoItemSnapshotLabels = sqliteTable('undo_item_snapshot_labels', {
  undoId: integer('undo_id').notNull().references(() => undoStack.id, { onDelete: 'cascade' }),
  label:  text('label').notNull(),
}, (t) => [
  primaryKey({ columns: [t.undoId, t.label] }),
]);

export const undoItemSnapshotDeps = sqliteTable('undo_item_snapshot_deps', {
  undoId:      integer('undo_id').notNull().references(() => undoStack.id, { onDelete: 'cascade' }),
  dependsOnId: text('depends_on_id').notNull(),
}, (t) => [
  primaryKey({ columns: [t.undoId, t.dependsOnId] }),
]);
```

### File Sync State (for FilesBackend change detection)

```typescript
export const fileSyncState = sqliteTable('file_sync_state', {
  itemId:   text('item_id').primaryKey(),
  hash:     text('hash').notNull(),         // SHA-256 of file content
  syncedAt: text('synced_at').notNull(),
});
```

**Total: 19 tables.** Each is small and focused. Cascade deletes keep them tidy.

## Query Benefits

### Filtering becomes indexed

Today: `listWorkItems()` reads N files, then `applyFilters()` scans all in-memory.

With Drizzle: filters map to indexed `WHERE` clauses. `getChildren(id)` and `getDependents(id)` become indexed lookups via the junction tables instead of full scans.

### Mutations touch only what changed

Today: changing a status rewrites the entire YAML+markdown file, invalidates the all-or-nothing cache, then re-reads all files on next refresh.

With Drizzle: single `UPDATE` statement, no file I/O, no cache invalidation.

### Delete cascades are automatic

Today: `deleteWorkItem()` reads all N items to find and rewrite those referencing the deleted item.

With Drizzle: `onDelete: 'cascade'` handles labels, deps, and comments. Parent references need one indexed update.

### Comments don't rewrite items

Today: adding a comment rewrites the entire item file. With Drizzle: one insert into the `comments` table.

### Aggregations become trivial

`getAssignees()`, `getLabels()` become `SELECT DISTINCT` queries instead of scanning every item.

## Refresh Cycle

### Today

Every mutation triggers `backendDataStore.refresh()`:

```
refresh()
  ├── getStatuses()         → configStore (memory)
  ├── getIterations()       → configStore (memory)
  ├── getWorkItemTypes()    → configStore (memory)
  ├── getAssignees()        → getCachedItems() → N file reads → scan all
  ├── getLabels()           → getCachedItems() → N file reads → scan all
  └── listWorkItems(iter)   → N file reads + N YAML parses
```

Cache was invalidated by the mutation, so every refresh is a full reload.

### New: targeted reload

After a mutation, update SQLite, then re-query just the affected item(s) and merge into the store:

```
User changes status:
  1. UPDATE work_items SET status='closed' WHERE id='42'   (1 query)
  2. INSERT INTO sync_queue ...                              (1 insert)
  3. Re-fetch item '42' + its labels + deps                  (3 queries)
  4. Merge into backendDataStore items[]                     (in-memory)
```

No full refresh needed. The DB is authoritative; the store reflects it. Cascade side effects (e.g., delete nulling parent references on children) are handled by the DB — just re-fetch affected rows.

**Full `refresh()` only needed after sync pulls**, when the remote may have changed many items at once. Even then, all six metadata queries hit indexed SQLite tables instead of N file reads.

## Sync Architecture

### SyncManager becomes backend-agnostic

`SyncManager(primary: Backend, remote: Backend)` — interacts only through the `Backend` interface. No direct file I/O.

### Push flow

```
pushPending():
  For each entry in sync_queue (claimed atomically):
    1. primary.getWorkItem(itemId)
    2. remote.createWorkItem(item) / updateWorkItem() / deleteWorkItem() / addComment()
    3. If remote returns new ID → primary.updateWorkItem(oldId, { id: newId })
    4. DELETE FROM sync_queue WHERE id = entry.id
```

### Pull flow

```
pull():
  1. remote.listWorkItems() → all remote items
  2. primary.listWorkItems() → all local items
  3. Diff:
     - New on remote     → primary.createWorkItem(item)
     - Changed on remote → primary.updateWorkItem(id, changes)
     - Deleted on remote → primary.deleteWorkItem(id)
       (skip if item has pending sync_queue entries)
  4. Sync metadata (statuses, iterations, types) from remote
```

### Conflict resolution

Same strategy as existing remote backends. Items with pending `syncQueue` entries are skipped during pull — the local change takes priority and will be pushed on the next cycle.

### Concurrent sync (TUI + MCP + CLI)

Any process that mutates data can also run sync. Queue entries are claimed atomically:

```typescript
await db.transaction((tx) => {
  const entry = tx.select().from(syncQueue).limit(1).get();
  if (!entry) return null;
  tx.delete(syncQueue).where(eq(syncQueue.id, entry.id));
  return entry;
});
```

SQLite's WAL mode allows concurrent readers. Writes are atomic. Two processes can't claim the same queue entry.

### ID remapping

```typescript
await db.transaction((tx) => {
  tx.update(workItems).set({ id: newId }).where(eq(workItems.id, oldId));
  tx.update(workItems).set({ parent: newId }).where(eq(workItems.parent, oldId));
  tx.update(syncQueue).set({ itemId: newId }).where(eq(syncQueue.itemId, oldId));
});
```

One transaction. No file scanning.

## FilesBackend and Change Detection

### FilesBackend

Wraps existing filesystem I/O (`items.ts`, `frontmatter.ts`, `templates.ts`) as a `Backend` implementation. It's the current `LocalBackend` minus config management, cache, and relationship validation. A dumb read/write layer for markdown files.

### Two-way sync via content hashing

Change detection uses SHA-256 content hashes stored in the `fileSyncState` table.

**Push:** Serialize WorkItem to frontmatter string, write to `.md` file, hash the string, store hash in `fileSyncState`.

**Pull:** Read each `.md` file as a string, hash it, compare to `fileSyncState.hash`. If different, the file was edited externally — parse and update SQLite. If no hash entry exists, it's a new file. If hash entry exists but file is gone, it was deleted externally.

Hashing is checked on explicit sync cycles, not real-time. Consistent with how all other remotes work.

### Serialization stability

The hash must be computed on the exact bytes written to disk. The YAML serializer must produce deterministic output (stable key ordering, consistent whitespace) to avoid false hash mismatches.

## Undo

### Soft delete via column

Soft-delete sets `deletedAt` on the `workItems` row instead of moving a file. Normal queries filter with `WHERE deleted_at IS NULL`. Restore nulls the column. Permanent delete is a real `DELETE`.

### Persistent undo stack

The `undoStack` and snapshot tables survive crashes and restarts. The in-memory `undoStore` Zustand store becomes a thin wrapper around these tables:

- **Push:** Insert into `undoStack` + snapshot tables. If stack exceeds 5, delete oldest.
- **Pop:** Read top entry + snapshot, execute reverse operation, delete entry.
- **Startup:** Read existing stack from DB.
- **Delete undo:** No snapshot needed — item is still in `workItems` with `deletedAt` set. Just null it.
- **Create/update undo:** Snapshot stored in `undoItemSnapshot` + labels/deps tables.

## Unified Backend Factory

Single creation path for all consumers (TUI, CLI, MCP):

```typescript
// src/backends/factory.ts
export async function createRemoteBackend(
  config: ProjectConfig
): Promise<Backend | null> {
  switch (config.backend) {
    case 'none':       return null;
    case 'filesystem': return new FilesBackend(root);
    case 'github':     { const { GitHubBackend } = await import('./github/index.js'); return new GitHubBackend(); }
    case 'gitlab':     { const { GitLabBackend } = await import('./gitlab/index.js'); return new GitLabBackend(); }
    case 'ado':        { const { AzureDevOpsBackend } = await import('./ado/index.js'); return new AzureDevOpsBackend(); }
    case 'jira':       { const { JiraBackend } = await import('./jira/index.js'); return new JiraBackend(); }
  }
}
```

All consumers:

```typescript
const primary = new DrizzleBackend(root);
const remote = await createRemoteBackend(config);
const sync = remote ? new SyncManager(primary, remote) : null;
```

Dynamic imports remain for lazy-loading remote backends, but the logic lives in one place. The duplication between `backendDataStore.createBackendAndSync()` and `factory.ts.createBackendWithSync()` is eliminated.

## MCP Server

The MCP server creates a `DrizzleBackend` + optional `SyncManager` with the same init path as the TUI. SQLite WAL mode allows the TUI and MCP server to share `.tic/tic.db` simultaneously with no coordination. Both can sync — atomic queue claims prevent double-processing.

The shared DB connection is held for the MCP server's lifetime (it's a long-lived stdio process), matching the TUI's lifecycle pattern.

## Migration / Upgrade Path

### First launch detection

1. `.tic/tic.db` exists → already migrated, open normally.
2. `.tic/items/` exists → legacy project, run migration.
3. Neither → fresh project, create empty DB with schema.

### Migration flow (single transaction)

1. Create `.tic/tic.db` with full schema.
2. Parse `.tic/config.yml` → populate `projectConfig`, `statuses`, `workItemTypes`, `iterations`, `jiraConfig`, `savedViews` + filter/sort tables.
3. For each `.tic/items/*.md` → parse frontmatter/body → insert into `workItems`, `workItemLabels`, `workItemDeps`, `comments`. Compute content hash → insert into `fileSyncState`.
4. For each `.tic/templates/*.md` → insert into `templates`, `templateLabels`, `templateDeps`.
5. Parse `.tic/sync-queue.json` (if exists) → insert into `syncQueue`, delete JSON file.
6. For each `.tic/trash/*.md` → parse and insert into `workItems` with `deletedAt` set.
7. Append `tic.db`, `tic.db-wal`, `tic.db-shm` to `.tic/.gitignore`.

Entire migration is one transaction — atomic success or rollback.

### Config mapping

| Old `config.yml` key | New location |
|---|---|
| `backend: local` | `projectConfig.backend = 'filesystem'` |
| `backend: github` | `projectConfig.backend = 'github'` |
| `statuses: [a, b, c]` | `statuses` table (3 rows, sortOrder 0,1,2) |
| `types: [x, y]` | `workItemTypes` table (2 rows) |
| `iterations: [s1, s2]` | `iterations` table (2 rows) |
| `current_iteration` | `projectConfig.currentIteration` |
| `next_id` | `projectConfig.nextId` |
| `branchMode` | `projectConfig.branchMode` |
| `branchCommand` | `projectConfig.branchCommand` |
| `views:` | `savedViews` + `savedViewFilters` + `savedViewSortEntries` |
| `jira:` | `jiraConfig` table |

### Rollback safety

Original `.tic/items/`, `config.yml`, and `templates/` are not deleted during migration. Deleting `tic.db` and downgrading restores the old behavior.

## Dependencies

| Package | Size | Purpose |
|---|---|---|
| `drizzle-orm` | ~7.4 KB (min+gz) | ORM, query builder, schema |
| `better-sqlite3` | ~2 MB (native binary) | SQLite engine |
| `drizzle-kit` | dev only | Migration generation |

`better-sqlite3` is a native addon with prebuilt binaries for macOS, Linux, and Windows. The synchronous API avoids async overhead and simplifies store updates.

`yaml` and frontmatter parsing move to `FilesBackend` — only loaded when filesystem sync is configured (via existing dynamic import pattern).

## Error Handling

- **Transaction boundaries:** Each mutation is a single transaction. Failure rolls back completely — no partial state.
- **Constraint violations:** Translated to existing error types (`UnsupportedOperationError`, `ValidationError`).
- **Corrupt DB:** On startup failure, offer to re-migrate from `.md` files if `FilesBackend` is configured.
- **Migration errors:** Single transaction — succeeds or rolls back, original files untouched.
- **Sync errors:** Same as today — accumulate per entry, leave failed entries in `syncQueue`, surface on status screen.

## Testing Strategy

### DrizzleBackend unit tests

In-memory SQLite database per test — no temp directories, no filesystem cleanup:

```typescript
function createTestDb() {
  const sqlite = new Database(':memory:');
  const db = drizzle(sqlite);
  migrate(db, { migrationsFolder: './drizzle' });
  return { db, sqlite };
}
```

### Backend interface contract tests

Parameterize existing `LocalBackend` tests to run against both `DrizzleBackend` (`:memory:`) and `FilesBackend` (temp directory). Validates both implement the same contract.

### Migration tests

Create temp `.tic/` with known items, run migration, verify SQLite contents. Edge cases: circular deps, items in trash, empty project, malformed `.md` files (skip with warning).

### Content hash sync tests

1. No changes (hashes match) → pull skips
2. External file edit (hash mismatch) → pull updates SQLite
3. New file (no hash entry) → pull imports
4. Deleted file (hash entry, no file) → pull deletes from SQLite
5. Push then immediate pull → no false changes
6. Both sides changed → conflict handled via queue (pending entries skip pull)
7. Serialization round-trip → hash stability

### Store lifecycle

Same `destroy()` in `afterEach` pattern. For `DrizzleBackend`, destroy closes the SQLite connection.

## Suggested Implementation Order

### Phase 1: DrizzleBackend (core)

Create `src/backends/drizzle/` with schema, migrations, and `DrizzleBackend` implementing the full `Backend` + `SoftDeleteBackend` interfaces. Use in-memory SQLite for all tests. No UI changes — this phase is purely backend.

**Deliverables:** Schema definition, DrizzleBackend class, full test suite matching LocalBackend's contract tests.

### Phase 2: Config migration

Replace `configStore` internals to read/write from SQLite instead of `config.yml`. The store's public API (`getState()`, `update()`, selectors) stays identical — components don't change.

**Deliverables:** Config tables populated, configStore backed by DrizzleBackend, existing config tests pass.

### Phase 3: Undo and sync queue

Move `undoStore` to persist in SQLite via the undo tables. Move `SyncQueueStore` to use the `syncQueue` table. Both stores keep their Zustand wrapper API.

**Deliverables:** Persistent undo stack, atomic sync queue, existing undo/sync tests pass.

### Phase 4: backendDataStore integration

Wire `backendDataStore.init()` to create `DrizzleBackend` as primary. Implement targeted reload (Option B) for mutations. `refresh()` queries SQLite instead of reading files.

**Deliverables:** TUI and CLI use DrizzleBackend, full refresh cycle works, all UI tests pass.

### Phase 5: SyncManager refactor

Make `SyncManager` backend-agnostic — only call `Backend` interface methods. Implement atomic queue claim pattern for concurrent sync.

**Deliverables:** SyncManager works with any two Backend instances, concurrent sync tests pass.

### Phase 6: FilesBackend

Extract filesystem I/O from old `LocalBackend` into `FilesBackend` implementing `Backend`. Add content hash change detection and `fileSyncState` table.

**Deliverables:** FilesBackend with two-way sync, hash-based change detection tests pass.

### Phase 7: Unified factory and migration

Create single `createRemoteBackend()` factory. Implement automatic migration from legacy `.tic/` projects. Map `backend: local` to `backend: filesystem`.

**Deliverables:** Existing projects auto-migrate on first launch, factory duplication eliminated.

### Phase 8: Cleanup

Remove old `LocalBackend` (replaced by `DrizzleBackend` + `FilesBackend`). Remove `BackendCache` (no longer needed). Remove `sync-queue.json` handling. Update `configStore` to remove YAML file watching.

**Deliverables:** Dead code removed, all tests pass, build clean.
