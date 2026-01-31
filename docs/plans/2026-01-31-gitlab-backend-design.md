# GitLab Backend Design

## Goal

Implement a GitLab backend that maps GitLab issues and epics to tic work items. Every operation shells out to `glab` (CLI commands for issues, `glab api` for group-level resources like epics and iterations). The backend is stateless — no local caching.

This design also includes a project-wide ID migration from `number` to `string` to support multiple item types with separate ID spaces.

## Current State

The `Backend` interface in `src/backends/types.ts` is clean and well-abstracted. A factory pattern in `src/backends/factory.ts` already recognizes `'gitlab'` as a backend type but throws "not yet implemented." All 19 interface methods are synchronous, which means we use `execSync` to call `glab`.

## Key Decisions

- **Live interface** — every operation calls `glab`, no local state
- **Two work item types** — `epic` and `issue`, mapped from GitLab epics (group-level) and issues (project-level)
- **Two statuses** — `open` and `closed`, mapped from GitLab's `opened`/`closed` states
- **Iterations for sprints** — GitLab iterations (Premium feature) map to tic iterations; current iteration derived from date range
- **Epic-issue parent-child** — issues under an epic have `parent` set to the epic's ID; `getChildren(epicId)` returns the epic's issues
- **String IDs project-wide** — `WorkItem.id` changes from `number` to `string` across the entire codebase to avoid ID collisions between epics and issues
- **Prefixed IDs** — GitLab items use `issue-{iid}` and `epic-{iid}` as IDs
- **Auto-detect group from remote** — parse the git remote URL with subgroup support
- **Shell out to `glab`** — `execSync` for simplicity, leverages existing auth
- **No `.tic/` directory needed** — fully stateless, no `tic init` required
- **Requires GitLab Premium/Ultimate** — epics and iterations are Premium features

## Design

### 1. File Structure

```
src/backends/gitlab/
  index.ts       — GitLabBackend class implementing Backend
  glab.ts        — thin wrapper around glab CLI (execSync + JSON parsing)
  mappers.ts     — convert between GitLab JSON and tic WorkItem/Comment
  group.ts       — auto-detect group path from git remote
  gitlab.test.ts — tests
```

### 2. Project-Wide ID Migration

The `WorkItem.id` field changes from `number` to `string` across the entire codebase.

**`src/types.ts` changes:**

```ts
interface WorkItem {
  id: string;              // was number
  parent: string | null;   // was number | null
  dependsOn: string[];     // was number[]
  // everything else unchanged
}
```

**`src/backends/types.ts` changes:**

```ts
interface Backend {
  getWorkItem(id: string): WorkItem;
  updateWorkItem(id: string, data: Partial<WorkItem>): WorkItem;
  deleteWorkItem(id: string): void;
  addComment(workItemId: string, comment: NewComment): Comment;
  getChildren(id: string): WorkItem[];
  getDependents(id: string): WorkItem[];
  getItemUrl(id: string): string;
  openItem(id: string): void;
  // rest unchanged
}
```

**Per-backend ID formats:**

| Backend | ID format | Examples |
|---------|-----------|---------|
| Local | Stringified number | `"1"`, `"2"`, `"15"` |
| GitLab | Prefixed by type | `"issue-42"`, `"epic-5"` |
| GitHub (future) | Stringified number | `"123"` |

**LocalBackend:** Config still tracks `nextId` as a number internally. `WorkItem.id` returns stringified numbers. File naming unchanged (`items/1.md`, `items/2.md`).

**Component/CLI impact:** Anywhere that parses IDs as integers or compares with `===` against numbers needs updating. The TUI's parent ID field and dependency ID fields are already string inputs — only the parsing logic changes.

### 3. `glab` Wrapper (`glab.ts`)

Single function that spawns `glab` synchronously, parses JSON output, and throws on failure:

```ts
export function glab<T>(args: string[], cwd: string): T {
  const result = execSync(`glab ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  return JSON.parse(result);
}
```

Also export a variant for commands that don't return JSON:

```ts
export function glabExec(args: string[], cwd: string): string {
  return execSync(`glab ${args.join(' ')}`, {
    cwd,
    encoding: 'utf-8',
    stdio: ['pipe', 'pipe', 'pipe'],
  });
}
```

### 4. Group Detection (`group.ts`)

Auto-detects the GitLab group path from the git remote URL:

```ts
export function detectGroup(cwd: string): string
```

Examples:

| Remote URL | Detected group |
|---|---|
| `git@gitlab.com:mygroup/project.git` | `mygroup` |
| `https://gitlab.com/a/b/c/project.git` | `a/b/c` |
| `git@gitlab.com:a/b/c/project.git` | `a/b/c` |

