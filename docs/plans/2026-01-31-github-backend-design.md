# GitHub Backend Design

## Goal

Implement a GitHub backend that lets users interact with GitHub Issues through the tic TUI. Every operation shells out to the `gh` CLI — no local caching, no sync. The backend is fully stateless.

## Current State

The `Backend` interface in `src/backends/types.ts` is clean and well-abstracted. A factory pattern in `src/backends/factory.ts` already recognizes `'github'` as a backend type but throws "not yet implemented." All 19 interface methods are synchronous, which means we use `execSync` to call `gh`.

## Key Decisions

- **Live interface** — every operation calls `gh`, no local state
- **Flat issues** — no work item types, priority, parent-child, or dependency mapping
- **Two statuses** — `open` and `closed`, mapped from GitHub's issue states
- **Milestones as iterations** — first open milestone (by due date) is "current"
- **Single assignee** — take first assignee from GitHub, ignore the rest
- **Shell out to `gh`** — `execSync` for simplicity, leverages existing auth
- **No `.tic/` directory needed** — fully stateless, no `tic init` required
- **500 issue limit** — cap `gh issue list` at 500 items

## Design

### 1. File Structure

```
src/backends/github/
  index.ts       — GitHubBackend class implementing Backend
  gh.ts          — thin wrapper around gh CLI (execSync + JSON parsing)
  mappers.ts     — convert between GitHub JSON and tic WorkItem/Comment
  github.test.ts — tests
```

### 2. `gh` Wrapper (`gh.ts`)

Single function that spawns `gh` synchronously, parses JSON output, and throws on failure:

```ts
export function gh<T>(args: string[], cwd: string): T {
  const result = execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result);
}
```

Also export a variant for commands that don't return JSON (e.g. `gh issue close`):

```ts
export function ghExec(args: string[], cwd: string): string {
  return execSync(`gh ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

### 3. Data Mapping (`mappers.ts`)

**GitHub Issue JSON → tic `WorkItem`:**

| tic field | Source | Notes |
|-----------|--------|-------|
| `id` | `issue.number` | |
| `title` | `issue.title` | |
| `description` | `issue.body` | Default to `''` if null |
| `status` | `issue.state` | `"OPEN"` → `"open"`, `"CLOSED"` → `"closed"` |
| `type` | `"issue"` | Hardcoded — no type mapping |
| `assignee` | `issue.assignees[0].login` | First assignee or `''` |
| `labels` | `issue.labels[].name` | |
| `iteration` | `issue.milestone?.title` | Or `''` if none |
| `priority` | `"medium"` | Hardcoded default — not mapped |
| `created` | `issue.createdAt` | |
| `updated` | `issue.updatedAt` | |
| `comments` | `issue.comments[].body` etc. | |
| `parent` | `null` | Not supported |
| `dependsOn` | `[]` | Not supported |

**GitHub Comment JSON → tic `Comment`:**

| tic field | Source |
|-----------|--------|
| `author` | `comment.author.login` |
| `date` | `comment.createdAt` |
| `body` | `comment.body` |

### 4. Backend Interface Mapping

**Work Items (Issues):**

| Backend method | `gh` command |
|---|---|
| `listWorkItems(iteration?)` | `gh issue list --state all --json ... --limit 500` — filter by milestone if iteration given |
| `getWorkItem(id)` | `gh issue view <id> --json ...` |
| `createWorkItem(data)` | `gh issue create --title --body --assignee --milestone --label` |
| `updateWorkItem(id, data)` | `gh issue edit <id> ...` + `gh issue close`/`gh issue reopen` for status changes |
| `deleteWorkItem(id)` | `gh issue delete <id> --yes` |

**Comments:**

| Backend method | `gh` command |
|---|---|
| `addComment(id, comment)` | `gh issue comment <id> --body "..."` |

Comments are included in `gh issue view --json comments`, so `getWorkItem` returns them.

**Iterations (Milestones):**

| Backend method | Implementation |
|---|---|
| `getIterations()` | `gh api repos/{owner}/{repo}/milestones --jq '.[].title'` |
| `getCurrentIteration()` | First open milestone sorted by due date via `gh api` |
| `setCurrentIteration(name)` | No-op (stateless — current iteration is always first open milestone) |

**Statuses & Types:**

| Backend method | Returns |
|---|---|
| `getStatuses()` | `['open', 'closed']` |
| `getWorkItemTypes()` | `['issue']` |

**Relationships (not supported):**

| Backend method | Returns |
|---|---|
| `getChildren(id)` | `[]` |
| `getDependents(id)` | `[]` |

**Item URL & Open:**

| Backend method | Implementation |
|---|---|
| `getItemUrl(id)` | `gh issue view <id> --json url --jq .url` |
| `openItem(id)` | `gh issue view <id> --web` |

### 5. Repo Context

`gh` auto-detects the repo from the git remote in the working directory. The `GitHubBackend` constructor takes `cwd: string` and passes it to all `gh` calls via the `cwd` spawn option.

Constructor validates that `gh` is available and authenticated:

```ts
class GitHubBackend implements Backend {
  constructor(private cwd: string) {
    // Verify gh is available and authenticated
    ghExec(['auth', 'status'], cwd);
  }
}
```

### 6. Factory Integration

Update `src/backends/factory.ts`:

```ts
case 'github':
  return new GitHubBackend(root);
```

**Detection:** The existing `detectBackend()` already returns `'github'` for repos with `github.com` in their remote URL. No changes needed there.

**No `.tic/` required:** For GitHub backend, the factory needs a way to work without `.tic/config.yml`. If no `.tic/` directory exists but the repo is detected as GitHub, create the backend directly without reading local config.

### 7. Error Handling

- **`gh` not installed:** Constructor throws `"gh CLI is not installed. Install it from https://cli.github.com"`
- **Not authenticated:** Constructor throws `"gh is not authenticated. Run 'gh auth login' first."`
- **Not a GitHub repo:** Factory detection handles this — won't select GitHub backend
- **Issue not found:** `gh issue view` exits non-zero — throw `"Work item #<id> not found"`
- **Permission denied:** Let `gh` error propagate with its own message
- **Network failure:** Let `gh` error propagate

## Files Changed

| File | Change |
|------|--------|
| `src/backends/github/index.ts` | **New** — `GitHubBackend` class |
| `src/backends/github/gh.ts` | **New** — `gh` CLI wrapper functions |
| `src/backends/github/mappers.ts` | **New** — data mapping functions |
| `src/backends/github/github.test.ts` | **New** — tests |
| `src/backends/factory.ts` | Wire up `GitHubBackend` in `createBackend()`, handle missing `.tic/` |

## Out of Scope

- Work item type mapping (labels)
- Priority mapping
- Parent-child relationships (task lists)
- Dependency tracking
- Offline/caching layer
- Pagination beyond 500 issues
- Multiple assignee support
- Milestone CRUD (create/edit/delete milestones)
- Pull request integration
