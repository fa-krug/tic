# Parent-Child & Dependency Relationships Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add hierarchical parent-child relationships and dependency tracking to work items, with circular reference validation and reference cleanup on delete.

**Architecture:** Two new optional fields (`parent`, `dependsOn`) on `WorkItem`. Stored as `parent` and `depends_on` in YAML frontmatter. Validation at write time prevents cycles and dangling references. Delete cascades cleanup. Two new backend methods (`getChildren`, `getDependents`) for querying relationships. UI shows tree-indented list with dependency warnings.

**Tech Stack:** TypeScript, Vitest, Ink/React (terminal UI), gray-matter (YAML frontmatter)

---

### Task 1: Add parent and dependsOn to WorkItem type

**Files:**
- Modify: `src/types.ts:7-20`

**Step 1: Update the WorkItem interface**

Add two new fields to the `WorkItem` interface:

```typescript
export interface WorkItem {
  id: number;
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
  parent: number | null;
  dependsOn: number[];
}
```

**Step 2: Update NewWorkItem type**

Add `parent` and `dependsOn` to the `NewWorkItem` Pick type:

```typescript
export type NewWorkItem = Pick<
  WorkItem,
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'parent'
  | 'dependsOn'
>;
```

**Step 3: Run type check to see what breaks**

Run: `npx tsc --noEmit`
Expected: Type errors in tests and backend code where `WorkItem` and `NewWorkItem` objects are constructed without the new fields. This is expected — we'll fix these in subsequent tasks.

**Step 4: Commit**

```bash
git add src/types.ts
git commit -m "feat: add parent and dependsOn fields to WorkItem type"
```

---

### Task 2: Update items.ts to read/write new fields

**Files:**
- Modify: `src/backends/local/items.ts:75-116`
- Test: `src/backends/local/items.test.ts`

**Step 1: Write failing tests for new fields**

Add these tests to `src/backends/local/items.test.ts` inside the existing `describe('items', ...)` block:

```typescript
it('writes and reads a work item with parent and dependsOn', () => {
  const item: WorkItem = {
    id: 1,
    title: 'Child item',
    type: 'task',
    status: 'todo',
    iteration: 'v1',
    priority: 'high',
    assignee: 'dev',
    labels: [],
    created: '2026-01-31T00:00:00Z',
    updated: '2026-01-31T00:00:00Z',
    description: 'A child.',
    comments: [],
    parent: 5,
    dependsOn: [3, 4],
  };
  writeWorkItem(tmpDir, item);
  const read = readWorkItem(tmpDir, 1);
  expect(read.parent).toBe(5);
  expect(read.dependsOn).toEqual([3, 4]);
});

it('reads items without parent/dependsOn as defaults', () => {
  const item: WorkItem = {
    id: 2,
    title: 'Legacy item',
    type: 'issue',
    status: 'todo',
    iteration: 'v1',
    priority: 'low',
    assignee: '',
    labels: [],
    created: '2026-01-31T00:00:00Z',
    updated: '2026-01-31T00:00:00Z',
    description: '',
    comments: [],
    parent: null,
    dependsOn: [],
  };
  writeWorkItem(tmpDir, item);
  const read = readWorkItem(tmpDir, 2);
  expect(read.parent).toBeNull();
  expect(read.dependsOn).toEqual([]);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/items.test.ts`
Expected: FAIL — existing tests may also fail due to missing `parent`/`dependsOn` in test fixtures. The new tests will fail because `parseWorkItemFile` doesn't read these fields yet.

**Step 3: Update parseWorkItemFile to read new fields**

In `src/backends/local/items.ts`, update the `parseWorkItemFile` function (line 75-94). Add these two lines to the returned object:

```typescript
parent: (data['parent'] as number) ?? null,
dependsOn: (data['depends_on'] as number[]) ?? [],
```

The full return becomes:

```typescript
return {
  id: data['id'] as number,
  title: data['title'] as string,
  type: (data['type'] as string) || 'issue',
  status: data['status'] as string,
  iteration: data['iteration'] as string,
  priority: data['priority'] as WorkItem['priority'],
  assignee: (data['assignee'] as string) || '',
  labels: (data['labels'] as string[]) || [],
  created: data['created'] as string,
  updated: data['updated'] as string,
  parent: (data['parent'] as number) ?? null,
  dependsOn: (data['depends_on'] as number[]) ?? [],
  description,
  comments,
};
```

