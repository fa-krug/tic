# Dual-ID Design: Separate Storage rowId from Display ID

## Problem

Work item IDs serve double duty as both the SQLite storage key and the display/remote identifier. During sync, when a remote backend assigns a different ID, the system must rename the item (delete + reimport + update all references), which is fragile and error-prone. The `nextId` counter can also collide with imported IDs.

## Solution

Introduce a stable internal `rowId` (INTEGER PRIMARY KEY AUTOINCREMENT) managed by SQLite, and make the display `id` a nullable field assigned by the backend. Relationships (parent, dependsOn) reference `rowId` internally. The display ID is null until a backend assigns it.

## Design Decisions

- **rowId is invisible** — users never see it. TUI shows display ID or a placeholder icon.
- **Relationships use rowId** — parent and dependsOn store integer rowIds, not display ID strings. This eliminates the rename cascade on sync.
- **CLI/MCP use display IDs** — `tic item show 42` looks up by display ID. Unsynced items (no display ID) are only addressable via TUI cursor selection.
- **Storage acts as a backend** — for local-only usage (no remote), Storage assigns a display ID on creation, just like a remote would. Uniform contract across all backends.
- **NewWorkItem unchanged** — no id, no rowId. Parent/dependsOn become `number | null` and `number[]` (rowId references).

## Schema Changes

### work_items

```sql
-- Before
id TEXT PRIMARY KEY

-- After
rowId INTEGER PRIMARY KEY AUTOINCREMENT
id TEXT NULL  -- display ID, assigned by backend
```

A unique index on `id` (where not null) ensures no duplicate display IDs.

### Foreign Key Migration

All tables referencing work items switch from `TEXT → work_items.id` to `INTEGER → work_items.rowId`:

| Table | Current FK | New FK |
|-------|-----------|--------|
| `work_item_labels` | `work_item_id TEXT` | `work_item_row_id INTEGER` |
| `work_item_deps` | `work_item_id TEXT`, `depends_on_id TEXT` | both `INTEGER` |
| `comments` | `work_item_id TEXT` | `INTEGER` |
| `sync_queue` | `item_id TEXT` | `item_row_id INTEGER` |
| `undo_stack` | `item_id TEXT` | `item_row_id INTEGER` |
| `file_sync_state` | `item_id TEXT PK` | `item_row_id INTEGER PK` |
| `pr_item_links` | `item_id TEXT` | `item_row_id INTEGER` |
| `work_items.parent` | `TEXT (self-ref)` | `INTEGER NULL (self-ref to rowId)` |

### project_config

Remove `nextId` — SQLite AUTOINCREMENT handles rowId sequencing. Display ID assignment is the backend's responsibility.

## Type Changes

```typescript
export interface WorkItem {
  rowId: number;           // NEW — stable internal key
  id: string | null;       // CHANGED — nullable display ID
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
  parent: number | null;   // CHANGED — rowId reference
  dependsOn: number[];     // CHANGED — rowId references
}

// NewWorkItem — same fields minus rowId and id
export type NewWorkItem = Pick<WorkItem,
  | 'title' | 'type' | 'status' | 'iteration' | 'priority'
  | 'assignee' | 'labels' | 'description' | 'parent' | 'dependsOn'
>;
```

Template `parent` and `dependsOn` also switch to rowId references.

## Backend Interface

The `Backend` interface keeps `id: string` signatures for all methods (`getWorkItem`, `updateWorkItem`, `deleteWorkItem`, `addComment`, `getChildren`, `getDependents`, etc.). Remote backends continue to use display ID strings natively.

**Storage** implements the `Backend` interface by translating: it accepts display `id` strings in the interface methods but resolves them to `rowId` internally via lookup. Storage also exposes `rowId`-based methods for internal use (by the TUI, stores, and sync).

**Storage.createWorkItem(item: NewWorkItem):**
1. Insert row — SQLite assigns `rowId`
2. If no remote backend configured: assign display `id` (next sequential number)
3. If remote backend configured: leave `id` as null
4. Return `WorkItem` with `rowId` and `id` (possibly null)

**BaseBackend default implementations** (`getChildren`, `getDependents`) currently filter by string comparison (`item.parent === id`). Since the `Backend` interface keeps `id: string` signatures, these methods receive a display ID, resolve it to a rowId via lookup, then filter by `item.parent === rowId`. Remote backends override these with their own API calls and never see rowIds.

### PullRequest Types

