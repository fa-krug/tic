# Direct API + Integrated OAuth Design

## Problem

All remote backends (GitHub, GitLab, Azure DevOps, Jira) shell out to external CLI tools (`gh`, `glab`, `az`, `acli`) for both authentication and API calls. This has three drawbacks:

1. **Extra dependencies** — users must install and configure each CLI tool separately
2. **Poor UX** — authentication requires running a separate CLI command (`gh auth login`, etc.) outside of tic
3. **Performance** — spawning subprocesses for every API call adds overhead vs. direct HTTP

## Goals

- Remove all external CLI dependencies for remote backends
- Integrated OAuth flows so users authenticate entirely within tic
- Direct HTTP calls via Node's built-in `fetch` for better performance
- Shared foundation that all backends can reuse (no duplication)

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| OAuth flow (GitHub/GitLab) | Device flow | Simplest for terminal apps, no local server needed |
| Credential storage | `@napi-rs/keyring` | Cross-platform system keychain, precompiled Rust binaries, no node-gyp |
| Keychain fallback | None | YAGNI — fail if keychain unavailable |
| HTTP client | Built-in `fetch` (Node 18+) | Zero dependencies |
| API client pattern | Class per provider, shared base class | Common retry/rate-limit logic, provider-specific pagination |
| Token management | API client class with `this.token` | Clean — no threading tokens through every call |
| GitHub Enterprise | Not in scope | github.com only; GHE is just a base URL change later |
| OAuth app | Public tic OAuth App, user can override with custom client ID | Seamless default, privacy option available |
| Open URL in browser | `open` package | Cross-platform, proven, replaces inconsistent `execFileSync('open', ...)` across backends |

## New Dependencies

| Package | Purpose |
|---------|---------|
| `@napi-rs/keyring` | System keychain access (macOS Security.framework, Windows Credential Manager, Linux Secret Service) |
| `open` | Cross-platform "open URL in browser" |

No other new runtime dependencies. Built-in `fetch` replaces all CLI subprocess calls.

## Architecture

### Layer 1: Credential Storage (`src/auth/keychain.ts`)

Shared thin wrapper around `@napi-rs/keyring`:

```typescript
import { Entry } from '@napi-rs/keyring';

export function getToken(service: string, account: string): string | null;
export function setToken(service: string, account: string, token: string): void;
export function deleteToken(service: string, account: string): void;
```

- Service is always `"tic"`
- Account varies by provider: `"github.com"`, `"gitlab.com"`, `"dev.azure.com"`, `"jira:mysite.atlassian.net"`

### Layer 2: Auth Modules (`src/auth/<provider>.ts`)

Separate module per provider, each exporting the same shape:

```typescript
// src/auth/github.ts
export function authenticateGitHub(options?: { clientId?: string; onCode?: (code: string, url: string) => void }): Promise<string>;
export function getGitHubToken(): Promise<string | null>;
export function clearGitHubToken(): Promise<void>;
```

Each module owns its provider-specific flow:

| Provider | Auth Flow | Details |
|----------|-----------|---------|
| GitHub | OAuth Device Flow | POST `github.com/login/device/code`, poll for token, scope: `repo` |
| GitLab | OAuth Device Flow | Similar to GitHub, GitLab supports device flow |
| Azure DevOps | Azure AD OAuth | Device code flow via `login.microsoftonline.com` |
| Jira | Atlassian OAuth 2.0 (3LO) | User-configured site URL, Atlassian OAuth with consent screen |

All modules store/retrieve tokens via the shared `keychain.ts`.

#### GitHub Device Flow Detail

1. POST `https://github.com/login/device/code` with tic's public client ID and `repo` scope
2. GitHub returns `user_code`, `verification_uri`, `device_code`, `interval`
3. Display: "Visit https://github.com/login/device and enter code: ABCD-1234"
4. Poll `https://github.com/login/oauth/access_token` at specified interval until user completes authorization
5. Store access token in keychain under `tic` / `github.com`

**Client ID override:** If user sets `githubClientId` in project config, that client ID is used instead of tic's default.

**Token refresh:** GitHub OAuth tokens don't expire unless revoked. On 401, clear stored token and re-initiate device flow.

**Callbacks:** `authenticateGitHub()` accepts an optional `onCode` callback so each context (TUI, CLI, MCP) can render the code/URL appropriately.

### Layer 3: Shared API Client (`src/backends/shared/api-client.ts`)

Abstract base class with common HTTP logic:

```typescript
export abstract class BaseApiClient {
  constructor(protected token: string, protected baseUrl: string) {}

  protected async fetch<T>(method: string, path: string, body?: unknown): Promise<T>;
  protected abstract paginate<T>(path: string): AsyncGenerator<T>;
  protected async retry<T>(fn: () => Promise<T>): Promise<T>;
  protected checkRateLimit(headers: Headers): void;
}
```

