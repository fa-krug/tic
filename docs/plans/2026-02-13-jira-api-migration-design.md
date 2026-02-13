# Jira API Migration Design

**Date:** 2026-02-13
**Status:** Approved
**Scope:** Jira Cloud only, API Token auth

## Overview

Migrate the Jira backend from `acli` CLI dependency to direct Jira REST API v3 calls, following the same pattern used for GitHub, GitLab, and Azure DevOps migrations. This eliminates the external CLI dependency, improves performance (no process spawning), and integrates authentication into the TUI and CLI.

## Decisions

- **Jira Cloud only** — REST API v3 at `https://{site}/rest/api/3/`
- **API Token auth** — email + token pair, no OAuth 2.0 (3LO). Atlassian does not support device code flow.
- **Full mirror of GitHub pattern** — `BaseApiClient` subclass, private constructor + `static create()` factory, keychain storage, `skipAuth` support.

## Authentication (`src/auth/jira.ts`)

Keychain storage keyed by site:

```
account: "jira:{site}"  (e.g. "jira:mycompany.atlassian.net")
value:   "email:token"  (e.g. "user@corp.com:ABCdef123...")
```

Functions:
- `getJiraCredentials(site): { email, token } | null` — reads from keychain, splits on first `:`
- `setJiraCredentials(site, email, token)` — writes to keychain
- `removeJiraCredentials(site)` — deletes from keychain

TUI auth flow (via `AuthPrompt`):
- Simple form: email input + masked token input
- Hint: "Generate a token at https://id.atlassian.com/manage-profile/security/api-tokens"
- On submit: validate with `GET /rest/api/3/myself` → store in keychain on success

CLI auth:
- Add `'jira'` to `VALID_PROVIDERS`
- `tic auth login jira` — prompts for site, email, token; validates; stores
- `tic auth status jira` — checks keychain + validates with `/myself`
- `tic auth logout jira` — removes from keychain

## API Client (`src/backends/jira/api.ts`)

`JiraApiClient extends BaseApiClient`

```typescript
constructor(email: string, token: string, site: string) {
  // Base URL: https://{site}/rest
  // Auth: Basic base64(email:token)
}
```

Uses Basic auth (`Authorization: Basic <base64>`) rather than Bearer token. Overrides `fetch` to set the correct header.

Core method:
- `rest<T>(method, path, body?)` — Jira REST API v3 calls

Pagination: Jira uses offset-based (`startAt` + `maxResults` + `total`), not link headers.

Key endpoints:

| Operation | Endpoint |
|-----------|----------|
| Validate auth | `GET /api/3/myself` |
| Search issues | `GET /api/3/search?jql=...&fields=*all` |
| Get issue | `GET /api/3/issue/{key}?fields=*all` |
| Create issue | `POST /api/3/issue` |
| Update issue | `PUT /api/3/issue/{key}` |
| Delete issue | `DELETE /api/3/issue/{key}` |
| Transitions | `GET /api/3/issue/{key}/transitions` + `POST /api/3/issue/{key}/transitions` |
| Comments | `GET/POST /api/3/issue/{key}/comment` |
| Link issues | `POST /api/3/issueLink` |
| Statuses | `GET /api/3/project/{key}/statuses` |
| Issue types | `GET /api/3/project/{key}` |
| Assignees | `GET /api/3/user/assignable/search?project={key}` |
| Sprints | `GET /agile/1.0/board/{id}/sprint` |

Error handling: Jira returns `{ errorMessages: [...], errors: {...} }` — parsed into readable messages. 401 → `AuthError`. 429 → respect `Retry-After`.

## Backend Class (`src/backends/jira/index.ts`)

Private constructor + `static create()` async factory:

```typescript
class JiraBackend extends BaseBackend {
  private api: JiraApiClient;
  private site: string;
  private project: string;
  private boardId: number | undefined;

  private constructor(api, site, project, boardId?) { ... }

  static async create(root, options?: { skipAuth?: boolean }): Promise<JiraBackend> {
    // 1. Read jira config from SQLite (site, project, boardId)
    // 2. Get credentials from keychain via getJiraCredentials(site)
    // 3. If no credentials + skipAuth: throw AuthError
    // 4. Create JiraApiClient(email, token, site)
    // 5. Validate with GET /myself
    // 6. Return new JiraBackend(api, site, project, boardId)
  }
}
```

