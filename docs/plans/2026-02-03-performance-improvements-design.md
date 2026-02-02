# Performance Improvements Design

## Motivation

Several performance bottlenecks exist across the codebase, most stemming from a single root cause: no caching between backend calls. Methods like `getChildren()`, `getDependents()`, and `getAssignees()` each call `listWorkItems()` independently, causing redundant full fetches. For remote backends (GitHub, GitLab, ADO, Jira), each fetch is a subprocess invocation taking 500ms-2s. For the local backend, each fetch reads every markdown file from disk.

This design addresses all identified bottlenecks in a single cohesive effort.

## Bottleneck Summary

| Bottleneck | Severity | Location |
|------------|----------|----------|
| N+1 getChildren/getDependents | Critical | All backends |
| getAssignees re-scans all items | High | LocalBackend |
| Circular ref validation O(n²) | High | LocalBackend.validateRelationships |
| Delete cleanup: individual writes | High | LocalBackend.deleteWorkItem |
| GitHub milestones fetched 2x per cycle | Medium | GitHubBackend.fetchMilestones |
| Jira sprints fetched 3x per cycle | Medium | JiraBackend.fetchSprints |
| ADO update fetches same item 2-3x | Medium | AzureDevOpsBackend.updateWorkItem |
| Search overlay re-fetches all items | Medium | WorkItemList useEffect |
| Startup blocks on listWorkItems | Medium | index.tsx |

## Design

### 1. Caching Layer in BaseBackend

A new `BackendCache` class in `src/backends/cache.ts` provides a shared cache for `listWorkItems()` results. All backends inherit caching through `BaseBackend`.

#### BackendCache

Holds:
- `items: WorkItem[] | null` — cached result of `listWorkItems()`
- `itemsByIteration: Map<string, WorkItem[]>` — cached filtered results keyed by iteration
- `timestamp: number` — when the cache was last populated
- `ttl: number` — milliseconds before cache expires (0 = never expires)

Methods:
- `get(iteration?: string): WorkItem[] | null` — returns cached items if valid (within TTL), null if expired or empty
- `set(items: WorkItem[], iteration?: string): void` — stores items and updates timestamp
- `invalidate(): void` — clears all cached data

#### BaseBackend Changes

New protected members:
- `cache: BackendCache` — instantiated with `ttl` from constructor
- `getCachedItems(iteration?: string): Promise<WorkItem[]>` — returns cache hit or calls real `listWorkItems()` and caches result

New default implementations (using `getCachedItems()`):
- `getChildren(id)` — filters cached items by `parent === id`
- `getDependents(id)` — filters cached items by `dependsOn.includes(id)`
- `getAssignees()` — extracts unique assignees from cached items

Mutation wrapper pattern:
- `createWorkItem`, `updateWorkItem`, `deleteWorkItem` call the real implementation then `this.cache.invalidate()` and `this.onCacheInvalidate()`

Hook for subclasses:
- `protected onCacheInvalidate(): void` — override to clear secondary caches (milestones, sprints)

#### TTL Configuration

- LocalBackend: `ttl = 0` (no expiry, invalidation-only)
- GitHub, GitLab, ADO, Jira: `ttl = 60_000` (60 seconds)

Remote backends use TTL to pick up external changes (edits from web UI, other users). Local backend only changes through tic itself, so invalidation on mutation is sufficient.

### 2. LocalBackend Fixes

#### 2a. Map-Based Validation (O(n) instead of O(n²))

In `validateRelationships()`, build a `Map<string, WorkItem>` from all items at the start. Replace all `all.find()` calls with `Map.get()`. This affects:
- Parent chain walk (circular parent detection)
- Dependency cycle DFS

Before: O(n) per lookup, O(n²) total in cycle detection.
After: O(1) per lookup, O(n + e) total where e = number of dependency edges.

#### 2b. Batched Delete Cleanup

In `deleteWorkItem()`, instead of calling `writeWorkItem()` for each modified item individually:
1. Collect all items needing modification into an array
2. Write them all after the loop

This reduces the number of individual file writes and makes the operation more predictable.

#### 2c. getAssignees Uses Cache

Replace the direct `listWorkItems()` call with `getCachedItems()`. When the list view has already loaded items, this is a no-op.

### 3. Remote Backend Fixes

#### 3a. GitHub Milestone Memoization

Add a `cachedMilestones: GhMilestone[] | null` field to GitHubBackend. `fetchMilestones()` checks this field first. Cleared via `onCacheInvalidate()`.

#### 3b. Jira Sprint Memoization

Same pattern. Add `cachedSprints: JiraSprint[] | null` to JiraBackend. `fetchSprints()` checks this field first. Cleared via `onCacheInvalidate()`.

#### 3c. ADO Update Deduplication

Refactor `updateWorkItem()` to:
1. Fetch the current work item once at the top
2. Reuse that object for both parent and dependency relation comparisons
3. Use the final `az boards work-item update` response as the return value instead of calling `getWorkItem()` again

### 4. Search Overlay Reuses Loaded Items

Remove the `useEffect` + `backend.listWorkItems()` call in WorkItemList that triggers when search opens. Instead, pass `allItems` from `useBackendData` directly to `SearchOverlay` as a prop.

SearchOverlay becomes a pure component: receives items, runs `fuzzyMatch()`, renders results. No independent data fetching.

### 5. Immediate TUI Rendering

Move the `render(<App>)` call before any data fetching. Remove the blocking `await backend.listWorkItems()` from `index.tsx`. The list view already supports a loading state via `useBackendData` — let it handle the initial fetch.

For sync: fire `syncManager.sync()` in the background unconditionally. Never block render.

Result: TUI frame (header, hint bar) appears instantly. Items populate once loaded.

## Testing Strategy

- **BackendCache unit tests** (`src/backends/cache.test.ts`) — cache population, TTL expiry, invalidation, iteration-keyed storage
- **LocalBackend validation tests** — existing tests serve as regression. Add test with 50+ items to verify Map-based validation correctness
- **All existing backend tests** — caching is transparent; same inputs, same outputs
- **Search overlay** — verify it works with items passed as props. Existing `SearchOverlay.test.ts` is unaffected (tests `groupResults` only)
- **Startup** — manual smoke test: `npm start` should show TUI frame immediately

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Stale cache after external change | 60s TTL for remote backends ensures periodic refresh |
| Cache not invalidated on some path | All mutations route through BaseBackend wrappers that invalidate |
| Memory for large item sets | Item lists are hundreds, not millions. Negligible memory |
| Secondary cache (milestones/sprints) missed | `onCacheInvalidate()` hook. Only affects display freshness, not correctness |

## Out of Scope

- Debouncing search input (not needed at current item counts)
- Tree rebuild optimization (already O(n), memoized with `useMemo`)
- Parallelizing CLI subprocess calls (diminishing returns)
- Manual refresh keybinding (future enhancement)
