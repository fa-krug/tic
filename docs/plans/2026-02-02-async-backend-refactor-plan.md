# Async Backend Interface Refactor — Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Convert the synchronous `Backend` interface to async (`Promise`-based), so all file I/O and subprocess calls are non-blocking and the Ink TUI stays responsive during navigation.

**Architecture:** The `Backend` interface methods become `async` (returning `Promise<T>`). A shared `useBackendData()` React hook manages async state for TUI components, providing `{ data, loading, error, refresh }`. CLI and MCP handlers simply `await` each call. The `SyncQueueStore` is also converted to async. All four backends (Local, GitHub, GitLab, ADO) and all consumers are updated.

**Tech Stack:** TypeScript 5.9, React 19, Ink 6, Vitest 4, `fs/promises` for async I/O, `child_process.execFile` (callback-based wrapped in Promise) for subprocess calls.

---

## Task 1: Convert Backend Interface to Async

**Files:**
- Modify: `src/backends/types.ts`

**Step 1: Update the `Backend` interface**

Change every method signature to return a `Promise`. Methods that returned `void` return `Promise<void>`, etc.

```typescript
export interface Backend {
  getCapabilities(): BackendCapabilities; // stays sync — pure data, no I/O
  getStatuses(): Promise<string[]>;
  getIterations(): Promise<string[]>;
  getWorkItemTypes(): Promise<string[]>;
  getAssignees(): Promise<string[]>;
  getCurrentIteration(): Promise<string>;
  setCurrentIteration(name: string): Promise<void>;
  listWorkItems(iteration?: string): Promise<WorkItem[]>;
  getWorkItem(id: string): Promise<WorkItem>;
  createWorkItem(data: NewWorkItem): Promise<WorkItem>;
  updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem>;
  deleteWorkItem(id: string): Promise<void>;
  addComment(workItemId: string, comment: NewComment): Promise<Comment>;
  getChildren(id: string): Promise<WorkItem[]>;
  getDependents(id: string): Promise<WorkItem[]>;
  getItemUrl(id: string): string; // stays sync — pure string construction
  openItem(id: string): Promise<void>;
}
```

**Design decisions:**
- `getCapabilities()` stays sync — it returns a hardcoded object with no I/O in every backend.
- `getItemUrl()` stays sync — it's pure string construction.
- Everything else becomes `Promise`-based because all four backends do I/O (file reads, subprocess calls).

**Step 2: Update `BaseBackend` abstract declarations**

Match the abstract method signatures to the new interface. `validateFields` stays sync since it only reads `getCapabilities()` which is sync.

```typescript
export abstract class BaseBackend implements Backend {
  abstract getCapabilities(): BackendCapabilities;
  abstract getStatuses(): Promise<string[]>;
  abstract getIterations(): Promise<string[]>;
  abstract getWorkItemTypes(): Promise<string[]>;
  abstract getAssignees(): Promise<string[]>;
  abstract getCurrentIteration(): Promise<string>;
  abstract setCurrentIteration(name: string): Promise<void>;
  abstract listWorkItems(iteration?: string): Promise<WorkItem[]>;
  abstract getWorkItem(id: string): Promise<WorkItem>;
  abstract createWorkItem(data: NewWorkItem): Promise<WorkItem>;
  abstract updateWorkItem(id: string, data: Partial<WorkItem>): Promise<WorkItem>;
  abstract deleteWorkItem(id: string): Promise<void>;
  abstract addComment(workItemId: string, comment: NewComment): Promise<Comment>;
  abstract getChildren(id: string): Promise<WorkItem[]>;
  abstract getDependents(id: string): Promise<WorkItem[]>;
  abstract getItemUrl(id: string): string;
  abstract openItem(id: string): Promise<void>;

  // validateFields stays sync — only reads getCapabilities() which is sync
  protected validateFields(data: Partial<NewWorkItem>): void { /* unchanged */ }
  protected assertSupported(capability: boolean, operation: string): void { /* unchanged */ }
}
```

**Step 3: Run build to see all compilation errors**

Run: `npm run build 2>&1 | head -100`
Expected: Many type errors across all backends and consumers. This is the roadmap for the remaining tasks.

**Step 4: Commit**

```bash
git add src/backends/types.ts
git commit -m "refactor: make Backend interface async"
```

---

## Task 2: Convert Local Backend File I/O to Async

**Files:**
- Modify: `src/backends/local/items.ts`
- Modify: `src/backends/local/config.ts`

**Step 1: Convert `items.ts` to use `fs/promises`**

Replace all sync fs calls with async equivalents:

