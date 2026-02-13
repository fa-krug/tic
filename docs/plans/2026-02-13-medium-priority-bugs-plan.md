# Medium-Priority Bug Fixes (#28) Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix all 11 sub-issues from issue #28: null checks, JQL injection, race conditions, data loss, auth polling limits, test leaks, and resource leaks.

**Architecture:** Four independent batches grouped by risk category: (1) Security, (2) Null safety, (3) Concurrency, (4) Data integrity. Each batch gets its own commit. TDD where possible — write failing tests first, then fix.

**Tech Stack:** TypeScript, Vitest, React/Ink (for useEffect fixes)

---

## Batch 1: Security

### Task 1: JQL Injection — Write failing test

**Files:**
- Test: `src/backends/jira/jira.test.ts`

**Step 1: Write the failing test**

Add a test that verifies project names with JQL special characters are properly escaped. The test should call `listWorkItems()` and verify the URL passed to the API contains a properly quoted project name.

```typescript
it('escapes project names with special characters in JQL', async () => {
  // Create a backend with a malicious project name
  const config = {
    site: 'test.atlassian.net',
    project: "My Project' OR 1=1 --",
    email: 'test@test.com',
    boardId: undefined,
  };
  // ... setup mock API, create JiraBackend
  await backend.listWorkItems();
  // Verify the JQL in the URL contains escaped quotes
  const calledUrl = mockApi.paginate.mock.calls[0][0];
  expect(calledUrl).toContain("project = 'My Project'' OR 1=1 --'");
});
```

