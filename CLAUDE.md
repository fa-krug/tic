# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) for full developer documentation.

## Project Overview

**tic** is a terminal UI for issue tracking across multiple backends (GitHub, GitLab, Azure DevOps, Jira). Built with TypeScript and Ink (React for the terminal). All data is stored locally in SQLite (`.tic/tic.db`) and optionally synced to a remote backend.

## Commands

```bash
npm run build        # Compile TypeScript (tsc)
npm run dev          # Watch mode (tsc --watch)
npm start            # Run the TUI (node dist/index.js)
npm test             # Run all tests (vitest run --exclude 'dist/**')
npx vitest run src/storage/config.test.ts   # Run a single test file
npm run lint         # Run ESLint on src/
npm run lint:fix     # Run ESLint with auto-fix
npm run format       # Format src/ with Prettier
npm run format:check # Check formatting without writing
```

### MCP Server

`tic mcp serve` starts an MCP server on stdio, exposing 14 tools for work item management (plus up to 8 PR tools when the backend supports pull requests, and 6 branch tools when in a git repo). Connect it to Claude Code with:

```bash
claude mcp add --scope project --transport stdio tic -- npx tic mcp serve
```

Or add `.mcp.json` to the project root:

```json
{
  "mcpServers": {
    "tic": {
      "type": "stdio",
      "command": "npx",
      "args": ["tic", "mcp", "serve"]
    }
  }
}
```

## Architecture

### Entry Point & Rendering

`src/index.tsx` is the CLI entry point. It renders `<App>` using Ink's `render()`. On first run, the TUI auto-initializes by detecting the backend from git remotes and creating `.tic/tic.db`. The app uses screen-based routing via React Context (`AppContext` in `src/app.tsx`), with screens: `list`, `form`, `editor`, `iteration-picker`, `settings`, `status`, `help`, `pr-list`, `branch-list`.

### Backend Abstraction

`src/backends/types.ts` defines the `Backend` interface (CRUD for work items, iteration management, status/iteration/type lists, relationship queries via `getChildren(id)` and `getDependents(id)`). All UI components interact with backends only through this interface.

`BaseBackend` (`src/backends/types.ts`) is the abstract base class all backends extend. It provides `validateFields()` to throw `UnsupportedOperationError` for fields the backend doesn't support, and `assertSupported()` for gating entire operations. Each backend implements `getCapabilities()` returning a `BackendCapabilities` object that declares supported feature groups (`relationships`, `customTypes`, `customStatuses`, `iterations`, `comments`) and individual fields (`priority`, `assignee`, `labels`, `parent`, `dependsOn`). TUI components, CLI commands, and MCP tools use capabilities to hide unsupported features.

**Implemented backends:**

- `Storage` (`src/storage/`) — SQLite-backed local persistence (always the primary backend)
- `GitHubBackend` (`src/backends/github/`) — GitHub Issues via REST/GraphQL API (OAuth device flow or `gh` token)
- `GitLabBackend` (`src/backends/gitlab/`) — GitLab Issues via REST/GraphQL API (OAuth device flow or PAT)
- `AzureDevOpsBackend` (`src/backends/ado/`) — Azure DevOps Work Items via REST API (Entra ID OAuth or PAT)
- `JiraBackend` (`src/backends/jira/`) — Jira issues via REST API
- `FilesBackend` (`src/backends/files/`) — filesystem sync destination that delegates I/O to `local/items.ts` and `local/templates.ts`. Used by `SyncManager` to replicate items from `Storage` to `.tic/items/` markdown files.

`PrBackend` (also in `src/backends/types.ts`) is a separate interface for pull request operations (list, show, create, merge, close, link/unlink items). `isPrBackend(backend)` type guard checks if a backend implements PR support. `PrCapabilities` declares which PR operations are available (create, merge). Currently `Storage` (local read-only) and `GitHubBackend` implement `PrBackend`.

`src/backends/factory.ts` auto-detects the remote backend from git remotes (github.com → GitHub, gitlab.com → GitLab, dev.azure.com/visualstudio.com → Azure DevOps, fallback → none). Can be overridden via the `backend` config field in SQLite. Jira is configured via the TUI settings screen.

### Storage (Local Persistence)

`Storage` (`src/storage/`) is the SQLite-backed local persistence layer. It is **not** a remote backend — it replaces `LocalBackend` as the primary local store and implements the `Backend` interface so it can be used interchangeably.

Key modules in `src/storage/`:

