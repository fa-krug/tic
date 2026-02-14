# Startup Performance Optimization

## Problem

Startup is too slow for both TUI and CLI with 200+ work items. The current startup path runs ~14 DB queries scanning ~2,500 rows, loads comments for all items unnecessarily, fetches labels redundantly, and loads React/Ink for CLI commands that don't need it.

## Design

### 1. Database Query Optimization

**A. Skip comments in list context**
- Add `options.includeComments` parameter to `assembleWorkItems()`, default `false`
- `listWorkItems()` passes `includeComments: false` — saves one query scanning ~100 rows
- `getWorkItem(id)` passes `includeComments: true` for detail/form views

**B. Deduplicate at DB level**
- `getAssignees()`: Use `SELECT DISTINCT assignee` instead of scanning all rows and deduping in JS
- `getLabels()`: Use `SELECT DISTINCT label` with the join, deduplicate DB-side

**C. Add compound indexes**
- `(deleted_at, iteration)` — covers the most common list query
- `(deleted_at, status)` — covers status filtering
- `(deleted_at, assignee)` — covers assignee queries

**D. Eliminate redundant `getLabels()` call**
- Labels are fetched twice: once in `refresh()` via `getLabels()`, and again inside `assembleWorkItems()`
- Extract unique labels from the already-loaded per-item label data instead of a separate query

### 2. Lazy/Deferred Loading

**A. Defer assignee and label lists until needed**
- Remove `getAssignees()` and `getLabels()` from `refresh()`
- Derive unique assignees/labels from the already-loaded items in memory
- Zero additional queries for picker data — just iterate loaded items
- Falls back to a DB query only if items aren't loaded yet

**B. Defer comments from list loading**
- Uses the `includeComments: false` option from Section 1
- Comments loaded per-item when opening detail panel or form

**C. CLI keeps sync behavior**
- CLI commands continue to `await syncManager.sync()` before operating
- Sync errors surface immediately for reliable scripting feedback

### 3. Module Loading Optimization

**A. Dynamic import for TUI rendering**
- Move `ink` and `App` imports behind dynamic `import()` — only load for TUI mode
- CLI path skips React/Ink entirely (~500ms savings)

**B. Lazy backend module loading in factory.ts**
- `factory.ts` (CLI path) currently statically imports all backends
- Change to dynamic imports — only load the detected backend module

**C. What we're NOT doing**
- No esbuild/bundling — dynamic imports make this unnecessary
- No tree-shaking Ink components — avoided entirely for CLI

## Expected Impact

| Layer | Before | After |
|-------|--------|-------|
| Module load (CLI) | ~500ms (React+Ink) | ~100ms (no React) |
| DB queries in refresh | 6 parallel + 3 sub-queries | 4 parallel + 2 sub-queries |
| Rows scanned | ~2,500 | ~1,200 |
| Redundant label fetch | 2x | 0 (derived from items) |
| Comment loading | Always (all items) | On demand (single item) |