```typescript
import fs from 'node:fs/promises';
import fsSync from 'node:fs'; // keep for matter.stringify which needs sync write only if needed
import path from 'node:path';
import matter from 'gray-matter';
import type { WorkItem, Comment } from '../../types.js';

// listItemFiles: readdirSync → readdir
export async function listItemFiles(root: string): Promise<string[]> {
  const dir = itemsDir(root);
  try {
    const files = await fs.readdir(dir);
    return files.filter((f) => f.endsWith('.md')).map((f) => path.join(dir, f));
  } catch {
    return [];
  }
}

// readWorkItem: readFileSync → readFile
export async function readWorkItem(root: string, id: string): Promise<WorkItem> {
  const raw = await fs.readFile(itemPath(root, id), 'utf-8');
  return parseWorkItemFile(raw);
}

// parseWorkItemFile stays sync — it's pure string parsing, no I/O

// writeWorkItem: mkdirSync → mkdir, writeFileSync → writeFile
export async function writeWorkItem(root: string, item: WorkItem): Promise<void> {
  const dir = itemsDir(root);
  await fs.mkdir(dir, { recursive: true });
  const body = item.description + serializeComments(item.comments);
  const content = matter.stringify(body, frontmatter);
  await fs.writeFile(itemPath(root, item.id), content);
}

// deleteWorkItem: existsSync+unlinkSync → unlink with catch
export async function deleteWorkItem(root: string, id: string): Promise<void> {
  try {
    await fs.unlink(itemPath(root, id));
  } catch {
    // already deleted
  }
}
```

**Step 2: Convert `config.ts` to use `fs/promises`**

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import yaml from 'yaml';

export async function readConfig(root: string): Promise<Config> {
  const p = configPath(root);
  try {
    const raw = await fs.readFile(p, 'utf-8');
    return yaml.parse(raw) as Config;
  } catch {
    return { ...defaultConfig };
  }
}

export async function writeConfig(root: string, config: Config): Promise<void> {
  const dir = path.join(root, '.tic');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(configPath(root), yaml.stringify(config));
}
```

**Step 3: Commit**

```bash
git add src/backends/local/items.ts src/backends/local/config.ts
git commit -m "refactor: convert local backend file I/O to async"
```

---

## Task 3: Convert LocalBackend Class to Async

**Files:**
- Modify: `src/backends/local/index.ts`

**Step 1: Make constructor async-compatible**

The constructor currently calls `readConfig(root)` which is now async. Two options:
- Use a static factory method: `static async create(root, options?): Promise<LocalBackend>`
- Cache config on first access

Use static factory:

```typescript
export class LocalBackend extends BaseBackend {
  private root: string;
  private config: Config;
  private tempIds: boolean;

  private constructor(root: string, config: Config, options?: LocalBackendOptions) {
    super();
    this.root = root;
    this.config = config;
    this.tempIds = options?.tempIds ?? false;
  }

  static async create(root: string, options?: LocalBackendOptions): Promise<LocalBackend> {
    const config = await readConfig(root);
    return new LocalBackend(root, config, options);
  }
  // ...
}
```

**Step 2: Convert all methods to async**

Every method that does file I/O becomes `async`. Key changes:

- `listWorkItems`: Use `listItemFiles` + `Promise.all` for parallel reads
- `getWorkItem`: Await `readWorkItem`
- `createWorkItem`: Await `validateRelationships`, `writeWorkItem`, `save`
- `updateWorkItem`: Await `getWorkItem`, `validateRelationships`, `writeWorkItem`
- `deleteWorkItem`: Await `removeWorkItemFile`, `listWorkItems`, `writeWorkItem` loop
- `addComment`: Await `getWorkItem`, `writeWorkItem`
- `getChildren`/`getDependents`: Await `listWorkItems`
- `getAssignees`: Await `listWorkItems`
- `setCurrentIteration`: Await `save`
- `openItem`: Use `execFile` from `child_process` wrapped in a Promise instead of `execSync`
- `validateRelationships`: Make async since it calls `listWorkItems`
- `save`: Make async since it calls `writeConfig`
- `syncConfigFromRemote`: Make async since it calls `save`

For `listWorkItems`, use parallel file reads:

```typescript
async listWorkItems(iteration?: string): Promise<WorkItem[]> {
  const files = await listItemFiles(this.root);
  const items = await Promise.all(
    files.map(async (f) => {
      const raw = await fs.readFile(f, 'utf-8');
      return parseWorkItemFile(raw);
    }),
  );
  if (iteration) return items.filter((i) => i.iteration === iteration);
  return items;
}
```

For `openItem`, use async exec:

```typescript
async openItem(id: string): Promise<void> {
  const filePath = this.getItemUrl(id);
  try {
    await fs.access(filePath);
  } catch {
    throw new Error(`Work item #${id} does not exist`);
  }
  const editor = process.env['VISUAL'] || process.env['EDITOR'] || 'vi';
  const { execFile } = await import('node:child_process');
  return new Promise((resolve, reject) => {
    const child = execFile(editor, [filePath], { stdio: 'inherit' }, (err) => {
      if (err) reject(err);
      else resolve();
    });
    // inherit stdio for interactive editors
    child.stdin?.pipe(process.stdin);
  });
}
```

**Step 3: Commit**

```bash
git add src/backends/local/index.ts
git commit -m "refactor: convert LocalBackend methods to async"
```

---

## Task 4: Update Backend Factory for Async Construction

**Files:**
- Modify: `src/backends/factory.ts`

**Step 1: Make `createBackend` and `createBackendWithSync` async**

```typescript
export async function createBackend(root: string): Promise<Backend> {
  const config = await readConfig(root);
  const backend = config.backend ?? 'local';

  switch (backend) {
    case 'local':
      return LocalBackend.create(root);
    case 'github':
      return new GitHubBackend(root);
    case 'gitlab':
      return new GitLabBackend(root);
    case 'azure':
      return new AzureDevOpsBackend(root);
    default:
      throw new Error(`Unknown backend "${backend}"`);
  }
}

