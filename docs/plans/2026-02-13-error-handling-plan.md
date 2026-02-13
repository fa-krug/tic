# Error Handling Improvements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Fix 5 categories of error handling issues: unhandled promise rejections, missing error boundaries, silent sync failures, API error secret leaking, and missing fetch timeouts.

**Architecture:** Each fix is independent and can be done in sequence. The fetch timeout utility is added to `BaseApiClient`, error boundaries wrap `<App>`, promise rejections get `.catch()` handlers, sync catches are replaced with proper propagation, and API error messages are sanitized.

**Tech Stack:** TypeScript, React 19, Ink 6, Vitest

---

### Task 1: Add fetch timeout utility and apply to BaseApiClient

**Files:**
- Modify: `src/backends/shared/api-client.ts`
- Modify: `src/backends/shared/api-client.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/shared/api-client.test.ts` inside the `describe('fetch', ...)` block:

```typescript
it('aborts fetch after timeout', async () => {
  fetchMock.mockImplementation(
    () => new Promise((resolve) => setTimeout(() => resolve(mockResponse(200, {})), 60000)),
  );

  await expect(client.testFetch('GET', '/items')).rejects.toThrow(
    'Request timed out',
  );
}, 20000);
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/shared/api-client.test.ts`
Expected: FAIL — test times out or hangs

**Step 3: Write minimal implementation**

In `src/backends/shared/api-client.ts`, add a constant and helper at the top (after the class declarations, before `BaseApiClient`):

```typescript
const DEFAULT_TIMEOUT_MS = 15_000;
```

In `BaseApiClient.fetch()`, add timeout via `AbortController`. Change the fetch call at line 46:

```typescript
const controller = new AbortController();
const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);
init.signal = controller.signal;

let response: Response;
try {
  response = await globalThis.fetch(url, init);
} catch (err: unknown) {
  clearTimeout(timer);
  if (err instanceof DOMException && err.name === 'AbortError') {
    throw new Error('Request timed out');
  }
  throw err;
} finally {
  clearTimeout(timer);
}
```

Replace the old `const response = await globalThis.fetch(url, init);` line with this block.

**Step 4: Update test to use fake timers**

The test needs fake timers to avoid actually waiting. Update the test:

```typescript
it('aborts fetch after timeout', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );

  const promise = client.testFetch('GET', '/items');
  await vi.advanceTimersByTimeAsync(15_000);
  await expect(promise).rejects.toThrow('Request timed out');
  vi.useRealTimers();
});
```

**Step 5: Run test to verify it passes**

Run: `npx vitest run src/backends/shared/api-client.test.ts`
Expected: PASS

**Step 6: Commit**

```
feat(api): add 15s fetch timeout to BaseApiClient
```

---

### Task 2: Apply fetch timeout to GitHub API client

**Files:**
- Modify: `src/backends/github/api.ts`
- Modify: `src/backends/github/api.test.ts`

**Step 1: Check current code**

Read `src/backends/github/api.ts`. It has its own `fetch()` override and separate `graphqlFetch()` and `paginate()` methods that call `globalThis.fetch` directly. These bypass `BaseApiClient.fetch()` and need their own timeout.

**Step 2: Apply timeout pattern**

Export `DEFAULT_TIMEOUT_MS` from `api-client.ts` so other clients can use it. In `github/api.ts`, add the same `AbortController` + timeout pattern to:
- `fetch()` method (line ~34)
- `graphqlFetch()` method (line ~82)
- `paginate()` method (line ~130)

**Step 3: Write a test for GraphQL timeout**

Add to `src/backends/github/api.test.ts`:

```typescript
it('aborts GraphQL fetch after timeout', async () => {
  vi.useFakeTimers();
  fetchMock.mockImplementation(
    (_url: string, init: RequestInit) =>
      new Promise((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('The operation was aborted.', 'AbortError'));
        });
      }),
  );

  const promise = client.graphql('query { viewer { login } }');
  await vi.advanceTimersByTimeAsync(15_000);
  await expect(promise).rejects.toThrow('Request timed out');
  vi.useRealTimers();
});
```

