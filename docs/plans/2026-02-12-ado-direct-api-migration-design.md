# Azure DevOps Backend: Direct API Migration

## Motivation

Migrate the Azure DevOps backend from `az` CLI dependency to direct HTTP API calls, following the same pattern as the GitHub migration (`f28284e`). Three goals:

1. **Eliminate `az` CLI dependency** — works in containers/CI without installing Azure CLI
2. **Performance** — direct HTTP calls vs spawning `az` child processes for every operation
3. **Fix dual auth** — single Entra ID token covers both work items and comments (replacing the confusing `az devops login` + `az login` split)

## Authentication

Two strategies, resolved in priority order:

### Strategy 1: Entra ID Device Code Flow (default)

Uses Azure CLI's well-known public client ID — no app registration needed.

- **Client ID**: `04b07795-8ddb-461a-bbee-02f9e1bf7b46` (Azure CLI, public client, no secret)
- **Authority**: `https://login.microsoftonline.com/organizations` (multi-tenant, org accounts only)
- **Scope**: `499b84ac-1321-427f-aa17-267ca6975798/.default offline_access` — full Azure DevOps access + refresh token
- **Flow**: POST `/oauth2/v2/devicecode` → display code + `https://microsoft.com/devicelogin` → poll `/oauth2/v2/token` with `urn:ietf:params:oauth:grant-type:device_code`
- **Token storage**: Keychain entries — `"dev.azure.com"` (access token), `"dev.azure.com:refresh"` (refresh token)
- **Auto-refresh**: On 401, POST `/oauth2/v2/token` with `grant_type=refresh_token`. On refresh failure, clear both tokens and throw `AuthError`

### Strategy 2: PAT Fallback

For enterprise tenants that block device code flow.

- **When**: User runs `tic auth login azure --pat`, or device code flow is blocked
- **Storage**: Keychain — `"dev.azure.com:pat"` entry
- **API auth**: `Authorization: Basic base64(:PAT)` instead of `Bearer` token
- **No refresh needed**: PATs have long lifetimes (up to 1 year)

### Resolution Order (`getAdoAuth()`)

1. Check keychain for OAuth access token → use it (with refresh on 401)
2. Check keychain for PAT → use it
3. If `skipAuth` → throw `AuthError`
4. Otherwise → attempt device code flow. If it fails, suggest `tic auth login azure --pat`

### CLI Commands

- `tic auth login azure` — runs device code flow
- `tic auth login azure --pat` — prompts for PAT, stores in keychain
- `tic auth status` — shows which method is active (OAuth or PAT)
- `tic auth logout azure` — clears all ADO tokens from keychain

## API Client

**New file: `src/backends/ado/api.ts`**

`AdoApiClient` extends `BaseApiClient` from `src/backends/shared/api-client.ts`, inheriting retry logic, rate limit detection, and error hierarchy.

### Constructor

```typescript
constructor(auth: AdoAuth, org: string)
// where AdoAuth = { type: 'bearer'; token: string } | { type: 'basic'; pat: string }
// baseUrl = https://dev.azure.com/{org}
```

### Methods

- `rest<T>(method, path, body?, contentType?)` — REST calls with `api-version=7.1` query param. Content type defaults to `application/json`, but supports `application/json-patch+json` for create/update.
- `wiql<T>(project, query)` — POST to `/{project}/_apis/wit/wiql`. Returns work item IDs.
- `batchGetWorkItems<T>(ids, fields?, expand?)` — POST to `/_apis/wit/workitemsbatch`. Chunks at 200 IDs per request (matching current behavior).
- `paginate<T>(path)` — ADO uses `continuationToken` response header. Generator yields pages, passes token as query param.

### Token Refresh

Override `fetch()` — on 401 with `bearer` auth type, attempt refresh via `src/auth/ado.ts`. Update `this.auth.token`, retry original request once. If refresh fails, throw `AuthError`. No refresh logic for `basic` (PAT) auth.

### Differences from `GitHubApiClient`

- No GraphQL — ADO doesn't have one
- WIQL as query mechanism instead of GraphQL queries
- `continuationToken` pagination instead of Link headers
- `api-version=7.1` query param instead of version header
- `application/json-patch+json` content type for create/update
- Auth discriminated union (`bearer` | `basic`) instead of single token

## Backend Class Migration

`AzureDevOpsBackend` in `src/backends/ado/index.ts` replaces all `az*()` calls with `AdoApiClient` methods. Constructor becomes async via static `create()` factory (same pattern as GitHub).

### Initialization

```
AzureDevOpsBackend.create(cwd, options?)
  1. parseAdoRemote(cwd) → { org, project }  (unchanged)
  2. getAdoAuth() from keychain
  3. If no auth + skipAuth → throw AuthError
  4. If no auth → run device code flow, store tokens
  5. Create AdoApiClient(auth, org)
  6. Fetch work item types via REST → store in this.types
  7. Return backend instance
```

### Operation Mapping

