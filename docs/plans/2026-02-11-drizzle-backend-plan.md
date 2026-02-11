# Drizzle ORM SQLite Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace the filesystem-based LocalBackend with a DrizzleBackend backed by SQLite (Drizzle ORM + better-sqlite3) as the always-present primary backend, repositioning the filesystem as an optional sync destination.

**Architecture:** DrizzleBackend implements the full Backend + SoftDeleteBackend interfaces against 19 normalized SQLite tables. SyncManager becomes backend-agnostic, operating only through the Backend interface. A new FilesBackend wraps existing filesystem I/O as an optional remote sync destination. All consumers (TUI, CLI, MCP) share a unified factory.

**Tech Stack:** Drizzle ORM, better-sqlite3, drizzle-kit (dev), SQLite WAL mode

**Design Doc:** `docs/plans/2026-02-10-drizzle-backend-design.md`

---

## Phase 1: DrizzleBackend (Core)

### Task 1.1: Install dependencies

**Step 1: Install runtime and dev dependencies**

Run:
```bash
npm install drizzle-orm better-sqlite3
npm install -D drizzle-kit @types/better-sqlite3
```

**Step 2: Create drizzle config file**

Create: `drizzle.config.ts`

```typescript
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/backends/drizzle/schema.ts',
  out: './drizzle',
  dialect: 'sqlite',
});
```

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS (no type errors)

**Step 4: Commit**

```bash
git add package.json package-lock.json drizzle.config.ts
git commit -m "chore: add drizzle-orm and better-sqlite3 dependencies"
```

---

### Task 1.2: Define the SQLite schema

**Files:**
- Create: `src/backends/drizzle/schema.ts`

**Step 1: Write the schema file**

Create `src/backends/drizzle/schema.ts` with all 19 tables exactly as specified in the design doc (`docs/plans/2026-02-10-drizzle-backend-design.md`, "SQLite Schema" section). The tables are:

1. `workItems` — with indexes on status, type, assignee, priority, iteration, parent; includes `deletedAt` column for soft-delete
2. `workItemLabels` — junction table with composite PK (workItemId, label), index on label
3. `workItemDeps` — junction table with composite PK (workItemId, dependsOnId), index on dependsOnId
4. `comments` — autoIncrement PK, FK to workItems with cascade delete, index on workItemId
5. `templates` — slug PK
6. `templateLabels` — junction table with composite PK
7. `templateDeps` — junction table with composite PK
8. `projectConfig` — singleton row (id=1), all config fields as typed columns
9. `statuses` — name PK, sortOrder
10. `workItemTypes` — name PK, sortOrder
11. `iterations` — name PK, sortOrder
12. `jiraConfig` — singleton row (id=1)
13. `savedViews` — name PK
14. `savedViewFilters` — composite PK (viewName, field, value)
15. `savedViewSortEntries` — composite PK (viewName, sortOrder)
16. `syncQueue` — autoIncrement PK, index on (itemId, action)
17. `undoStack` — autoIncrement PK
18. `undoItemSnapshot` — undoId PK (1:1 with undoStack), FK with cascade
19. `undoItemSnapshotLabels` — composite PK (undoId, label), FK with cascade
20. `undoItemSnapshotDeps` — composite PK (undoId, dependsOnId), FK with cascade
21. `fileSyncState` — itemId PK, hash and syncedAt columns

Note: Also export a `* as schema` barrel for use with drizzle's relational query API if needed later.

Reference the exact column definitions from the design doc. Use `text()` for all string fields, `integer()` for numeric/boolean fields, ISO 8601 text for timestamps.

**Step 2: Generate initial migration**

Run:
```bash
npx drizzle-kit generate
```
Expected: Creates migration files in `./drizzle/` directory.

**Step 3: Verify build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/backends/drizzle/schema.ts drizzle/
git commit -m "feat(drizzle): add SQLite schema with 19 normalized tables"
```

---

### Task 1.3: Database initialization helper

**Files:**
- Create: `src/backends/drizzle/db.ts`
- Test: `src/backends/drizzle/db.test.ts`

**Step 1: Write the failing test**

Create `src/backends/drizzle/db.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createDatabase, type TicDatabase } from './db.js';