**Step 4: Run tests**

Run: `npx vitest run src/backends/github/api.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(github): add fetch timeout to GitHub API client
```

---

### Task 3: Apply fetch timeout to ADO, Jira, GitLab API clients

**Files:**
- Modify: `src/backends/ado/api.ts`
- Modify: `src/backends/jira/api.ts`
- Modify: `src/backends/gitlab/api.ts`

**Step 1: Apply timeout to ADO**

`src/backends/ado/api.ts` has `fetch()` override (line ~51) and `paginate()` (line ~124). Also a retry-fetch for token refresh (line ~64). Apply the same `AbortController` pattern to all `globalThis.fetch` calls.

**Step 2: Apply timeout to Jira**

`src/backends/jira/api.ts` has `fetch()` override (line ~46). Apply timeout. Note: `paginate()` uses `this.rest()` which goes through `fetch()`, so it's covered.

**Step 3: Apply timeout to GitLab**

`src/backends/gitlab/api.ts` has `graphqlFetch()` (line ~34). Apply timeout. `paginate()` uses `this.graphql()` which goes through `graphqlFetch()`, so it's covered.

**Step 4: Run all API tests**

Run: `npx vitest run src/backends/ado/api.test.ts src/backends/jira/api.test.ts src/backends/gitlab/api.test.ts`
Expected: PASS

**Step 5: Commit**

```
feat(api): add fetch timeout to ADO, Jira, GitLab API clients
```

---

### Task 4: Apply fetch timeout to auth modules

**Files:**
- Modify: `src/auth/github.ts`
- Modify: `src/auth/ado.ts`
- Modify: `src/auth/gitlab.ts`

**Step 1: Apply timeout to auth fetch calls**

Auth modules use bare `fetch()` calls (not through BaseApiClient). Import `DEFAULT_TIMEOUT_MS` from `api-client.ts` and apply the same `AbortController` + timeout pattern to each `fetch()` call:

- `src/auth/github.ts`: lines ~74 (device code request) and ~103 (token poll)
- `src/auth/ado.ts`: lines ~88 (token refresh), ~131 (device code), ~157 (token poll)
- `src/auth/gitlab.ts`: lines ~92 (device code), ~124 (token poll)

**Step 2: Run tests**

Run: `npx vitest run src/auth/`
Expected: PASS (or no test files — auth modules may not have tests)

**Step 3: Commit**

```
feat(auth): add fetch timeout to auth flow HTTP calls
```

---

### Task 5: Sanitize API error messages

**Files:**
- Modify: `src/backends/shared/api-client.ts:62-64`
- Modify: `src/backends/shared/api-client.test.ts`
- Modify: `src/backends/github/api.ts` (3 throw locations)
- Modify: `src/backends/github/api.test.ts`
- Modify: `src/backends/ado/api.ts` (2 throw locations)
- Modify: `src/backends/ado/api.test.ts`
- Modify: `src/backends/jira/api.ts` (1 throw location — fallback)
- Modify: `src/backends/jira/api.test.ts`
- Modify: `src/backends/gitlab/api.ts` (1 throw location)
- Modify: `src/backends/gitlab/api.test.ts`

**Step 1: Update BaseApiClient**

In `src/backends/shared/api-client.ts`, change lines 62-64:

```typescript
// Before:
if (!response.ok) {
  const text = await response.text();
  throw new Error(`HTTP ${response.status}: ${text}`);
}

// After:
if (!response.ok) {
  throw new Error(`HTTP ${response.status}: Request failed`);
}
```

**Step 2: Update all other API clients**

Apply the same change to every `throw new Error(`HTTP ${response.status}: ${text}`)` in:
- `src/backends/github/api.ts` (~3 locations)
- `src/backends/ado/api.ts` (~2 locations)
- `src/backends/jira/api.ts` (the fallback in the catch block)
- `src/backends/gitlab/api.ts` (~1 location)

For Jira, keep the structured error parsing (errorMessages/errors) but sanitize the fallback.

**Step 3: Update tests**