export async function createBackendWithSync(root: string): Promise<BackendSetup> {
  const config = await readConfig(root);
  const backendType = config.backend ?? 'local';

  const local = await LocalBackend.create(root, { tempIds: backendType !== 'local' });

  if (backendType === 'local') {
    return { backend: local, syncManager: null };
  }

  // ... remote setup unchanged ...
}
```

**Step 2: Commit**

```bash
git add src/backends/factory.ts
git commit -m "refactor: make backend factory functions async"
```

---

## Task 5: Convert Other Backends to Async

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/gitlab/index.ts`
- Modify: `src/backends/ado/index.ts`

**Step 1: Add `async` keyword to all Backend method implementations**

For GitHub, GitLab, and ADO backends, the change is mechanical: add `async` to each method that now returns `Promise<T>`. Since these backends use synchronous subprocess wrappers (`gh()`, `glab()`, `az()`), the methods will still block internally but satisfy the interface contract. A future task can convert the subprocess wrappers themselves to truly async.

For each backend:
- Add `async` to every method that the interface now requires as `Promise`-returning
- The return type is inferred from the `async` keyword
- No logic changes needed — the sync subprocess calls are automatically wrapped in a resolved Promise

Example for GitHubBackend:

```typescript
async getStatuses(): Promise<string[]> {
  return ['open', 'closed'];  // was: return ['open', 'closed']
}

async listWorkItems(iteration?: string): Promise<WorkItem[]> {
  const issues = gh<GHIssue[]>(/* ... */);  // still sync under the hood
  return issues.map(mapIssue);
}
```

**Step 2: Commit**

```bash
git add src/backends/github/index.ts src/backends/gitlab/index.ts src/backends/ado/index.ts
git commit -m "refactor: make GitHub, GitLab, ADO backends async"
```

---

## Task 6: Convert SyncQueueStore to Async

**Files:**
- Modify: `src/sync/queue.ts`

**Step 1: Convert all methods to use `fs/promises`**

```typescript
import fs from 'node:fs/promises';
import path from 'node:path';
import type { QueueAction, QueueEntry, SyncQueue } from './types.js';

export class SyncQueueStore {
  private filePath: string;

  constructor(root: string) {
    this.filePath = path.join(root, '.tic', 'sync-queue.json');
  }

  async read(): Promise<SyncQueue> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      const data = JSON.parse(raw) as SyncQueue;
      if (!Array.isArray(data.pending)) return { pending: [] };
      return data;
    } catch {
      return { pending: [] };
    }
  }

  private async write(queue: SyncQueue): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, JSON.stringify(queue, null, 2));
  }

  async append(entry: QueueEntry): Promise<void> {
    const queue = await this.read();
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === entry.itemId && e.action === entry.action),
    );
    queue.pending.push(entry);
    await this.write(queue);
  }

  async remove(itemId: string, action: QueueAction): Promise<void> {
    const queue = await this.read();
    queue.pending = queue.pending.filter(
      (e) => !(e.itemId === itemId && e.action === action),
    );
    await this.write(queue);
  }

  async clear(): Promise<void> {
    await this.write({ pending: [] });
  }

  async renameItem(oldId: string, newId: string): Promise<void> {
    const queue = await this.read();
    for (const entry of queue.pending) {
      if (entry.itemId === oldId) {
        entry.itemId = newId;
      }
    }
    await this.write(queue);
  }
}
```

**Step 2: Commit**

```bash
git add src/sync/queue.ts
git commit -m "refactor: make SyncQueueStore async"
```

---

## Task 7: Update SyncManager for Async Backend + Queue

**Files:**
- Modify: `src/sync/SyncManager.ts`

**Step 1: Add `await` to all backend and queue calls**