**Step 4: Update writeWorkItem to write new fields**

In `src/backends/local/items.ts`, update the `writeWorkItem` function (line 96-116). Update the frontmatter object to conditionally include the new fields:

```typescript
const frontmatter: Record<string, unknown> = {
  id: item.id,
  title: item.title,
  type: item.type,
  status: item.status,
  iteration: item.iteration,
  priority: item.priority,
  assignee: item.assignee,
  labels: item.labels,
  created: item.created,
  updated: item.updated,
};

if (item.parent !== null) {
  frontmatter['parent'] = item.parent;
}

if (item.dependsOn.length > 0) {
  frontmatter['depends_on'] = item.dependsOn;
}
```

**Step 5: Fix existing test fixtures**

Add `parent: null, dependsOn: []` to every `WorkItem` literal in `items.test.ts`. There are 4 existing test fixtures to update (the items in 'writes and reads a work item', 'writes and reads a work item with comments', 'deletes a work item file', and 'lists all item files').

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/items.test.ts`
Expected: ALL PASS (6 tests — 4 existing + 2 new)

**Step 7: Commit**

```bash
git add src/backends/local/items.ts src/backends/local/items.test.ts
git commit -m "feat: read/write parent and depends_on in work item files"
```

---

### Task 3: Add getChildren and getDependents to Backend interface

**Files:**
- Modify: `src/backends/types.ts:3-15`

**Step 1: Add two new methods to Backend interface**

```typescript
export interface Backend {
  getStatuses(): string[];
  getIterations(): string[];
  getWorkItemTypes(): string[];
  getCurrentIteration(): string;
  setCurrentIteration(name: string): void;
  listWorkItems(iteration?: string): WorkItem[];
  getWorkItem(id: number): WorkItem;
  createWorkItem(data: NewWorkItem): WorkItem;
  updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem;
  deleteWorkItem(id: number): void;
  addComment(workItemId: number, comment: NewComment): Comment;
  getChildren(id: number): WorkItem[];
  getDependents(id: number): WorkItem[];
}
```

**Step 2: Run type check to see what breaks**

Run: `npx tsc --noEmit`
Expected: Type error in `LocalBackend` — it doesn't implement the new methods yet. This is expected.

**Step 3: Commit**

```bash
git add src/backends/types.ts
git commit -m "feat: add getChildren and getDependents to Backend interface"
```

---

### Task 4: Implement getChildren, getDependents, and validation in LocalBackend

**Files:**
- Modify: `src/backends/local/index.ts`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write failing tests for getChildren and getDependents**

Add these tests to `src/backends/local/index.test.ts` inside the existing `describe('LocalBackend', ...)` block:

```typescript
it('returns children of a work item', () => {
  const parent = backend.createWorkItem({
    title: 'Parent',
    type: 'epic',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'Child 1',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: parent.id,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'Child 2',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: parent.id,
    dependsOn: [],
  });
  const children = backend.getChildren(parent.id);
  expect(children).toHaveLength(2);
  expect(children.map((c) => c.title)).toEqual(
    expect.arrayContaining(['Child 1', 'Child 2']),
  );
});