Operation mapping from acli to REST:

| Operation | Before (acli) | After (REST) |
|-----------|---------------|--------------|
| `listWorkItems` | `acli jira workitem search --jql ...` | `api.rest('GET', '/api/3/search?jql=...')` |
| `getWorkItem` | `acli jira workitem view --key {id}` | `api.rest('GET', '/api/3/issue/{id}?fields=*all')` |
| `createWorkItem` | `acli jira workitem create ...` + link cmds | `api.rest('POST', '/api/3/issue', body)` + `POST /api/3/issueLink` |
| `updateWorkItem` | Separate `transition`, `assign`, `edit` | `api.rest('PUT', '/api/3/issue/{id}', body)` + `POST .../transitions` |
| `deleteWorkItem` | `acli jira workitem delete --key {id}` | `api.rest('DELETE', '/api/3/issue/{id}')` |
| `addComment` | `acli jira workitem comment create ...` | `api.rest('POST', '/api/3/issue/{id}/comment', {body})` |
| `getStatuses` | `acli jira project statuses ...` | `api.rest('GET', '/api/3/project/{key}/statuses')` |
| `getWorkItemTypes` | `acli jira project view ...` | `api.rest('GET', '/api/3/project/{key}')` |
| `getAssignees` | `acli jira user search ...` | `api.rest('GET', '/api/3/user/assignable/search?project={key}')` |
| `getIterations` | `acli jira board list-sprints ...` | `api.rest('GET', '/agile/1.0/board/{id}/sprint')` |
| `openItem` | `acli jira workitem view --web` | `open(https://{site}/browse/{id})` — no API call |
| `getItemUrl` | Sync acli call | `https://{site}/browse/{id}` — computed, no API call |

Preserved behaviors:
- Capabilities object unchanged
- Priority mapping (`mappers.ts`) unchanged
- Dependency rollback on create failure
- JQL-based children/dependents queries
- `setCurrentIteration()` remains a no-op

## Integration Points

| Component | Change |
|-----------|--------|
| `src/backends/factory.ts` | None — already calls `JiraBackend.create()`. Add `skipAuth` passthrough. |
| `src/stores/backendDataStore.ts` | Minor — ensure `skipAuth` passed for Jira in `createBackendAndSync()` |
| `src/components/AuthPrompt.tsx` | Add Jira branch — email + token form (no polling, simpler than GitHub/ADO) |
| `src/cli/commands/auth.ts` | Add `'jira'` to `VALID_PROVIDERS`, implement login/status/logout handlers |
| `src/backends/availability.ts` | None — already returns `true` for Jira |
| `src/components/Settings.tsx` | None — Jira config fields already handled |

## Testing Strategy

**New:** `src/backends/jira/api.test.ts` — mock `global.fetch`, test Basic auth headers, pagination, error parsing, retry.

**New:** `src/auth/jira.test.ts` — keychain get/set/remove, edge case for tokens containing `:`.

**Updated:** `src/backends/jira/jira.test.ts` — re-mock from `acli`/`acliExec` to `JiraApiClient`. Same operations tested, same edge cases, different mock layer.

**Updated:** `src/backends/jira/mappers.test.ts` — minor updates if REST response shapes differ from acli JSON.

**Deleted:** `src/backends/jira/acli.test.ts` — no longer needed.

## File Summary

### New files (4)
- `src/backends/jira/api.ts` — JiraApiClient
- `src/backends/jira/api.test.ts` — API client tests
- `src/auth/jira.ts` — keychain credential management
- `src/auth/jira.test.ts` — auth tests

### Modified files (7)
- `src/backends/jira/index.ts` — full rewrite to REST API
- `src/backends/jira/mappers.ts` — minor shape adjustments
- `src/backends/jira/jira.test.ts` — re-mock to API client
- `src/backends/jira/mappers.test.ts` — update test data if needed
- `src/cli/commands/auth.ts` — add Jira provider
- `src/components/AuthPrompt.tsx` — add Jira email+token form
- `src/stores/backendDataStore.ts` — skipAuth passthrough

### Deleted files (2)
- `src/backends/jira/acli.ts` — CLI wrapper removed
- `src/backends/jira/acli.test.ts` — tests for deleted file