The SyncManager methods are already `async`, but they call backend methods and queue methods without `await` (since those were sync). Add `await` to every call:

- `constructor`: The queue `read()` is now async. Move pending count initialization to a separate `async init()` or accept the queue count as a constructor param. Simplest: constructor takes pre-read pending count.
- `pushPending()`: `await this.queue.read()`, `await this.pushEntry(entry)`, `await this.queue.remove(...)`
- `pushEntry()`: `await this.local.getWorkItem(...)`, `await this.remote.createWorkItem(...)`, etc.
- `renameLocalItem()`: Make async, `await` all calls
- `pull()`: `await this.remote.getIterations()`, `await this.remote.listWorkItems()`, etc.
- `sync()`: `await this.queue.read()` for pending count

**Step 2: Commit**

```bash
git add src/sync/SyncManager.ts
git commit -m "refactor: add await to SyncManager for async backend/queue"
```

---

## Task 8: Create `useBackendData` Hook

**Files:**
- Create: `src/hooks/useBackendData.ts`

**Step 1: Implement the shared hook**

This hook wraps async backend calls for use in React components. It provides loading state, error handling, and a refresh mechanism.

```typescript
import { useState, useEffect, useCallback, useRef } from 'react';
import type { Backend, BackendCapabilities } from '../backends/types.js';
import type { WorkItem } from '../types.js';

export interface BackendData {
  capabilities: BackendCapabilities;
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  currentIteration: string;
  items: WorkItem[];
  loading: boolean;
  error: string | null;
  refresh: () => void;
  getWorkItem: (id: string) => Promise<WorkItem>;
  getChildren: (id: string) => Promise<WorkItem[]>;
  getDependents: (id: string) => Promise<WorkItem[]>;
}

export function useBackendData(backend: Backend, iteration?: string): BackendData {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [statuses, setStatuses] = useState<string[]>([]);
  const [iterations, setIterations] = useState<string[]>([]);
  const [types, setTypes] = useState<string[]>([]);
  const [assignees, setAssignees] = useState<string[]>([]);
  const [currentIteration, setCurrentIteration] = useState('');
  const [items, setItems] = useState<WorkItem[]>([]);
  const [refreshCounter, setRefreshCounter] = useState(0);

  const capabilities = backend.getCapabilities(); // sync — no I/O

  const refresh = useCallback(() => {
    setRefreshCounter((c) => c + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    async function load() {
      try {
        const iter = iteration ?? await backend.getCurrentIteration();
        const [s, it, t, a, wi] = await Promise.all([
          backend.getStatuses(),
          backend.getIterations(),
          backend.getWorkItemTypes(),
          backend.getAssignees().catch(() => [] as string[]),
          backend.listWorkItems(iter),
        ]);
        if (cancelled) return;
        setStatuses(s);
        setIterations(it);
        setTypes(t);
        setAssignees(a);
        setCurrentIteration(iter);
        setItems(wi);
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [backend, iteration, refreshCounter]);

  return {
    capabilities,
    statuses,
    iterations,
    types,
    assignees,
    currentIteration,
    items,
    loading,
    error,
    refresh,
    getWorkItem: (id: string) => backend.getWorkItem(id),
    getChildren: (id: string) => backend.getChildren(id),
    getDependents: (id: string) => backend.getDependents(id),
  };
}
```

**Step 2: Write test for useBackendData**

Create `src/hooks/useBackendData.test.ts` to test the hook with a mock backend.

**Step 3: Commit**

```bash
git add src/hooks/useBackendData.ts src/hooks/useBackendData.test.ts
git commit -m "feat: add useBackendData hook for async backend data loading"
```

---

## Task 9: Update WorkItemList Component

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Replace sync backend calls with `useBackendData`**

Replace the `useMemo` calls to `backend.getCapabilities()`, `backend.getWorkItemTypes()`, `backend.getCurrentIteration()`, `backend.listWorkItems()` with the hook:

```typescript
import { useBackendData } from '../hooks/useBackendData.js';

export function WorkItemList() {
  const { backend, syncManager, navigate, selectWorkItem, activeType, setActiveType } = useAppState();
  // ...
  const {
    capabilities,
    types,
    currentIteration: iteration,
    items: allItems,
    loading,
    refresh: refreshData,
  } = useBackendData(backend);

  // Remove: const capabilities = useMemo(...)
  // Remove: const types = useMemo(...)
  // Remove: const iteration = backend.getCurrentIteration()
  // Remove: const allItems = useMemo(() => backend.listWorkItems(iteration), ...)
  // Remove: const [refresh, setRefresh] = useState(0)
  // Replace all setRefresh((r) => r + 1) with refreshData()
```

**Step 2: Add loading state to render**