- **`fetch()`** — Sets `Authorization: Bearer <token>`, JSON serialization, response parsing, error handling. On 401, throws `AuthError` (caught by backend to trigger re-auth).
- **`paginate()`** — Abstract; pagination differs per provider.
- **`retry()`** — Single retry on 5xx after 1 second delay.
- **`checkRateLimit()`** — Reads rate limit headers, warns when remaining < 100, throws descriptive error on 403 rate limit exceeded with reset time.

### Layer 4: Provider API Clients

Each backend extends `BaseApiClient` with provider-specific behavior:

| Client | Pagination | Special Headers | Extra Methods |
|--------|-----------|----------------|---------------|
| `GitHubApiClient` | `Link` header (`rel="next"`) | `X-GitHub-Api-Version: 2022-11-28` | `graphql()` for GraphQL queries, sub-issues feature header |
| `GitLabApiClient` | `X-Next-Page` header | None | GitLab API v4 path prefix |
| `AzureDevOpsApiClient` | `continuationToken` query param | Azure-specific auth | WIQL query support |
| `JiraApiClient` | `startAt`/`maxResults` offset | Atlassian-specific headers | JQL query support |

Example for GitHub:

```typescript
export class GitHubApiClient extends BaseApiClient {
  constructor(token: string) {
    super(token, 'https://api.github.com');
  }

  async rest<T>(method: string, path: string, body?: unknown): Promise<T>;
  async graphql<T>(query: string, variables?: Record<string, unknown>): Promise<T>;
  async *paginate<T>(path: string): AsyncGenerator<T>;
}
```

### Layer 5: Backend Migration

Each backend class changes minimally in structure — still extends `BaseBackend`, same methods, same capabilities. Key changes:

**Constructor becomes async factory:**

```typescript
class GitHubBackend extends BaseBackend {
  private api: GitHubApiClient;

  private constructor(api: GitHubApiClient, owner: string, repo: string) { ... }

  static async create(root: string): Promise<GitHubBackend> {
    // 1. Get/prompt for token (from keychain or device flow)
    // 2. Detect owner/repo from git remotes
    // 3. Construct GitHubApiClient with token
    // 4. Return new GitHubBackend(api, owner, repo)
  }
}
```

Factory callers in `factory.ts` and `backendDataStore` update from `new XBackend(root)` to `XBackend.create(root)`.

**GitHub method migrations:**

| Method | Before (gh CLI) | After (direct API) |
|--------|-----------------|-------------------|
| `listWorkItems()` | `ghGraphQL(LIST_ISSUES_QUERY)` | `this.api.graphql(LIST_ISSUES_QUERY)` |
| `getWorkItem()` | `ghGraphQL(GET_ISSUE_QUERY)` | `this.api.graphql(GET_ISSUE_QUERY)` |
| `createWorkItem()` | `gh issue create` | `POST /repos/{owner}/{repo}/issues` |
| `updateWorkItem()` | `gh issue edit/close/reopen` | `PATCH /repos/{owner}/{repo}/issues/{n}` |
| `deleteWorkItem()` | `gh issue delete` | GraphQL `deleteIssue` mutation |
| `addComment()` | `gh issue comment` | `POST /repos/{owner}/{repo}/issues/{n}/comments` |
| `getAssignees()` | `gh api .../collaborators` | `this.api.paginate('/repos/.../collaborators')` |
| `getIterations()` | `gh api .../milestones` | `this.api.paginate('/repos/.../milestones')` |
| `getItemUrl()` | `ghSync(['issue', 'view', '--json', 'url'])` | Construct from `owner/repo/number` (no API call) |
| `openItem()` | `gh issue view --web` | `open` package with constructed URL |

**What stays the same per backend:** Capabilities, mappers, GraphQL queries (GitHub), cache behavior, error rollback patterns.

## Auth UX Across Contexts

### `tic auth` CLI Command

Works for all backends:

- `tic auth login github` — GitHub device flow
- `tic auth login gitlab` — GitLab device flow
- `tic auth login azure` — Azure AD flow
- `tic auth login jira` — Atlassian OAuth flow
- `tic auth status` — Shows auth state for all configured backends
- `tic auth logout github` — Clears GitHub token from keychain

### Three Contexts, Three Behaviors

| Context | No token stored | Token invalid (401) |
|---------|----------------|-------------------|
| **TUI** | Inline auth component with device code, URL, spinner | Clear token, show auth component again |
| **CLI** | Interactive device flow on stdout, blocks until complete | Clear token, re-run device flow |
| **MCP** | First tool call initiates device flow, returns code/URL as progress text, blocks until auth completes, then returns actual result | Clear token, same flow on next tool call |