| Operation | Before (`az` CLI) | After (direct API) |
|---|---|---|
| List items | `az boards query --wiql` → `azInvoke('wit', 'workitemsbatch')` | `api.wiql(project, query)` → `api.batchGetWorkItems(ids)` |
| Get item | `az boards work-item show --expand relations` | `api.rest('GET', '/{project}/_apis/wit/workitems/{id}?$expand=relations')` |
| Create item | `az boards work-item create` + `az boards work-item relation add` | `api.rest('POST', '/{project}/_apis/wit/workitems/$Type', jsonPatch)` — single call with relations in patch |
| Update item | `az boards work-item update` + relation add/remove | `api.rest('PATCH', '/_apis/wit/workitems/{id}', jsonPatch)` — single call |
| Delete item | `az boards work-item delete --yes` | `api.rest('DELETE', '/_apis/wit/workitems/{id}')` |
| Add comment | `azRest` (preview API, needed separate Azure AD auth) | `api.rest('POST', '/_apis/wit/workitems/{id}/comments')` — same token |
| Get children | `az boards query --wiql` (link query) | `api.wiql(project, linkQuery)` → `api.batchGetWorkItems(ids)` |
| Get dependents | `az boards query --wiql` (link query) | `api.wiql(project, linkQuery)` → `api.batchGetWorkItems(ids)` |
| List iterations | `az boards iteration team list` | `api.rest('GET', '/{project}/{team}/_apis/work/teamsettings/iterations')` |
| Get assignees | `az devops team list-members` | `api.rest('GET', '/_apis/projects/{project}/teams/{team}/members')` |
| Get types | `azInvoke('wit', 'workitemtypes')` | `api.rest('GET', '/{project}/_apis/wit/workitemtypes')` |

### JSON Patch

ADO REST API uses JSON Patch (`application/json-patch+json`) for create/update:

```json
[
  { "op": "add", "path": "/fields/System.Title", "value": "Bug title" },
  { "op": "add", "path": "/fields/System.State", "value": "Active" },
  { "op": "add", "path": "/relations/-", "value": {
    "rel": "System.LinkTypes.Hierarchy-Reverse",
    "url": "https://dev.azure.com/{org}/_apis/wit/workitems/{parentId}"
  }}
]
```

This replaces the current multi-step create-then-link approach. Relations can be included in the same create/update call.

### Unchanged

- `getCapabilities()` — same capabilities object
- `mappers.ts` — same field mapping, same turndown HTML→Markdown
- `remote.ts` — same git remote parsing

## Files to Change

### New Files

| File | Purpose |
|---|---|
| `src/auth/ado.ts` | Entra ID device code flow + PAT storage |
| `src/auth/ado.test.ts` | Device flow polling, token refresh, PAT fallback |
| `src/backends/ado/api.ts` | `AdoApiClient` extending `BaseApiClient` |
| `src/backends/ado/api.test.ts` | REST calls, WIQL, batch, pagination, refresh on 401 |

### Modified Files

| File | Changes |
|---|---|
| `src/backends/ado/index.ts` | Replace `az*()` with `api.*()`, async `create()` factory |
| `src/backends/ado/mappers.ts` | Minor adjustments if REST response shape differs from CLI JSON |
| `src/auth/index.ts` | Export ADO auth functions |
| `src/cli/commands/auth.ts` | Add `azure` provider to login/status/logout, add `--pat` flag |
| `src/backends/factory.ts` | Call `AzureDevOpsBackend.create(root, { skipAuth })` instead of `new` |
| `src/stores/backendDataStore.ts` | Add ADO to `AuthError` catch path (same pattern as GitHub) |

### Deleted Files

| File | Reason |
|---|---|
| `src/backends/ado/az.ts` | Entire CLI wrapper layer (198 lines) |
| `src/backends/ado/az.test.ts` | Tests for deleted wrapper (176 lines) |

### Updated Tests

| File | Changes |
|---|---|
| `src/backends/ado/ado.test.ts` | Mock `AdoApiClient` instead of `az*` functions |
| `src/backends/ado/ado.e2e.test.ts` | Remove `az` CLI requirement, use token-based auth |

## Breaking Changes

- `az` CLI no longer required for ADO backend
- Users must run `tic auth login azure` (or `--pat`) to authenticate
- First run after upgrade prompts device code flow automatically (unless `skipAuth`)
- Single auth replaces dual `az devops login` + `az login`

## What Stays the Same

- All capabilities unchanged (relationships, priority, assignee, labels, iterations, comments)
- Work item IDs unchanged
- WIQL query patterns unchanged
- Sync behavior unchanged
- Auto-detection from git remotes unchanged (dev.azure.com / visualstudio.com)

## What Improves

- No `az` CLI dependency (works in containers/CI)
- Single auth token for everything (no more dual PAT + Azure AD)
- Comments work with same token as work items
- Create + link in one API call (faster, simpler error handling)
- Token auto-refresh (less re-authentication with OAuth)
- PAT fallback for locked-down enterprise tenants
- Retry logic and rate limit handling via `BaseApiClient`

## Implementation Order

1. Auth layer — `src/auth/ado.ts` + tests (independent)
2. API client — `src/backends/ado/api.ts` + tests (depends on auth)
3. Backend migration — swap `az*()` for `api.*()` in `index.ts`
4. Delete `az.ts` + `az.test.ts`
5. CLI/factory integration — wire up auth commands, update factory + store
6. Update tests — swap mocks

## Pre-requisites

None outside the codebase — Azure CLI client ID is public and pre-consented.