describe('createDatabase', () => {
  let tmpDir: string;
  let db: TicDatabase;

  afterEach(() => {
    db?.close();
    if (tmpDir) fs.rmSync(tmpDir, { recursive: true });
  });

  it('creates database file in .tic directory', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    expect(fs.existsSync(path.join(tmpDir, '.tic', 'tic.db'))).toBe(true);
  });

  it('creates in-memory database when path is :memory:', () => {
    db = createDatabase(':memory:');
    // Should not throw
    expect(db).toBeDefined();
  });

  it('enables WAL mode for file databases', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    const result = db.run('PRAGMA journal_mode');
    // WAL mode should be set
  });

  it('enables foreign keys', () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-db-test-'));
    db = createDatabase(tmpDir);
    // Verify foreign key constraints are enforced
  });

  it('applies schema (tables exist)', () => {
    db = createDatabase(':memory:');
    // Query sqlite_master for expected tables
    const tables = db.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    );
    const tableNames = tables.map((t) => t.name);
    expect(tableNames).toContain('work_items');
    expect(tableNames).toContain('comments');
    expect(tableNames).toContain('project_config');
    expect(tableNames).toContain('sync_queue');
    expect(tableNames).toContain('undo_stack');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/drizzle/db.test.ts`
Expected: FAIL (module not found)

**Step 3: Write the implementation**

Create `src/backends/drizzle/db.ts`:

```typescript
import Database from 'better-sqlite3';
import { drizzle, type BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import { migrate } from 'drizzle-orm/better-sqlite3/migrator';
import fs from 'node:fs';
import path from 'node:path';
import * as schema from './schema.js';

export type TicDatabase = BetterSQLite3Database<typeof schema> & {
  close(): void;
  /** Access raw better-sqlite3 methods when needed */
  raw: Database.Database;
  all<T>(sql: string): T[];
  run(sql: string): Database.RunResult;
};

export function createDatabase(root: string): TicDatabase {
  const isMemory = root === ':memory:';
  let dbPath: string;

  if (isMemory) {
    dbPath = ':memory:';
  } else {
    const ticDir = path.join(root, '.tic');
    fs.mkdirSync(ticDir, { recursive: true });
    dbPath = path.join(ticDir, 'tic.db');
  }

  const sqlite = new Database(dbPath);

  // Enable WAL mode for concurrent access (TUI + MCP + CLI)
  if (!isMemory) {
    sqlite.pragma('journal_mode = WAL');
  }

  // Enable foreign key constraints
  sqlite.pragma('foreign_keys = ON');

  const db = drizzle(sqlite, { schema });

  // Apply migrations
  migrate(db, { migrationsFolder: path.join(import.meta.dirname, '../../../drizzle') });

  const ticDb = db as unknown as TicDatabase;
  ticDb.close = () => sqlite.close();
  ticDb.raw = sqlite;
  ticDb.all = <T>(sql: string) => sqlite.prepare(sql).all() as T[];
  ticDb.run = (sql: string) => sqlite.prepare(sql).run();

  return ticDb;
}
```

Note: The migration folder path may need adjustment depending on the build output structure. The `import.meta.dirname` approach works in ESM Node.js. If migrations need to be embedded differently (e.g., using `drizzle-kit push` instead of file-based migrations), adjust accordingly. An alternative approach is to use `drizzle-kit push` programmatically or call `db.run()` with the schema DDL directly — pick whichever works cleanly with the build pipeline.

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/drizzle/db.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/drizzle/db.ts src/backends/drizzle/db.test.ts
git commit -m "feat(drizzle): add database initialization helper"
```

---

### Task 1.4: DrizzleBackend — read operations

**Files:**
- Create: `src/backends/drizzle/index.ts`
- Create: `src/backends/drizzle/mappers.ts`
- Test: `src/backends/drizzle/index.test.ts`

This task implements the read side of the Backend interface: `getCapabilities()`, `getStatuses()`, `getIterations()`, `getWorkItemTypes()`, `getAssignees()`, `getLabels()`, `getCurrentIteration()`, `listWorkItems()`, `getWorkItem()`, `getChildren()`, `getDependents()`, `getItemUrl()`.

**Step 1: Write the mapper module**

Create `src/backends/drizzle/mappers.ts` — functions to convert between DB rows (with joined labels/deps/comments) and `WorkItem`/`Template` types from `src/types.ts`. Key functions:

- `rowToWorkItem(row, labels, deps, comments)` — assembles a `WorkItem` from a work_items row plus related rows
- `workItemToRow(item)` — converts a `WorkItem` to an insertable row (without labels/deps/comments, which go in their own tables)
- `rowToTemplate(row, labels, deps)` — assembles a `Template`
- `rowToComment(row)` — assembles a `Comment`

Keep the mapping straightforward:
- `labels` column doesn't exist in DB — it's derived from `workItemLabels` join
- `dependsOn` column doesn't exist in DB — it's derived from `workItemDeps` join
- `comments` array — derived from `comments` table join
- `parent` — `null` in DB means `null` in WorkItem (already matches)
- `priority` — stored as text in DB, maps directly
- All timestamps are ISO 8601 text in both DB and WorkItem

**Step 2: Write failing tests for read operations**

Create `src/backends/drizzle/index.test.ts`. Model the test structure after `src/backends/local/index.test.ts` (671 lines). Use `:memory:` database for all tests:

```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DrizzleBackend } from './index.js';

describe('DrizzleBackend', () => {
  let backend: DrizzleBackend;

  beforeEach(() => {
    backend = DrizzleBackend.create(':memory:');
  });

  afterEach(() => {
    backend.destroy();
  });

  describe('getCapabilities', () => {
    it('reports all capabilities as true', () => {
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
    });
  });

  describe('getStatuses', () => {
    it('returns default statuses', async () => {
      const statuses = await backend.getStatuses();
      expect(statuses).toEqual(['open', 'in-progress', 'closed']);
    });
  });

  describe('getWorkItemTypes', () => {
    it('returns default types', async () => {
      const types = await backend.getWorkItemTypes();
      expect(types).toEqual(['issue', 'task', 'bug']);
    });
  });

  describe('listWorkItems', () => {
    it('returns empty array when no items exist', async () => {
      const items = await backend.listWorkItems();
      expect(items).toEqual([]);
    });

    it('excludes soft-deleted items', async () => {
      const item = await backend.createWorkItem({
        title: 'Test', type: 'issue', status: 'open',
        iteration: '', priority: 'medium', assignee: '',
        labels: [], description: '', parent: null, dependsOn: [],
      });
      await backend.softDeleteWorkItem(item.id);
      const items = await backend.listWorkItems();
      expect(items).toEqual([]);
    });
  });

  // ... more read tests following the same pattern as local/index.test.ts
});
```

Write tests for: `getCapabilities`, `getStatuses`, `getIterations`, `getWorkItemTypes`, `getAssignees` (empty, then after creating items), `getLabels` (same), `getCurrentIteration`, `listWorkItems` (empty, with items, filtered by iteration, excludes soft-deleted), `getWorkItem` (exists, not found), `getChildren`, `getDependents`, `getItemUrl`.

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: FAIL (module not found)

**Step 4: Write the DrizzleBackend class (read operations)**

Create `src/backends/drizzle/index.ts`:

```typescript
import { eq, and, isNull, inArray } from 'drizzle-orm';
import { type Backend, type SoftDeleteBackend, type BackendCapabilities, BaseBackend } from '../types.js';
import { type WorkItem, type NewWorkItem, type Comment, type NewComment, type Template } from '../../types.js';
import { createDatabase, type TicDatabase } from './db.js';
import * as s from './schema.js';
import { rowToWorkItem, rowToComment } from './mappers.js';

export class DrizzleBackend extends BaseBackend implements SoftDeleteBackend {
  private db: TicDatabase;
  private root: string;

  private constructor(db: TicDatabase, root: string) {
    super(0); // no TTL — DB is always fresh
    this.db = db;
    this.root = root;
  }

  static create(root: string): DrizzleBackend {
    const db = createDatabase(root);
    const backend = new DrizzleBackend(db, root);
    backend.seedDefaults();
    return backend;
  }

  destroy(): void {
    this.db.close();
  }

  private seedDefaults(): void {
    // Insert default config, statuses, types if project_config is empty
    // Use INSERT OR IGNORE to avoid overwriting on subsequent opens
  }

  getCapabilities(): BackendCapabilities {
    return {
      relationships: true,
      customTypes: true,
      customStatuses: true,
      iterations: true,
      comments: true,
      templates: true,
      fields: {
        priority: true,
        assignee: true,
        labels: true,
        parent: true,
        dependsOn: true,
      },
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

  async getStatuses(): Promise<string[]> {
    const rows = this.db.select().from(s.statuses).orderBy(s.statuses.sortOrder).all();
    return rows.map((r) => r.name);
  }

  async getIterations(): Promise<string[]> {
    const rows = this.db.select().from(s.iterations).orderBy(s.iterations.sortOrder).all();
    return rows.map((r) => r.name);
  }

  async getWorkItemTypes(): Promise<string[]> {
    const rows = this.db.select().from(s.workItemTypes).orderBy(s.workItemTypes.sortOrder).all();
    return rows.map((r) => r.name);
  }

  async getAssignees(): Promise<string[]> {
    // SELECT DISTINCT assignee FROM work_items WHERE assignee != '' AND deleted_at IS NULL
  }

  async getLabels(): Promise<string[]> {
    // SELECT DISTINCT label FROM work_item_labels
    // JOIN work_items to exclude soft-deleted
  }

  async getCurrentIteration(): Promise<string> {
    const config = this.db.select().from(s.projectConfig).get();
    return config?.currentIteration ?? '';
  }

  async listWorkItems(iteration?: string): Promise<WorkItem[]> {
    // SELECT from work_items WHERE deleted_at IS NULL
    // Optionally filter by iteration
    // For each item, load labels, deps, comments
    // Use rowToWorkItem mapper
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    // SELECT from work_items WHERE id = ? AND deleted_at IS NULL
    // Load labels, deps, comments
    // Throw if not found
  }

  // getChildren and getDependents can override BaseBackend's
  // in-memory versions with indexed queries:
  async getChildren(id: string): Promise<WorkItem[]> {
    // SELECT from work_items WHERE parent = ? AND deleted_at IS NULL
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    // SELECT work_items via JOIN on work_item_deps WHERE depends_on_id = ?
  }

  getItemUrl(id: string): string {
    return `${this.root}/.tic/items/${id}.md`;
  }

  // ... stubs for write operations (next task)
}
```

Note: Since `better-sqlite3` is synchronous, all these queries execute synchronously but are wrapped in `async` methods to satisfy the `Backend` interface. Use Drizzle's `.all()` and `.get()` (synchronous methods from better-sqlite3 driver) rather than `await`.

For `listWorkItems`, there are two implementation strategies:
1. **N+1 approach**: Query all items, then for each item query its labels, deps, comments separately. Simple but O(N) queries.
2. **Batch approach**: Query all items, then batch-query all labels, all deps, all comments, and assemble in-memory. 4 queries total regardless of N.

Use the batch approach — it's 4 queries instead of 3N+1.

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: PASS for read operation tests

**Step 6: Commit**

```bash
git add src/backends/drizzle/index.ts src/backends/drizzle/mappers.ts src/backends/drizzle/index.test.ts
git commit -m "feat(drizzle): implement DrizzleBackend read operations"
```

---

### Task 1.5: DrizzleBackend — write operations (CRUD)

**Files:**
- Modify: `src/backends/drizzle/index.ts`
- Modify: `src/backends/drizzle/index.test.ts`

This task implements: `createWorkItem()`, `updateWorkItem()`, `deleteWorkItem()`, `addComment()`, `setCurrentIteration()`.

**Step 1: Write failing tests for write operations**

Add to `src/backends/drizzle/index.test.ts`:

```typescript
describe('createWorkItem', () => {
  it('creates item and assigns auto-increment ID', async () => {
    const item = await backend.createWorkItem({
      title: 'Test item', type: 'issue', status: 'open',
      iteration: '', priority: 'medium', assignee: 'alice',
      labels: ['bug', 'ux'], description: 'Description',
      parent: null, dependsOn: [],
    });
    expect(item.id).toBe('1');
    expect(item.title).toBe('Test item');
    expect(item.labels).toEqual(['bug', 'ux']);
    expect(item.assignee).toBe('alice');
  });

  it('auto-increments IDs', async () => {
    const item1 = await backend.createWorkItem({ /* ... */ });
    const item2 = await backend.createWorkItem({ /* ... */ });
    expect(item1.id).toBe('1');
    expect(item2.id).toBe('2');
  });

  it('stores labels in junction table', async () => {
    const item = await backend.createWorkItem({
      /* ... labels: ['a', 'b'] */
    });
    const fetched = await backend.getWorkItem(item.id);
    expect(fetched.labels).toEqual(['a', 'b']);
  });

  it('stores dependencies in junction table', async () => {
    const item1 = await backend.createWorkItem({ /* ... */ });
    const item2 = await backend.createWorkItem({
      /* ... dependsOn: [item1.id] */
    });
    const fetched = await backend.getWorkItem(item2.id);
    expect(fetched.dependsOn).toEqual([item1.id]);
  });

  it('rejects self-referencing parent', async () => {
    // Create item, then try to update with parent = own id
  });

  it('rejects circular parent chain', async () => {
    // Create A with parent B, then try to set B's parent to A
  });

  it('rejects non-existent parent', async () => {
    // Create item with parent = 'nonexistent'
  });

  it('rejects non-existent dependency', async () => {
    // Create item with dependsOn = ['nonexistent']
  });
});

describe('updateWorkItem', () => {
  it('updates individual fields', async () => { /* ... */ });
  it('replaces labels', async () => { /* ... */ });
  it('replaces dependencies', async () => { /* ... */ });
  it('validates relationships on update', async () => { /* ... */ });
});

describe('deleteWorkItem', () => {
  it('removes item and cleans up references', async () => {
    // Create parent + child, delete parent, verify child.parent is null
  });
  it('cascade deletes labels and deps', async () => { /* ... */ });
  it('cascade deletes comments', async () => { /* ... */ });
});

describe('addComment', () => {
  it('adds comment to existing item', async () => { /* ... */ });
  it('does not rewrite the item', async () => {
    // Verify item.updated is unchanged after adding a comment
  });
});

describe('setCurrentIteration', () => {
  it('updates project config', async () => { /* ... */ });
  it('adds iteration to list if new', async () => { /* ... */ });
});
```

Mirror the test cases from `src/backends/local/index.test.ts` — the contract should be identical.

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: FAIL (methods not implemented)

**Step 3: Implement write operations**

In `src/backends/drizzle/index.ts`, implement each method using transactions:

`createWorkItem(data)`:
1. Read + increment `nextId` from `projectConfig`
2. Validate relationships (parent exists, no circular refs, deps exist)
3. In a transaction: insert into `workItems`, insert rows into `workItemLabels`, insert rows into `workItemDeps`, update `projectConfig.nextId`
4. Return the created `WorkItem` by calling `getWorkItem(id)`

`updateWorkItem(id, data)`:
1. Read existing item (throw if not found)
2. Validate relationships if parent/dependsOn changed
3. In a transaction: update `workItems` row, delete+re-insert `workItemLabels` if labels changed, delete+re-insert `workItemDeps` if dependsOn changed
4. Return updated item

`deleteWorkItem(id)`:
1. In a transaction: null out `parent` on children (`UPDATE work_items SET parent = NULL WHERE parent = ?`), delete the item (cascade handles labels, deps, comments)

`addComment(workItemId, comment)`:
1. Verify item exists (throw if not)
2. Insert into `comments` table
3. Return the created `Comment`

`setCurrentIteration(name)`:
1. Update `projectConfig.currentIteration`
2. Insert iteration into `iterations` table if not exists (INSERT OR IGNORE)

For relationship validation, implement a `validateRelationships(id, parent, dependsOn)` private method similar to `LocalBackend.validateRelationships()` (lines 142-203 of `src/backends/local/index.ts`), but using DB queries instead of in-memory scans:
- Self-reference: `parent === id` or `dependsOn.includes(id)` → reject
- Parent exists: `SELECT id FROM work_items WHERE id = ? AND deleted_at IS NULL`
- Circular parent: Walk up the parent chain via repeated queries (max depth ~50)
- Deps exist: `SELECT id FROM work_items WHERE id IN (...) AND deleted_at IS NULL`, compare count
- Circular deps: Similar walk

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/drizzle/index.ts src/backends/drizzle/index.test.ts
git commit -m "feat(drizzle): implement DrizzleBackend write operations"
```

---

### Task 1.6: DrizzleBackend — soft delete and undo support

**Files:**
- Modify: `src/backends/drizzle/index.ts`
- Modify: `src/backends/drizzle/index.test.ts`

Implement the `SoftDeleteBackend` interface: `softDeleteWorkItem()`, `restoreWorkItem()`, `permanentlyDeleteWorkItem()`, `cleanupTrash()`.

**Step 1: Write failing tests**

Add to `src/backends/drizzle/index.test.ts`:

```typescript
describe('SoftDeleteBackend', () => {
  it('soft-deletes by setting deletedAt', async () => {
    const item = await backend.createWorkItem({ /* ... */ });
    await backend.softDeleteWorkItem(item.id);
    // Item should not appear in listWorkItems
    const items = await backend.listWorkItems();
    expect(items).toEqual([]);
    // But should still be retrievable if we query directly
  });

  it('restores soft-deleted item', async () => {
    const item = await backend.createWorkItem({ /* ... */ });
    await backend.softDeleteWorkItem(item.id);
    await backend.restoreWorkItem(item.id);
    const items = await backend.listWorkItems();
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe(item.id);
  });

  it('permanently deletes from trash', async () => {
    const item = await backend.createWorkItem({ /* ... */ });
    await backend.softDeleteWorkItem(item.id);
    await backend.permanentlyDeleteWorkItem(item.id);
    // Item should be gone entirely
  });

  it('cleanup removes all soft-deleted items', async () => {
    const item1 = await backend.createWorkItem({ /* ... */ });
    const item2 = await backend.createWorkItem({ /* ... */ });
    await backend.softDeleteWorkItem(item1.id);
    await backend.softDeleteWorkItem(item2.id);
    await backend.cleanupTrash();
    // Both should be permanently gone
  });

  it('isSoftDeleteBackend returns true', () => {
    expect(isSoftDeleteBackend(backend)).toBe(true);
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: FAIL

**Step 3: Implement soft delete**

```typescript
async softDeleteWorkItem(id: string): Promise<void> {
  this.db.update(s.workItems)
    .set({ deletedAt: new Date().toISOString() })
    .where(eq(s.workItems.id, id))
    .run();
}

async restoreWorkItem(id: string): Promise<void> {
  this.db.update(s.workItems)
    .set({ deletedAt: null })
    .where(eq(s.workItems.id, id))
    .run();
}

async permanentlyDeleteWorkItem(id: string): Promise<void> {
  this.db.delete(s.workItems).where(eq(s.workItems.id, id)).run();
}

async cleanupTrash(): Promise<void> {
  this.db.delete(s.workItems).where(isNotNull(s.workItems.deletedAt)).run();
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/drizzle/index.ts src/backends/drizzle/index.test.ts
git commit -m "feat(drizzle): implement SoftDeleteBackend interface"
```

---

### Task 1.7: DrizzleBackend — template operations

**Files:**
- Modify: `src/backends/drizzle/index.ts`
- Modify: `src/backends/drizzle/index.test.ts`

Implement: `listTemplates()`, `getTemplate()`, `createTemplate()`, `updateTemplate()`, `deleteTemplate()`.

**Step 1: Write failing tests**

Add tests mirroring `src/backends/local/templates.test.ts` patterns:

```typescript
describe('templates', () => {
  it('lists templates (empty)', async () => { /* ... */ });
  it('creates and retrieves template', async () => { /* ... */ });
  it('creates template with labels and deps', async () => { /* ... */ });
  it('updates template', async () => { /* ... */ });
  it('updates template slug (rename)', async () => { /* ... */ });
  it('deletes template', async () => { /* ... */ });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: FAIL

**Step 3: Implement template operations**

Each method operates on the `templates`, `templateLabels`, and `templateDeps` tables. `updateTemplate(oldSlug, template)` must handle slug changes (delete old + insert new, within a transaction). `deleteTemplate` uses cascade delete.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/drizzle/index.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/drizzle/index.ts src/backends/drizzle/index.test.ts
git commit -m "feat(drizzle): implement template CRUD operations"
```

---

### Task 1.8: DrizzleBackend — temp ID support and openItem

**Files:**
- Modify: `src/backends/drizzle/index.ts`
- Modify: `src/backends/drizzle/index.test.ts`

Implement `tempIds` option (for sync — local items get `local-` prefixed IDs when a remote is configured) and `openItem()`.

**Step 1: Write failing tests**

```typescript
describe('temp IDs', () => {
  it('prefixes IDs with local- when tempIds is true', async () => {
    const backend = DrizzleBackend.create(':memory:', { tempIds: true });
    const item = await backend.createWorkItem({ /* ... */ });
    expect(item.id).toMatch(/^local-/);
    backend.destroy();
  });
});

describe('openItem', () => {
  it('opens item URL', async () => {
    // This is hard to test without mocking — just verify it doesn't throw
    // and that getItemUrl returns a reasonable path
  });
});
```

**Step 2-4: Implement and verify**

For `tempIds`, add an options parameter to `DrizzleBackend.create()` matching `LocalBackendOptions`. When `tempIds` is true, ID generation becomes `local-${nextId}` instead of `${nextId}`.

For `openItem`, use `child_process.execSync('open <url>')` on macOS or delegate to `$EDITOR` — match existing `LocalBackend.openItem()` behavior (lines 318-330 of `src/backends/local/index.ts`).

**Step 5: Commit**

```bash
git add src/backends/drizzle/index.ts src/backends/drizzle/index.test.ts
git commit -m "feat(drizzle): add temp ID support and openItem"
```

---

### Task 1.9: Run full test suite and verify no regressions

**Step 1: Run all tests**

Run: `npm test`
Expected: All existing tests PASS. New DrizzleBackend tests PASS.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run lint and format check**

Run: `npm run lint && npm run format:check`
Expected: PASS (run `npm run format` first if needed)

**Step 4: Commit any fixes**

If formatting or lint fixes were needed:
```bash
git add -A
git commit -m "chore: fix lint and formatting"
```

---

## Phase 2: Config Migration

### Task 2.1: DrizzleBackend — config read/write methods

**Files:**
- Modify: `src/backends/drizzle/index.ts`
- Create: `src/backends/drizzle/config.ts`
- Test: `src/backends/drizzle/config.test.ts`

The DrizzleBackend needs methods to read and write the full `Config` object (from `src/backends/local/config.ts` lines 6-36) so that `configStore` can be backed by SQLite.

**Step 1: Write failing tests**

Create `src/backends/drizzle/config.test.ts`:

```typescript
describe('DrizzleBackend config', () => {
  it('reads default config from fresh database', () => {
    // Should return defaults matching defaultConfig from local/config.ts
  });

  it('updates individual config fields', () => {
    // Update branchMode, verify it persists
  });

  it('reads and writes statuses with sort order', () => {
    // Set statuses ['open', 'closed', 'wontfix']
    // Read back, verify order preserved
  });

  it('reads and writes saved views with filters and sort', () => {
    // Create a saved view with filters and sort entries
    // Read back, verify structure matches
  });

  it('reads and writes jira config', () => { /* ... */ });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/drizzle/config.test.ts`
Expected: FAIL

**Step 3: Implement config module**

Create `src/backends/drizzle/config.ts` with functions:

- `readConfig(db: TicDatabase): Config` — reads from `projectConfig`, `statuses`, `workItemTypes`, `iterations`, `jiraConfig`, `savedViews`+filters+sort tables. Assembles into a `Config` object matching the interface in `src/backends/local/config.ts`.
- `writeConfig(db: TicDatabase, config: Config): void` — writes all config tables in a transaction. For array fields (statuses, types, iterations), deletes existing rows and re-inserts with sort order. For saved views, does the same with filters and sort entries.
- `updateConfig(db: TicDatabase, partial: Partial<Config>): void` — reads, merges, writes.

The `Config` interface itself doesn't change — it's reused as-is.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/drizzle/config.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/drizzle/config.ts src/backends/drizzle/config.test.ts
git commit -m "feat(drizzle): add config read/write backed by SQLite tables"
```

---

### Task 2.2: configStore — support SQLite backing

**Files:**
- Modify: `src/stores/configStore.ts`
- Test: `src/stores/configStore.test.ts` (modify existing)

The `configStore` currently reads/writes `config.yml` via `readConfig`/`writeConfig` from `src/backends/local/config.ts`. It needs to support both backends:
- When a `DrizzleBackend` is available, read/write config through it.
- Fall back to YAML for backward compatibility (CLI short-lived processes that haven't migrated yet).

**Step 1: Add a `setDatabase` method to configStore**

Modify `src/stores/configStore.ts` to accept an optional `TicDatabase` reference:

```typescript
// Add to ConfigStoreState interface:
setDatabase(db: TicDatabase | null): void;
```

When a database is set:
- `init(root)` reads config from SQLite via `readConfig(db)` instead of the YAML file
- `update(partial)` writes to SQLite via `updateConfig(db, partial)` instead of the YAML file
- `startWatching()` becomes a no-op (no file to watch — the DB is the source of truth)

When no database is set (CLI backward compat):
- Existing YAML behavior unchanged

**Step 2: Write tests for the new path**

Add test cases to `src/stores/configStore.test.ts`:

```typescript
describe('configStore with SQLite backing', () => {
  it('reads config from database when setDatabase is called', async () => { /* ... */ });
  it('writes config to database on update', async () => { /* ... */ });
  it('startWatching is no-op with database', () => { /* ... */ });
});
```

**Step 3: Run tests**

Run: `npx vitest run src/stores/configStore.test.ts`
Expected: PASS (both old YAML tests and new SQLite tests)

**Step 4: Commit**

```bash
git add src/stores/configStore.ts src/stores/configStore.test.ts
git commit -m "feat(config): support SQLite backing in configStore"
```

---

## Phase 3: Undo and Sync Queue

### Task 3.1: Persistent undo stack

**Files:**
- Create: `src/backends/drizzle/undo.ts`
- Test: `src/backends/drizzle/undo.test.ts`

Create functions for reading/writing the undo stack from/to SQLite:

- `pushUndoEntry(db, entry: UndoEntry): UndoEntry | null` — insert into `undoStack` + `undoItemSnapshot` + labels/deps. If stack exceeds MAX_DEPTH(5), delete oldest, return evicted entry.
- `popUndoEntry(db): UndoEntry | null` — read + delete top entry (highest id) with snapshot.
- `readUndoStack(db): UndoEntry[]` — read all entries, ordered by id desc.
- `clearUndoStack(db): UndoEntry[]` — delete all, return what was there.

**Step 1: Write failing tests**

```typescript
describe('undo persistence', () => {
  it('push and pop round-trip', () => { /* ... */ });
  it('respects max depth of 5', () => { /* ... */ });
  it('pop returns null when empty', () => { /* ... */ });
  it('clear returns previous stack', () => { /* ... */ });
  it('stores and restores item snapshot with labels and deps', () => { /* ... */ });
  it('delete undo entry has no snapshot (item in trash)', () => { /* ... */ });
  it('survives database close and reopen', () => {
    // Push entry, close DB, reopen, verify entry persists
  });
});
```

**Step 2-4: Implement and verify**

**Step 5: Commit**

```bash
git add src/backends/drizzle/undo.ts src/backends/drizzle/undo.test.ts
git commit -m "feat(drizzle): add persistent undo stack in SQLite"
```

---

### Task 3.2: Modify undoStore to use SQLite

**Files:**
- Modify: `src/stores/undoStore.ts`
- Modify: existing undo tests

The `undoStore` Zustand store becomes a thin wrapper:
- `pushUndo(entry)` → calls `pushUndoEntry(db, entry)`, updates in-memory `stack`
- `popUndo()` → calls `popUndoEntry(db)`, updates in-memory `stack`
- `clear()` → calls `clearUndoStack(db)`, clears in-memory `stack`

Add a `setDatabase(db)` method, similar to configStore. When no DB is set, fall back to in-memory-only behavior (backward compat).

On init, read existing stack from DB into memory: `stack = readUndoStack(db)`.

**Step 1: Write tests**

Verify existing undo behavior is preserved. Add test for crash resilience:

```typescript
it('recovers undo stack after simulated crash', () => {
  // Push entries with DB set
  // Create new undoStore pointing at same DB
  // Verify stack is restored
});
```

**Step 2-4: Implement and verify**

Run: `npx vitest run src/stores/undoStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/undoStore.ts
git commit -m "feat(undo): persist undo stack to SQLite"
```

---

### Task 3.3: Sync queue in SQLite

**Files:**
- Create: `src/backends/drizzle/syncQueue.ts`
- Test: `src/backends/drizzle/syncQueue.test.ts`

Create a `DrizzleSyncQueue` class implementing the same API as `SyncQueueStore` (from `src/sync/queue.ts`) but backed by the `syncQueue` table:

- `read(): QueueEntry[]` — SELECT all, ordered by id
- `append(entry: QueueEntry): void` — INSERT, deduplicating by (itemId, action) — delete existing first
- `remove(itemId, action): void` — DELETE WHERE
- `removeByIds(itemIds, action): void` — DELETE WHERE IN
- `clear(): void` — DELETE all
- `renameItem(oldId, newId): void` — UPDATE itemId
- `claimNext(): QueueEntry | null` — atomic SELECT + DELETE in transaction (for concurrent sync)

**Step 1: Write failing tests**

Mirror the tests in `src/sync/queue.test.ts` (if it exists) or write new ones:

```typescript
describe('DrizzleSyncQueue', () => {
  it('append and read round-trip', () => { /* ... */ });
  it('deduplicates by itemId and action', () => { /* ... */ });
  it('remove deletes matching entry', () => { /* ... */ });
  it('removeByIds batch deletes', () => { /* ... */ });
  it('renameItem updates itemId', () => { /* ... */ });
  it('claimNext atomically removes entry', () => { /* ... */ });
  it('claimNext returns null when empty', () => { /* ... */ });
  it('clear removes all entries', () => { /* ... */ });
});
```

**Step 2-4: Implement and verify**

**Step 5: Commit**

```bash
git add src/backends/drizzle/syncQueue.ts src/backends/drizzle/syncQueue.test.ts
git commit -m "feat(drizzle): add sync queue backed by SQLite"
```

---

### Task 3.4: Run full test suite

**Step 1:** Run: `npm test`
Expected: All tests PASS.

**Step 2:** Run: `npm run build && npm run lint && npm run format:check`
Expected: PASS

**Step 3: Commit any fixes**

---

## Phase 4: backendDataStore Integration

### Task 4.1: Wire DrizzleBackend into backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`
- Modify: `src/backends/factory.ts`

Replace the `createBackendAndSync` function to use `DrizzleBackend` as primary:

```typescript
async function createBackendAndSync(cwd: string) {
  const { DrizzleBackend } = await import('../backends/drizzle/index.js');
  const primary = DrizzleBackend.create(cwd);

  // Set up configStore with SQLite backing
  configStore.getState().setDatabase(primary.getDatabase());

  const config = configStore.getState().config;
  const remote = await createRemoteBackend(cwd, config);

  let syncManager: SyncManager | null = null;
  if (remote) {
    const { SyncManager } = await import('../sync/SyncManager.js');
    const { DrizzleSyncQueue } = await import('../backends/drizzle/syncQueue.js');
    const queue = new DrizzleSyncQueue(primary.getDatabase());
    syncManager = new SyncManager(primary, remote, queue);
  }

  return { backend: primary, syncManager };
}
```

Also create the unified `createRemoteBackend` function in `src/backends/factory.ts`:

```typescript
export async function createRemoteBackend(
  root: string,
  config: Config,
): Promise<Backend | null> {
  const backendType = config.backend;
  switch (backendType) {
    case 'none':
      return null;
    case 'filesystem': {
      const { FilesBackend } = await import('./files/index.js');
      return new FilesBackend(root);
    }
    case 'github': {
      const { GitHubBackend } = await import('./github/index.js');
      return GitHubBackend.create(root);
    }
    // ... gitlab, ado, jira
    default:
      return null;
  }
}
```

Note: `FilesBackend` doesn't exist yet (Phase 6), so the `filesystem` case can throw a "not yet implemented" error for now.

For `factory.ts`'s `createBackendWithSync()` (used by CLI/MCP), apply the same changes with static imports.

**Step 1: Implement the changes**

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS — existing behavior preserved since the store interface hasn't changed.

**Step 3: Commit**

```bash
git add src/stores/backendDataStore.ts src/backends/factory.ts
git commit -m "feat(store): wire DrizzleBackend into backendDataStore and factory"
```

---

### Task 4.2: Targeted reload after mutations

**Files:**
- Modify: `src/stores/backendDataStore.ts`

Add a `reloadItem(id: string)` method to `BackendDataStoreState` that:
1. Calls `backend.getWorkItem(id)` to get fresh data
2. Finds the item in the store's `items` array and replaces it (or adds if new)
3. Optionally refreshes `assignees` and `labels` if the mutation affected those

Add a `removeItem(id: string)` method for post-delete:
1. Filters the item out of the store's `items` array

Components that currently call `refresh()` after every mutation can be migrated to call `reloadItem(id)` or `removeItem(id)` instead. Keep `refresh()` available for full reloads (e.g., after sync pull).

**Step 1: Add methods to the store interface**

```typescript
// Add to BackendDataStoreState:
reloadItem(id: string): Promise<void>;
removeItem(id: string): void;
```

**Step 2: Implement**

```typescript
reloadItem: async (id: string) => {
  const backend = currentBackend;
  if (!backend) return;
  try {
    const item = await backend.getWorkItem(id);
    set((state) => ({
      items: state.items.map((i) => (i.id === id ? item : i)),
    }));
  } catch {
    // Item may have been deleted — remove it
    set((state) => ({
      items: state.items.filter((i) => i.id !== id),
    }));
  }
  // Refresh derived data
  const [assignees, labels] = await Promise.all([
    backend.getAssignees(),
    backend.getLabels(),
  ]);
  set({ assignees, labels });
},

removeItem: (id: string) => {
  set((state) => ({
    items: state.items.filter((i) => i.id !== id),
  }));
},
```

**Step 3: Test**

Add tests to `src/stores/backendDataStore.test.ts` (if it exists, otherwise note that integration testing via the full TUI test suite covers this).

**Step 4: Commit**

```bash
git add src/stores/backendDataStore.ts
git commit -m "feat(store): add targeted reloadItem and removeItem methods"
```

---

### Task 4.3: Migrate mutation call sites to targeted reload

**Files:**
- Modify: `src/components/WorkItemList.tsx` — find all places that call `refresh()` after status/priority/assignee/label changes via overlay, and replace with `reloadItem(id)`
- Modify: `src/components/WorkItemForm.tsx` — after save, use `reloadItem` instead of full `refresh`

This is a search-and-replace task. Use `Grep` to find all `refresh()` calls in components:

```
grep -n "refresh()" src/components/*.tsx
```

For each call site, determine if a targeted reload suffices or if a full refresh is needed:
- Single item mutation (status, priority, label, assignee change) → `reloadItem(id)`
- Delete → `removeItem(id)`
- Create → `refresh()` (need full list to include the new item — or add the returned item to the store directly)
- Sync pull → `refresh()` (many items may have changed)

**Step 1: Implement changes**

**Step 2: Manual testing**

Run the TUI: `npm start`
- Change an item's status → verify list updates without flicker
- Delete an item → verify it disappears
- Create an item → verify it appears

**Step 3: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/WorkItemForm.tsx
git commit -m "refactor: use targeted reload instead of full refresh for mutations"
```

---

## Phase 5: SyncManager Refactor

### Task 5.1: Remove direct file I/O from SyncManager

**Files:**
- Modify: `src/sync/SyncManager.ts`

The SyncManager currently imports from `src/backends/local/items.js` (lines 15-16) and `src/backends/local/templates.js` (lines 18-20) and calls `writeWorkItem`, `deleteWorkItem` (renamed as `removeWorkItemFile`), `writeTemplate`, `deleteTemplate` (renamed as `removeTemplateFile`) directly.

Replace all these with `Backend` interface calls:

**Lines to change in `SyncManager.ts`:**

1. Remove imports of `writeWorkItem`, `deleteWorkItem` from `../backends/local/items.js` (lines 15-16)
2. Remove imports of `writeTemplate`, `deleteTemplate` from `../backends/local/templates.js` (lines 18-20)
3. Change constructor signature: `local: LocalBackend` → `primary: Backend` (line 32)
4. In `pushEntry()` create case (lines 168-190): replace `this.local.getWorkItem(id)` with `this.primary.getWorkItem(id)` — this already uses the Backend interface
5. In `renameLocalItem()` (lines 265-286): replace direct file I/O with:
   ```typescript
   // Instead of writeWorkItem + removeWorkItemFile:
   await this.primary.updateWorkItem(oldId, { ...item, id: newId });
   // Note: this requires the Backend to support ID changes via update,
   // or a dedicated method. If not, do it via delete + create in a transaction.
   ```
6. In `pull()` (lines 305-370):
   - Replace `writeWorkItem(this.local.getRoot(), item)` with `this.primary.createWorkItem(item)` or `this.primary.updateWorkItem(id, item)` depending on whether the item exists locally
   - Replace `removeWorkItemFile(root, id)` with `this.primary.deleteWorkItem(id)`
   - Replace template file I/O similarly
7. Change the `queue` parameter from `SyncQueueStore` to accept either `SyncQueueStore` or `DrizzleSyncQueue` — extract an interface that both implement

**Step 1: Define a SyncQueue interface**

Create or update `src/sync/types.ts` to add:

```typescript
export interface SyncQueue {
  read(): QueueEntry[] | Promise<QueueEntry[]>;
  append(entry: QueueEntry): void | Promise<void>;
  remove(itemId: string, action: QueueAction): void | Promise<void>;
  removeByIds(itemIds: string[], action: QueueAction): void | Promise<void>;
  clear(): void | Promise<void>;
  renameItem(oldId: string, newId: string): void | Promise<void>;
}
```

Make both `SyncQueueStore` and `DrizzleSyncQueue` implement this interface.

**Step 2: Refactor SyncManager constructor**

```typescript
constructor(
  private primary: Backend,
  private remote: Backend,
  private queue: SyncQueue,
)
```

**Step 3: Replace all direct file I/O calls**

Walk through each method and replace file operations with Backend interface calls.

For `pull()`, the logic becomes:
```typescript
const remoteItems = await this.remote.listWorkItems();
const localItems = await this.primary.listWorkItems();
const localMap = new Map(localItems.map(i => [i.id, i]));
const pendingEntries = await this.queue.read();
const pendingIds = new Set(pendingEntries.map(e => e.itemId));

for (const remoteItem of remoteItems) {
  if (localMap.has(remoteItem.id)) {
    await this.primary.updateWorkItem(remoteItem.id, remoteItem);
  } else {
    await this.primary.createWorkItem(remoteItem);
  }
  localMap.delete(remoteItem.id);
}

// Items in local but not in remote — delete if not pending
for (const [id] of localMap) {
  if (!pendingIds.has(id)) {
    await this.primary.deleteWorkItem(id);
  }
}
```

**Step 4: Run tests**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: PASS — tests use mock backends, so they should work without modification.

If tests reference `LocalBackend` directly, update them to use the `Backend` interface type.

**Step 5: Commit**

```bash
git add src/sync/SyncManager.ts src/sync/types.ts src/sync/queue.ts
git commit -m "refactor(sync): make SyncManager backend-agnostic"
```

---

### Task 5.2: Atomic queue claim for concurrent sync

**Files:**
- Modify: `src/sync/SyncManager.ts`
- Modify: `src/sync/types.ts`

Add `claimNext()` to the `SyncQueue` interface. Update `pushPending()` to use `claimNext()` instead of iterating the full queue:

```typescript
async pushPending(): Promise<PushResult> {
  const result: PushResult = { pushed: 0, failed: 0, errors: [], idMappings: new Map() };

  while (true) {
    const entry = await this.queue.claimNext();
    if (!entry) break;

    try {
      await this.pushEntry(entry);
      result.pushed++;
    } catch (error) {
      result.failed++;
      result.errors.push({ entry, message: String(error), timestamp: new Date().toISOString() });
      // Re-queue failed entry
      await this.queue.append(entry);
    }
  }

  return result;
}
```

For `SyncQueueStore` (file-based), `claimNext()` can be implemented as read-first-remove-first (single process, no real concurrency concern). For `DrizzleSyncQueue`, it's the atomic SELECT+DELETE in a transaction.

**Step 1: Implement**

**Step 2: Test**

Add test for concurrent claim behavior:
```typescript
it('claimNext returns each entry exactly once', async () => {
  queue.append(entry1);
  queue.append(entry2);
  const claimed1 = await queue.claimNext();
  const claimed2 = await queue.claimNext();
  const claimed3 = await queue.claimNext();
  expect(claimed1).toBeTruthy();
  expect(claimed2).toBeTruthy();
  expect(claimed3).toBeNull();
});
```

**Step 3: Commit**

```bash
git add src/sync/SyncManager.ts src/sync/types.ts src/backends/drizzle/syncQueue.ts src/sync/queue.ts
git commit -m "feat(sync): add atomic queue claim for concurrent sync"
```

---

## Phase 6: FilesBackend

### Task 6.1: Extract FilesBackend from LocalBackend

**Files:**
- Create: `src/backends/files/index.ts`
- Create: `src/backends/files/hash.ts`
- Test: `src/backends/files/index.test.ts`
- Test: `src/backends/files/hash.test.ts`

The `FilesBackend` wraps the existing filesystem I/O modules — reuse `src/backends/local/items.ts`, `src/backends/local/frontmatter.ts`, and `src/backends/local/templates.ts` directly (import them, don't copy them). `FilesBackend` implements the `Backend` interface but is much simpler than `LocalBackend`:

- No cache (it's a remote — caching is the primary's job)
- No relationship validation (that's the primary's job)
- No config management (config lives in SQLite)
- No `next_id` management (IDs come from the primary)
- No `SoftDeleteBackend` (soft-delete is a DrizzleBackend concept)

```typescript
export class FilesBackend implements Backend {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  getCapabilities(): BackendCapabilities {
    // Full capabilities since local files can store everything
    return { /* all true */ };
  }

  async listWorkItems(): Promise<WorkItem[]> {
    // Delegate to listItemFiles + readWorkItem from local/items.ts
  }

  async getWorkItem(id: string): Promise<WorkItem> {
    // Delegate to readWorkItem from local/items.ts
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    // Delegate to writeWorkItem from local/items.ts
    // Note: the item should already have an ID assigned by the primary
  }

  async updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem> {
    // Read, merge, write via local/items.ts
  }

  async deleteWorkItem(id: string): Promise<void> {
    // Delegate to deleteWorkItem from local/items.ts
  }

  // Metadata methods return empty arrays — metadata lives in SQLite
  async getStatuses(): Promise<string[]> { return []; }
  async getIterations(): Promise<string[]> { return []; }
  async getWorkItemTypes(): Promise<string[]> { return []; }
  async getAssignees(): Promise<string[]> { return []; }
  async getLabels(): Promise<string[]> { return []; }

  // Templates delegate to local/templates.ts
  async listTemplates(): Promise<Template[]> { /* ... */ }
  // ... etc
}
```

**Step 1: Create hash module**

Create `src/backends/files/hash.ts`:

```typescript
import { createHash } from 'node:crypto';

export function contentHash(content: string): string {
  return createHash('sha256').update(content).digest('hex');
}
```

Test in `src/backends/files/hash.test.ts`:
```typescript
it('produces deterministic hash', () => {
  const hash1 = contentHash('hello');
  const hash2 = contentHash('hello');
  expect(hash1).toBe(hash2);
});

it('produces different hashes for different content', () => {
  expect(contentHash('a')).not.toBe(contentHash('b'));
});
```

**Step 2: Write failing tests for FilesBackend**

Use the same patterns as `src/backends/local/index.test.ts` but without relationship validation or config tests:

```typescript
describe('FilesBackend', () => {
  let tmpDir: string;
  let backend: FilesBackend;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tic-files-test-'));
    fs.mkdirSync(path.join(tmpDir, '.tic', 'items'), { recursive: true });
    backend = new FilesBackend(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true });
  });

  it('lists empty items directory', async () => { /* ... */ });
  it('creates and reads back a work item', async () => { /* ... */ });
  it('updates a work item', async () => { /* ... */ });
  it('deletes a work item', async () => { /* ... */ });
  it('handles templates', async () => { /* ... */ });
});
```

**Step 3-4: Implement and verify**

**Step 5: Commit**

```bash
git add src/backends/files/ src/backends/files/hash.ts src/backends/files/hash.test.ts src/backends/files/index.ts src/backends/files/index.test.ts
git commit -m "feat(files): add FilesBackend as sync destination"
```

---

### Task 6.2: Content hash sync detection

**Files:**
- Create: `src/backends/files/sync.ts`
- Test: `src/backends/files/sync.test.ts`

Implement the `fileSyncState` tracking logic. Functions:

- `computeFileHashes(root): Map<string, string>` — read all `.tic/items/*.md`, hash each, return map of `id → hash`
- `detectChanges(db, root): { changed: string[], added: string[], deleted: string[] }` — compare current file hashes against `fileSyncState` table
- `updateSyncState(db, itemId, hash): void` — upsert `fileSyncState` entry
- `removeSyncState(db, itemId): void` — delete entry

**Step 1: Write failing tests**

```typescript
describe('file sync detection', () => {
  it('detects no changes when hashes match', () => { /* ... */ });
  it('detects changed file (hash mismatch)', () => { /* ... */ });
  it('detects new file (no hash entry)', () => { /* ... */ });
  it('detects deleted file (hash entry but no file)', () => { /* ... */ });
  it('serialization round-trip produces stable hash', () => {
    // Write item → hash → read → re-serialize → hash again → must match
  });
});
```

**Step 2-4: Implement and verify**

**Step 5: Commit**

```bash
git add src/backends/files/sync.ts src/backends/files/sync.test.ts
git commit -m "feat(files): add content hash sync detection"
```

---

## Phase 7: Unified Factory and Migration

### Task 7.1: Migration from legacy .tic/ projects

**Files:**
- Create: `src/backends/drizzle/migrate-legacy.ts`
- Test: `src/backends/drizzle/migrate-legacy.test.ts`

Implement the migration function that converts a legacy filesystem project to SQLite:

```typescript
export function migrateLegacyProject(root: string, db: TicDatabase): void {
  // Single transaction:
  // 1. Parse config.yml → insert into config tables
  // 2. Parse each .tic/items/*.md → insert into work_items + labels + deps + comments
  // 3. Parse each .tic/trash/*.md → insert with deletedAt set
  // 4. Parse each .tic/templates/*.md → insert into templates + labels + deps
  // 5. Parse sync-queue.json → insert into sync_queue
  // 6. Compute file hashes → insert into file_sync_state
  // 7. Update .tic/.gitignore with tic.db, tic.db-wal, tic.db-shm
  // 8. Map backend: 'local' → 'filesystem'
}
```

**Step 1: Write failing tests**

```typescript
describe('migrateLegacyProject', () => {
  it('migrates config.yml to database tables', () => {
    // Create temp dir with config.yml containing custom statuses, types, iterations
    // Run migration
    // Verify config tables
  });

  it('migrates work items with labels and deps', () => {
    // Create temp dir with .tic/items/1.md, 2.md
    // Item 2 depends on item 1 and has labels
    // Run migration
    // Verify work_items, work_item_labels, work_item_deps
  });

  it('migrates comments from item body', () => {
    // Create item with comments in markdown body
    // Run migration
    // Verify comments table
  });

  it('migrates trash to soft-deleted items', () => {
    // Create .tic/trash/3.md
    // Run migration
    // Verify work_items entry with deletedAt set
  });

  it('migrates templates', () => { /* ... */ });

  it('migrates sync queue', () => {
    // Create .tic/sync-queue.json with entries
    // Run migration
    // Verify sync_queue table
  });

  it('maps backend local to filesystem', () => {
    // config.yml has backend: local
    // After migration, project_config.backend = 'filesystem'
  });

  it('handles empty project', () => {
    // .tic/ exists but no items
    // Should succeed with empty tables + defaults
  });

  it('handles malformed .md files gracefully', () => {
    // Create a file with invalid frontmatter
    // Migration should skip it with a warning, not abort
  });

  it('is atomic — all or nothing', () => {
    // Simulate a failure partway through
    // Verify DB is empty (transaction rolled back)
  });

  it('updates .gitignore', () => {
    // Verify tic.db, tic.db-wal, tic.db-shm added to .tic/.gitignore
  });

  it('computes file hashes for sync state', () => {
    // Verify file_sync_state entries match actual file content hashes
  });
});
```

**Step 2-4: Implement and verify**

Use the existing parsing functions from `src/backends/local/items.ts`, `config.ts`, `templates.ts` to read legacy files. Import `parseFrontmatter`, `parseWorkItemFile`, `readConfig`, etc.

**Step 5: Commit**

```bash
git add src/backends/drizzle/migrate-legacy.ts src/backends/drizzle/migrate-legacy.test.ts
git commit -m "feat(drizzle): add legacy .tic/ project migration"
```

---

### Task 7.2: Auto-detect and migrate on startup

**Files:**
- Modify: `src/backends/drizzle/db.ts` or `src/backends/drizzle/index.ts`

Update `DrizzleBackend.create(root)` to check for legacy projects:

```typescript
static create(root: string, options?: DrizzleBackendOptions): DrizzleBackend {
  const dbPath = path.join(root, '.tic', 'tic.db');
  const isLegacy = !fs.existsSync(dbPath) && fs.existsSync(path.join(root, '.tic', 'items'));

  const db = createDatabase(root);
  const backend = new DrizzleBackend(db, root, options);

  if (isLegacy) {
    migrateLegacyProject(root, db);
  } else {
    backend.seedDefaults();
  }

  return backend;
}
```

**Step 1: Write test**

```typescript
it('auto-migrates legacy project on first create', () => {
  // Set up a temp dir with legacy .tic/ files
  const backend = DrizzleBackend.create(tmpDir);
  const items = await backend.listWorkItems();
  expect(items.length).toBeGreaterThan(0);
  backend.destroy();
});
```

**Step 2-3: Implement and verify**

**Step 4: Commit**

```bash
git add src/backends/drizzle/index.ts
git commit -m "feat(drizzle): auto-detect and migrate legacy projects on startup"
```

---

### Task 7.3: Unified factory — eliminate dual creation paths

**Files:**
- Modify: `src/backends/factory.ts`
- Modify: `src/stores/backendDataStore.ts`

Ensure both `backendDataStore.createBackendAndSync()` and `factory.ts.createBackendWithSync()` call the same `createRemoteBackend()` function. The factory should export:

```typescript
export async function createRemoteBackend(root: string, config: Config): Promise<Backend | null>;
export function createBackendWithSync(root: string): Promise<BackendSetup>;
```

`createBackendWithSync` is used by CLI/MCP. It creates a `DrizzleBackend` + calls `createRemoteBackend` + creates `SyncManager` if needed.

`backendDataStore.createBackendAndSync()` does the same thing but with dynamic imports. Since `createRemoteBackend` already uses dynamic imports, the two paths can converge:

```typescript
// backendDataStore.ts
async function createBackendAndSync(cwd: string) {
  const { DrizzleBackend } = await import('../backends/drizzle/index.js');
  const { createRemoteBackend } = await import('../backends/factory.js');
  const primary = DrizzleBackend.create(cwd);
  const config = /* read from primary */;
  const remote = await createRemoteBackend(cwd, config);
  // ... create SyncManager if remote exists
}
```

**Step 1: Implement**

**Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

**Step 3: Commit**

```bash
git add src/backends/factory.ts src/stores/backendDataStore.ts
git commit -m "refactor(factory): unify backend creation into single path"
```

---

### Task 7.4: Update VALID_BACKENDS and config

**Files:**
- Modify: `src/backends/factory.ts`

Update `VALID_BACKENDS` to include `'none'` and `'filesystem'`, and handle the `'local'` → `'filesystem'` mapping:

```typescript
export const VALID_BACKENDS = ['none', 'filesystem', 'github', 'gitlab', 'azure', 'jira'] as const;
```

Ensure the Settings screen and CLI `init --backend` command reflect the new options.

**Step 1: Implement**

**Step 2: Commit**

```bash
git add src/backends/factory.ts
git commit -m "feat(config): add 'none' and 'filesystem' backend types, map 'local' to 'filesystem'"
```

---

## Phase 8: Cleanup

### Task 8.1: Remove old LocalBackend dual role

**Files:**
- Modify: `src/backends/local/index.ts` — remove or mark as deprecated. The file I/O functions (`items.ts`, `frontmatter.ts`, `templates.ts`) stay since `FilesBackend` uses them.

After this phase, `LocalBackend` is no longer used directly. It's replaced by `DrizzleBackend` (primary) and `FilesBackend` (filesystem sync destination).

Do NOT delete `LocalBackend` yet if any tests still reference it. Instead, update tests to use `DrizzleBackend`.

**Step 1: Search for LocalBackend usage**

Run grep for all imports/references to `LocalBackend` across the codebase. For each:
- If it's in a test file → migrate to use `DrizzleBackend` with `:memory:`
- If it's in production code → should already be replaced in prior phases
- If it's in `FilesBackend` → it shouldn't import `LocalBackend`, only the file I/O modules

**Step 2: Remove/migrate each reference**

**Step 3: Remove BackendCache**

`src/backends/cache.ts` is no longer needed — `DrizzleBackend` doesn't use it. Remove the file and update `BaseBackend` in `types.ts` to remove the cache field and `getCachedItems`/`invalidateCache` methods. Other backends (GitHub, GitLab, etc.) that extend `BaseBackend` and use the cache will need to be checked — they likely still benefit from caching since they're remote backends with network latency. If so, keep `BackendCache` for remote backends only.

**Step 4: Remove sync-queue.json handling**

The file-based `SyncQueueStore` (`src/sync/queue.ts`) is no longer used when `DrizzleSyncQueue` is active. Keep it only if CLI/MCP backward compat requires it.

**Step 5: Run full test suite**

Run: `npm test && npm run build && npm run lint && npm run format:check`
Expected: PASS

**Step 6: Commit**

```bash
git add -A
git commit -m "refactor: remove LocalBackend dual role, clean up unused code"
```

---

### Task 8.2: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests PASS.

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 4: Manual smoke test**

Run the TUI: `npm start`

Verify:
- [ ] Fresh project init works (creates SQLite database)
- [ ] Create, read, update, delete items
- [ ] Labels, dependencies, parent relationships
- [ ] Comments
- [ ] Templates
- [ ] Undo (delete + create + update)
- [ ] Sort and filter
- [ ] Saved views
- [ ] Settings screen
- [ ] Command palette
- [ ] If filesystem backend: `.tic/items/` files created on sync
- [ ] If filesystem backend: externally edited `.md` file detected on sync

**Step 5: Commit any final fixes**

```bash
git add -A
git commit -m "chore: final cleanup and verification"
```
