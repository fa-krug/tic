# Pull Request Support Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add full PR lifecycle management (list, show, create, merge, close) as a separate entity alongside work items, with GitHub as the only remote backend in v1.

**Architecture:** PRs are a parallel entity to work items with their own types, SQLite tables, backend interface (`PrBackend`), screens, CLI commands, and MCP tools. Bidirectional links between PRs and work items via a join table. Merge/close go directly to the remote API (not queued). Local SQLite storage with sync mirrors the work item pattern.

**Tech Stack:** TypeScript, React 19, Ink 6, Drizzle ORM, better-sqlite3, GitHub REST API, Zustand, Vitest

---

## Task 1: Add PullRequest Types

**Files:**
- Modify: `src/types.ts`

**Step 1: Write the failing test**

Create `src/types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { PullRequest, NewPullRequest } from './types.js';

describe('PullRequest types', () => {
  it('accepts a valid PullRequest object', () => {
    const pr: PullRequest = {
      id: 'pr-1',
      number: 42,
      title: 'Fix login bug',
      description: 'Fixes the login timeout issue',
      status: 'open',
      sourceBranch: 'fix/login-bug',
      targetBranch: 'main',
      author: 'octocat',
      linkedItems: ['1', '5'],
      created: '2026-02-14T00:00:00Z',
      updated: '2026-02-14T00:00:00Z',
      url: 'https://github.com/owner/repo/pull/42',
    };
    expect(pr.number).toBe(42);
    expect(pr.status).toBe('open');
    expect(pr.linkedItems).toEqual(['1', '5']);
  });

  it('accepts a valid NewPullRequest object', () => {
    const newPr: NewPullRequest = {
      title: 'Add feature',
      sourceBranch: 'feat/new-feature',
    };
    expect(newPr.title).toBe('Add feature');
    expect(newPr.targetBranch).toBeUndefined();
    expect(newPr.linkedItems).toBeUndefined();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/types.test.ts`
Expected: FAIL — `PullRequest` and `NewPullRequest` types not exported from `./types.js`

**Step 3: Add PullRequest and NewPullRequest interfaces to `src/types.ts`**

After the `Template` interface (line 55), add:

```typescript
export type PullRequestStatus = 'open' | 'merged' | 'closed' | 'draft';

export interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  status: PullRequestStatus;
  sourceBranch: string;
  targetBranch: string;
  author: string;
  linkedItems: string[];
  created: string;
  updated: string;
  url: string;
}

export interface NewPullRequest {
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch?: string;
  linkedItems?: string[];
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/types.ts src/types.test.ts
git commit -m "feat: add PullRequest and NewPullRequest types"
```

---

## Task 2: Add PrBackend Interface and PrCapabilities

**Files:**
- Modify: `src/backends/types.ts`

**Step 1: Write the failing test**

Create `src/backends/pr-types.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import type { PrBackend, PrCapabilities } from './types.js';

describe('PrCapabilities', () => {
  it('defines expected capability shape', () => {
    const caps: PrCapabilities = {
      pullRequests: true,
      merge: true,
      create: true,
    };
    expect(caps.pullRequests).toBe(true);
  });

  it('can represent a backend with no PR support', () => {
    const caps: PrCapabilities = {
      pullRequests: false,
      merge: false,
      create: false,
    };
    expect(caps.pullRequests).toBe(false);
  });
});

describe('PrBackend interface', () => {
  it('type-checks a mock implementation', () => {
    const mock: PrBackend = {
      getPrCapabilities: () => ({ pullRequests: false, merge: false, create: false }),
      listPullRequests: async () => [],
      getPullRequest: async () => null,
      createPullRequest: async () => { throw new Error('not supported'); },
      updatePullRequest: async () => { throw new Error('not supported'); },
      mergePullRequest: async () => { throw new Error('not supported'); },
      closePullRequest: async () => { throw new Error('not supported'); },
      getLinkedPullRequests: async () => [],
      getLinkedItems: async () => [],
      linkItem: async () => {},
      unlinkItem: async () => {},
    };
    expect(mock.getPrCapabilities().pullRequests).toBe(false);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/pr-types.test.ts`
