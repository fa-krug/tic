# Performance Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Eliminate redundant data fetching across all backends by adding a caching layer in BaseBackend, fix O(n²) algorithms in LocalBackend, memoize secondary queries in remote backends, and improve startup/search UX.

**Architecture:** A `BackendCache` class caches `listWorkItems()` results. `BaseBackend` provides default `getChildren`/`getDependents`/`getAssignees` implementations that read from cache. Mutations invalidate the cache. Remote backends use a 60s TTL. Individual backends get targeted fixes for their own redundancies.

**Tech Stack:** TypeScript, Vitest (testing)

---

### Task 1: Create BackendCache Class

**Files:**
- Create: `src/backends/cache.ts`
- Test: `src/backends/cache.test.ts`

**Step 1: Write the failing tests**

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BackendCache } from './cache.js';
import type { WorkItem } from '../types.js';

const makeItem = (id: string, iteration = ''): WorkItem => ({
  id,
  title: `Item ${id}`,
  type: 'task',
  status: 'open',
  priority: 'medium',
  assignee: '',
  labels: [],
  parent: null,
  dependsOn: [],
  iteration,
  description: '',
  comments: [],
  created: '2026-01-01T00:00:00Z',
  updated: '2026-01-01T00:00:00Z',
});

describe('BackendCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns null on empty cache', () => {
    const cache = new BackendCache(0);
    expect(cache.get()).toBeNull();
  });

  it('returns cached items after set', () => {
    const cache = new BackendCache(0);
    const items = [makeItem('1'), makeItem('2')];
    cache.set(items);
    expect(cache.get()).toEqual(items);
  });

  it('caches by iteration key', () => {
    const cache = new BackendCache(0);
    const all = [makeItem('1', 'sprint-1'), makeItem('2', 'sprint-2')];
    const sprint1 = [makeItem('1', 'sprint-1')];
    cache.set(all);
    cache.set(sprint1, 'sprint-1');
    expect(cache.get()).toEqual(all);
    expect(cache.get('sprint-1')).toEqual(sprint1);
  });

  it('invalidate clears all cached data', () => {
    const cache = new BackendCache(0);
    cache.set([makeItem('1')]);
    cache.set([makeItem('1')], 'sprint-1');
    cache.invalidate();
    expect(cache.get()).toBeNull();
    expect(cache.get('sprint-1')).toBeNull();
  });

  it('ttl=0 means cache never expires', () => {
    const cache = new BackendCache(0);
    cache.set([makeItem('1')]);
    vi.advanceTimersByTime(999999);
    expect(cache.get()).not.toBeNull();
  });

  it('ttl > 0 expires after duration', () => {
    const cache = new BackendCache(60000);
    cache.set([makeItem('1')]);
    expect(cache.get()).not.toBeNull();
    vi.advanceTimersByTime(60001);
    expect(cache.get()).toBeNull();
  });

  it('iteration-keyed cache also expires with ttl', () => {
    const cache = new BackendCache(60000);
    cache.set([makeItem('1', 's1')], 's1');
    vi.advanceTimersByTime(60001);
    expect(cache.get('s1')).toBeNull();
  });
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/cache.test.ts`
Expected: FAIL — module `./cache.js` not found

**Step 3: Write the implementation**

```typescript
import type { WorkItem } from '../types.js';

export class BackendCache {
  private items: WorkItem[] | null = null;
  private itemsByIteration = new Map<string, WorkItem[]>();
  private timestamp = 0;
  private readonly ttl: number;

  constructor(ttl: number) {
    this.ttl = ttl;
  }

  get(iteration?: string): WorkItem[] | null {
    if (this.ttl > 0 && Date.now() - this.timestamp > this.ttl) {
      this.invalidate();
      return null;
    }
    if (iteration !== undefined) {
      return this.itemsByIteration.get(iteration) ?? null;
    }
    return this.items;
  }

  set(items: WorkItem[], iteration?: string): void {
    if (iteration !== undefined) {
      this.itemsByIteration.set(iteration, items);
    } else {
      this.items = items;
    }
    if (this.timestamp === 0) {
      this.timestamp = Date.now();
    }
  }

