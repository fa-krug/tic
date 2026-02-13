# Design: Fix Medium-Priority Issues (#28)

## Scope

All 11 sub-issues from issue #28: null checks, injection, race conditions, data loss, auth limits, test leaks, and resource leaks.

## Approach

Fix in 4 batches grouped by risk category, each independently testable and reviewable:

1. **Security** — JQL injection + auth polling limits
2. **Null safety** — mapper null checks + CLI array bounds
3. **Concurrency** — ADO token refresh mutex + useEffect cancellation + write chain
4. **Data integrity** — sync notifications + Jira separator + test leaks + timeout leak

## Batch 1: Security

### JQL Injection (`src/backends/jira/index.ts`)

Add `escapeJqlString(value)` helper: wraps value in single quotes, escapes embedded quotes (`'` → `\\'`). Apply to all JQL interpolations of `this.config.project`.

### OAuth Polling Limits (`src/auth/github.ts`, `src/auth/ado.ts`)

Both `while (true)` polling loops lack a maximum. Use the server-provided `expires_in` field as the timeout bound. Track elapsed time across iterations and break with a descriptive error when exceeded.

## Batch 2: Null Safety

### GitHub Mappers (`src/backends/github/mappers.ts`)

`mapCommentToComment()`: use `ghComment.author?.login ?? 'unknown'` to handle deleted users with null authors.

### Jira Mappers (`src/backends/jira/mappers.ts`)

`extractDependsOn()`: replace `link.inwardIssue!.key` non-null assertion with flatMap pattern:
```ts
.flatMap((link) => link.inwardIssue ? [link.inwardIssue.key] : [])
```

### ADO Backend (`src/backends/ado/index.ts`)

`getAssignees()`: add optional chaining on `m.identity?.displayName` and filter out nullish values.

### CLI Array Bounds (`src/cli/commands/item.ts`)

Replace `types[0]!` and `statuses[0]!` with nullish coalescing fallbacks: `types[0] ?? 'task'`, `statuses[0] ?? 'open'`.

## Batch 3: Concurrency

### ADO Token Refresh Mutex (`src/backends/ado/api.ts`)

Store a `refreshPromise` on the class. On 401, if no refresh is in progress, start one and store the promise. Concurrent 401s all await the same promise. Clear `refreshPromise` in `finally`.

### useEffect Cancellation (`Settings.tsx`, `WorkItemList.tsx`)

Add `let cancelled = false` + cleanup `return () => { cancelled = true }` to all 4 async useEffects (3 in Settings, 1 in WorkItemList). Guard setState calls with `if (!cancelled)`.

### recentCommandsStore Write Chain (`src/stores/recentCommandsStore.ts`)

Add `.catch(() => {})` to prevent broken chains. Collapse chain by resetting to `Promise.resolve()` after each write completes.

## Batch 4: Data Integrity

### Sync Field Stripping Notifications (`src/sync/SyncManager.ts`)

`stripUnsupportedFields()` returns both stripped data and list of stripped field names. Caller shows toast via `uiStore.setToast()` and logs to sync status screen.

### Jira Colon Separator (`src/auth/jira.ts`)

Switch from `:` delimiter to `\0` (null byte) for joining email+token. Add backward compatibility: if `getJiraCredentials` finds no `\0`, fall back to `:` split.

### Test DB Leaks (`factory.test.ts`, CLI tests)

Add `store.getState().destroy()` in `afterEach` for test files that create Storage instances without cleanup.

### AbortController Timeout Leak (`update-checker.ts`)

Add `clearTimeout` in a `finally` block after the fetch to prevent timer leak when fetch completes before timeout.