Logic: strip the hostname and `.git` suffix, split by `/`, take everything except the last segment (the project name), join with `/`.

Throws on failure: `"Could not detect GitLab group from git remote. Ensure the remote points to a GitLab repository."`

### 5. Data Mapping (`mappers.ts`)

**GitLab Issue JSON -> tic `WorkItem`:**

| tic field | Source | Notes |
|-----------|--------|-------|
| `id` | `"issue-${issue.iid}"` | Prefixed IID (project-scoped) |
| `title` | `issue.title` | |
| `description` | `issue.description` | Default to `''` if null |
| `status` | `issue.state` | `"opened"` -> `"open"`, `"closed"` -> `"closed"` |
| `type` | `"issue"` | Hardcoded |
| `assignee` | `issue.assignees[0].username` | First assignee or `''` |
| `labels` | `issue.labels[]` | |
| `iteration` | via API | See iterations section |
| `priority` | `"medium"` | Hardcoded default |
| `parent` | `"epic-${issue.epic.iid}"` | If issue has an epic, else `null` |
| `dependsOn` | `[]` | Not supported |
| `created` | `issue.created_at` | |
| `updated` | `issue.updated_at` | |
| `comments` | from `issue.notes` | |

**GitLab Epic JSON -> tic `WorkItem`:**

| tic field | Source | Notes |
|-----------|--------|-------|
| `id` | `"epic-${epic.iid}"` | Prefixed IID (group-scoped) |
| `title` | `epic.title` | |
| `description` | `epic.description` | Default to `''` |
| `status` | `epic.state` | `"opened"` -> `"open"`, `"closed"` -> `"closed"` |
| `type` | `"epic"` | Hardcoded |
| `assignee` | `''` | Epics don't have assignees |
| `labels` | `epic.labels[]` | |
| `iteration` | `''` | Epics don't belong to iterations |
| `priority` | `"medium"` | Hardcoded default |
| `parent` | `null` | No parent epic mapping (one level deep) |
| `dependsOn` | `[]` | Not supported |
| `created` | `epic.created_at` | |
| `updated` | `epic.updated_at` | |
| `comments` | `[]` | Not fetched for epics |

**GitLab Comment (Note) JSON -> tic `Comment`:**

| tic field | Source |
|-----------|--------|
| `author` | `note.author.username` |
| `date` | `note.created_at` |
| `body` | `note.body` |

### 6. Backend Interface Mapping

**Work Items (Issues + Epics):**

| Backend method | Implementation |
|---|---|
| `listWorkItems(iteration?)` | Fetch issues via `glab issue list -O json --per-page 100` (up to 500 via pagination). Fetch epics via `glab api groups/:group/epics`. Merge and sort by `updated` descending. Filter by iteration if provided (issues only; epics always included). |
| `getWorkItem(id)` | Parse prefix: `issue-N` -> `glab issue view N -F json`, `epic-N` -> `glab api groups/:group/epics/N` |
| `createWorkItem(data)` | If `type === 'epic'`: `glab api groups/:group/epics -X POST`. If `type === 'issue'`: `glab issue create ...`. If `parent` is set and is an epic, add issue to epic via API. |
| `updateWorkItem(id, data)` | `issue-N`: `glab issue update N ...` + `glab issue close`/`glab issue reopen` for status changes. `epic-N`: `glab api -X PUT`. |
| `deleteWorkItem(id)` | `issue-N`: `glab issue delete N`. `epic-N`: `glab api -X DELETE`. |

**Comments:**

| Backend method | Implementation |
|---|---|
| `addComment(id, comment)` | `issue-N`: `glab issue note N -m "..."`. `epic-N`: `glab api groups/:group/epics/N/notes -X POST`. |

**Iterations:**

| Backend method | Implementation |
|---|---|
| `getIterations()` | `glab iteration list -F json` — return titles/names |
| `getCurrentIteration()` | From the iteration list, pick the one whose date range includes today. If none, return `''`. |
| `setCurrentIteration(name)` | No-op (stateless — current iteration is derived from dates) |

**Statuses & Types:**

| Backend method | Returns |
|---|---|
| `getStatuses()` | `['open', 'closed']` |
| `getWorkItemTypes()` | `['epic', 'issue']` |

**Relationships:**

| Backend method | Implementation |
|---|---|
| `getChildren(id)` | If `epic-N`: `glab api groups/:group/epics/N/issues` -> map to WorkItems. If `issue-N`: `[]`. |
| `getDependents(id)` | `[]` — not supported |

**Item URL & Open:**

| Backend method | Implementation |
|---|---|
| `getItemUrl(id)` | `issue-N`: extract `web_url` from `glab issue view N -F json`. `epic-N`: construct from group path. |
| `openItem(id)` | `issue-N`: `glab issue view N --web`. `epic-N`: open URL via system browser. |

