# GitLab Backend: Migration from glab CLI to Direct GraphQL API

## Overview

Migrate the GitLab backend from shelling out to the `glab` CLI tool to direct GraphQL API calls via a new `GitLabApiClient`. This aligns GitLab with the GitHub and ADO backends, which already use direct APIs. The migration also adds in-TUI OAuth device flow authentication and removes the `glab` dependency entirely.

## Decisions

- **Full GraphQL via Work Items API** for both issues and epics (no REST, no legacy Issue/Epic mutations)
- **OAuth device flow** on gitlab.com with PAT fallback (user registers the OAuth app)
- **Templates via local filesystem** (no Repository Files API)
- **gitlab.com only** for now (no self-hosted support)
- **Client ID**: `cdcaceeece0df785f6df0e8b94fce6669ec8521787844faed02a5605b29e05bd`

## Architecture

### File Changes

| File | Action | Description |
|------|--------|-------------|
| `src/backends/gitlab/index.ts` | Rewrite | Private constructor + static `create()`, Work Items API |
| `src/backends/gitlab/api.ts` | **New** | `GitLabApiClient extends BaseApiClient` — GraphQL only |
| `src/backends/gitlab/mappers.ts` | Rewrite | Widget-based Work Item response mapping |
| `src/backends/gitlab/group.ts` → `remote.ts` | Rename + extend | Returns `GitLabRemoteInfo` (host, group, project, fullPath) |
| `src/backends/gitlab/glab.ts` | **Delete** | CLI wrapper removed |
| `src/auth/gitlab.ts` | **New** | OAuth device flow + PAT keychain storage |
| `src/backends/factory.ts` | Update | GitLab case uses `GitLabBackend.create()` |
| `src/backends/gitlab/api.test.ts` | **New** | API client tests |
| `src/auth/gitlab.test.ts` | **New** | Auth flow tests |
| `src/backends/gitlab/mappers.test.ts` | Rewrite | Widget-based mapper tests |
| `src/backends/gitlab/gitlab.test.ts` | Rewrite | Mock API client instead of glab subprocess |
| `src/backends/gitlab/group.test.ts` → `remote.test.ts` | Rename + extend | Test full GitLabRemoteInfo parsing |
| `src/backends/gitlab/glab.test.ts` | **Delete** | Removed with glab.ts |

### Component Diagram

```
┌─────────────────────────────────────────────────────┐
│ GitLabBackend                                       │
│  - private constructor(api, group, project, types)  │
│  - static create(cwd, options?)                     │
│  - CRUD via workItemCreate/Update/Delete mutations  │
│  - Comments via createNote mutation                 │
│  - Templates via local filesystem                   │
├─────────────────────────────────────────────────────┤
│ GitLabApiClient extends BaseApiClient               │
│  - graphql<T>(query, variables?)                    │
│  - paginate<T>(query, variables, extractNodes)      │
│  - endpoint: https://gitlab.com/api/graphql         │
├─────────────────────────────────────────────────────┤
│ Auth (src/auth/gitlab.ts)                           │
│  - getGitLabToken() / getGitLabPat()                │
│  - authenticateGitLab(options?) — device flow       │
│  - clearGitLabTokens()                              │
│  - Keychain: gitlab.com, gitlab.com:pat             │
└─────────────────────────────────────────────────────┘
```

## Authentication

### OAuth Device Flow (gitlab.com)

1. `POST https://gitlab.com/oauth/authorize_device` with `client_id` + `scope=api`
2. Response: `device_code`, `user_code`, `verification_uri`, `expires_in`, `interval`
3. Display user code + verification URI via `AuthPrompt` component
4. Poll `POST https://gitlab.com/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code`
5. Handle: `authorization_pending` (retry), `slow_down` (increase interval), `expired_token` / `access_denied` (error)
6. Store access token in OS keychain via `@napi-rs/keyring`

### PAT Fallback

- `tic auth login --backend gitlab --pat` prompts for PAT
- Stored in keychain under `gitlab.com:pat`
- Sent as `Authorization: Bearer <pat>` (same header as OAuth token)

### Keychain Accounts

| Account | Purpose |
|---------|---------|
| `gitlab.com` | OAuth access token |
| `gitlab.com:pat` | Personal access token |