Expected: FAIL — `PrBackend` and `PrCapabilities` not exported

**Step 3: Add PrBackend and PrCapabilities to `src/backends/types.ts`**

After the `BaseBackend` class (line 252), add:

```typescript
export interface PrCapabilities {
  pullRequests: boolean;
  merge: boolean;
  create: boolean;
}

export interface PrBackend {
  getPrCapabilities(): PrCapabilities;
  listPullRequests(): Promise<PullRequest[]>;
  getPullRequest(id: string): Promise<PullRequest | null>;
  createPullRequest(pr: NewPullRequest): Promise<PullRequest>;
  updatePullRequest(id: string, updates: Partial<NewPullRequest>): Promise<PullRequest>;
  mergePullRequest(id: string): Promise<PullRequest>;
  closePullRequest(id: string): Promise<PullRequest>;
  getLinkedPullRequests(itemId: string): Promise<PullRequest[]>;
  getLinkedItems(prId: string): Promise<string[]>;
  linkItem(prId: string, itemId: string): Promise<void>;
  unlinkItem(prId: string, itemId: string): Promise<void>;
}

export function isPrBackend(backend: Backend): backend is Backend & PrBackend {
  return 'listPullRequests' in backend;
}
```

Also add imports at the top of the file:

```typescript
import type { PullRequest, NewPullRequest } from '../types.js';
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/backends/pr-types.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/backends/types.ts src/backends/pr-types.test.ts
git commit -m "feat: add PrBackend interface and PrCapabilities"
```

---

## Task 3: Add SQLite Schema for Pull Requests

**Files:**
- Modify: `src/storage/schema.ts`
- Create: `drizzle/0004_pull_requests.sql` (migration)

**Step 1: Add Drizzle table definitions to `src/storage/schema.ts`**

After the `colorMappings` table (line 283), add:

```typescript
// 23. Pull Requests
export const pullRequests = sqliteTable(
  'pull_requests',
  {
    id: text('id').primaryKey(),
    number: integer('number').notNull(),
    title: text('title').notNull(),
    description: text('description').notNull().default(''),
    status: text('status').notNull(),
    sourceBranch: text('source_branch').notNull(),
    targetBranch: text('target_branch').notNull(),
    author: text('author').notNull().default(''),
    url: text('url').notNull().default(''),
    remoteId: text('remote_id'),
    created: text('created').notNull(),
    updated: text('updated').notNull(),
  },
  (t) => [
    index('idx_pr_status').on(t.status),
    index('idx_pr_remote').on(t.remoteId),
  ],
);

// 24. PR-Item Links (junction for bidirectional linking)
export const prItemLinks = sqliteTable(
  'pr_item_links',
  {
    prId: text('pr_id')
      .notNull()
      .references(() => pullRequests.id, { onDelete: 'cascade' }),
    itemId: text('item_id')
      .notNull()
      .references(() => workItems.id, { onDelete: 'cascade' }),
  },
  (t) => [
    primaryKey({ columns: [t.prId, t.itemId] }),
    index('idx_pr_link_item').on(t.itemId),
  ],
);
```

**Step 2: Create migration file**

Create `drizzle/0004_pull_requests.sql`:

```sql
CREATE TABLE `pull_requests` (
  `id` text PRIMARY KEY NOT NULL,
  `number` integer NOT NULL,
  `title` text NOT NULL,
  `description` text DEFAULT '' NOT NULL,
  `status` text NOT NULL,
  `source_branch` text NOT NULL,
  `target_branch` text NOT NULL,
  `author` text DEFAULT '' NOT NULL,
  `url` text DEFAULT '' NOT NULL,
  `remote_id` text,
  `created` text NOT NULL,
  `updated` text NOT NULL
);

CREATE INDEX `idx_pr_status` ON `pull_requests` (`status`);
CREATE INDEX `idx_pr_remote` ON `pull_requests` (`remote_id`);

CREATE TABLE `pr_item_links` (
  `pr_id` text NOT NULL REFERENCES `pull_requests`(`id`) ON DELETE CASCADE,
  `item_id` text NOT NULL REFERENCES `work_items`(`id`) ON DELETE CASCADE,
  PRIMARY KEY (`pr_id`, `item_id`)
);

CREATE INDEX `idx_pr_link_item` ON `pr_item_links` (`item_id`);
```