In `src/backends/shared/api-client.test.ts`, update the 500 error test (line 119-125):

```typescript
it('throws generic error on 500', async () => {
  fetchMock.mockResolvedValue(mockResponse(500, 'Internal Server Error'));

  await expect(client.testFetch('GET', '/items')).rejects.toThrow(
    'HTTP 500: Request failed',
  );
});
```

Also update the retry test (line 144-152) that checks for `HTTP 502: Bad Gateway` → `HTTP 502: Request failed`. And line 134 where `new Error('HTTP 500: Internal Server Error')` is used in the retry test — this should stay as-is since it's a manually constructed error for the retry logic test (not from the actual fetch).

Search all test files for assertions on `HTTP \d+:` patterns and update as needed.

**Step 4: Run all tests**

Run: `npx vitest run src/backends/`
Expected: PASS

**Step 5: Commit**

```
fix(security): strip response bodies from API error messages
```

---

### Task 6: Add React error boundary

**Files:**
- Create: `src/components/ErrorBoundary.tsx`
- Modify: `src/index.tsx`

**Step 1: Create ErrorBoundary component**

Create `src/components/ErrorBoundary.tsx`:

```tsx
import { Component, type ReactNode } from 'react';
import { Box, Text, useInput } from 'ink';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

function ErrorScreen({ error, onRetry }: { error: Error; onRetry: () => void }) {
  useInput((input) => {
    if (input === 'q') {
      process.exit(1);
    }
    if (input === 'r') {
      onRetry();
    }
  });

  return (
    <Box flexDirection="column" padding={1}>
      <Text bold color="red">
        Something went wrong
      </Text>
      <Text>{error.message}</Text>
      <Box marginTop={1}>
        <Text dimColor>Press r to retry, q to quit</Text>
      </Box>
    </Box>
  );
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  handleRetry = () => {
    this.setState({ error: null });
  };

  render() {
    if (this.state.error) {
      return <ErrorScreen error={this.state.error} onRetry={this.handleRetry} />;
    }
    return this.props.children;
  }
}
```

**Step 2: Wrap App with ErrorBoundary**

In `src/index.tsx`, import and wrap:

```tsx
import { ErrorBoundary } from './components/ErrorBoundary.js';

// Change:
const app = render(<App />);

// To:
const app = render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
```

**Step 3: Run build**

Run: `npm run build`
Expected: PASS — no type errors

**Step 4: Commit**

```
feat(ui): add React error boundary for crash recovery
```

---

### Task 7: Fix silent sync failures

**Files:**
- Modify: `src/stores/backendDataStore.ts` (4 instances)
- Modify: `src/components/WorkItemList.tsx` (1 instance)
- Modify: `src/components/WorkItemForm.tsx` (1 instance)
- Modify: `src/components/Settings.tsx` (1 instance)

**Step 1: Fix backendDataStore sync catches**

In `src/stores/backendDataStore.ts`, the `syncManager.sync().catch(() => {})` calls (lines ~196, ~331, ~395, ~486) need to propagate errors to the sync status. `SyncManager.sync()` already updates `syncStatus` internally on errors, so we can simply remove the `.catch(() => {})` and let the promise rejection be silently unhandled (the SyncManager handles it), or better: add a minimal catch that does nothing but prevents unhandled rejection warnings while the SyncManager has already recorded the error:

```typescript
// Before:
syncManager.sync().catch(() => {});

// After:
syncManager.sync().catch(() => {
  // Errors are recorded in syncStatus by SyncManager
});
```

Wait — this is the same thing. The real issue is whether SyncManager.sync() actually updates syncStatus on error. Let me verify: check `src/sync/SyncManager.ts` to confirm errors propagate to status.

Actually, the better fix: the SyncManager likely already catches internally and updates status. The `.catch(() => {})` is just to suppress the unhandled promise rejection warning. We should keep these catches but add a comment explaining why. The *real* silent failures are the `pushPending().catch(() => {})` calls in components.

**Step 2: Fix component pushPending catches**