`PullRequest.linkedItems` changes from `string[]` to `number[]` (rowId references). `NewPullRequest.linkedItems` also becomes `number[]`. `PrBackend` methods `linkItem(prId, itemRowId)` and `unlinkItem(prId, itemRowId)` accept rowId for the item parameter. `getLinkedPullRequests(itemRowId)` accepts rowId.

## Sync Changes

### Push (local → remote)

**Before:**
1. Push item to remote → get remote display ID
2. `renameLocalItem()`: delete old item, reimport with new ID, update all references

**After:**
1. Prepare item for remote: resolve rowId relationship fields (`parent`, `dependsOn`) to display ID strings by looking up each referenced item's display ID. Items whose referenced parents/deps have no display ID yet (also unsynced) must be pushed first — SyncManager orders pushes so dependencies are resolved before dependents.
2. Push item to remote → get remote display ID
3. `UPDATE work_items SET id = ? WHERE rowId = ?`

**Remote backends receive `NewWorkItem` with string-typed `parent`/`dependsOn`** — the SyncManager translates rowIds to display IDs before handing off to the remote backend. The remote backend never sees rowIds. This means the `NewWorkItem` type used at the sync boundary has `parent: string | null` and `dependsOn: string[]` (display IDs), while the internal `NewWorkItem` used by Storage has `parent: number | null` and `dependsOn: number[]` (rowIds). This is handled by the SyncManager translation layer, not by having two `NewWorkItem` types — the sync code builds a plain object with resolved display IDs to pass to the remote.

### Pull (remote → local)

When pulling items from a remote backend:
1. Look up existing item by display `id` in local DB
2. If found: update that row (matched by rowId via the display ID lookup)
3. If not found: insert a new row — SQLite assigns rowId, display `id` set from remote

This replaces the current `importWorkItem` for pull reconciliation. The `importWorkItem` method simplifies to an upsert-by-display-id.

**Removed:**
- `renameLocalItem()` method
- `renameItem()` on sync queue
- `PushResult.idMappings` map
- `tempIds` option on `StorageOptions`
- `local-` prefix ID convention

## Undo System

The undo system serializes `WorkItem` snapshots. These snapshots update to use the new types: `parent: number | null` and `dependsOn: number[]` (rowIds). The `undo_stack.itemRowId` column (renamed from `itemId`) stores the rowId of the affected item.

`UndoMetadata` fields `syncItemIds` and `createdIds` switch to `number[]` (rowIds). Since undo entries are transient (max depth 5, flushed on exit), migration of in-flight undo data is not needed — the undo stack can be cleared during migration.

## Store Changes

- **navigationStore:** `selectedWorkItemId` becomes `selectedWorkItemRowId: number | null`. `createChildParentId` becomes `createChildParentRowId: number | null`.
- **listViewStore:** cursor tracks `rowId`, not display ID.
- **formStackStore:** navigation stack entries use `rowId` for item identification.
- **undoStore:** entries reference `rowId`.

## UI Changes

- **ID column:** shows `item.id` or placeholder icon (e.g., `·`) when null
- **WorkItemForm:** parent/dependsOn pickers pass `rowId` values, display shows `id` or placeholder
- **CommandBar/search:** matches on display ID and title; items without display ID searchable by title only
- **Branch links:** `tic/{id}-*` pattern uses display ID for naming; lookup from display ID → rowId for linking back. Branch creation requires a non-null display ID — block for unsynced items.
- **FilesBackend:** file naming uses display ID for filenames (e.g., `42.md`). Items with null display ID are skipped during file sync.

### Template Relationships

Template `parent` and `dependsOn` remain as `string | null` and `string[]` (display ID strings). Templates reference items by display ID since templates may be synced to remote backends that don't know about rowIds. When resolving template relationships at item creation time, display IDs are looked up to find the corresponding rowId.

## Migration

1. Create new `work_items` table with `rowId INTEGER PRIMARY KEY AUTOINCREMENT` and `id TEXT NULL`
2. Copy existing items — existing `id` text values preserved as display IDs, SQLite assigns rowIds
3. Rewrite all FK columns from text ID → corresponding rowId (via join on old ID)
4. Rewrite `parent` self-references from text ID → rowId
5. Drop `nextId` from `project_config`
6. Handle dangling references (parent/dependsOn pointing to non-existent items) by nulling them out
7. Existing `local-*` prefixed IDs are preserved as display IDs (they're valid strings)
8. Clear the undo stack (transient data, not worth migrating)