### TUI Auth Component

`src/components/GitHubAuth.tsx` (and equivalents per provider) — small Ink component that renders:
- The verification URL
- The user code (prominently displayed)
- A "Waiting for authorization..." spinner
- Error/timeout messaging

The auth module's `onCode` callback feeds state to this component.

### MCP Behavior

1. Tool call arrives (e.g., `list_items`), no token stored
2. Backend creation initiates device flow
3. Tool response includes: "GitHub authentication required. Visit https://github.com/login/device and enter code: ABCD-1234. Waiting for authorization..."
4. Polls in background until user completes auth
5. Token stored, backend initializes, original operation executes
6. Tool returns the actual result — single call, single response, no retry needed

## File Structure

```
src/auth/
  keychain.ts          # Shared @napi-rs/keyring wrapper
  github.ts            # GitHub OAuth device flow
  gitlab.ts            # GitLab OAuth device flow
  ado.ts               # Azure AD OAuth flow
  jira.ts              # Atlassian OAuth 2.0 (3LO)
  index.ts             # Re-exports

src/backends/shared/
  api-client.ts        # BaseApiClient abstract class

src/backends/github/
  api.ts               # GitHubApiClient extends BaseApiClient
  index.ts             # GitHubBackend (migrated from gh CLI to api.ts)
  mappers.ts           # Unchanged
  gh.ts                # DELETED

src/backends/gitlab/
  api.ts               # GitLabApiClient extends BaseApiClient
  index.ts             # GitLabBackend (migrated)
  glab.ts              # DELETED (when gitlab is migrated)

src/backends/ado/
  api.ts               # AzureDevOpsApiClient extends BaseApiClient
  index.ts             # AzureDevOpsBackend (migrated)
  az.ts                # DELETED (when ado is migrated)

src/backends/jira/
  api.ts               # JiraApiClient extends BaseApiClient
  index.ts             # JiraBackend (migrated)
  acli.ts              # DELETED (when jira is migrated)

src/components/
  AuthFlow.tsx          # Shared TUI auth component (renders code/URL/spinner)

src/cli/commands/
  auth.ts              # tic auth login/status/logout commands
```

## Testing Strategy

### Unit tests for `src/auth/`

- `keychain.test.ts` — Mock `@napi-rs/keyring` Entry class. Test get/set/delete flows, error handling when keychain unavailable.
- `github.test.ts` (auth) — Mock `fetch` to simulate device flow: request code, poll with `authorization_pending`, return token. Test timeout, denial, network errors.

### Unit tests for API clients

- `api-client.test.ts` — Mock `fetch`. Test base class behavior: auth headers, JSON parsing, retry on 5xx, rate limit warning/error, 401 → `AuthError`.
- `github/api.test.ts` — Test GitHub-specific: REST calls, GraphQL queries, Link header pagination, sub-issues feature header.

### Migration of existing backend tests

- Current tests mock CLI wrappers (`gh`, `glab`, `az`, `acli`). Mocks change to target API client methods instead.
- Test logic and assertions stay largely the same — same backend behavior, different transport.
- Each backend's test suite (600-800 lines each) migrates 1:1.

## Migration Order

GitHub first (this design), then each backend independently:

1. **Shared foundation** — `src/auth/keychain.ts`, `src/backends/shared/api-client.ts`, `tic auth` CLI, `open` package, `AuthFlow.tsx` component
2. **GitHub** — `src/auth/github.ts`, `GitHubApiClient`, migrate `GitHubBackend`, delete `gh.ts`
3. **GitLab** — `src/auth/gitlab.ts`, `GitLabApiClient`, migrate `GitLabBackend`, delete `glab.ts`
4. **Azure DevOps** — `src/auth/ado.ts`, `AzureDevOpsApiClient`, migrate `AzureDevOpsBackend`, delete `az.ts`
5. **Jira** — `src/auth/jira.ts`, `JiraApiClient`, migrate `JiraBackend`, delete `acli.ts`

Each step is independently shippable. The shared foundation (step 1) is built alongside the GitHub migration (step 2).

## Breaking Changes

- **Major version bump** required — system requirements change (CLI tools no longer needed, but auth flow changes)
- Users must run `tic auth login <provider>` once after upgrading (or the device flow triggers automatically on first use)
- Tokens previously managed by CLI tools (`gh`, `glab`, etc.) are not migrated — fresh authentication required

## Out of Scope

- GitHub Enterprise / GitLab self-hosted (just a base URL change, add later)
- Token refresh for providers that issue expiring tokens (handle per-provider when migrating)
- Offline token caching / encrypted file fallback
- `open` package adoption in existing backends (follow-up after this migration)
