# Error Handling Improvements Design

Issue: #27

## Overview

Fix 5 categories of error handling issues identified in codebase audit: unhandled promise rejections, missing error boundaries, silent sync failures, API error message leaking secrets, and missing fetch timeouts.

## 1. Unhandled Promise Rejections (~23 instances)

Add `.catch()` handlers to all `void` promise calls in UI components. Two categories:

- **Store operations** (`configStore.update()`, `backendDataStore.refresh()`, `reloadItem()`): catch and route to `uiStore.setToast()`.
- **Backend calls** (`backend.listTemplates()`, `backend.listWorkItems()`): catch and set local error state or use toast.

## 2. React Error Boundary

Add a single `ErrorBoundary` class component wrapping `<App>` in `src/index.tsx`. On error, render a simple Ink error screen showing the error message and "press q to quit" or "press r to retry". Must be a class component (required for `componentDidCatch`).

## 3. Silent Sync Failures (8 instances)

Replace `.catch(() => {})` with proper error propagation. The `SyncManager` already updates `syncStatus` with errors, and `Header.tsx` already displays `⚠ Sync failed`. For `syncManager.sync()` calls, remove the empty catch so SyncManager's internal error handling populates syncStatus. For `pushPending()` calls, catch and update sync status.

## 4. API Error Message Sanitization (11 instances)

Strip response bodies from all error messages. Replace:
```typescript
throw new Error(`HTTP ${response.status}: ${text}`);
```
with:
```typescript
throw new Error(`HTTP ${response.status}: Request failed`);
```

Update tests that assert on old format.

## 5. Fetch Timeouts (17+ calls)

Add a `withTimeout` utility that wraps fetch with `AbortController` + 15s timeout. Apply in:

- `BaseApiClient.fetch()` — covers most backends
- `GitHubApiClient` — GraphQL and pagination fetch calls
- `AdoApiClient` — fetch calls including token refresh
- Auth modules (`github.ts`, `ado.ts`, `gitlab.ts`) — polling and token exchange

Utility lives in `src/backends/shared/api-client.ts`.

## Decisions

- **Sync error notification**: Use existing Header sync indicator (already shows `⚠ Sync failed`)
- **Fetch timeout**: 15 seconds universal
- **API error bodies**: Strip entirely (just `HTTP {status}: Request failed`)