### Token Resolution (in `create()`)

```
getGitLabToken() → getGitLabPat() → authenticateGitLab() (device flow)
```

GitLab's device flow does not issue refresh tokens, so expired tokens require re-authentication.

### Integration with backendDataStore

Same pattern as GitHub/ADO — `create()` accepts `onAuthPrompt`/`onAuthFlow` callbacks that feed into `backendDataStore`'s auth state, rendering the `AuthPrompt` component for in-TUI OAuth.

## GitLabApiClient

### Class Design

```typescript
class GitLabApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, 'https://gitlab.com')
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>

  async *paginate<T>(
    query: string,
    variables: Record<string, unknown>,
    extractConnection: (data: T) => { nodes: unknown[]; pageInfo: PageInfo }
  ): AsyncGenerator<unknown[]>
}
```

### Endpoint

All requests go to `POST https://gitlab.com/api/graphql` with:
- `Authorization: Bearer <token>`
- `Content-Type: application/json`

### Pagination

Cursor-based relay-style pagination (same as GitHub GraphQL):
1. Query with `first: 100`
2. Extract `pageInfo.hasNextPage` + `pageInfo.endCursor`
3. Re-query with `after: endCursor` if more pages
4. Yield nodes per page via async generator

The caller provides `extractConnection` to navigate response shape (e.g., `data => data.project.workItems`).

### Error Handling

- **401** → `AuthError`
- **GraphQL `errors` array** → throw first error message
- **5xx** → retry once after 1s (inherited from `BaseApiClient`)
- **Query complexity exceeded** → surface as error

### Differences from GitHub API Client

| Aspect | GitHub | GitLab |
|--------|--------|--------|
| Endpoint | `api.github.com/graphql` | `gitlab.com/api/graphql` |
| Has `rest()` method | Yes (REST + GraphQL) | No (GraphQL only) |
| Pagination | REST: Link headers; GQL: cursor | All cursor-based |
| Rate limiting | `X-RateLimit-Remaining` header | Query complexity (250 max) |
| Extra headers | `X-GitHub-Api-Version` | None |

## Work Items API Operations

### Startup: Type ID Resolution

Work item type IDs (`gid://gitlab/WorkItems::Type/<id>`) vary between namespaces. Queried once at `create()` time and cached:

```graphql
query {
  project(fullPath: "group/project") {
    workItemTypes { nodes { id name } }
  }
  group(fullPath: "group") {
    workItemTypes { nodes { id name } }
  }
}
```

### CRUD Operations

| Operation | Mutation/Query | Notes |
|-----------|---------------|-------|
| **List issues** | `project(fullPath).workItems(types: [ISSUE])` | Paginated, filter by state/milestone |
| **List epics** | `group(fullPath).workItems(types: [EPIC])` | Paginated |
| **Get item** | `workItem(id)` or `namespace(fullPath).workItem(iid)` | All widgets in one query |
| **Create** | `workItemCreate` mutation | `title`, `namespacePath`, `workItemTypeId`, widget inputs |
| **Update** | `workItemUpdate` mutation | `id` (gid), widget inputs for changed fields |
| **Delete** | `workItemDelete` mutation | `id` (gid) |
| **Comment** | `createNote` mutation | `noteableId` (gid), `body` |

### Widget-to-Field Mapping

| tic field | Widget | Create/Update input |
|-----------|--------|-------------------|
| `title` | (top-level) | `title: "..."` |
| `description` | `descriptionWidget` | `{ description: "..." }` |
| `status` | `statusWidget` / state | TBD — confirm via schema exploration |
| `assignee` | `assigneesWidget` | `{ assigneeIds: ["gid://gitlab/User/..."] }` |
| `labels` | `labelsWidget` | `{ addLabelIds: [...], removeLabelIds: [...] }` |
| `iteration` | `milestoneWidget` | `{ milestoneId: "gid://..." }` |
| `parent` | `hierarchyWidget` | `{ parentId: "gid://..." }` (null to clear) |

Note: Exact widget input field names need confirmation against the live GraphQL schema during implementation. The pattern is established from the migration guide.

### ID Format

External IDs remain `issue-{iid}` / `epic-{iid}` (same as current). Internally, maintain a cache mapping `iid → gid` (populated on list/get) since mutations require `gid://gitlab/WorkItem/<id>`.