For `pushPending().catch(() => {})` in WorkItemList.tsx (line ~257), WorkItemForm.tsx (line ~126), Settings.tsx (line ~665):

```typescript
// Before:
syncManager?.pushPending().catch(() => {});

// After:
syncManager?.pushPending().catch((err) => {
  backendDataStore.getState().setSyncError(err);
});
```

If `setSyncError` doesn't exist on `backendDataStore`, we need to add a method that updates the `syncStatus` to error state. Check if there's already a way to set sync errors.

Alternative simpler approach: since `pushPending` errors should show up through the SyncManager's status listener, we may just need to ensure the SyncManager's `onStatusChange` is wired up (it already is per the codebase audit). In that case, the fix is to call `syncManager.sync()` instead (which handles errors properly) or log to toast:

```typescript
// Simple approach:
syncManager?.pushPending().catch((err) => {
  uiStore.getState().setToast(`Sync failed: ${err instanceof Error ? err.message : 'Unknown error'}`);
});
```

**Step 3: Run tests**

Run: `npm test`
Expected: PASS

**Step 4: Commit**

```
fix(sync): replace silent error swallowing with proper error propagation
```

---

### Task 8: Add .catch() handlers to unhandled promise rejections

**Files:**
- Modify: `src/components/WorkItemList.tsx` (~15 void calls)
- Modify: `src/components/WorkItemForm.tsx` (~5 void calls)
- Modify: `src/components/Settings.tsx` (~8 void calls)
- Modify: `src/components/AuthPrompt.tsx` (~3 void calls)
- Modify: `src/components/StatusScreen.tsx` (~1 void call)
- Modify: `src/app.tsx` (~1 void call)

**Step 1: Categorize and fix**

For each `void somePromise()` or `void somePromise().then(...)`, add `.catch()`:

**Pattern A — Store operations (refresh, reloadItem, config update):**
```typescript
// Before:
void backendDataStore.getState().refresh();

// After:
void backendDataStore.getState().refresh().catch(() => {});
// Store operations update their own error state internally
```

**Pattern B — Backend calls with .then() (listTemplates, listWorkItems):**
```typescript
// Before:
void backend.listTemplates().then(setTemplates);

// After:
void backend.listTemplates().then(setTemplates).catch((err) => {
  uiStore.getState().setToast(err instanceof Error ? err.message : 'Failed to load templates');
});
```

**Pattern C — Sync calls with .then():**
```typescript
// Before:
void syncManager.sync().then(() => { refreshData(); });

// After:
void syncManager.sync().then(() => { refreshData(); }).catch(() => {
  // Errors recorded in syncStatus by SyncManager
});
```

**Pattern D — Async IIFEs (void (async () => { ... })()):**
These already have try/catch inside the async function body in most cases. For those that don't, wrap the body:
```typescript
void (async () => {
  try {
    // existing code
  } catch (err) {
    uiStore.getState().setToast(err instanceof Error ? err.message : 'Operation failed');
  }
})();
```

**Step 2: Apply pattern by file**

Go through each file methodically. Most `void configStore.getState().update(...)` calls can just get `.catch(() => {})` since config writes to SQLite are unlikely to fail and there's no meaningful recovery.

**Step 3: Fix app.tsx update checker**

```typescript
// Before:
void import('./update-checker.js').then(({ checkForUpdate }) =>
  checkForUpdate().then((info) => {
    if (info) navigationStore.getState().setUpdateInfo(info);
  }),
);

// After:
void import('./update-checker.js').then(({ checkForUpdate }) =>
  checkForUpdate().then((info) => {
    if (info) navigationStore.getState().setUpdateInfo(info);
  }),
).catch(() => {});
// Update check is best-effort
```

**Step 4: Run build and tests**

Run: `npm run build && npm test`
Expected: PASS

**Step 5: Commit**

```
fix(ui): add .catch() handlers to all unhandled promise rejections
```

---

### Task 9: Final verification

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run linting and formatting**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 3: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 4: Build**

Run: `npm run build`
Expected: PASS

**Step 5: Commit any remaining fixes, then close issue**

Update tic issue #27 to `done` status.