```typescript
if (loading) {
  return (
    <Box>
      <Text dimColor>Loading...</Text>
    </Box>
  );
}
```

**Step 3: Make event handler mutations async**

For `deleteWorkItem`, `updateWorkItem`, `openItem` — wrap in async IIFE or use an async callback pattern:

```typescript
// Delete
if (confirmDelete) {
  if (input === 'y' || input === 'Y') {
    void (async () => {
      await backend.deleteWorkItem(treeItems[cursor]!.item.id);
      queueWrite('delete', treeItems[cursor]!.item.id);
      setConfirmDelete(false);
      setCursor((c) => Math.max(0, c - 1));
      refreshData();
    })();
  }
  // ...
}

// Open
if (input === 'o' && treeItems.length > 0) {
  void (async () => {
    await backend.openItem(treeItems[cursor]!.item.id);
    refreshData();
  })();
}

// Parent update (in onSubmit)
onSubmit={(value) => {
  void (async () => {
    const item = treeItems[cursor]!.item;
    const newParent = value.trim() === '' ? null : value.trim();
    try {
      await backend.updateWorkItem(item.id, { parent: newParent });
      queueWrite('update', item.id);
      setWarning('');
    } catch (e) {
      setWarning(e instanceof Error ? e.message : 'Invalid parent');
    }
    setSettingParent(false);
    setParentInput('');
    refreshData();
  })();
}}
```

**Step 4: Make `queueWrite` async**

```typescript
const queueWrite = async (action: QueueAction, itemId: string) => {
  if (queueStore) {
    await queueStore.append({
      action,
      itemId,
      timestamp: new Date().toISOString(),
    });
    void syncManager?.pushPending().then(() => refreshData());
  }
};
```

**Step 5: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor: update WorkItemList for async backend"
```

---

## Task 10: Update WorkItemForm Component

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Replace sync backend calls with `useBackendData` + async state**

The form component has two async concerns:
1. **Initial data loading** (statuses, types, iterations, assignees, existing item) — use `useBackendData` for lists, and `useEffect` for loading the specific item being edited
2. **Mutations** (save, addComment) — make async

```typescript
import { useBackendData } from '../hooks/useBackendData.js';

