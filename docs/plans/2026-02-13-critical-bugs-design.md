# Design: Fix critical bugs (issue #26)

Command injection, ID race condition, listener memory leak.

## Bug 1: Command injection in `editor.ts`

**Problem:** `spawnSync(editor, [tmpFile], { shell: true })` allows `$EDITOR`/`$VISUAL` values to be interpreted as shell commands. Metacharacters in env vars enable arbitrary command execution.

**Fix:** Remove `shell: true` from the `spawnSync` call at `src/editor.ts:17-20`. The editor binary is executed directly without shell interpretation.

**Scope:** `editor.ts` only. `implement.ts` shell usage is intentional (user-configured `branchCommand` is a shell script by design).

## Bug 2: ID race condition in `storage/index.ts`

**Problem:** `SELECT nextId` (line 578-582) runs outside the transaction that increments it (line 589-593). Two concurrent `createWorkItem` calls could read the same `nextId`, causing duplicate IDs.

**Fix:** Move the `SELECT nextId` inside the transaction block. The transaction callback returns the allocated ID. `validateRelationships` moves after the transaction (it doesn't need to be atomic with ID generation).

```ts
const nextId = this.db.transaction((tx) => {
  const config = tx.select()...get();
  const nid = config?.nextId ?? 1;
  tx.update(...).set({ nextId: nid + 1 })...
  return nid;
});
```

## Bug 3: SyncManager listener memory leak

**Problem:** `onStatusChange()` pushes to a listener array with no removal mechanism. `backendDataStore` registers new listeners on every auth flow (4 call sites), and old listeners from destroyed instances keep firing.

**Fix:**
1. `SyncManager.onStatusChange` returns an `() => void` unsubscribe function
2. `backendDataStore` stores the unsubscribe function in a module-level variable
3. Each new `onStatusChange` call replaces the previous unsubscribe
4. `destroy()` calls the unsubscribe and nulls it

## Testing

- Bug 1: No unit tests (spawns external processes). Manual verification.
- Bug 2: Existing `createWorkItem` tests validate the refactor.
- Bug 3: New test in `SyncManager.test.ts` for unsubscribe behavior.
- Full test suite run for regressions.