### Metadata Queries

| Method | Source |
|--------|--------|
| `getAssignees()` | `project.projectMembers` (paginated GraphQL) |
| `getLabels()` | `project.labels` (paginated GraphQL) |
| `getIterations()` | `project.milestones` (paginated GraphQL) |
| `getStatuses()` | Hardcoded `['open', 'closed']` |
| `getWorkItemTypes()` | Hardcoded `['issue', 'epic']` |

## Mappers

`mappers.ts` is rewritten for the Work Items widget response shape:

```typescript
function mapWorkItemToWorkItem(workItem: GlWorkItem, type: 'issue' | 'epic'): WorkItem
```

The mapper iterates over `workItem.widgets` using `__typename` to extract fields:

| `__typename` | Extracted field |
|-------------|-----------------|
| `WorkItemWidgetAssignees` | `assignee` (first assignee) |
| `WorkItemWidgetLabels` | `labels` |
| `WorkItemWidgetHierarchy` | `parent`, used for `getChildren()` |
| `WorkItemWidgetNotes` | `comments` |
| `WorkItemWidgetStartAndDueDate` | (available but unused — no tic field) |
| `WorkItemWidgetMilestone` | `iteration` |

Priority remains hardcoded to `"medium"` (GitLab has no priority field).

## Remote Detection

`group.ts` renamed to `remote.ts`, extended to return full project info:

```typescript
interface GitLabRemoteInfo {
  host: string       // 'gitlab.com'
  group: string      // 'mygroup' or 'mygroup/subgroup'
  project: string    // 'myproject'
  fullPath: string   // 'mygroup/myproject'
}

function parseGitLabRemote(cwd: string): GitLabRemoteInfo
```

Parses SSH (`git@gitlab.com:group/project.git`) and HTTPS (`https://gitlab.com/group/project.git`) formats.

## Templates — Local Filesystem

All template operations use the local filesystem instead of the Repository Files API:

```
.gitlab/issue_templates/{name}.md
```

| Operation | Implementation |
|-----------|---------------|
| **List** | `glob('.gitlab/issue_templates/*.md')` |
| **Get** | `fs.readFile()` |
| **Create** | `fs.writeFile()` (create dir if needed) |
| **Update** | `fs.rename()` (if slug changed) + `fs.writeFile()` |
| **Delete** | `fs.unlink()` |

The `templateNameCache` is dropped — filenames are read directly.

## Factory Integration

```typescript
// factory.ts
case 'gitlab': {
  const { GitLabBackend } = await import('./gitlab/index.js');
  return GitLabBackend.create(root, options);
}
```

Same change in `backendDataStore`'s `createBackendAndSync()`.

## Capabilities

Unchanged from current backend:

```typescript
{
  relationships: true,
  customTypes: false,
  customStatuses: false,
  iterations: true,
  comments: true,
  fields: {
    priority: false,
    assignee: true,
    labels: true,
    parent: true,
    dependsOn: false,
  },
  templates: true,
  templateFields: {
    description: true,
    // all others false
  },
}
```

## Testing Strategy

| Test file | Approach |
|-----------|----------|
| `api.test.ts` (new) | Mock `fetch()`, test GraphQL calls, pagination, error handling |
| `mappers.test.ts` (rewrite) | Test widget-based response mapping |
| `gitlab.test.ts` (rewrite) | Mock `GitLabApiClient`, test CRUD, auth flow, type ID resolution |
| `remote.test.ts` (rename) | Test full `GitLabRemoteInfo` parsing from SSH/HTTPS remotes |
| `auth/gitlab.test.ts` (new) | Test device flow polling, PAT storage, token resolution |

## Open Questions

1. **Status widget**: Exact mutation input for changing issue state (open/closed) via Work Items API needs schema exploration. May use `stateEvent` or a `statusWidget`.
2. **Labels widget**: Exact input field names (`addLabelIds`/`removeLabelIds` vs `labelIds`) need confirmation.
3. **Milestone widget**: Input field name for milestone assignment needs confirmation.
4. **Work Items API maturity for issues**: The API is GA for epics (18.1+). Issue support via Work Items should be verified on gitlab.com's GraphiQL explorer before implementation begins.