export function WorkItemForm() {
  const { backend, syncManager, navigate, selectedWorkItemId, activeType, pushWorkItem, popWorkItem } = useAppState();

  const { capabilities, statuses, iterations, types, assignees, currentIteration } = useBackendData(backend);

  // Load existing item + relationships async
  const [existingItem, setExistingItem] = useState<WorkItem | null>(null);
  const [children, setChildren] = useState<WorkItem[]>([]);
  const [dependents, setDependents] = useState<WorkItem[]>([]);
  const [itemLoading, setItemLoading] = useState(selectedWorkItemId !== null);

  useEffect(() => {
    if (selectedWorkItemId === null) {
      setExistingItem(null);
      setChildren([]);
      setDependents([]);
      setItemLoading(false);
      return;
    }
    let cancelled = false;
    setItemLoading(true);
    void (async () => {
      const [item, ch, dep] = await Promise.all([
        backend.getWorkItem(selectedWorkItemId),
        capabilities.relationships ? backend.getChildren(selectedWorkItemId) : Promise.resolve([]),
        capabilities.relationships ? backend.getDependents(selectedWorkItemId) : Promise.resolve([]),
      ]);
      if (cancelled) return;
      setExistingItem(item);
      setChildren(ch);
      setDependents(dep);
      setItemLoading(false);
    })();
    return () => { cancelled = true; };
  }, [selectedWorkItemId, backend, capabilities.relationships]);
```

**Step 2: Build field list from loaded data**

Replace the `useMemo` for `fields` to use the state variables `existingItem`, `children`, `dependents` instead of calling backend methods inline.

**Step 3: Make `save()` async**

```typescript
async function save() {
  // ... parse labels, parent, dependsOn (sync) ...

  if (selectedWorkItemId !== null) {
    await backend.updateWorkItem(selectedWorkItemId, { ... });
    await queueWrite('update', selectedWorkItemId);

    if (capabilities.comments && newComment.trim().length > 0) {
      const added = await backend.addComment(selectedWorkItemId, { ... });
      await queueWrite('comment', selectedWorkItemId, { ... });
      setComments((prev) => [...prev, added]);
      setNewComment('');
    }
  } else {
    const created = await backend.createWorkItem({ ... });
    await queueWrite('create', created.id);

    if (capabilities.comments && newComment.trim().length > 0) {
      await backend.addComment(created.id, { ... });
      await queueWrite('comment', created.id, { ... });
    }
  }
}
```

**Step 4: Update useInput to handle async save**

```typescript
if (key.escape) {
  void (async () => {
    await save();
    const prev = popWorkItem();
    if (prev === null) {
      navigate('list');
    }
  })();
}
```

**Step 5: Make `renderRelationshipField` async-safe**

Currently calls `backend.getWorkItem(id)` synchronously during render. Instead, use the already-loaded `existingItem`, `children`, `dependents` arrays to look up titles without async calls in render.

```typescript
function renderRelationshipField(field: FieldName, index: number) {
  // ...
  let item: { id: string; title: string } | null = null;
  if (field === 'rel-parent' && existingItem?.parent) {
    // Parent was loaded in the useEffect — need to load it there too
    // Add parentItem to the state loaded in the effect
    item = parentItem ? { id: parentItem.id, title: parentItem.title } : null;
  } else if (id) {
    const child = children.find((c) => c.id === id);
    const dep = dependents.find((d) => d.id === id);
    const relItem = child ?? dep;
    item = relItem ? { id: relItem.id, title: relItem.title } : null;
  }
  // ...
}
```

**Step 6: Add loading state**

```typescript
if (itemLoading) {
  return <Box><Text dimColor>Loading...</Text></Box>;
}
```

**Step 7: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "refactor: update WorkItemForm for async backend"
```

---

## Task 11: Update IterationPicker Component

**Files:**
- Modify: `src/components/IterationPicker.tsx`

**Step 1: Use `useBackendData` hook**

```typescript
import { useBackendData } from '../hooks/useBackendData.js';

export function IterationPicker() {
  const { backend, navigate } = useAppState();
  const { iterations, currentIteration, loading } = useBackendData(backend);

  if (loading) {
    return <Box><Text dimColor>Loading...</Text></Box>;
  }

  const items = iterations.map((it) => ({
    label: it === currentIteration ? `${it} (current)` : it,
    value: it,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}><Text bold>Switch Iteration</Text></Box>
      <SelectInput
        items={items}
        initialIndex={iterations.indexOf(currentIteration)}
        onSelect={(item) => {
          void (async () => {
            await backend.setCurrentIteration(item.value);
            navigate('list');
          })();
        }}
      />
      <Box marginTop={1}><Text dimColor>up/down: navigate enter: select</Text></Box>
    </Box>
  );
}
```

**Step 2: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "refactor: update IterationPicker for async backend"
```

---

## Task 12: Update StatusScreen and Settings Components

**Files:**
- Modify: `src/components/StatusScreen.tsx`
- Modify: `src/components/Settings.tsx`

**Step 1: StatusScreen — use `useBackendData`**

Replace `backend.getCapabilities()` useMemo with hook. StatusScreen only uses capabilities (sync) and sync status, so minimal change needed — just get capabilities from the hook or call directly since it's sync.

**Step 2: Settings — make config read async**

Settings reads config directly via `readConfig()`. Convert to useEffect + useState:

```typescript
const [config, setConfig] = useState<Config | null>(null);

useEffect(() => {
  void readConfig(root).then(setConfig);
}, [root]);

if (!config) {
  return <Box><Text dimColor>Loading...</Text></Box>;
}
```

Make `writeConfig` call async:

```typescript
if (key.return) {
  const selected = VALID_BACKENDS[cursor]!;
  if (selected !== 'local' && selected !== 'github') return;
  config.backend = selected;
  void writeConfig(root, config);
}
```

**Step 3: Commit**

```bash
git add src/components/StatusScreen.tsx src/components/Settings.tsx
git commit -m "refactor: update StatusScreen and Settings for async"
```

---

## Task 13: Update Entry Point

**Files:**
- Modify: `src/index.tsx`

**Step 1: Await async factory**

```typescript
if (process.argv.length > 2) {
  await runCli(process.argv);
} else {
  const { backend, syncManager } = await createBackendWithSync(process.cwd());

  if (syncManager) {
    const items = await backend.listWorkItems();
    if (items.length === 0) {
      process.stderr.write('Syncing...\n');
      await syncManager.sync();
    } else {
      syncManager.sync().catch(() => {});
    }
  }

  render(<App backend={backend} syncManager={syncManager} />);
}
```

**Step 2: Commit**

```bash
git add src/index.tsx
git commit -m "refactor: update entry point for async backend factory"
```

---

## Task 14: Update CLI Command Handlers

**Files:**
- Modify: `src/cli/commands/item.ts`
- Modify: `src/cli/commands/iteration.ts`
- Modify: `src/cli/index.ts`

**Step 1: Make all `runItem*` and `runIteration*` functions async**

Add `async` and `await` to each function in `item.ts`:

```typescript
export async function runItemCreate(backend: Backend, title: string, opts: ItemCreateOptions): Promise<WorkItem> {
  const statuses = await backend.getStatuses();
  const types = await backend.getWorkItemTypes();
  return backend.createWorkItem({ ... });
}

export async function runItemList(backend: Backend, opts: ItemListOptions): Promise<WorkItem[]> {
  const iteration = opts.all ? undefined : (opts.iteration ?? await backend.getCurrentIteration());
  let items = await backend.listWorkItems(iteration);
  // ...
}

export async function runItemShow(backend: Backend, id: string): Promise<WorkItem> {
  return backend.getWorkItem(id);
}

export async function runItemUpdate(backend: Backend, id: string, opts: ItemUpdateOptions): Promise<WorkItem> {
  // ...
  return backend.updateWorkItem(id, data);
}

export async function runItemDelete(backend: Backend, id: string): Promise<void> {
  return backend.deleteWorkItem(id);
}

export async function runItemOpen(backend: Backend, id: string): Promise<void> {
  return backend.openItem(id);
}

export async function runItemComment(backend: Backend, id: string, text: string, opts: ItemCommentOptions): Promise<Comment> {
  return backend.addComment(id, { ... });
}
```

Same for `iteration.ts`:

```typescript
export async function runIterationList(backend: Backend): Promise<IterationListResult> {
  return {
    iterations: await backend.getIterations(),
    current: await backend.getCurrentIteration(),
  };
}

export async function runIterationSet(backend: Backend, name: string): Promise<void> {
  await backend.setCurrentIteration(name);
}
```

**Step 2: Update `cli/index.ts` action handlers**

The CLI action handlers need to `await` the now-async `runItem*` functions. Many are already `async` (create, update, delete, comment). The others need to become `async`:

- `item list` action: `async (opts) => { ... const items = await runItemList(backend, opts); ... }`
- `item show` action: `async (idStr) => { ... const wi = await runItemShow(backend, idStr); ... }`
- `item open` action: `async (idStr) => { ... await runItemOpen(backend, idStr); ... }`
- `iteration list` action: `async () => { ... const result = await runIterationList(backend); ... }`
- `iteration set` action: `async (name) => { ... await runIterationSet(backend, name); ... }`

Also: `createBackend()` and `createBackendAndSync()` helpers become async:

```typescript
async function createBackend(): Promise<Backend> {
  requireTicProject(process.cwd());
  return createBackendFromConfig(process.cwd());
}

async function createBackendAndSync(): Promise<{ backend: Backend; syncManager: SyncManager | null; queueStore: SyncQueueStore | null }> {
  requireTicProject(process.cwd());
  const { backend, syncManager } = await createBackendWithSync(process.cwd());
  const queueStore = syncManager ? new SyncQueueStore(process.cwd()) : null;
  return { backend, syncManager, queueStore };
}
```

And `tryGetCapabilities()` becomes async — but it's called at program creation time. Since Commander doesn't support async program construction natively, and this is only used for conditional CLI option display, we have two options:
1. Make it sync by reading config file directly (keep a sync `readConfigSync` helper)
2. Remove the conditional option display and always show all options

Recommendation: **Keep a `readConfigSync` helper just for this one use case** in `config.ts`, since it's CLI construction time, not a hot path.

**Step 3: Commit**

```bash
git add src/cli/commands/item.ts src/cli/commands/iteration.ts src/cli/index.ts
git commit -m "refactor: make CLI command handlers async"
```

---

## Task 15: Update MCP Tool Handlers

**Files:**
- Modify: `src/cli/commands/mcp.ts`

**Step 1: Make all `handle*` functions async and await backend calls**

Every `handle*` function becomes `async` and awaits the `runItem*` calls:

```typescript
export async function handleGetConfig(backend: Backend, root: string): Promise<ToolResult> {
  try {
    const config = await readConfig(root);
    return success({
      backend: config.backend,
      statuses: await backend.getStatuses(),
      types: await backend.getWorkItemTypes(),
      iterations: await backend.getIterations(),
      currentIteration: await backend.getCurrentIteration(),
      capabilities: backend.getCapabilities(),
    });
  } catch (err) { ... }
}

export async function handleListItems(backend: Backend, args: ListItemsArgs): Promise<ToolResult> {
  try {
    const items = await runItemList(backend, { ... });
    return success(items);
  } catch (err) { ... }
}
// ... same pattern for all other handlers
```

**Step 2: Update `registerTools` — tool callbacks are already async-capable**

The MCP SDK `server.tool()` accepts async callbacks. Some are already async. Make all of them async and await the handler:

```typescript
server.tool('list_items', '...', { ... }, async (args) => {
  return handleListItems(backend, args);
});
```

**Step 3: Update `startMcpServer` for async backend creation**

```typescript
export async function startMcpServer(): Promise<void> {
  const root = process.cwd();
  // ...
  if (isTicProject(root)) {
    const setup = await createBackendWithSync(root);
    backend = setup.backend;
    // ...
  }
  // ...
}
```

**Step 4: Update the guarded backend Proxy**

The proxy currently lazy-creates the backend sync. Make it async:

```typescript
const guardedBackend = new Proxy({} as Backend, {
  get(_target, prop: string | symbol) {
    if (!backend) {
      if (isTicProject(root)) {
        // This is a sync path in a proxy getter — we can't await here.
        // Solution: make startMcpServer always create the backend upfront,
        // and only use the proxy for the "not a tic project" error case.
        throw new Error('Backend not initialized. Use init_project first.');
      }
      throw new Error('Not a tic project. Use the init_project tool first.');
    }
    return (backend as unknown as Record<string | symbol, unknown>)[prop];
  },
});
```

To handle the lazy init case (init_project creates the project, then subsequent tools need the backend), add a re-init tool callback:

```typescript
server.tool('init_project', '...', async () => {
  const result = handleInitProject(root);
  if (!result.isError && !backend && isTicProject(root)) {
    const setup = await createBackendWithSync(root);
    backend = setup.backend;
    syncState.syncManager = setup.syncManager;
    syncState.queueStore = setup.syncManager ? new SyncQueueStore(root) : null;
  }
  return result;
});
```

**Step 5: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "refactor: make MCP tool handlers async"
```

---

## Task 16: Update Tests

**Files:**
- Modify: All `*.test.ts` files that call Backend methods or use sync helpers

**Step 1: Update local backend tests**

`src/backends/local/index.test.ts`: Add `await` to all backend method calls. Use `await LocalBackend.create(root)` instead of `new LocalBackend(root)`.

`src/backends/local/items.test.ts`: Add `await` to `readWorkItem`, `writeWorkItem`, `deleteWorkItem`, `listItemFiles`.

`src/backends/local/config.test.ts`: Add `await` to `readConfig`, `writeConfig`.

**Step 2: Update other backend tests**

`src/backends/github/github.test.ts`, `src/backends/gitlab/gitlab.test.ts`, `src/backends/ado/ado.test.ts`: Add `await` to all backend method calls.

`src/backends/base.test.ts`: If it instantiates backends directly, update for async.

`src/backends/factory.test.ts`: `await createBackend(...)`, `await createBackendWithSync(...)`.

**Step 3: Update sync tests**

`src/sync/queue.test.ts`: Add `await` to all `SyncQueueStore` method calls.

`src/sync/SyncManager.test.ts`: Add `await` where needed — most calls are already async.

`src/sync/integration.test.ts`: Add `await` to all backend and queue calls.

**Step 4: Update CLI tests**

`src/cli/__tests__/item.test.ts`: Add `await` to all `runItem*` calls.

`src/cli/__tests__/mcp.test.ts`: Add `await` to all `handle*` calls.

`src/cli/__tests__/iteration.test.ts`: Add `await` to `runIterationList`, `runIterationSet`.

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add -A
git commit -m "test: update all tests for async backend interface"
```

---

## Task 17: Build, Lint, and Final Verification

**Files:** None (verification only)

**Step 1: Run TypeScript compiler**

Run: `npm run build`
Expected: No type errors.

**Step 2: Run linter**

Run: `npm run lint`
Expected: No lint errors. Watch for:
- `@typescript-eslint/no-floating-promises` — ensure all Promises are handled
- `@typescript-eslint/require-await` — remove from functions that no longer need suppression

**Step 3: Run formatter**

Run: `npm run format`

**Step 4: Run tests**

Run: `npm test`
Expected: All tests pass.

**Step 5: Manual smoke test**

Run: `npm start`
Expected: TUI loads, navigation is responsive, creating/editing/deleting items works.

**Step 6: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix lint and format after async refactor"
```

---

## Summary of Changes

| Area | Change |
|------|--------|
| `Backend` interface | 15 of 17 methods now return `Promise<T>` |
| `BaseBackend` | Abstract methods updated to match |
| `LocalBackend` | All file I/O via `fs/promises`, static factory `create()` |
| `items.ts` / `config.ts` | All sync fs calls → async |
| GitHub/GitLab/ADO backends | Methods marked `async` (subprocess wrappers unchanged for now) |
| `SyncQueueStore` | All methods async via `fs/promises` |
| `SyncManager` | Added `await` to all backend/queue calls |
| `useBackendData` hook | New shared hook for component data loading |
| `WorkItemList` | Uses hook, async mutations in event handlers |
| `WorkItemForm` | Uses hook + useEffect for item loading, async save |
| `IterationPicker` | Uses hook, async setCurrentIteration |
| `StatusScreen` / `Settings` | Async config loading |
| `index.tsx` | Awaits async factory |
| CLI handlers | All `runItem*`/`runIteration*` async, action handlers await |
| MCP handlers | All `handle*` async, tool callbacks await |
| Tests | All updated with `await` |