### 7. Repo and Group Context

`glab` auto-detects the repo from the git remote in the working directory. The `GitLabBackend` constructor takes `cwd: string` and passes it to all `glab` calls via the `cwd` spawn option.

Epics and iterations are group-level resources. The group path is auto-detected from the git remote URL with subgroup support.

Constructor validates that `glab` is available and authenticated, and detects the group:

```ts
class GitLabBackend implements Backend {
  private cwd: string;
  private group: string;

  constructor(cwd: string) {
    glabExec(['auth', 'status'], cwd);  // throws if not authenticated
    this.cwd = cwd;
    this.group = detectGroup(cwd);
  }
}
```

### 8. Factory Integration

Update `src/backends/factory.ts`:

```ts
case 'gitlab':
  return new GitLabBackend(root);
```

Detection: The existing `detectBackend()` already returns `'gitlab'` for repos with `gitlab.com` in their remote URL. No changes needed.

No `.tic/` required: For GitLab backend, the factory needs a way to work without `.tic/config.yml`. If no `.tic/` directory exists but the repo is detected as GitLab, create the backend directly without reading local config.

### 9. Error Handling

- **`glab` not installed:** Constructor throws `"glab CLI is not installed. Install it from https://gitlab.com/gitlab-org/cli"`
- **Not authenticated:** Constructor throws `"glab is not authenticated. Run 'glab auth login' first."`
- **Not a GitLab repo:** Factory detection handles this — won't select GitLab backend
- **Group detection fails:** Constructor throws with clear message
- **Item not found:** Parse the `glab` error, throw `"Work item <id> not found"`
- **Epic API errors (403):** Throw `"Epics require GitLab Premium or Ultimate. Consider using 'issue' type only."`
- **Network/permission errors:** Let `glab` error propagate with its own message

### 10. Limits

- Issue list capped at 100 per page. Fetch up to 500 issues (5 pages) and all epics from the group (up to 100).
- When `listWorkItems` is called, issues and epics are fetched separately and merged into a single list, sorted by `updated` descending.

## Files Changed

| File | Change |
|------|--------|
| `src/types.ts` | `id`: `number` -> `string`, `parent`: `number \| null` -> `string \| null`, `dependsOn`: `number[]` -> `string[]` |
| `src/backends/types.ts` | All `id: number` params -> `id: string` |
| `src/backends/local/index.ts` | Adapt to string IDs |
| `src/backends/local/items.ts` | Adapt to string IDs |
| `src/backends/local/config.ts` | No change (nextId stays internal number) |
| `src/backends/local/*.test.ts` | Update assertions for string IDs |
| `src/backends/factory.ts` | Wire up `GitLabBackend`, handle missing `.tic/` |
| `src/backends/gitlab/index.ts` | **New** — `GitLabBackend` class |
| `src/backends/gitlab/glab.ts` | **New** — `glab` CLI wrapper functions |
| `src/backends/gitlab/mappers.ts` | **New** — data mapping functions |
| `src/backends/gitlab/group.ts` | **New** — group detection from git remote |
| `src/backends/gitlab/gitlab.test.ts` | **New** — tests |
| `src/components/WorkItemList.tsx` | Adapt to string IDs |
| `src/components/WorkItemForm.tsx` | Adapt to string IDs |
| `src/cli/commands/item.ts` | Adapt to string IDs |
| `src/cli/commands/mcp.ts` | Adapt to string IDs |

## Testing

Tests in `src/backends/gitlab/gitlab.test.ts` mock the `glab` and `glabExec` functions. Test cases:

- **Mappers:** GitLab issue JSON -> WorkItem, epic JSON -> WorkItem, note JSON -> Comment. Verify ID prefixing, status mapping, null handling.
- **Group detection:** Parse various remote URL formats (SSH, HTTPS, nested subgroups, trailing `.git`).
- **Backend methods:** Mock `glab` calls, verify correct arguments passed, verify returned WorkItems are mapped correctly.
- **Error handling:** `glab` not found, auth failure, 403 on epics, item not found.
- **ID parsing:** Verify `issue-42` routes to issue commands, `epic-5` routes to API calls, invalid IDs throw.

Existing test files also need updates for the string ID migration.

## Out of Scope

- Epic-to-epic parent relationships (only one level: epic -> issues)
- Dependency tracking (`dependsOn` always `[]`)
- Priority mapping from labels or weights
- Multiple assignee support
- Iteration CRUD (create/edit/delete iterations)
- Epic comments in `listWorkItems` (only fetched via `getWorkItem`)
- Offline/caching layer
- Pagination beyond 500 issues / 100 epics
- Milestone support (using iterations instead)
- Label-based status mapping