  invalidate(): void {
    this.items = null;
    this.itemsByIteration.clear();
    this.timestamp = 0;
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/cache.test.ts`
Expected: All 7 tests PASS

**Step 5: Commit**

```bash
git add src/backends/cache.ts src/backends/cache.test.ts
git commit -m "feat: add BackendCache class with TTL support"
```

---

### Task 2: Integrate Cache into BaseBackend

**Files:**
- Modify: `src/backends/types.ts:45-108`

**Step 1: Write the failing test**

Create `src/backends/types.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';
import { BaseBackend } from './types.js';
import type { BackendCapabilities } from './types.js';

const makeItem = (
  id: string,
  overrides: Partial<WorkItem> = {},
): WorkItem => ({
  id,
  title: `Item ${id}`,
  type: 'task',
  status: 'open',
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
});

class TestBackend extends BaseBackend {
  public items: WorkItem[] = [];

  constructor(ttl = 0) {
    super(ttl);
  }

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
    };
  }

  getStatuses = async () => ['open', 'closed'];
  getIterations = async () => ['sprint-1'];
  getWorkItemTypes = async () => ['task'];
  getAssignees = async () => this.getAssigneesFromCache();
  getCurrentIteration = async () => 'sprint-1';
  setCurrentIteration = async () => {};
  getWorkItem = async (id: string) => this.items.find((i) => i.id === id)!;
  addComment = async () => ({ author: '', date: '', body: '' }) as Comment;
  getItemUrl = () => '';
  openItem = async () => {};

  async listWorkItems(_iteration?: string): Promise<WorkItem[]> {
    return this.items;
  }

  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    const item = makeItem(String(this.items.length + 1), {
      title: data.title,
      parent: data.parent,
      dependsOn: data.dependsOn,
    });
    this.items.push(item);
    return item;
  }

  async updateWorkItem(
    id: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    const idx = this.items.findIndex((i) => i.id === id);
    this.items[idx] = { ...this.items[idx]!, ...data };
    return this.items[idx]!;
  }

  async deleteWorkItem(id: string): Promise<void> {
    this.items = this.items.filter((i) => i.id !== id);
  }
}

describe('BaseBackend cache integration', () => {
  it('getChildren uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeItem('1'),
      makeItem('2', { parent: '1' }),
      makeItem('3', { parent: '1' }),
      makeItem('4'),
    ];
    const listSpy = vi.spyOn(b, 'listWorkItems');
    const children1 = await b.getChildren('1');
    const children2 = await b.getChildren('1');
    expect(children1).toHaveLength(2);
    expect(children2).toHaveLength(2);
    // listWorkItems called only once due to cache
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('getDependents uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeItem('1'),
      makeItem('2', { dependsOn: ['1'] }),
      makeItem('3', { dependsOn: ['1'] }),
    ];
    const listSpy = vi.spyOn(b, 'listWorkItems');
    const deps = await b.getDependents('1');
    await b.getDependents('1');
    expect(deps).toHaveLength(2);
    expect(listSpy).toHaveBeenCalledTimes(1);
  });

  it('getAssigneesFromCache uses cached items', async () => {
    const b = new TestBackend();
    b.items = [
      makeItem('1', { assignee: 'alice' }),
      makeItem('2', { assignee: 'bob' }),
      makeItem('3', { assignee: 'alice' }),
    ];
    const assignees = await b.getAssignees();
    expect(assignees).toEqual(['alice', 'bob']);
  });

  it('cache invalidates after mutation', async () => {
    const b = new TestBackend();
    b.items = [makeItem('1'), makeItem('2', { parent: '1' })];
    const children1 = await b.getChildren('1');
    expect(children1).toHaveLength(1);

    // Mutate: remove the child relationship
    b.items[1]!.parent = null;
    await b.cachedUpdateWorkItem('2', { parent: null });

    const children2 = await b.getChildren('1');
    expect(children2).toHaveLength(0);
  });
});
```

Note: The test references `cachedUpdateWorkItem` — this is the wrapper method that calls the real `updateWorkItem` then invalidates cache. The exact naming will depend on implementation approach. See Step 3.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/types.test.ts`
Expected: FAIL — BaseBackend constructor doesn't accept ttl, no getChildren/getDependents/getAssigneesFromCache methods