Look at existing `jira.test.ts` for the mock pattern and adapt.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/jira/jira.test.ts -t "escapes project names"`
Expected: FAIL — project name is currently unquoted in JQL

### Task 2: JQL Injection — Implement fix

**Files:**
- Modify: `src/backends/jira/index.ts:170,176`

**Step 1: Add JQL escape helper**

Add a private method or module-level function in `src/backends/jira/index.ts`:

```typescript
/** Escape a value for use in JQL by wrapping in single quotes and doubling embedded quotes. */
function escapeJqlValue(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}
```

**Step 2: Apply to all JQL interpolations**

In `listWorkItems()`, change line 170 from:
```typescript
`project = ${this.config.project} AND sprint = ${sprint.id}`
```
to:
```typescript
`project = ${escapeJqlValue(this.config.project)} AND sprint = ${sprint.id}`
```

And line 176 from:
```typescript
`project = ${this.config.project}`
```
to:
```typescript
`project = ${escapeJqlValue(this.config.project)}`
```

Search the file for any other `this.config.project` interpolations into JQL and apply the same fix.

**Step 3: Run test to verify it passes**

Run: `npx vitest run src/backends/jira/jira.test.ts`
Expected: ALL PASS

### Task 3: OAuth Polling Limits — Write failing tests

**Files:**
- Test: `src/auth/github.test.ts`
- Test: `src/auth/ado.test.ts`

**Step 1: Write failing test for GitHub auth timeout**

Add to `src/auth/github.test.ts`:

```typescript
it('times out after expires_in seconds', async () => {
  // Mock device code response with short expires_in
  // Mock token poll to always return authorization_pending
  // Verify that authenticateGitHub rejects with expiry error
});
```

The test should mock `fetch` to return a device code with `expires_in: 2` (2 seconds) and `interval: 1`, then always return `authorization_pending` on token polls. The function should reject with an error about expiry.

Use `vi.useFakeTimers()` — the test file already sets this up in `beforeEach`.

**Step 2: Write failing test for ADO auth timeout**

Same pattern in `src/auth/ado.test.ts`. Mock device code with short `expires_in`, mock token polls to always return `authorization_pending`, verify rejection.

**Step 3: Run tests to verify they fail**

Run: `npx vitest run src/auth/github.test.ts src/auth/ado.test.ts`
Expected: FAIL — both loop forever (will timeout in test runner)

### Task 4: OAuth Polling Limits — Implement fix

**Files:**
- Modify: `src/auth/github.ts:116-118`
- Modify: `src/auth/ado.ts:184-186`

**Step 1: Add timeout to GitHub polling loop**

In `src/auth/github.ts`, after line 116 (`let interval = deviceCode.interval * 1000;`), add:

```typescript
const deadline = Date.now() + deviceCode.expires_in * 1000;
```

Change line 118 from `while (true)` to:

```typescript
while (Date.now() < deadline) {
```

After the while loop, add:

```typescript
throw new Error('Device code has expired. Please restart the authentication flow.');
```

**Step 2: Add timeout to ADO polling loop**

Same pattern in `src/auth/ado.ts`. After line 184 (`let interval = deviceCode.interval * 1000;`), add deadline. Change `while (true)` on line 186 to `while (Date.now() < deadline)`. Add expiry error after the loop.

**Step 3: Run tests to verify they pass**

Run: `npx vitest run src/auth/github.test.ts src/auth/ado.test.ts`
Expected: ALL PASS

### Task 5: Commit Batch 1

```
git add src/backends/jira/index.ts src/backends/jira/jira.test.ts src/auth/github.ts src/auth/github.test.ts src/auth/ado.ts src/auth/ado.test.ts
git commit -m "fix(security): escape JQL project names and add OAuth polling timeout (#28)"
```

---

## Batch 2: Null Safety

### Task 6: GitHub mapper null author — Write failing test

**Files:**
- Test: `src/backends/github/mappers.test.ts`

**Step 1: Write failing test**

Add to the `mapCommentToComment` describe block (or create one if it doesn't exist):

```typescript
it('handles null author (deleted user)', () => {
  const ghComment = {
    author: null as unknown as { login: string },
    createdAt: '2026-01-16T09:00:00Z',
    body: 'Ghost comment',
  };
  const comment = mapCommentToComment(ghComment);
  expect(comment.author).toBe('unknown');
});
```

Also add a test for `mapIssueToWorkItem` when a comment has null author.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/github/mappers.test.ts`
Expected: FAIL — TypeError on null.login

### Task 7: GitHub mapper null author — Implement fix

**Files:**
- Modify: `src/backends/github/mappers.ts:18,32`

**Step 1: Update GhComment interface**

Line 17-21: Change `author` to allow null:

```typescript
export interface GhComment {
  author: { login: string } | null;
  createdAt: string;
  body: string;
}
```

**Step 2: Add null check in mapCommentToComment**

Line 32: Change from:
```typescript
author: ghComment.author.login,
```
to:
```typescript
author: ghComment.author?.login ?? 'unknown',
```

**Step 3: Run test to verify it passes**

Run: `npx vitest run src/backends/github/mappers.test.ts`
Expected: ALL PASS

### Task 8: Jira mapper non-null assertion — Write failing test

**Files:**
- Test: `src/backends/jira/mappers.test.ts`

**Step 1: Write failing test**

Add to the existing test file (create `extractDependsOn` describe block if needed):

```typescript
describe('extractDependsOn', () => {
  it('extracts keys from blocking links', () => {
    const links = [
      {
        type: { inward: 'is blocked by' },
        inwardIssue: { key: 'PROJ-10' },
      },
    ];
    expect(extractDependsOn(links as JiraIssueLink[])).toEqual(['PROJ-10']);
  });

  it('skips links with null inwardIssue', () => {
    const links = [
      {
        type: { inward: 'is blocked by' },
        inwardIssue: null,
      },
    ];
    expect(extractDependsOn(links as JiraIssueLink[])).toEqual([]);
  });

  it('returns empty for undefined links', () => {
    expect(extractDependsOn(undefined)).toEqual([]);
  });
});
```

You'll need to import `JiraIssueLink` type — check `src/backends/jira/types.ts` for the exact export name.

**Step 2: Run test to verify current behavior**

Run: `npx vitest run src/backends/jira/mappers.test.ts`
Expected: Tests should pass (the current code works, but we want to remove the `!` assertion)

### Task 9: Jira mapper non-null assertion — Implement fix

**Files:**
- Modify: `src/backends/jira/mappers.ts:96-101`

**Step 1: Replace filter+map with flatMap**

Change lines 96-101 from:
```typescript
return links
  .filter(
    (link) =>
      link.type.inward === 'is blocked by' && link.inwardIssue != null,
  )
  .map((link) => link.inwardIssue!.key);
```
to:
```typescript
return links.flatMap((link) =>
  link.type.inward === 'is blocked by' && link.inwardIssue != null
    ? [link.inwardIssue.key]
    : [],
);
```

**Step 2: Run tests**

Run: `npx vitest run src/backends/jira/mappers.test.ts`
Expected: ALL PASS

### Task 10: ADO getAssignees null check — Write failing test

**Files:**
- Test: `src/backends/ado/ado.test.ts`

**Step 1: Write failing test**

Add a test that mocks the team members API to return an entry with `identity: null` or `identity: { displayName: undefined }`. Verify `getAssignees()` filters it out instead of crashing.

Look at existing `ado.test.ts` for mock patterns.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/ado/ado.test.ts -t "null identity"`
Expected: FAIL — TypeError on null.displayName

### Task 11: ADO getAssignees null check — Implement fix

**Files:**
- Modify: `src/backends/ado/index.ts:155`

**Step 1: Add defensive access**

Change line 155 from:
```typescript
return result.value.map((m) => m.identity.displayName);
```
to:
```typescript
return result.value
  .map((m) => m.identity?.displayName)
  .filter((name): name is string => !!name);
```

**Step 2: Run test**

Run: `npx vitest run src/backends/ado/ado.test.ts`
Expected: ALL PASS

### Task 12: CLI array bounds — Write failing test

**Files:**
- Test: `src/cli/__tests__/item.test.ts`

**Step 1: Write failing test**

Add a test for `item create` where the backend returns empty types/statuses arrays. Verify it doesn't crash and uses sensible defaults.

Look at existing `item.test.ts` for the mock/setup pattern.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/cli/__tests__/item.test.ts -t "empty types"`
Expected: FAIL — crash on undefined[0]

### Task 13: CLI array bounds — Implement fix

**Files:**
- Modify: `src/cli/commands/item.ts:71-72`

**Step 1: Add fallbacks**

Change line 71 from:
```typescript
type: opts.type ?? (types.includes('task') ? 'task' : types[0]!),
```
to:
```typescript
type: opts.type ?? (types.includes('task') ? 'task' : (types[0] ?? 'task')),
```

Change line 72 from:
```typescript
status: opts.status ?? statuses[0]!,
```
to:
```typescript
status: opts.status ?? (statuses[0] ?? 'open'),
```

**Step 2: Run test**

Run: `npx vitest run src/cli/__tests__/item.test.ts`
Expected: ALL PASS

### Task 14: Commit Batch 2

```
git add src/backends/github/mappers.ts src/backends/github/mappers.test.ts src/backends/jira/mappers.ts src/backends/jira/mappers.test.ts src/backends/ado/index.ts src/backends/ado/ado.test.ts src/cli/commands/item.ts src/cli/__tests__/item.test.ts
git commit -m "fix(null-safety): add null checks in mappers, CLI array bounds (#28)"
```

---

## Batch 3: Concurrency

### Task 15: ADO token refresh mutex — Write failing test

**Files:**
- Test: `src/backends/ado/api.test.ts`

**Step 1: Write failing test**

Add a test that triggers two concurrent 401 responses. Mock `refreshAdoToken` to track call count. Verify it's called exactly once (mutex prevents double-refresh).

```typescript
it('refreshes token only once on concurrent 401s', async () => {
  // Mock first call returns 401, second (retry) returns 200
  // Fire two requests concurrently
  // Verify refreshAdoToken called exactly once
});
```

You'll need to mock `getAdoRefreshToken` and `refreshAdoToken` from `../auth/ado.js`.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/ado/api.test.ts -t "concurrent 401"`
Expected: FAIL — refreshAdoToken called twice

### Task 16: ADO token refresh mutex — Implement fix

**Files:**
- Modify: `src/backends/ado/api.ts:75-83`

**Step 1: Add refresh promise field**

Add to the `AdoApiClient` class:

```typescript
private refreshPromise: Promise<string | null> | null = null;
```

**Step 2: Replace inline refresh with mutex**

Change lines 76-83 from direct `refreshAdoToken` call to:

```typescript
if (response.status === 401 && this.auth.type === 'bearer') {
  const refreshToken = getAdoRefreshToken();
  if (refreshToken) {
    if (!this.refreshPromise) {
      this.refreshPromise = refreshAdoToken(refreshToken).finally(() => {
        this.refreshPromise = null;
      });
    }
    const newToken = await this.refreshPromise;
    if (newToken) {
      this.auth = { type: 'bearer', token: newToken };
      this.token = newToken;
      // ... retry logic unchanged
    }
  }
}
```

**Step 3: Run test**

Run: `npx vitest run src/backends/ado/api.test.ts`
Expected: ALL PASS

### Task 17: useEffect cancellation — Implement fix

**Files:**
- Modify: `src/components/Settings.tsx:95-107,110-123,125-135`
- Modify: `src/components/WorkItemList.tsx:230-243`

No test for this — React component effects are impractical to unit-test for cancellation. The fix is mechanical.

**Step 1: Fix Settings.tsx first useEffect (lines 95-108)**

```typescript
useEffect(() => {
  let cancelled = false;
  void checkAllBackendAvailability()
    .then((results) => {
      if (cancelled) return;
      setAvailability(
        Object.fromEntries(
          Object.entries(results).map(([b, ok]) => [
            b,
            ok ? 'available' : 'unavailable',
          ]),
        ) as Record<BackendType, AvailabilityStatus>,
      );
    })
    .catch(() => {});
  return () => { cancelled = true; };
}, []);
```

**Step 2: Fix Settings.tsx second useEffect (lines 110-123)**

```typescript
useEffect(() => {
  if (capabilities.templates && backend) {
    let cancelled = false;
    void backend
      .listTemplates()
      .then((t) => { if (!cancelled) setTemplates(t); })
      .catch((err: unknown) => {
        if (cancelled) return;
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Failed to load templates',
          );
      });
    return () => { cancelled = true; };
  }
}, [backend, capabilities.templates]);
```

**Step 3: Fix Settings.tsx third useEffect (lines 125-135)**

```typescript
useEffect(() => {
  let cancelled = false;
  setUpdateChecking(true);
  void checkForUpdate()
    .then((info) => {
      if (cancelled) return;
      setUpdateInfo(info);
      setUpdateChecking(false);
    })
    .catch(() => {
      if (!cancelled) setUpdateChecking(false);
    });
  return () => { cancelled = true; };
}, []);
```

**Step 4: Fix WorkItemList.tsx useEffect (lines 230-243)**

```typescript
useEffect(() => {
  if (capabilities.templates && backend) {
    let cancelled = false;
    void backend
      .listTemplates()
      .then((t) => { if (!cancelled) setTemplates(t); })
      .catch((err: unknown) => {
        if (cancelled) return;
        uiStore
          .getState()
          .setToast(
            err instanceof Error ? err.message : 'Failed to load templates',
          );
      });
    return () => { cancelled = true; };
  }
}, [backend, capabilities.templates]);
```

**Step 5: Verify build**

Run: `npm run build`
Expected: No type errors

### Task 18: recentCommandsStore write chain — Write failing test

**Files:**
- Locate or create: `src/stores/recentCommandsStore.test.ts`

**Step 1: Write test verifying error recovery**

```typescript
it('recovers from write errors', async () => {
  // Init store with a temp root
  // Mock writeFile to reject once, then succeed
  // Call addRecent twice
  // Verify second write still succeeds (chain not broken)
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/recentCommandsStore.test.ts`
Expected: FAIL — broken promise chain prevents second write

### Task 19: recentCommandsStore write chain — Implement fix

**Files:**
- Modify: `src/stores/recentCommandsStore.ts:49-53`

**Step 1: Add error handling**

Change lines 49-53 from:
```typescript
writeChain = writeChain.then(() =>
  mkdir(join(root, '.tic'), { recursive: true }).then(() =>
    writeFile(filePath, JSON.stringify(updated) + '\n'),
  ),
);
```
to:
```typescript
writeChain = writeChain
  .then(() =>
    mkdir(join(root, '.tic'), { recursive: true }).then(() =>
      writeFile(filePath, JSON.stringify(updated) + '\n'),
    ),
  )
  .catch(() => {});
```

The `.catch(() => {})` prevents a failed write from breaking subsequent writes in the chain. The chain naturally collapses as resolved promises are GC'd.

**Step 2: Run test**

Run: `npx vitest run src/stores/recentCommandsStore.test.ts`
Expected: ALL PASS

### Task 20: Commit Batch 3

```
git add src/backends/ado/api.ts src/backends/ado/api.test.ts src/components/Settings.tsx src/components/WorkItemList.tsx src/stores/recentCommandsStore.ts src/stores/recentCommandsStore.test.ts
git commit -m "fix(concurrency): add ADO token refresh mutex, useEffect cancellation, write chain error handling (#28)"
```

---

## Batch 4: Data Integrity

### Task 21: Sync field stripping notifications — Write failing test

**Files:**
- Test: `src/sync/SyncManager.test.ts`

**Step 1: Write failing test**

Create a mock remote with `fields.priority: false` and `fields.labels: false`. Push an item with priority and labels set. Verify the returned result includes information about stripped fields.

Look at the existing `createMockRemote()` helper in `SyncManager.test.ts` — create a variant with limited capabilities.

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/sync/SyncManager.test.ts -t "stripped fields"`
Expected: FAIL — no stripped field tracking exists

### Task 22: Sync field stripping notifications — Implement fix

**Files:**
- Modify: `src/sync/SyncManager.ts:152-172`

**Step 1: Track stripped fields**

Change `stripUnsupportedFields` to return both the data and stripped field names:

```typescript
private stripUnsupportedFields(data: NewWorkItem): { data: NewWorkItem; strippedFields: string[] } {
  const caps = this.remote.getCapabilities();
  const result = { ...data };
  const strippedFields: string[] = [];
  if (!caps.fields.priority && data.priority !== 'medium') {
    result.priority = 'medium';
    strippedFields.push('priority');
  }
  if (!caps.fields.assignee && data.assignee) {
    result.assignee = '';
    strippedFields.push('assignee');
  }
  if (!caps.fields.labels && data.labels.length > 0) {
    result.labels = [];
    strippedFields.push('labels');
  }
  if (!caps.fields.parent && data.parent) {
    result.parent = null;
    strippedFields.push('parent');
  }
  if (!caps.fields.dependsOn && data.dependsOn.length > 0) {
    result.dependsOn = [];
    strippedFields.push('dependsOn');
  }
  return { data: result, strippedFields };
}
```

**Step 2: Update caller to show notifications**

In `pushEntry()` (or wherever `stripUnsupportedFields` is called), destructure the result and if `strippedFields.length > 0`:

1. Import `uiStore` from `../stores/uiStore.js`
2. Show toast: `uiStore.getState().setToast(\`Sync: ${strippedFields.join(', ')} stripped (unsupported by remote)\`)`
3. Add to sync log (the existing `this.syncLog` array)

**Step 3: Run tests**

Run: `npx vitest run src/sync/SyncManager.test.ts`
Expected: ALL PASS

### Task 23: Jira colon separator — Write failing test

**Files:**
- Test: `src/auth/jira.test.ts`

**Step 1: Write failing test**

The test file already has `it('handles tokens containing colons')` which passes with the current `:` separator. Add a test for the new `\0` separator and backward compatibility:

```typescript
it('reads credentials stored with null byte separator', () => {
  mockGetToken.mockReturnValue('user@corp.com\0ABCdef123');
  const creds = getJiraCredentials('mycompany.atlassian.net');
  expect(creds).toEqual({ email: 'user@corp.com', token: 'ABCdef123' });
});

it('stores credentials with null byte separator', () => {
  setJiraCredentials('mycompany.atlassian.net', 'user@corp.com', 'token123');
  expect(mockSetToken).toHaveBeenCalledWith(
    'jira:mycompany.atlassian.net',
    'user@corp.com\0token123',
  );
});

it('falls back to colon separator for legacy credentials', () => {
  mockGetToken.mockReturnValue('user@corp.com:ABCdef123');
  const creds = getJiraCredentials('mycompany.atlassian.net');
  expect(creds).toEqual({ email: 'user@corp.com', token: 'ABCdef123' });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/auth/jira.test.ts`
Expected: FAIL — null byte separator test fails, store test expects `:` not `\0`

### Task 24: Jira colon separator — Implement fix

**Files:**
- Modify: `src/auth/jira.ts:10-21,28`

**Step 1: Update setJiraCredentials**

Change line 28 from:
```typescript
setToken(`${JIRA_ACCOUNT_PREFIX}${site}`, `${email}:${token}`);
```
to:
```typescript
setToken(`${JIRA_ACCOUNT_PREFIX}${site}`, `${email}\0${token}`);
```

**Step 2: Update getJiraCredentials with fallback**

Change lines 14-20 to:

```typescript
// Prefer null byte separator; fall back to colon for legacy credentials
let idx = stored.indexOf('\0');
if (idx < 0) {
  idx = stored.indexOf(':');
}
if (idx < 0) return null;

return {
  email: stored.slice(0, idx),
  token: stored.slice(idx + 1),
};
```

**Step 3: Run tests**

Run: `npx vitest run src/auth/jira.test.ts`
Expected: ALL PASS

### Task 25: Test DB leaks — Fix

**Files:**
- Modify: `src/backends/factory.test.ts` (and any other test files with DB leaks)

**Step 1: Find affected test files**

Search for test files that create `Storage` instances or call `backendDataStore.init()` without corresponding `destroy()` in `afterEach`. Check `factory.test.ts` and CLI test files.

**Step 2: Add cleanup**

Add `afterEach` hooks with `store.getState().destroy()` or `storage.close()` as appropriate. Follow the pattern used in other test files that already have proper cleanup.

**Step 3: Run affected tests**

Run: `npx vitest run src/backends/factory.test.ts src/cli/__tests__/`
Expected: ALL PASS (no change in behavior, just resource cleanup)

### Task 26: AbortController timeout leak — Fix

**Files:**
- Modify: `src/update-checker.ts:15-19`

**Step 1: Move clearTimeout to finally**

Change from:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

const response = await fetch(REGISTRY_URL, { signal: controller.signal });
clearTimeout(timeout);
```
to:
```typescript
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);

try {
  const response = await fetch(REGISTRY_URL, { signal: controller.signal });

  if (!response.ok) return null;

  const data = (await response.json()) as Record<string, unknown>;
  const latest = data['version'];
  if (typeof latest !== 'string') return null;

  return {
    current: VERSION,
    latest,
    updateAvailable: semver.gt(latest, VERSION),
  };
} finally {
  clearTimeout(timeout);
}
```

This replaces the existing try/catch structure. The outer `catch` (line 32) still handles any errors.

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

### Task 27: Commit Batch 4

```
git add src/sync/SyncManager.ts src/sync/SyncManager.test.ts src/auth/jira.ts src/auth/jira.test.ts src/backends/factory.test.ts src/cli/__tests__/ src/update-checker.ts
git commit -m "fix(data-integrity): sync field stripping notifications, Jira separator, test/timer leaks (#28)"
```

---

## Final Verification

### Task 28: Full test suite + lint + build

**Step 1: Run full verification**

```bash
npm run build && npm test && npm run lint && npm run format:check
```

Expected: ALL PASS, no lint errors, no format issues.

**Step 2: Update tic issue #28 status if all green**

Use: `tic update 28 --status done`
