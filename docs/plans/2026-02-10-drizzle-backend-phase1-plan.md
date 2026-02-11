# DrizzleBackend Phase 1: Core Backend Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create DrizzleBackend implementing Backend + SoftDeleteBackend backed by SQLite.

**Architecture:** New src/backends/drizzle/ with SQLite storage. No UI changes - purely backend + tests.

**Tech Stack:** Drizzle ORM, better-sqlite3, Vitest

**Design:** docs/plans/2026-02-10-drizzle-backend-design.md

---

### Task 1: Install dependencies

**Files:** package.json

**Step 1:** Run npm install drizzle-orm better-sqlite3 and npm install -D drizzle-kit @types/better-sqlite3

**Step 2:** Run npm run build - expected: succeeds

**Step 3:** Commit package.json + package-lock.json: chore(deps): add drizzle-orm and better-sqlite3

---

### Task 2: Schema definition

**Files:** Create src/backends/drizzle/schema.ts

Write all 19 tables from design doc SQLite Schema section using sqliteTable, text, integer, index, primaryKey from drizzle-orm/sqlite-core:

- workItems - text PK id, standard fields, deletedAt nullable, indexes on status/type/assignee/priority/iteration/parent
- workItemLabels - composite PK (workItemId, label), FK cascade from workItems, index on label
- workItemDeps - composite PK (workItemId, dependsOnId), both FK cascade from workItems, index on dependsOnId
- comments - auto-increment PK, FK cascade from workItems, index on workItemId
- templates - text PK slug, standard template fields
- templateLabels - composite PK (templateSlug, label), FK cascade
- templateDeps - composite PK (templateSlug, dependsOnId), FK cascade
- projectConfig - integer PK default 1 (singleton), all config columns
- statuses, workItemTypes, iterations - text PK name, sortOrder
- jiraConfig - singleton
- savedViews + savedViewFilters + savedViewSortEntries - normalized
- syncQueue - auto-increment, indexed on (itemId, action)
- undoStack + undoItemSnapshot + undoItemSnapshotLabels + undoItemSnapshotDeps - cascade
- fileSyncState - text PK itemId, hash, syncedAt

**Verify:** npm run build passes. **Commit:** feat(drizzle): add SQLite schema definition (19 tables)

---

### Task 3: Database initialization

**Files:** Create src/backends/drizzle/db.ts and src/backends/drizzle/db.test.ts

**Tests:** Verify createInMemoryDatabase() has all tables (sqlite_master query), foreign_keys ON. Verify createDatabase(dbPath) creates file with WAL mode.

**Implementation:** Export DrizzleDb type, createInMemoryDatabase(), createDatabase(dbPath). Private pushSchema(db) runs CREATE TABLE IF NOT EXISTS + CREATE INDEX IF NOT EXISTS raw SQL for all tables.

**Commit:** feat(drizzle): add database initialization with schema push

---

### Task 4: Implement DrizzleBackend

**Files:** Create src/backends/drizzle/index.ts and src/backends/drizzle/index.test.ts

**Tests (~40):** Use createInMemoryDatabase(), seed config/statuses/types/iterations. Groups: capabilities (1), create+get (5), list (3), update (4), delete+cascade (3), soft delete (3), comments (1), children/dependents (2), relationship validation (5), metadata (7), templates (6), temp IDs (1).

**Implementation:** DrizzleBackend implements SoftDeleteBackend with { tempIds?: boolean } option. Uses eq/and/isNull/inArray from drizzle-orm. Private helpers: hydrateWorkItem, hydrateTemplate, validateRelationships. Match src/backends/local/index.ts behavior. Cached variants are pass-through.

Key method behaviors:
- createWorkItem: read+increment nextId from projectConfig, auto-add iteration, insert row+labels+deps
- updateWorkItem: merge with existing, validate, update scalars, delete+re-insert labels/deps
- deleteWorkItem: null parent refs on children, remove dep refs, delete item (cascade)
- softDeleteWorkItem/restoreWorkItem/permanentlyDeleteWorkItem: deletedAt column ops
- Template CRUD: slug change = delete old + create new
- hydrateWorkItem: query labels, deps, comments for each row
- validateRelationships: self-ref, existence, circular parent walk

**Commit:** feat(drizzle): implement DrizzleBackend with Backend + SoftDeleteBackend

---

### Task 5: Final verification

Run npm test, npm run format:check, npm run lint, npx tsc --noEmit - all pass. New files only in src/backends/drizzle/. No existing files changed except package.json.