**Step 3: Write the implementation**

Modify `src/backends/types.ts`. Changes to `BaseBackend`:

1. Add constructor accepting `ttl`:
```typescript
import { BackendCache } from './cache.js';

export abstract class BaseBackend implements Backend {
  protected cache: BackendCache;

  constructor(ttl = 0) {
    this.cache = new BackendCache(ttl);
  }
```

2. Change `getChildren` and `getDependents` from abstract to default implementations:
```typescript
  async getChildren(id: string): Promise<WorkItem[]> {
    const all = await this.getCachedItems();
    return all.filter((item) => item.parent === id);
  }

  async getDependents(id: string): Promise<WorkItem[]> {
    const all = await this.getCachedItems();
    return all.filter((item) => item.dependsOn.includes(id));
  }
```

3. Add `getCachedItems` and `getAssigneesFromCache` helpers:
```typescript
  protected async getCachedItems(iteration?: string): Promise<WorkItem[]> {
    const cached = this.cache.get(iteration);
    if (cached) return cached;
    const items = await this.listWorkItems(iteration);
    this.cache.set(items, iteration);
    return items;
  }

  protected async getAssigneesFromCache(): Promise<string[]> {
    const items = await this.getCachedItems();
    const assignees = new Set<string>();
    for (const item of items) {
      if (item.assignee) assignees.add(item.assignee);
    }
    return [...assignees].sort();
  }
```

4. Add cache invalidation hook:
```typescript
  protected onCacheInvalidate(): void {
    // Override in subclasses to clear secondary caches
  }

  protected invalidateCache(): void {
    this.cache.invalidate();
    this.onCacheInvalidate();
  }
```

5. Add cached mutation wrappers:
```typescript
  async cachedCreateWorkItem(data: NewWorkItem): Promise<WorkItem> {
    const result = await this.createWorkItem(data);
    this.invalidateCache();
    return result;
  }

  async cachedUpdateWorkItem(
    id: string,
    data: Partial<WorkItem>,
  ): Promise<WorkItem> {
    const result = await this.updateWorkItem(id, data);
    this.invalidateCache();
    return result;
  }

  async cachedDeleteWorkItem(id: string): Promise<void> {
    await this.deleteWorkItem(id);
    this.invalidateCache();
  }
```