**Step 3: Update the Drizzle migration journal**

Read `drizzle/meta/_journal.json` and add a new entry for migration `0004_pull_requests`. The entry follows the existing pattern (idx, version, when timestamp, tag, breakpoints).

**Step 4: Run build to verify schema compiles**

Run: `npm run build`
Expected: PASS

**Step 5: Write a test that creates a database and verifies the tables exist**

Create `src/storage/pr-schema.test.ts`:

```typescript
import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { createDatabase } from './db.js';
import { pullRequests, prItemLinks } from './schema.js';

describe('PR schema', () => {
  let tmpDir: string;
  let db: ReturnType<typeof createDatabase>;

  afterEach(() => {
    // cleanup handled by OS temp
  });

  it('creates pull_requests table', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tic-test-'));
    db = createDatabase(tmpDir);
    const result = db
      .select()
      .from(pullRequests)
      .all();
    expect(result).toEqual([]);
  });

  it('creates pr_item_links table', () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'tic-test-'));
    db = createDatabase(tmpDir);
    const result = db
      .select()
      .from(prItemLinks)
      .all();
    expect(result).toEqual([]);
  });
});
```

**Step 6: Run test to verify**

Run: `npx vitest run src/storage/pr-schema.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add src/storage/schema.ts drizzle/0004_pull_requests.sql drizzle/meta/_journal.json src/storage/pr-schema.test.ts
git commit -m "feat: add SQLite schema and migration for pull requests"
```

---

## Task 4: Implement PR Storage Methods

**Files:**
- Modify: `src/storage/index.ts`
- Modify: `src/storage/mappers.ts`
- Create: `src/storage/pr.test.ts`

**Step 1: Add PR mappers to `src/storage/mappers.ts`**

Add functions to map between Drizzle rows and `PullRequest` objects. Follow the same pattern as `rowToWorkItem()` and `workItemToRow()`.

```typescript
export function rowToPullRequest(
  row: typeof pullRequests.$inferSelect,
  linkedItemIds: string[],
): PullRequest {
  return {
    id: row.id,
    number: row.number,
    title: row.title,
    description: row.description,
    status: row.status as PullRequestStatus,
    sourceBranch: row.sourceBranch,
    targetBranch: row.targetBranch,
    author: row.author,
    linkedItems: linkedItemIds,
    created: row.created,
    updated: row.updated,
    url: row.url,
  };
}
```

**Step 2: Add PR methods to `Storage` class in `src/storage/index.ts`**

Have `Storage` implement `PrBackend`. Add these methods:

- `getPrCapabilities()` — returns `{ pullRequests: true, merge: false, create: false }` (storage is local-only)
- `listPullRequests()` — query `pullRequests` table, join with `prItemLinks` to populate `linkedItems`
- `getPullRequest(id)` — single PR lookup with linked items
- `importPullRequest(pr: PullRequest)` — upsert a PR (used by sync to write remote PRs locally)
- `getLinkedPullRequests(itemId)` — query `prItemLinks` by `itemId`, join with `pullRequests`
- `getLinkedItems(prId)` — query `prItemLinks` by `prId`, return item IDs
- `linkItem(prId, itemId)` — insert into `prItemLinks`
- `unlinkItem(prId, itemId)` — delete from `prItemLinks`
- `createPullRequest()`, `updatePullRequest()`, `mergePullRequest()`, `closePullRequest()` — throw `UnsupportedOperationError` (local storage can't do these)

**Step 3: Write tests for Storage PR methods**

Create `src/storage/pr.test.ts` with tests for:

1. `listPullRequests()` returns empty array initially
2. `importPullRequest()` inserts a PR, `getPullRequest()` retrieves it
3. `importPullRequest()` with `linkedItems` creates join table entries
4. `getLinkedPullRequests(itemId)` returns PRs linked to a work item
5. `getLinkedItems(prId)` returns item IDs linked to a PR
6. `linkItem()` and `unlinkItem()` modify the join table
7. `createPullRequest()` throws UnsupportedOperationError
8. Deleting a work item cascades to `prItemLinks`
9. `importPullRequest()` upserts (updates existing PR by id)

Follow the existing test pattern: `mkdtempSync` for temp dirs, `Storage.create(tmpDir)` for setup.

**Step 4: Run tests**

Run: `npx vitest run src/storage/pr.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/storage/index.ts src/storage/mappers.ts src/storage/pr.test.ts
git commit -m "feat: implement PR storage methods with SQLite persistence"
```

---

## Task 5: Add PR Support to backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`

**Step 1: Extend BackendDataStoreState**

Add to the state interface:

```typescript
pullRequests: PullRequest[];
prCapabilities: PrCapabilities;
```

Add actions:

```typescript
loadPullRequests: () => Promise<void>;
getLinkedPullRequests: (itemId: string) => Promise<PullRequest[]>;
createPullRequest: (pr: NewPullRequest) => Promise<PullRequest>;
mergePullRequest: (id: string) => Promise<PullRequest>;
closePullRequest: (id: string) => Promise<PullRequest>;
linkItem: (prId: string, itemId: string) => Promise<void>;
unlinkItem: (prId: string, itemId: string) => Promise<void>;
```

**Step 2: Implement the actions**

- `loadPullRequests()` — calls `storage.listPullRequests()`, sets state
- `createPullRequest()` — delegates to remote backend (if `isPrBackend`), then imports result to local storage, refreshes
- `mergePullRequest()` / `closePullRequest()` — delegates directly to remote backend, then syncs result to local
- `getLinkedPullRequests()` — delegates to storage
- `linkItem()` / `unlinkItem()` — delegates to storage, refreshes

**Step 3: Call `loadPullRequests()` during `init()`**

After items are loaded in `init()`, also load PRs if the backend supports them.

**Step 4: Write tests**

Add tests to existing `src/stores/backendDataStore.test.ts` or create `src/stores/backendDataStore-pr.test.ts`:

1. After init, `pullRequests` is an empty array
2. After importing a PR to storage and calling `loadPullRequests()`, it appears in state
3. `prCapabilities` reflects storage capabilities

**Step 5: Run tests**

Run: `npx vitest run src/stores/backendDataStore`
Expected: PASS

**Step 6: Commit**

```bash
git add src/stores/backendDataStore.ts src/stores/backendDataStore-pr.test.ts
git commit -m "feat: add PR state and actions to backendDataStore"
```

---

## Task 6: Add PR Screen Navigation

**Files:**
- Modify: `src/stores/navigationStore.ts`
- Modify: `src/app.tsx`

**Step 1: Add `pr-list` screen to Screen type**

In `src/stores/navigationStore.ts` (line 8-14), add `'pr-list'` to the `Screen` union.

**Step 2: Add lazy import and screen routing in `src/app.tsx`**

Follow the IterationPicker pattern:

```typescript
const PullRequestList = lazy(() =>
  import('./components/PullRequestList.js').then((m) => ({
    default: m.PullRequestList,
  })),
);
```

Add to screen routing JSX:

```tsx
{screen === 'pr-list' && <PullRequestList />}
```

**Step 3: Create a stub `PullRequestList` component**

Create `src/components/PullRequestList.tsx` with a minimal placeholder:

```tsx
import React from 'react';
import { Box, Text } from 'ink';

export function PullRequestList() {
  return (
    <Box>
      <Text>Pull Requests (coming soon)</Text>
    </Box>
  );
}
```

**Step 4: Run build to verify**

Run: `npm run build`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/navigationStore.ts src/app.tsx src/components/PullRequestList.tsx
git commit -m "feat: add pr-list screen routing and stub component"
```

---

## Task 7: Add `p` Keybinding to WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Find the keybindings section**

Look for the `useInput` handler where `i` navigates to `iteration-picker` (around line 590). Add a similar handler for `p`:

```typescript
if (key === 'p') {
  navigate('pr-list');
  return;
}
```

**Step 2: Add `p` to the HelpScreen**

In `src/components/HelpScreen.tsx`, add `p` to the `list` screen shortcuts:

```typescript
{ key: 'p', description: 'Pull requests' },
```

Also add a `pr-list` section with keybindings for the PR screen.

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/WorkItemList.tsx src/components/HelpScreen.tsx
git commit -m "feat: add p keybinding to navigate to PR list"
```

---

## Task 8: Implement PullRequestList Component

**Files:**
- Modify: `src/components/PullRequestList.tsx`

**Step 1: Implement the full component**

Follow the WorkItemList pattern but simpler. Key features:

- Subscribe to `backendDataStore` for `pullRequests` and `prCapabilities`
- Render a table with columns: #, title, status (ColorPill), branches, author, linked items count
- Use `TableLayout` for responsive column rendering
- Keybindings:
  - `Enter` — navigate to PR detail (future task, for now open in browser)
  - `m` — merge (with confirmation, only if `prCapabilities.merge`)
  - `c` — close (with confirmation, only if `prCapabilities.merge`)
  - `n` — create new PR (only if `prCapabilities.create`)
  - `o` — open in browser via `open` package
  - `Escape` — `navigate('list')` to go back
  - `/` — search/filter
- Keyboard navigation with cursor (up/down/j/k)
- Status pills: open=green, merged=magenta, closed=red, draft=gray (use `themeStore` keyword defaults)

**Step 2: Write a smoke test**

Create `src/components/PullRequestList.test.tsx`:

```typescript
import { describe, it, expect } from 'vitest';
// Minimal smoke test — component renders without crash
// Full interaction tests can come later
describe('PullRequestList', () => {
  it('exports the component', async () => {
    const mod = await import('./PullRequestList.js');
    expect(mod.PullRequestList).toBeDefined();
  });
});
```

**Step 3: Run build and test**

Run: `npm run build && npx vitest run src/components/PullRequestList.test.tsx`
Expected: PASS

**Step 4: Commit**

```bash
git add src/components/PullRequestList.tsx src/components/PullRequestList.test.tsx
git commit -m "feat: implement PullRequestList component with table and keybindings"
```

---

## Task 9: Add Linked PRs to DetailPanel

**Files:**
- Modify: `src/components/DetailPanel.tsx`

**Step 1: Add linked PRs section**

After the existing labels/metadata section, add a "Linked PRs" section that:

- Calls `backendDataStore.getLinkedPullRequests(selectedItemId)`
- Renders each linked PR as: `#42 Fix login bug (open)` with status as a ColorPill
- If no linked PRs, show nothing (don't clutter the panel)

**Step 2: Run build**

Run: `npm run build`
Expected: PASS

**Step 3: Commit**

```bash
git add src/components/DetailPanel.tsx
git commit -m "feat: show linked PRs in work item detail panel"
```

---

## Task 10: Implement GitHub PR Backend

**Files:**
- Modify: `src/backends/github/index.ts`
- Modify: `src/backends/github/api.ts`
- Create: `src/backends/github/pr-mappers.ts`

**Step 1: Add GitHub PR API methods to `src/backends/github/api.ts`**

Add methods to `GitHubApiClient`:

```typescript
async listPullRequests(owner: string, repo: string, state = 'all'): Promise<GhPullRequest[]>
async getPullRequest(owner: string, repo: string, number: number): Promise<GhPullRequest>
async createPullRequest(owner: string, repo: string, data: { title: string; body?: string; head: string; base: string }): Promise<GhPullRequest>
async mergePullRequest(owner: string, repo: string, number: number): Promise<void>
async closePullRequest(owner: string, repo: string, number: number): Promise<GhPullRequest>
```

These use the GitHub REST API:
- `GET /repos/{owner}/{repo}/pulls`
- `GET /repos/{owner}/{repo}/pulls/{number}`
- `POST /repos/{owner}/{repo}/pulls`
- `PUT /repos/{owner}/{repo}/pulls/{number}/merge`
- `PATCH /repos/{owner}/{repo}/pulls/{number}` with `{ state: 'closed' }`

**Step 2: Create PR mappers in `src/backends/github/pr-mappers.ts`**

Map GitHub PR response to `PullRequest` type. Extract linked issue numbers from PR body (regex for "closes #N", "fixes #N", "resolves #N").

**Step 3: Implement `PrBackend` on `GitHubBackend`**

Have `GitHubBackend` implement `PrBackend`:

```typescript
export class GitHubBackend extends BaseBackend implements PrBackend {
  getPrCapabilities(): PrCapabilities {
    return { pullRequests: true, merge: true, create: true };
  }
  // ... delegate to api client + mappers
}
```

**Step 4: Write tests**

Create `src/backends/github/pr.test.ts` with tests using mocked API responses:

1. `listPullRequests()` maps GitHub response to `PullRequest[]`
2. `createPullRequest()` sends correct API request
3. `mergePullRequest()` calls merge endpoint
4. `closePullRequest()` patches state to closed
5. PR body link extraction: "closes #5" → `linkedItems: ['5']`

**Step 5: Run tests**

Run: `npx vitest run src/backends/github/pr.test.ts`
Expected: PASS

**Step 6: Commit**

```bash
git add src/backends/github/index.ts src/backends/github/api.ts src/backends/github/pr-mappers.ts src/backends/github/pr.test.ts
git commit -m "feat: implement GitHub PR backend with REST API"
```

---

## Task 11: Add PR Sync to SyncManager

**Files:**
- Modify: `src/sync/types.ts`
- Modify: `src/sync/manager.ts` (or wherever SyncManager lives)

**Step 1: Add PR queue action types to `src/sync/types.ts`**

Extend `QueueAction`:

```typescript
export type QueueAction =
  | 'create' | 'update' | 'delete' | 'comment'
  | 'template-create' | 'template-update' | 'template-delete'
  | 'pr-create' | 'pr-update' | 'pr-link' | 'pr-unlink';
```

**Step 2: Add PR pull to SyncManager**

During sync pull phase, if the remote backend is a `PrBackend`:

1. Call `remote.listPullRequests()`
2. For each PR, call `storage.importPullRequest(pr)` to upsert locally
3. Resolve linked items from PR body references

**Step 3: Add PR push to SyncManager**

Process `pr-create`, `pr-update`, `pr-link`, `pr-unlink` queue entries during push phase.

Note: `merge` and `close` are NOT queued — they go directly to the remote API from the store actions.

**Step 4: Write tests**

Add tests for PR sync:

1. Pull: remote PRs are imported to local storage
2. Push: queued `pr-create` calls `remote.createPullRequest()`
3. Link resolution: PR body "closes #3" creates link in local storage

**Step 5: Run tests**

Run: `npx vitest run src/sync/`
Expected: PASS

**Step 6: Commit**

```bash
git add src/sync/types.ts src/sync/manager.ts src/sync/*.test.ts
git commit -m "feat: add PR sync support to SyncManager"
```

---

## Task 12: Add CLI Commands for PRs

**Files:**
- Create: `src/cli/commands/pr.ts`
- Modify: `src/cli/index.ts`

**Step 1: Create `src/cli/commands/pr.ts`**

Follow the pattern in `src/cli/commands/item.ts`. Implement:

- `tic pr list` — list PRs in table format (columns: #, title, status, branches, author)
- `tic pr show <id>` — show full PR details
- `tic pr create --title "..." --source <branch> [--target <branch>] [--link <item-id>]`
- `tic pr merge <id>` — merge (requires remote backend with `prCapabilities.merge`)
- `tic pr close <id>` — close (requires remote backend)
- `tic pr open <id>` — open in browser
- `tic pr link <pr-id> <item-id>` — link PR to work item
- `tic pr unlink <pr-id> <item-id>` — unlink

All commands respect `--json` and `--quiet`. Remote-only commands show a helpful error if no PR-capable backend is configured.

**Step 2: Register in `src/cli/index.ts`**

Add the `pr` command group to the Commander program, following the `item` pattern.

**Step 3: Write tests**

Create `src/cli/commands/pr.test.ts`:

1. `tic pr list` with no PRs returns empty
2. `tic pr list --json` returns JSON array
3. `tic pr show <id>` returns PR details
4. `tic pr create` without remote shows error
5. `tic pr link` creates a link in storage

**Step 4: Run tests**

Run: `npx vitest run src/cli/commands/pr.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/cli/commands/pr.ts src/cli/index.ts src/cli/commands/pr.test.ts
git commit -m "feat: add tic pr CLI commands"
```

---

## Task 13: Add MCP Tools for PRs

**Files:**
- Modify: `src/cli/commands/mcp.ts`

**Step 1: Register 8 new MCP tools**

Follow the existing tool registration pattern. Add:

- `tic-list_prs` — list PRs with optional `status` filter
- `tic-show_pr` — show PR details by id
- `tic-create_pr` — create PR (title, sourceBranch, targetBranch, linkedItems)
- `tic-merge_pr` — merge PR by id
- `tic-close_pr` — close PR by id
- `tic-link_pr` — link PR to work item (prId, itemId)
- `tic-unlink_pr` — unlink PR from work item (prId, itemId)
- `tic-get_linked_prs` — get PRs linked to a work item (itemId)

**Step 2: Write tests**

Add to existing MCP tests or create `src/cli/commands/mcp-pr.test.ts`:

1. `tic-list_prs` returns empty list
2. `tic-show_pr` with valid id returns PR
3. `tic-link_pr` creates a link
4. `tic-get_linked_prs` returns linked PRs

**Step 3: Run tests**

Run: `npx vitest run src/cli/commands/mcp`
Expected: PASS

**Step 4: Commit**

```bash
git add src/cli/commands/mcp.ts src/cli/commands/mcp-pr.test.ts
git commit -m "feat: add MCP tools for pull request management"
```

---

## Task 14: Add PR Status Color Defaults to ThemeStore

**Files:**
- Modify: `src/stores/themeStore.ts`

**Step 1: Add keyword defaults for PR statuses**

In the keyword defaults mapping (used by `resolveFieldColor()`), add:

- `open` → green
- `merged` → magenta
- `closed` → red
- `draft` → gray

These may already partially exist for work item statuses. Verify no conflicts.

**Step 2: Run build and existing tests**

Run: `npm run build && npm test`
Expected: PASS (no regressions)

**Step 3: Commit**

```bash
git add src/stores/themeStore.ts
git commit -m "feat: add PR status color defaults to theme"
```

---

## Task 15: Final Integration Testing and Cleanup

**Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 2: Run lint and format**

Run: `npm run lint && npm run format:check`
Expected: PASS

**Step 3: Run build**

Run: `npm run build`
Expected: PASS

**Step 4: Manual smoke test**

Run `npm start` and verify:
- `p` from work items list opens PR list screen
- `Escape` returns to work items list
- `?` shows help with PR keybindings

**Step 5: Commit any final fixes**

```bash
git commit -m "fix: address integration test findings"
```

---

## Summary

| Task | Description | Key Files |
|------|-------------|-----------|
| 1 | PullRequest types | `src/types.ts` |
| 2 | PrBackend interface | `src/backends/types.ts` |
| 3 | SQLite schema + migration | `src/storage/schema.ts`, `drizzle/0004_*.sql` |
| 4 | Storage PR methods | `src/storage/index.ts`, `src/storage/mappers.ts` |
| 5 | backendDataStore PR state | `src/stores/backendDataStore.ts` |
| 6 | Screen navigation | `src/stores/navigationStore.ts`, `src/app.tsx` |
| 7 | `p` keybinding | `src/components/WorkItemList.tsx`, `HelpScreen.tsx` |
| 8 | PullRequestList component | `src/components/PullRequestList.tsx` |
| 9 | DetailPanel linked PRs | `src/components/DetailPanel.tsx` |
| 10 | GitHub PR backend | `src/backends/github/` |
| 11 | PR sync | `src/sync/` |
| 12 | CLI commands | `src/cli/commands/pr.ts` |
| 13 | MCP tools | `src/cli/commands/mcp.ts` |
| 14 | Theme colors | `src/stores/themeStore.ts` |
| 15 | Integration testing | All files |