- `index.ts` — `Storage` class. Implements `Backend` + `SoftDeleteBackend`. All data lives in `.tic/tic.db` (SQLite with WAL mode). Manages work items, comments, templates, config, iterations, and auto-incrementing IDs.
- `schema.ts` — Drizzle ORM table definitions (work items, labels, dependencies, comments, templates, config, undo log, sync queue, color mappings, pull requests, PR-item links).
- `db.ts` — database creation, migration, and WAL setup via `createDatabase(root)`. Migrations live in `drizzle/` at the project root.
- `config.ts` — `Config` type, `defaultConfig`, and SQLite read/write functions. Project config stored in the `project_config` table (statuses, types, iterations with optional start/end dates, branch settings, views). Also provides `readBackendTypeSync()` for CLI startup.
- `syncQueue.ts` — `SyncQueue` class. Queues create/update/delete actions for `SyncManager` to push to remote backends and `FilesBackend`.
- `undo.ts` — undo log stored in the `undo_log` table. Supports soft-delete (items moved to `deleted_at` column rather than removed).
- `mappers.ts` — converts between Drizzle row types and `WorkItem`/`Template` domain objects.
- `pr-mappers.ts` — converts between Drizzle row types and `PullRequest` domain objects.

### Components

- `WorkItemList` — collapsible tree-indented table with keyboard navigation. Supports bulk operations via mark/unmark (`m`/`M`), inline property pickers via OverlayPanel (`s` status, `a` assignee, `l` labels, `t` type, `i` iteration), search (`/`), command palette (`:`), branch/worktree creation (`b`), quick PR creation (`p`), PR list (`P`), branch management (`B`), iteration picker (`I`), bulk actions menu (`x`), detail panel toggle (`v`), and undo (`u`). Shows `⧗` indicator for items with dependencies. Responsive column hiding based on terminal width. Status, priority, and labels render as colored pills via `ColorPill`.
- `WorkItemForm` — multi-field form for create/edit with dropdowns, autocomplete inputs, multi-autocomplete (labels), and built-in markdown editor (or external `$EDITOR`) for descriptions. Navigable relationship links allow drilling into related items with a back-stack. Also serves as the template editor via `formMode`. Display values for status, priority, type, and labels render as colored pills.
- `OverlayPanel` — unified overlay component for search, bulk actions, and all property pickers. Supports single-select, multi-select, and freeform input modes with fuzzy filtering and category grouping. Accepts optional `fieldType` prop to show `ColorPill` previews alongside picker items.
- `ColorPill` — reusable component rendering colored background pills for field values (status, priority, type, label). Resolves color via `themeStore.resolveFieldColor()`. Falls back to plain text when no color matches.
- `DetailPanel` — inline preview panel showing selected item metadata and description with scroll support. Status, priority, type, and labels render as colored pills.
- `AuthPrompt` — full-screen authentication flow UI. Displays device code, verification URI, and spinner during OAuth flows. Integrated into `App` via lazy loading. States: waiting, code-ready, success, error.
- `Breadcrumbs` — breadcrumb navigation for form drill-down stack.
- `IterationPicker` — full-screen iteration picker using TableLayout. Shows iteration name, date range, and color-coded status (active/past/upcoming). Supports cursor navigation and selection.
- `MarkdownEditor` — in-TUI markdown editor with syntax highlighting via `markdownHighlight.ts`. Supports cursor movement, undo/redo, kill buffer, scroll, and discard prompt. State managed by `editorStore`.
- `CommandBar` — extracted command palette and search UI. Handles recent commands, fuzzy search across items/PRs/branches, and command dispatch.
- `Settings` — backend selector, Jira configuration, theme picker, and Colors section for customizing field color pills (status, priority, type, label colors with 16-color terminal palette picker)
- `StatusScreen` — sync status and error details
- `HelpScreen` — context-sensitive keyboard shortcut reference (press `?` from any screen)
- `AutocompleteInput` / `MultiAutocompleteInput` — fuzzy autocomplete inputs for single and comma-separated multi-value fields
- `PullRequestList` — list view for pull requests (accessible via `P` from WorkItemList). Shows PR number, title, status, source→target branches, and author. Supports navigation (`Enter` to view details, `o` to open in browser), linking/unlinking work items, and colored status pills.
- `BranchList` — branch lifecycle management screen (accessible via `B` from WorkItemList). Lists all branches with linked work items (`tic/{id}-*` pattern), worktree status, remote tracking (ahead/behind), and relative commit times. Supports switch (`Enter`), create (`n`), delete (`d`), merge (`m`), push (`P`), worktree shell (`w`), refresh/fetch (`r`), and search (`/`). Two-phase loading: instant local data, then background `git fetch`.
- `TableLayout` — list rendering with responsive column visibility based on terminal width

### State Management

Zustand vanilla stores in `src/stores/`:

- `themeStore` — UI theme colors and field color resolution. Holds `themeName`, semantic `colors` (accent, muted, error, etc.), `colorOverrides` (user-defined field colors from `color_mappings` table), and `resolveFieldColor(field, value)` which checks: user override → keyword defaults → hash color (for all field types) → null. Exports `FieldType`, `FieldColor`, `autoFg()`. Initialized via `initThemeFromConfig()` after configStore loads; color overrides loaded during `backendDataStore.init()`.
- `backendDataStore` — single source of truth for backend data (items, statuses, types, assignees, labels, capabilities, sync status). Also manages auth state (`authPrompt`, `authFlow`, `authDismissed`) for in-TUI authentication flows. Initialized with `init(cwd)` which creates backends asynchronously (Storage + optional remote + SyncManager). Components subscribe via `useBackendDataStore(selector)`. Has `initGeneration` counter to prevent stale async init from overwriting store after destroy. Exposes `setColorMapping()`, `deleteColorMapping()`, `deleteColorMappingsByField()`, `reloadColorOverrides()` for Settings color picker.
- `configStore` — single source of truth for project config. Reads/writes exclusively via SQLite (the `project_config` table). `init(root)` reads config from DB, `startWatching()` is a no-op (DB is the source of truth). Store must be `destroy()`'d on exit.
- `undoStore` — undo action stack (max depth 5). Delete uses soft-delete (`deleted_at` column in SQLite), create/update use whole-item snapshots. `u` keybinding in WorkItemList pops and reverses.
- `formStackStore` — form navigation stack and field state for drill-down into related items.
- `listViewStore` — list view state (cursor position, expanded/collapsed items, marked items, scroll offset).
- `navigationStore` — screen routing and work item selection.
- `uiStore` — UI state (active overlay, warnings, toasts).
- `filterStore` — saved views and active filters (status, type, priority, assignee, label filtering).
- `recentCommandsStore` — tracks recently used command palette items (persisted to `.tic/recent-commands.json`).
- `editorStore` — in-TUI markdown editor state (lines, cursor, undo/redo stack, kill buffer, scroll offset, dirty tracking). Used by `MarkdownEditor` component.

### CLI

`src/cli/index.ts` defines CLI commands via Commander: `init` (with `--backend`), `item` (list/show/create/update/delete/open/comment), `pr` (list/show/create/merge/close/open/link/unlink), `branch` (list/switch/create/delete/merge/push), `iteration` (list/set), `config` (get/set), `auth` (login/status/logout), `mcp serve`. Global options: `--json`, `--quiet`.

### Authentication

`src/auth/` provides credential management for remote backends:

- `keychain.ts` — wrapper around `@napi-rs/keyring` for secure OS keychain storage
- `github.ts` — GitHub OAuth device flow authentication
- `gitlab.ts` — GitLab OAuth device flow + PAT fallback
- `ado.ts` — Azure DevOps Entra ID device code flow + PAT fallback with token refresh

`src/backends/shared/api-client.ts` defines `BaseApiClient` with common fetch, retry, and error handling logic. `GitHubApiClient` (REST + GraphQL), `GitLabApiClient` (REST + GraphQL), and `AdoApiClient` (WIQL, batch, pagination) extend it. `GitHubBackend`, `GitLabBackend`, and `AzureDevOpsBackend` use private constructors with static `create()` factory methods that resolve auth tokens before instantiation.

### Shared Types

`src/types.ts` defines `WorkItem`, `Comment`, `NewWorkItem`, `NewComment`, `Template`, `PullRequest`, `NewPullRequest`, and `Iteration` interfaces used across backends and components. `WorkItem` includes `parent: string | null` and `dependsOn: string[]` for hierarchical and dependency relationships (IDs are strings to support non-numeric IDs from external backends). `Iteration` has `name`, `startDate`, and `endDate` (nullable ISO date strings). Validation (circular references, referential integrity) is enforced at the backend level, and references are cleaned up on delete.

`src/iteration-utils.ts` provides `findCurrentIteration()` (matches today against date ranges), `formatIterationDates()` (human-readable date formatting), and `getIterationStatus()` (active/past/upcoming classification).

## Tech Stack

- **UI**: React 19 + Ink 6 (terminal rendering)
- **Language**: TypeScript 5.9 (strict, via `@sindresorhus/tsconfig`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Testing**: Vitest 4 (tests use temp directories for isolation)
- **Local storage**: Drizzle ORM + better-sqlite3 (SQLite with WAL mode) in `src/storage/`
- **File sync**: gray-matter (YAML frontmatter) + yaml (serialization) for `.tic/items/` markdown files
- **Auth**: @napi-rs/keyring (OS keychain), open (browser launching for OAuth flows)

## Conventions

- Tests live alongside source files (`*.test.ts`)
- **Prettier** for formatting (`singleQuote: true`, defaults otherwise)
- **ESLint** with typescript-eslint recommended type-checked rules
- **Husky** pre-commit hook runs `format:check`, `lint`, and `tsc --noEmit`
- Commits follow conventional commit style (`feat:`, `fix:`, `docs:`)
