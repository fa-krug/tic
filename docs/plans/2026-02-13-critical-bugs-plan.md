# Critical Bugs Fix Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix three critical bugs: command injection in editor.ts, ID race condition in Storage, and SyncManager listener memory leak.

**Architecture:** Three independent fixes. Bug 1 is a one-line removal. Bug 2 restructures createWorkItem to move ID allocation inside the transaction. Bug 3 adds unsubscribe return to SyncManager and wires cleanup into backendDataStore.

**Tech Stack:** TypeScript, better-sqlite3 (via Drizzle ORM), Zustand stores, Vitest

---

### Task 1: Fix command injection in editor.ts

**Files:**
- Modify: `src/editor.ts:17-20`

**Step 1: Remove `shell: true`**

In `src/editor.ts`, change line 17-20 from:

```ts
    const result = spawnSync(editor, [tmpFile], {
      stdio: 'inherit',
      shell: true,
    });
```

to:

```ts
    const result = spawnSync(editor, [tmpFile], {
      stdio: 'inherit',
    });
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation, no errors.

**Step 3: Run tests**

Run: `npm test`
Expected: All tests pass (editor.ts has no unit tests, but verify no regressions).

**Step 4: Commit**

```bash
git add src/editor.ts
git commit -m "fix(security): remove shell: true from editor spawn to prevent command injection"
```

---

### Task 2: Fix ID race condition in Storage.createWorkItem

**Files:**
- Modify: `src/storage/index.ts:573-638`

**Step 1: Move ID allocation inside transaction**

In `src/storage/index.ts`, replace the `createWorkItem` method body (lines 573-638) from:

```ts
  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const now = new Date().toISOString();

    // Get and increment nextId
    const config = this.db
      .select()
      .from(schema.projectConfig)
      .where(eq(schema.projectConfig.id, 1))
      .get();
    const nextId = config?.nextId ?? 1;
    const id = this.tempIds ? `local-${nextId}` : String(nextId);

    // Validate relationships before inserting
    this.validateRelationships(id, data.parent, data.dependsOn);

    this.db.transaction((tx) => {
      tx.update(schema.projectConfig)
        .set({ nextId: nextId + 1 })
        .where(eq(schema.projectConfig.id, 1))
        .run();
```

to:

```ts
  async createWorkItem(data: NewWorkItem): Promise<WorkItem> {
    this.validateFields(data);
    const now = new Date().toISOString();

    // Allocate ID atomically inside transaction to prevent race conditions
    const { id, nextId } = this.db.transaction((tx) => {
      const config = tx
        .select()
        .from(schema.projectConfig)
        .where(eq(schema.projectConfig.id, 1))
        .get();
      const nid = config?.nextId ?? 1;
      tx.update(schema.projectConfig)
        .set({ nextId: nid + 1 })
        .where(eq(schema.projectConfig.id, 1))
        .run();
      return { id: this.tempIds ? `local-${nid}` : String(nid), nextId: nid };
    });

    // Validate relationships before inserting
    this.validateRelationships(id, data.parent, data.dependsOn);

    this.db.transaction((tx) => {
```

Note: The rest of the transaction body (iteration insert, work item insert, labels, deps) stays exactly the same. The `nextId` increment is now in its own transaction that returns the allocated ID. The second transaction handles the actual insert. `validateRelationships` stays between them.

**Step 2: Verify build**

Run: `npm run build`
Expected: Clean compilation.

**Step 3: Run Storage tests**

Run: `npx vitest run src/storage/index.test.ts`
Expected: All existing createWorkItem tests pass.

**Step 4: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 5: Commit**

```bash
git add src/storage/index.ts
git commit -m "fix(storage): move ID allocation inside transaction to prevent race condition"
```

---

### Task 3: Add unsubscribe to SyncManager.onStatusChange

**Files:**
- Modify: `src/sync/SyncManager.ts:42-44`
- Test: `src/sync/SyncManager.test.ts`

**Step 1: Write the failing test**

Add this test to `src/sync/SyncManager.test.ts`, inside the existing `describe('SyncManager', ...)` block, near the existing `'fires status change callbacks during sync'` test:

```ts
  it('returns unsubscribe function from onStatusChange', async () => {
    const remote = createMockRemote([]);
    const manager = new SyncManager(local, remote, queueStore);
    const states: string[] = [];

    const unsubscribe = manager.onStatusChange((status) => {
      states.push(status.state);
    });

    await manager.sync();
    expect(states.length).toBeGreaterThan(0);

    const countBefore = states.length;
    unsubscribe();

    await manager.sync();
    expect(states.length).toBe(countBefore);
  });
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/SyncManager.test.ts -t "returns unsubscribe function"`
Expected: FAIL — `onStatusChange` currently returns `void`, so `unsubscribe` is not a function.

**Step 3: Implement unsubscribe return**

In `src/sync/SyncManager.ts`, change lines 42-44 from:

```ts
  onStatusChange(cb: StatusListener): void {
    this.listeners.push(cb);
  }
```

to:

```ts
  onStatusChange(cb: StatusListener): () => void {
    this.listeners.push(cb);
    return () => {
      const idx = this.listeners.indexOf(cb);
      if (idx >= 0) this.listeners.splice(idx, 1);
    };
  }
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/sync/SyncManager.test.ts -t "returns unsubscribe function"`
Expected: PASS

**Step 5: Run full SyncManager tests**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: All tests pass (existing tests don't use the return value, so they're unaffected).

**Step 6: Commit**

```bash
git add src/sync/SyncManager.ts src/sync/SyncManager.test.ts
git commit -m "feat(sync): return unsubscribe function from SyncManager.onStatusChange"
```

---

### Task 4: Wire unsubscribe into backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts` (lines 185, 309, 370, 458 and destroy at 484)

**Step 1: Add module-level unsubscribe variable**

Near the top of `src/stores/backendDataStore.ts`, after the existing module-level variables (`currentBackend`, `currentCwd`, `initGeneration`), add:

```ts
let currentSyncUnsubscribe: (() => void) | null = null;
```

**Step 2: Capture unsubscribe at all 4 call sites**

At each of the 4 `syncManager.onStatusChange(...)` call sites (lines 185, 309, 370, 458), change:

```ts
            syncManager.onStatusChange((status: SyncStatus) => {
```

to:

```ts
            currentSyncUnsubscribe?.();
            currentSyncUnsubscribe = syncManager.onStatusChange((status: SyncStatus) => {
```

This ensures any previous listener is cleaned up before registering a new one.

**Step 3: Clean up in destroy()**

In the `destroy()` method (around line 484), add cleanup before the existing reset logic:

```ts
    destroy() {
      ++initGeneration;
      currentSyncUnsubscribe?.();
      currentSyncUnsubscribe = null;
      // ... rest of existing destroy
```

**Step 4: Verify build**

Run: `npm run build`
Expected: Clean compilation.

**Step 5: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 6: Commit**

```bash
git add src/stores/backendDataStore.ts
git commit -m "fix(stores): wire SyncManager unsubscribe to prevent listener memory leak"
```

---

### Task 5: Final verification

**Step 1: Run format check**

Run: `npm run format:check`
Expected: All files properly formatted. If not, run `npm run format` and re-commit.

**Step 2: Run lint**

Run: `npm run lint`
Expected: No errors.

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass.

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: No type errors.