6. Remove `abstract` from `getChildren` and `getDependents` declarations. Keep them as regular methods. Backends that have optimized versions (ADO WIQL queries, GitLab epic children, Jira JQL queries) keep their overrides.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/types.test.ts`
Expected: All 4 tests PASS

**Step 5: Run full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All existing tests still pass. Some backends override getChildren/getDependents, so they won't use the default. LocalBackend's overrides should still work.

**Step 6: Commit**

```bash
git add src/backends/types.ts src/backends/types.test.ts
git commit -m "feat: add cache integration to BaseBackend with default getChildren/getDependents"
```

---

### Task 3: Update LocalBackend to Use Cache

**Files:**
- Modify: `src/backends/local/index.ts:25-305`

**Step 1: Update constructor to pass ttl=0**

In the `LocalBackend` constructor (line 35), change `super()` to `super(0)`.

**Step 2: Replace getChildren/getDependents with cache-based defaults**

Remove the `getChildren` and `getDependents` overrides (lines 278-286). The `BaseBackend` default implementations will be used instead, which read from cache.

**Step 3: Update getAssignees to use cache**

Replace lines 89-98:
```typescript
async getAssignees(): Promise<string[]> {
  return this.getAssigneesFromCache();
}
```

**Step 4: Fix validateRelationships — use Map for O(1) lookups**

Replace lines 126-190. Build a `Map<string, WorkItem>` at the start:

```typescript
private async validateRelationships(
  id: string,
  parent: string | null | undefined,
  dependsOn: string[] | undefined,
): Promise<void> {
  const all = await this.getCachedItems();
  const itemMap = new Map(all.map((item) => [item.id, item]));
  const allIds = new Set(itemMap.keys());

  if (parent !== null && parent !== undefined) {
    if (parent === id) {
      throw new Error(`Work item #${id} cannot be its own parent`);
    }
    if (!allIds.has(parent)) {
      throw new Error(`Parent #${parent} does not exist`);
    }
    let current: string | null = parent;
    const visited = new Set<string>();
    while (current !== null) {
      if (current === id) {
        throw new Error(`Circular parent chain detected for #${id}`);
      }
      if (visited.has(current)) break;
      visited.add(current);
      const parentItem = itemMap.get(current);
      current = parentItem?.parent ?? null;
    }
  }

  if (dependsOn !== undefined) {
    for (const depId of dependsOn) {
      if (depId === id) {
        throw new Error(`Work item #${id} cannot depend on itself`);
      }
      if (!allIds.has(depId)) {
        throw new Error(`Dependency #${depId} does not exist`);
      }
    }
    const hasCycle = (startId: string, targetId: string): boolean => {
      const visited = new Set<string>();
      const stack = [startId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current === targetId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        const item = itemMap.get(current);
        if (item) {
          for (const dep of item.dependsOn) {
            stack.push(dep);
          }
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
```

Key change: `all.find()` → `itemMap.get()` throughout.

**Step 5: Fix deleteWorkItem — batch writes**

Replace lines 245-263:

```typescript
async deleteWorkItem(id: string): Promise<void> {
  await removeWorkItemFile(this.root, id);
  const all = await this.listWorkItems();
  const toWrite: WorkItem[] = [];
  for (const item of all) {
    let changed = false;
    if (item.parent === id) {
      item.parent = null;
      changed = true;
    }
    if (item.dependsOn.includes(id)) {
      item.dependsOn = item.dependsOn.filter((d) => d !== id);
      changed = true;
    }
    if (changed) {
      toWrite.push(item);
    }
  }
  await Promise.all(toWrite.map((item) => writeWorkItem(this.root, item)));
}
```

Key change: collect modified items, write all in parallel at the end.

**Step 6: Run existing LocalBackend tests**

Run: `npx vitest run src/backends/local/`
Expected: All tests PASS

**Step 7: Commit**

```bash
git add src/backends/local/index.ts
git commit -m "perf: use cache and Map lookups in LocalBackend"
```

---

### Task 4: Update GitHub Backend

**Files:**
- Modify: `src/backends/github/index.ts`

**Step 1: Add TTL to constructor**

Change `super()` (line 100) to `super(60_000)`.

**Step 2: Add milestone memoization**

Add a private field and override `onCacheInvalidate`:

```typescript
private cachedMilestones: GhMilestone[] | null = null;

protected override onCacheInvalidate(): void {
  this.cachedMilestones = null;
}
```

Update `fetchMilestones()` (lines 366-372):
```typescript
private fetchMilestones(): GhMilestone[] {
  if (this.cachedMilestones) return this.cachedMilestones;
  const { owner, repo } = this.getOwnerRepo();
  this.cachedMilestones = gh<GhMilestone[]>(
    ['api', `repos/${owner}/${repo}/milestones`, '--jq', '.'],
    this.cwd,
  );
  return this.cachedMilestones;
}
```

**Step 3: Remove getChildren/getDependents overrides (lines 311-320)**

The default `BaseBackend` implementations will handle these via cache. GitHub's `getChildren` was just `listWorkItems().filter(parent === id)` — identical to the default.

Note: GitHub `getDependents` had an `assertSupported` check, but `dependsOn` is `false` in capabilities, so `getDependents` should never be called by the UI. The `BaseBackend` default is fine.

**Step 4: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/github/index.ts
git commit -m "perf: add cache TTL and milestone memoization to GitHubBackend"
```

---

### Task 5: Update GitLab Backend

**Files:**
- Modify: `src/backends/gitlab/index.ts`

**Step 1: Add TTL to constructor**

Change `super()` (line 34) to `super(60_000)`.

**Step 2: Add iteration memoization**

Add a private field and override `onCacheInvalidate`:

```typescript
private cachedIterations: GlIteration[] | null = null;

protected override onCacheInvalidate(): void {
  this.cachedIterations = null;
}
```

Update `fetchIterations()` (lines 282-288):
```typescript
private fetchIterations(): GlIteration[] {
  if (this.cachedIterations) return this.cachedIterations;
  const encodedGroup = encodeURIComponent(this.group);
  this.cachedIterations = glab<GlIteration[]>(
    ['api', `groups/${encodedGroup}/iterations`, '--paginate'],
    this.cwd,
  );
  return this.cachedIterations;
}
```

**Step 3: Keep getChildren override (it uses GitLab-specific epic API)**

GitLab's `getChildren` (lines 235-248) uses a specific API endpoint for epic children — don't remove it. The `getDependents` override (returns `[]`) can be removed since the base implementation filtering by `dependsOn.includes(id)` will also return `[]` for GitLab items (which never have dependsOn set).

**Step 4: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/gitlab/index.ts
git commit -m "perf: add cache TTL and iteration memoization to GitLabBackend"
```

---

### Task 6: Update ADO Backend

**Files:**
- Modify: `src/backends/ado/index.ts`

**Step 1: Add TTL to constructor**

Change `super()` (line 36) to `super(60_000)`.

**Step 2: Deduplicate updateWorkItem fetches (lines 358-485)**

Refactor to fetch the current item once and reuse:

```typescript
// Before handling parent and deps, fetch once with relations
if (data.parent !== undefined || data.dependsOn !== undefined) {
  const current = await az<AdoWorkItem>(
    [
      'boards',
      'work-item',
      'show',
      '--id',
      id,
      '--expand',
      'relations',
      '--org',
      `https://dev.azure.com/${this.org}`,
    ],
    this.cwd,
  );

  if (data.parent !== undefined) {
    const currentParent = extractParent(current.relations);
    // ... same logic using currentParent ...
  }

  if (data.dependsOn !== undefined) {
    const currentDeps = new Set(extractPredecessors(current.relations));
    // ... same logic using currentDeps ...
  }
}

return this.getWorkItem(id);
```

This eliminates the second `az boards work-item show` call (was at line 419-432).

**Step 3: Keep getChildren/getDependents overrides**

ADO uses WIQL queries for relationship lookups (lines 545-597) which are more efficient than fetching all items. Keep these overrides.

**Step 4: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/ado/index.ts
git commit -m "perf: add cache TTL and deduplicate updateWorkItem in AzureDevOpsBackend"
```

---

### Task 7: Update Jira Backend

**Files:**
- Modify: `src/backends/jira/index.ts`

**Step 1: Add TTL to constructor**

Change `super()` (line 31) to `super(60_000)`.

**Step 2: Add sprint memoization**

Add a private field and override `onCacheInvalidate`:

```typescript
private cachedSprints: JiraSprint[] | null = null;

protected override onCacheInvalidate(): void {
  this.cachedSprints = null;
}
```

Update `fetchSprints()` (lines 398-411):
```typescript
private fetchSprints(): JiraSprint[] {
  if (this.cachedSprints) return this.cachedSprints;
  this.cachedSprints = acli<JiraSprint[]>(
    [
      'jira',
      'board',
      'list-sprints',
      '--id',
      String(this.config.boardId),
      '--paginate',
      '--json',
    ],
    this.cwd,
  );
  return this.cachedSprints;
}
```

**Step 3: Keep getChildren/getDependents overrides**

Jira uses JQL queries for relationship lookups (lines 352-387) which are more efficient than fetching all items. Keep these overrides.

**Step 4: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 5: Commit**

```bash
git add src/backends/jira/index.ts
git commit -m "perf: add cache TTL and sprint memoization to JiraBackend"
```

---

### Task 8: Update Callers to Use Cached Mutation Methods

**Files:**
- Modify: `src/components/WorkItemList.tsx` (mutation calls)
- Modify: `src/components/WorkItemForm.tsx` (mutation calls)
- Modify: `src/cli/index.ts` (mutation calls)
- Modify: `src/cli/mcp.ts` or wherever MCP handlers live (mutation calls)

**Step 1: Search for all mutation call sites**

Run: `grep -rn 'backend\.\(createWorkItem\|updateWorkItem\|deleteWorkItem\)' src/`

For each call site, decide:
- TUI components and hooks should use `cachedCreateWorkItem`, `cachedUpdateWorkItem`, `cachedDeleteWorkItem`
- CLI commands that exit after one operation don't benefit from caching — but using the cached versions is harmless and keeps things consistent

Replace all `backend.createWorkItem(` with `backend.cachedCreateWorkItem(`, etc.

Note: The `Backend` interface needs to be extended with the cached methods, OR the cached methods need to be on `BaseBackend` only and callers that hold a `Backend` reference need to be updated. The simplest approach: add the cached methods to the `Backend` interface, with the `BaseBackend` providing the implementation.

**Step 2: Update Backend interface**

Add to `src/backends/types.ts` interface `Backend` (after line 37):
```typescript
cachedCreateWorkItem(data: NewWorkItem): Promise<WorkItem>;
cachedUpdateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem>;
cachedDeleteWorkItem(id: string): Promise<void>;
```

**Step 3: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 4: Run lint**

Run: `npm run lint`
Expected: No errors

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: update all mutation callers to use cached methods"
```

---

### Task 9: Search Overlay — Reuse Loaded Items

**Files:**
- Modify: `src/components/WorkItemList.tsx:37-38,141-150,335-342`

**Step 1: Remove allSearchItems state and fetch effect**

Remove lines 38 (`allSearchItems` state) and 141-150 (the `useEffect` that fetches items when `isSearching` is true).

**Step 2: Pass allItems directly to SearchOverlay**

The `allItems` from `useBackendData` (line 48) are iteration-filtered. For search, we want ALL items (across iterations). We need to fetch all items separately — but we can use the cached version.

Actually, looking at the current code: `useBackendData` loads items for the current iteration (`backend.listWorkItems(iter)` at line 50 of useBackendData.ts). The search overlay wants ALL items without iteration filter. With the cache, `backend.listWorkItems()` (no arg) is a separate cache key from `backend.listWorkItems('sprint-1')`.

Better approach: add an `allItems` state to `useBackendData` that loads items without iteration filter in parallel. This way the data is always available.

OR: simpler — when search opens, call `backend.getCachedItems()` which may cache-hit if all items were already loaded. But `getCachedItems` is protected.

Simplest approach: keep the fetch on search open, but it will now hit the cache if items are already loaded (since `listWorkItems()` without iteration is cached). The `useEffect` stays but becomes near-instant after first load.

Actually the simplest fix: just keep the `useEffect` as-is. The caching layer in Task 1-2 ensures `backend.listWorkItems()` returns cached results. No code change needed here beyond the caching work already done.

**Decision: skip this task.** The caching layer makes the search overlay's fetch effectively free after the first load. No UI code changes needed.

**Step 3: Run the full test suite to verify no regression**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

---

### Task 10: Immediate TUI Rendering

**Files:**
- Modify: `src/index.tsx:7-23`

**Step 1: Refactor startup sequence**

Replace lines 9-22:

```typescript
} else {
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  if (syncManager) {
    syncManager.sync().catch(() => {});
  }

  render(<App backend={backend} syncManager={syncManager} />);
}
```

Changes:
- Remove `await backend.listWorkItems()` check (line 13)
- Remove the blocking `await syncManager.sync()` path (lines 14-16)
- Always fire sync in background (line 18 already does this for non-empty case)
- Render immediately after backend creation

The `useBackendData` hook handles loading state with a "Loading..." indicator (WorkItemList.tsx:325-331).

**Step 2: Run the app to verify startup**

Run: `npm run build && npm start`
Expected: TUI frame appears immediately, items load shortly after. No blank terminal wait.

**Step 3: Run the full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: All tests PASS

**Step 4: Commit**

```bash
git add src/index.tsx
git commit -m "perf: render TUI immediately, sync in background"
```

---

### Task 11: Build and Lint Check

**Step 1: Run TypeScript compiler**

Run: `npm run build`
Expected: No errors

**Step 2: Run linter**

Run: `npm run lint`
Expected: No errors

**Step 3: Run formatter**

Run: `npm run format:check`
Expected: All files formatted

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests PASS

**Step 5: Fix any issues found**

If any step fails, fix the issue and re-run.

**Step 6: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: address build/lint issues from performance improvements"
```