it('returns empty array when item has no children', () => {
  const item = backend.createWorkItem({
    title: 'Lonely',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  expect(backend.getChildren(item.id)).toEqual([]);
});

it('returns dependents of a work item', () => {
  const dep = backend.createWorkItem({
    title: 'Dependency',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'Dependent',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [dep.id],
  });
  const dependents = backend.getDependents(dep.id);
  expect(dependents).toHaveLength(1);
  expect(dependents[0]!.title).toBe('Dependent');
});

it('returns empty array when item has no dependents', () => {
  const item = backend.createWorkItem({
    title: 'Independent',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  expect(backend.getDependents(item.id)).toEqual([]);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `getChildren` and `getDependents` don't exist on `LocalBackend` yet. Existing tests may also fail due to missing `parent`/`dependsOn` in test fixtures.

**Step 3: Fix existing test fixtures**

Add `parent: null, dependsOn: []` to every `NewWorkItem` / `createWorkItem` call in `index.test.ts`. There are existing tests that create work items: 'creates and lists work items', 'filters work items by iteration' (2 items), 'updates a work item', 'deletes a work item', 'adds a comment', so 6 fixtures total.

**Step 4: Update LocalBackend.createWorkItem to include new fields**

In `src/backends/local/index.ts`, update `createWorkItem` (line 69-85) to spread the new fields:

```typescript
createWorkItem(data: NewWorkItem): WorkItem {
  const now = new Date().toISOString();
  const item: WorkItem = {
    ...data,
    id: this.config.next_id,
    created: now,
    updated: now,
    comments: [],
  };
  this.config.next_id++;
  if (data.iteration && !this.config.iterations.includes(data.iteration)) {
    this.config.iterations.push(data.iteration);
  }
  this.save();
  writeWorkItem(this.root, item);
  return item;
}
```

Note: Since `NewWorkItem` now includes `parent` and `dependsOn`, the spread `...data` already carries them through. No change to the method body is needed — just verify `NewWorkItem` includes the fields (done in Task 1).

**Step 5: Implement getChildren and getDependents**

Add these two methods to the `LocalBackend` class in `src/backends/local/index.ts`, after the `addComment` method (after line 114):

```typescript
getChildren(id: number): WorkItem[] {
  const all = this.listWorkItems();
  return all.filter((item) => item.parent === id);
}

getDependents(id: number): WorkItem[] {
  const all = this.listWorkItems();
  return all.filter((item) => item.dependsOn.includes(id));
}
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: ALL PASS (12 tests — 8 existing + 4 new)

**Step 7: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat: implement getChildren and getDependents in LocalBackend"
```

---

### Task 5: Add validation for circular references and self-reference

**Files:**
- Modify: `src/backends/local/index.ts`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write failing tests for validation**

Add these tests to `src/backends/local/index.test.ts`:

```typescript
it('rejects self-reference as parent', () => {
  const item = backend.createWorkItem({
    title: 'Self',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  expect(() => backend.updateWorkItem(item.id, { parent: item.id })).toThrow();
});

it('rejects self-reference in dependsOn', () => {
  const item = backend.createWorkItem({
    title: 'Self',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  expect(() =>
    backend.updateWorkItem(item.id, { dependsOn: [item.id] }),
  ).toThrow();
});

it('rejects circular parent chain', () => {
  const a = backend.createWorkItem({
    title: 'A',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  backend.createWorkItem({
    title: 'B',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: a.id,
    dependsOn: [],
  });
  // A's grandchild
  const c = backend.createWorkItem({
    title: 'C',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: 2,
    dependsOn: [],
  });
  // Try to make A a child of C — creates cycle A -> B -> C -> A
  expect(() => backend.updateWorkItem(a.id, { parent: c.id })).toThrow();
});

it('rejects circular dependency chain', () => {
  const a = backend.createWorkItem({
    title: 'A',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  const b = backend.createWorkItem({
    title: 'B',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [a.id],
  });
  // Try to make A depend on B — creates cycle A -> B -> A
  expect(() =>
    backend.updateWorkItem(a.id, { dependsOn: [b.id] }),
  ).toThrow();
});

it('rejects reference to non-existent parent', () => {
  expect(() =>
    backend.createWorkItem({
      title: 'Orphan',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: 999,
      dependsOn: [],
    }),
  ).toThrow();
});

it('rejects reference to non-existent dependency', () => {
  expect(() =>
    backend.createWorkItem({
      title: 'Bad dep',
      type: 'task',
      status: 'todo',
      iteration: 'default',
      priority: 'low',
      assignee: '',
      labels: [],
      description: '',
      parent: null,
      dependsOn: [999],
    }),
  ).toThrow();
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — no validation exists yet, so the create/update calls won't throw.

**Step 3: Implement validation in LocalBackend**

Add a private `validateRelationships` method to `LocalBackend` in `src/backends/local/index.ts`:

```typescript
private validateRelationships(
  id: number,
  parent: number | null | undefined,
  dependsOn: number[] | undefined,
): void {
  const all = this.listWorkItems();
  const allIds = new Set(all.map((item) => item.id));

  // Validate parent
  if (parent !== null && parent !== undefined) {
    if (parent === id) {
      throw new Error(`Work item #${id} cannot be its own parent`);
    }
    if (!allIds.has(parent)) {
      throw new Error(`Parent #${parent} does not exist`);
    }
    // Check for circular parent chain: walk up from proposed parent
    let current: number | null = parent;
    const visited = new Set<number>();
    while (current !== null) {
      if (current === id) {
        throw new Error(`Circular parent chain detected for #${id}`);
      }
      if (visited.has(current)) break;
      visited.add(current);
      const parentItem = all.find((item) => item.id === current);
      current = parentItem?.parent ?? null;
    }
  }

  // Validate dependsOn
  if (dependsOn !== undefined) {
    for (const depId of dependsOn) {
      if (depId === id) {
        throw new Error(`Work item #${id} cannot depend on itself`);
      }
      if (!allIds.has(depId)) {
        throw new Error(`Dependency #${depId} does not exist`);
      }
    }
    // Check for circular dependency chain: DFS from each dependency
    const hasCycle = (startId: number, targetId: number): boolean => {
      const visited = new Set<number>();
      const stack = [startId];
      while (stack.length > 0) {
        const current = stack.pop()!;
        if (current === targetId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        const item = all.find((i) => i.id === current);
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

**Step 4: Call validation from createWorkItem and updateWorkItem**

In `createWorkItem`, add validation before writing. The item doesn't have an ID yet from the perspective of existing items, so pass the about-to-be-assigned ID:

```typescript
createWorkItem(data: NewWorkItem): WorkItem {
  const now = new Date().toISOString();
  const id = this.config.next_id;
  this.validateRelationships(id, data.parent, data.dependsOn);
  const item: WorkItem = {
    ...data,
    id,
    created: now,
    updated: now,
    comments: [],
  };
  this.config.next_id++;
  if (data.iteration && !this.config.iterations.includes(data.iteration)) {
    this.config.iterations.push(data.iteration);
  }
  this.save();
  writeWorkItem(this.root, item);
  return item;
}
```

In `updateWorkItem`, add validation before writing:

```typescript
updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem {
  const item = this.getWorkItem(id);
  this.validateRelationships(id, data.parent, data.dependsOn);
  const updated = {
    ...item,
    ...data,
    id,
    updated: new Date().toISOString(),
  };
  writeWorkItem(this.root, updated);
  return updated;
}
```

**Step 5: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: ALL PASS (18 tests — 12 previous + 6 new)

**Step 6: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat: add validation for circular references and referential integrity"
```

---

### Task 6: Add reference cleanup on delete

**Files:**
- Modify: `src/backends/local/index.ts:99-101`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write failing tests for cleanup on delete**

Add these tests to `src/backends/local/index.test.ts`:

```typescript
it('clears parent reference when parent is deleted', () => {
  const parent = backend.createWorkItem({
    title: 'Parent',
    type: 'epic',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  const child = backend.createWorkItem({
    title: 'Child',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: parent.id,
    dependsOn: [],
  });
  backend.deleteWorkItem(parent.id);
  const updated = backend.getWorkItem(child.id);
  expect(updated.parent).toBeNull();
});

it('removes deleted item from dependsOn lists', () => {
  const dep = backend.createWorkItem({
    title: 'Dependency',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  const other = backend.createWorkItem({
    title: 'Other dep',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'medium',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [],
  });
  const dependent = backend.createWorkItem({
    title: 'Dependent',
    type: 'task',
    status: 'todo',
    iteration: 'default',
    priority: 'low',
    assignee: '',
    labels: [],
    description: '',
    parent: null,
    dependsOn: [dep.id, other.id],
  });
  backend.deleteWorkItem(dep.id);
  const updated = backend.getWorkItem(dependent.id);
  expect(updated.dependsOn).toEqual([other.id]);
});
```

**Step 2: Run tests to verify they fail**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `deleteWorkItem` doesn't clean up references yet.

**Step 3: Update deleteWorkItem to clean up references**

Replace the `deleteWorkItem` method in `src/backends/local/index.ts`:

```typescript
deleteWorkItem(id: number): void {
  removeWorkItemFile(this.root, id);
  // Clean up references in other items
  const all = this.listWorkItems();
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
      writeWorkItem(this.root, item);
    }
  }
}
```

Note: Add `writeWorkItem` to the import from `./items.js` if not already imported. Looking at the existing imports on line 11, `writeWorkItem` is already imported.

**Step 4: Run tests to verify they pass**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: ALL PASS (20 tests — 18 previous + 2 new)

**Step 5: Run all tests to confirm nothing is broken**

Run: `npx vitest run --exclude 'dist/**'`
Expected: ALL PASS. Note: `config.test.ts` tests don't create `WorkItem` objects so they should be unaffected.

**Step 6: Commit**

```bash
git add src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat: clean up parent and dependsOn references on work item delete"
```

---

### Task 7: Update WorkItemList for tree view and dependency indicators

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Build tree structure from flat item list**

Add a helper function and update the component to render items as a tree. Add this function above the `WorkItemList` component in `src/components/WorkItemList.tsx`:

```typescript
interface TreeItem {
  item: WorkItem;
  depth: number;
  isLast: boolean;
  prefix: string;
}

function buildTree(items: WorkItem[]): TreeItem[] {
  const itemMap = new Map(items.map((i) => [i.id, i]));
  const childrenMap = new Map<number | null, WorkItem[]>();

  for (const item of items) {
    const parentId = item.parent !== null && itemMap.has(item.parent) ? item.parent : null;
    if (!childrenMap.has(parentId)) childrenMap.set(parentId, []);
    childrenMap.get(parentId)!.push(item);
  }

  const result: TreeItem[] = [];

  function walk(parentId: number | null, depth: number, parentPrefix: string) {
    const children = childrenMap.get(parentId) ?? [];
    children.forEach((child, idx) => {
      const isLast = idx === children.length - 1;
      let prefix = '';
      if (depth > 0) {
        prefix = parentPrefix + (isLast ? '└─' : '├─');
      }
      result.push({ item: child, depth, isLast, prefix });
      const nextParentPrefix = depth > 0
        ? parentPrefix + (isLast ? '  ' : '│ ')
        : '';
      walk(child.id, depth + 1, nextParentPrefix);
    });
  }

  walk(null, 0, '');
  return result;
}
```

Add the `WorkItem` import at the top:

```typescript
import type { WorkItem } from '../types.js';
```

**Step 2: Update list rendering to use tree structure**

Replace the items mapping and rendering. Instead of iterating over `items` directly, build the tree:

```typescript
const treeItems = useMemo(() => buildTree(items), [items]);
```

Update `items.length` references to `treeItems.length` in cursor bounds, empty check, and keyboard handlers. In the `useInput` callback, use `treeItems[cursor]!.item` instead of `items[cursor]!` for item access.

Update the render loop:

```typescript
{treeItems.map((treeItem, idx) => {
  const { item, prefix } = treeItem;
  const selected = idx === cursor;
  const hasUnresolvedDeps = item.dependsOn.length > 0;
  return (
    <Box key={item.id}>
      <Box width={2}>
        <Text color="cyan">{selected ? '>' : ' '}</Text>
      </Box>
      <Box width={colId}>
        <Text color={selected ? 'cyan' : undefined}>{item.id}</Text>
      </Box>
      <Box flexGrow={1}>
        <Text color={selected ? 'cyan' : undefined} bold={selected}>
          {prefix}{item.title}
        </Text>
      </Box>
      <Box width={colStatus}>
        <Text color={selected ? 'cyan' : undefined}>
          {hasUnresolvedDeps ? '⧗ ' : ''}{item.status}
        </Text>
      </Box>
      <Box width={colPriority}>
        <Text color={selected ? 'cyan' : undefined}>{item.priority}</Text>
      </Box>
      <Box width={colAssignee}>
        <Text color={selected ? 'cyan' : undefined}>{item.assignee}</Text>
      </Box>
    </Box>
  );
})}
```

**Step 3: Add status warning when cycling to done**

Update the `s` keybinding handler to show a warning. Add a `warning` state:

```typescript
const [warning, setWarning] = useState('');
```

Update the `s` handler:

```typescript
if (input === 's' && treeItems.length > 0) {
  const item = treeItems[cursor]!.item;
  const idx = statuses.indexOf(item.status);
  const nextStatus = statuses[(idx + 1) % statuses.length]!;
  backend.updateWorkItem(item.id, { status: nextStatus });

  // Show warning if cycling to final status with open children or deps
  if (nextStatus === statuses[statuses.length - 1]) {
    const children = backend.getChildren(item.id);
    const openChildren = children.filter(
      (c) => c.status !== statuses[statuses.length - 1],
    );
    const unresolvedDeps = item.dependsOn
      .map((depId) => {
        try { return backend.getWorkItem(depId); } catch { return null; }
      })
      .filter((d) => d !== null && d.status !== statuses[statuses.length - 1]);

    const warnings: string[] = [];
    if (openChildren.length > 0)
      warnings.push(`${openChildren.length} children still open`);
    if (unresolvedDeps.length > 0)
      warnings.push(
        unresolvedDeps.map((d) => `Depends on #${d.id} (${d.status})`).join(', '),
      );
    if (warnings.length > 0) setWarning(warnings.join(' | '));
  } else {
    setWarning('');
  }

  setRefresh((r) => r + 1);
}
```

Show the warning in the footer area, clearing it on any other keypress. Add after the help text box:

```typescript
{warning && (
  <Box>
    <Text color="yellow">⚠ {warning}</Text>
  </Box>
)}
```

Clear warning on navigation:

```typescript
if (key.upArrow || key.downArrow || key.tab) setWarning('');
```

**Step 4: Add `p` keybinding for setting parent**

This is a UI-heavy feature. For now, add a simple prompt approach: pressing `p` enters a "set parent" mode where the user types an ID and presses Enter. Add state:

```typescript
const [settingParent, setSettingParent] = useState(false);
const [parentInput, setParentInput] = useState('');
```

Add the handler in `useInput`:

```typescript
if (input === 'p' && treeItems.length > 0 && !settingParent) {
  setSettingParent(true);
  const currentParent = treeItems[cursor]!.item.parent;
  setParentInput(currentParent !== null ? String(currentParent) : '');
}
```

Add an early return at the top of `useInput` for the settingParent mode (before the confirmDelete check):

```typescript
if (settingParent) {
  if (key.escape) {
    setSettingParent(false);
    return;
  }
  // Enter is handled by TextInput onSubmit
  return;
}
```

Render the parent input in the footer when active:

```typescript
{settingParent ? (
  <Box>
    <Text color="cyan">Set parent ID (empty to clear): </Text>
    <TextInput
      value={parentInput}
      onChange={setParentInput}
      focus={true}
      onSubmit={(value) => {
        const item = treeItems[cursor]!.item;
        const newParent = value.trim() === '' ? null : parseInt(value.trim(), 10);
        try {
          backend.updateWorkItem(item.id, { parent: newParent });
          setWarning('');
        } catch (e) {
          setWarning(e instanceof Error ? e.message : 'Invalid parent');
        }
        setSettingParent(false);
        setParentInput('');
        setRefresh((r) => r + 1);
      }}
    />
  </Box>
) : confirmDelete ? (
  ...existing delete confirm...
) : (
  ...existing help text... (add p: set parent to the help text)
)}
```

Add `TextInput` import:

```typescript
import TextInput from 'ink-text-input';
```

Update the help text to include the new keybinding:

```
up/down: navigate enter: open c: create d: delete s: cycle status p: set parent tab: type i: iteration q: quit
```

**Step 5: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS — no type errors.

**Step 6: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: add tree view, dependency indicators, and parent keybinding to WorkItemList"
```

---

### Task 8: Update WorkItemForm with parent and dependencies fields

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Add parent and dependsOn to the form fields**

Add `'parent'` and `'dependsOn'` to the `FieldName` type and `FIELDS` array. Insert them after `'description'` and before `'comments'`:

```typescript
type FieldName =
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'parent'
  | 'dependsOn'
  | 'comments';

const FIELDS: FieldName[] = [
  'title',
  'type',
  'status',
  'iteration',
  'priority',
  'assignee',
  'labels',
  'description',
  'parent',
  'dependsOn',
  'comments',
];
```

**Step 2: Add state for parent and dependsOn**

```typescript
const [parentId, setParentId] = useState(
  existingItem?.parent !== null && existingItem?.parent !== undefined
    ? String(existingItem.parent)
    : '',
);
const [dependsOn, setDependsOn] = useState(
  existingItem?.dependsOn?.join(', ') ?? '',
);
```

**Step 3: Update save function to include new fields**

In the `save()` function, parse the new fields and include them in both the create and update paths.

Add parsing before the if/else:

```typescript
const parsedParent = parentId.trim() === '' ? null : parseInt(parentId.trim(), 10);
const parsedDependsOn = dependsOn
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0)
  .map((s) => parseInt(s, 10));
```

In the `updateWorkItem` call, add:

```typescript
backend.updateWorkItem(selectedWorkItemId, {
  title,
  type,
  status,
  iteration,
  priority: priority,
  assignee,
  labels: parsedLabels,
  description,
  parent: parsedParent,
  dependsOn: parsedDependsOn,
});
```

In the `createWorkItem` call, add:

```typescript
const created = backend.createWorkItem({
  title: title || 'Untitled',
  type,
  status,
  iteration,
  priority: priority,
  assignee,
  labels: parsedLabels,
  description,
  parent: parsedParent,
  dependsOn: parsedDependsOn,
});
```

**Step 4: Add rendering for parent and dependsOn fields in renderField**

Add handling for `parent` and `dependsOn` in the `renderField` function. These are text fields (user types an ID or comma-separated IDs). Add before the existing text field handling (the section starting with `// Text fields: title, assignee, labels, description`):

Update the text value/setter mappings to include `parent` and `dependsOn`:

```typescript
const textValue =
  field === 'title'
    ? title
    : field === 'assignee'
      ? assignee
      : field === 'labels'
        ? labels
        : field === 'parent'
          ? parentId
          : field === 'dependsOn'
            ? dependsOn
            : description;

const textSetter =
  field === 'title'
    ? setTitle
    : field === 'assignee'
      ? setAssignee
      : field === 'labels'
        ? setLabels
        : field === 'parent'
          ? setParentId
          : field === 'dependsOn'
            ? setDependsOn
            : setDescription;
```

**Step 5: Add read-only relationship info section**

After the `FIELDS.map` rendering, add a read-only section showing children and dependents. This only shows when editing an existing item:

```typescript
{selectedWorkItemId !== null && (
  <Box flexDirection="column" marginTop={1}>
    <Text bold dimColor>Relationships:</Text>
    <Box marginLeft={2}>
      <Text dimColor>
        Children: {backend.getChildren(selectedWorkItemId).map(
          (c) => `#${c.id} (${c.title})`
        ).join(', ') || 'none'}
      </Text>
    </Box>
    <Box marginLeft={2}>
      <Text dimColor>
        Depended on by: {backend.getDependents(selectedWorkItemId).map(
          (d) => `#${d.id} (${d.title})`
        ).join(', ') || 'none'}
      </Text>
    </Box>
  </Box>
)}
```

**Step 6: Run build to verify no type errors**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: add parent and dependencies fields to WorkItemForm"
```

---

### Task 9: Update CLAUDE.md documentation

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Update the documentation**

Add `parent` and `dependsOn` to the WorkItem description in the Architecture section. Update the keybindings list to include `p` for set parent. Mention the new backend methods `getChildren` and `getDependents`.

Under the `WorkItemList` component description, add:
- `p` set parent — to the keybindings list

Under the Backend Abstraction section, note that the Backend interface includes `getChildren(id)` and `getDependents(id)` methods.

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: update CLAUDE.md for parent-child and dependency relationships"
```

---

### Task 10: Final verification

**Step 1: Run full test suite**

Run: `npx vitest run --exclude 'dist/**'`
Expected: ALL PASS (all tests green)

**Step 2: Run linter**

Run: `npm run lint`
Expected: PASS — no lint errors

**Step 3: Run format check**

Run: `npm run format:check`
Expected: PASS — or run `npm run format` first if needed

**Step 4: Run build**

Run: `npm run build`
Expected: PASS — clean TypeScript compilation

**Step 5: Manual smoke test**

Run: `npm start`
- Create a parent epic
- Create a child task with the parent set
- Verify tree indentation in the list
- Press `p` on an item to change its parent
- Cycle status to done on a parent with open children — verify warning appears
- Delete the parent — verify child's parent is cleared

**Step 6: Commit any remaining changes (formatting, etc.)**

```bash
git add -A
git commit -m "chore: final cleanup for parent-child and dependency feature"
```
