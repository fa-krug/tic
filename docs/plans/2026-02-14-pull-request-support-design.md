# Pull Request Support Design

**Date:** 2026-02-14
**Status:** Approved
**Epic:** #32

## Summary

Add full PR lifecycle management (list, show, create, merge, close) as a first-class entity alongside work items. GitHub is the only remote backend in v1. PRs are stored locally in SQLite with sync, and bidirectionally linked to work items.

## Decisions

- **Separate entity** — PRs are not a WorkItem subtype. They have their own type, schema, screens, CLI commands, and MCP tools.
- **GitHub only in v1** — other backends return `pullRequests: false` in capabilities.
- **Core CRUD only** — no review management (request reviewers, approve) in v1.
- **Merge/close are remote-only** — they go directly to the GitHub API, not through the sync queue. Results sync back to local storage.
- **Local SQLite storage with sync** — consistent with how work items work.
- **Navigation like iterations** — `pr-list` screen accessible via `p` keybinding from the work items list.
- **Bidirectional links** — PR references work items, work items show linked PRs.

## Data Model

### `PullRequest` type (`src/types.ts`)

```typescript
interface PullRequest {
  id: string;
  number: number;
  title: string;
  description: string;
  status: 'open' | 'merged' | 'closed' | 'draft';
  sourceBranch: string;
  targetBranch: string;
  author: string;
  linkedItems: string[];
  created: string;
  updated: string;
  url: string;
}

interface NewPullRequest {
  title: string;
  description?: string;
  sourceBranch: string;
  targetBranch?: string;
  linkedItems?: string[];
}
```

### SQLite tables

- **`pull_requests`** — id, number, title, description, status, sourceBranch, targetBranch, author, url, created, updated, remoteId
- **`pr_item_links`** — pr_id, item_id (join table for bidirectional links)

WorkItem type is unchanged. Linked PRs are fetched via the join table.

## Backend Interface

### `PrBackend` interface (`src/backends/types.ts`)

```typescript
interface PrBackend {
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

interface PrCapabilities {
  pullRequests: boolean;
  merge: boolean;
  create: boolean;
}
```

### Implementation split

- **Storage** — local persistence + linking only (list, get, getLinked*, link, unlink). No create/merge/close.
- **GitHubBackend** — full interface via GitHub REST API (`/repos/{owner}/{repo}/pulls`).
- **Other backends** — return `pullRequests: false`. UI/CLI hides PR features.

### Sync

Reuses the SyncManager/SyncQueue pattern:

**Pull (remote → local):**
- SyncManager calls `GitHubBackend.listPullRequests()`
- Upserts into local `pull_requests` table (match by remoteId)
- Resolves "closes #X" references to local work item links

**Push (local → remote):**
- SyncQueue gets new action types: `pr-create`, `pr-update`, `pr-link`, `pr-unlink`
- Merge and close go directly to remote (not queued) — they are immediate operations
- On success, local record is updated with the remote response

## TUI

### Navigation

New screen `pr-list` added to navigation store. Accessible via **`p`** keybinding from the work items list (same pattern as `i` for iteration picker).

### PullRequestList component

Columns: #number, title, status (ColorPill), sourceBranch → targetBranch, author, linked items count.

Keybindings:
- `Enter` — open PR detail view
- `m` — merge (remote only, with confirmation)
- `c` — close (remote only, with confirmation)
- `n` — create new PR
- `o` — open in browser
- `Escape` — back to work items list
- `/` — search/filter PRs

Responsive columns via TableLayout.

### PR detail view

Read-only form showing all PR fields, description, and linked work items. Linked items are navigable via formStackStore. Action keybindings at the bottom (merge, close, open in browser).

### WorkItem DetailPanel integration

Gains a "Linked PRs" section when viewing a work item with associated PRs. Each linked PR is navigable.

## CLI

New `tic pr` subcommand group (`src/cli/commands/pr.ts`):

```
tic pr list
tic pr show <id>
tic pr create --title "..." --source <branch> [--target <branch>] [--link <item-id>]
tic pr merge <id>
tic pr close <id>
tic pr open <id>
tic pr link <pr-id> <item-id>
tic pr unlink <pr-id> <item-id>
```

Respects `--json` and `--quiet` global flags. Remote-only commands fail gracefully without a PR-capable backend.

## MCP Tools

8 new tools in `src/cli/commands/mcp.ts`:

| Tool | Description |
|------|-------------|
| `tic-list_prs` | List PRs with optional status filter |
| `tic-show_pr` | Show PR details |
| `tic-create_pr` | Create a new PR |
| `tic-merge_pr` | Merge a PR |
| `tic-close_pr` | Close a PR |
| `tic-link_pr` | Link a PR to a work item |
| `tic-unlink_pr` | Unlink a PR from a work item |
| `tic-get_linked_prs` | Get PRs linked to a work item |

## Out of Scope (v1)

- GitLab merge request support
- Azure DevOps PR support
- Review management (request reviewers, approve, comment)
- Diff viewing in TUI
