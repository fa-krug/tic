# Contributing to tic

## Prerequisites

- Node.js (LTS)
- npm

## Setup

```bash
git clone <repo-url>
cd tic
npm install
```

## Commands

```bash
npm run build          # Compile TypeScript
npm run dev            # Watch mode (tsc --watch)
npm start              # Run the TUI (node dist/index.js)
npm test               # Run all tests
npm run lint           # Run ESLint on src/
npm run lint:fix       # Run ESLint with auto-fix
npm run format         # Format src/ with Prettier
npm run format:check   # Check formatting without writing
```

Run a single test file:

```bash
npx vitest run src/storage/config.test.ts
```

## Tech Stack

- **UI**: React 19 + [Ink](https://github.com/vadimdemedes/ink) 6 (terminal rendering)
- **Language**: TypeScript 5.9 (strict mode via `@sindresorhus/tsconfig`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Testing**: Vitest 4
- **Local storage**: [Drizzle ORM](https://orm.drizzle.team/) + [better-sqlite3](https://github.com/WiseLibs/better-sqlite3) (SQLite with WAL mode)
- **File sync**: [gray-matter](https://github.com/jonschlinkert/gray-matter) (YAML frontmatter) + [yaml](https://github.com/eemeli/yaml) (serialization) for `.tic/items/` markdown files

## Architecture

### Entry Point

`src/index.tsx` is the CLI entry point. It renders `<App>` using Ink's `render()`.

### Routing

The app uses screen-based routing via React Context (`AppContext` in `src/app.tsx`). Screens:

- `list` — main work item list
- `form` — create/edit work item
- `iteration-picker` — select current iteration
- `settings` — backend selection and Jira configuration
- `status` — sync status and error details
- `help` — context-sensitive keyboard shortcut reference

### Backend Abstraction

`src/backends/types.ts` defines the `Backend` interface — CRUD for work items, iteration management, status/iteration/type lists, and relationship queries (`getChildren(id)`, `getDependents(id)`). All UI components interact through this interface only.

`BaseBackend` (`src/backends/types.ts`) is the abstract base class all backends extend. It provides `validateFields()` to throw `UnsupportedOperationError` for fields the backend doesn't support, and `assertSupported()` for gating entire operations. Each backend implements `getCapabilities()` returning a `BackendCapabilities` object that declares supported feature groups and fields. TUI components, CLI commands, and MCP tools use capabilities to hide unsupported features.

`src/backends/factory.ts` handles backend creation and auto-detection from git remotes.

**Implemented backends:**

- **Storage** (`src/storage/`) — SQLite-backed local persistence (always the primary backend)
- **GitHub** (`src/backends/github/`) — reads/writes GitHub Issues via the `gh` CLI
- **GitLab** (`src/backends/gitlab/`) — reads/writes GitLab Issues via the `glab` CLI
- **Azure DevOps** (`src/backends/ado/`) — reads/writes Azure DevOps Work Items via the `az` CLI
- **Jira** (`src/backends/jira/`) — reads/writes Jira issues via REST API
- **Files** (`src/backends/files/`) — filesystem sync destination that replicates items from `Storage` to `.tic/items/` markdown files via `SyncManager`

### Storage (Local Persistence)

`Storage` (`src/storage/`) is the SQLite-backed local persistence layer. It implements the `Backend` interface but is **not** a remote backend — it replaces `LocalBackend` as the primary local store. All data lives in `.tic/tic.db` (SQLite with WAL mode). Key modules: `schema.ts` (Drizzle ORM table definitions), `db.ts` (database creation and migration), `config.ts` (project config), `syncQueue.ts` (`SyncQueue` for queuing sync actions), `undo.ts` (undo log), and `mappers.ts` (row-to-domain conversions).

### Components

- **WorkItemList** (`src/components/WorkItemList.tsx`) — collapsible tree-indented table with keyboard navigation. Supports bulk operations (mark/unmark items), inline property pickers via OverlayPanel, detail panel toggle, undo, and responsive column hiding based on terminal width.
- **WorkItemForm** (`src/components/WorkItemForm.tsx`) — multi-field form for create/edit. Supports text fields, dropdowns, autocomplete inputs (assignee, parent, depends-on), multi-autocomplete (labels), external editor for descriptions, and navigable relationship links. Also serves as the template editor via `formMode`.
- **OverlayPanel** (`src/components/OverlayPanel.tsx`) — unified overlay for search, bulk actions, and property pickers (status, priority, type, assignee, labels). Supports single-select, multi-select, and freeform input modes with fuzzy filtering and category grouping.
- **DetailPanel** (`src/components/DetailPanel.tsx`) — inline preview panel showing selected item metadata (status, priority, assignee, labels) and description with scroll support.
- **IterationPicker** (`src/components/IterationPicker.tsx`) — select from configured iterations.
- **Settings** (`src/components/Settings.tsx`) — backend selector with Jira configuration fields.
- **StatusScreen** (`src/components/StatusScreen.tsx`) — sync status display with error details.
- **HelpScreen** (`src/components/HelpScreen.tsx`) — context-sensitive keyboard shortcut reference.
- **Breadcrumbs** (`src/components/Breadcrumbs.tsx`) — breadcrumb navigation for form drill-down stack.
- **AutocompleteInput** (`src/components/AutocompleteInput.tsx`) — single-value fuzzy autocomplete input.
- **MultiAutocompleteInput** (`src/components/MultiAutocompleteInput.tsx`) — comma-separated multi-value autocomplete (used for labels).
- **TableLayout** (`src/components/TableLayout.tsx`) — list rendering with responsive column visibility based on terminal width.
- **Header** (`src/components/Header.tsx`) — top-level header bar.

### State Management

State is managed via Zustand vanilla stores in `src/stores/`:

- **backendDataStore** — single source of truth for backend data (items, statuses, types, assignees, labels, capabilities, sync status). Initialized with `init(cwd)` which creates backends asynchronously (Storage + optional remote + SyncManager). Components subscribe via `useBackendDataStore(selector)`.
- **configStore** — single source of truth for project config. Reads/writes exclusively via SQLite (`project_config` table). `startWatching()` is a no-op (DB is the source of truth).
- **undoStore** — undo action stack (max depth 5). Supports delete (soft-delete via `deleted_at` column), create, and update operations via whole-item snapshots.
- **formStackStore** — form navigation stack and field state for drill-down into related items.
- **listViewStore** — list view state (cursor position, expanded/collapsed items, marked items, scroll offset).
- **navigationStore** — screen routing and work item selection.
- **uiStore** — UI state (active overlay, warnings, toasts).

### CLI

`src/cli/index.ts` defines the CLI commands using Commander. Commands include `init`, `item` (list/show/create/update/delete/open/comment), `iteration` (list/set), `config` (get/set), and `mcp serve`. Global options: `--json`, `--quiet`.

### Types

`src/types.ts` defines shared interfaces:

- `WorkItem` — includes `parent: string | null` and `dependsOn: string[]`
- `Comment` — author, date, body
- `NewWorkItem` / `NewComment` — creation inputs

Validation (circular references, referential integrity) is enforced at the backend level. References are cleaned up on delete.

## Conventions

- Tests live alongside source files (`*.test.ts`) and use temp directories for isolation
- **Prettier** for formatting (`singleQuote: true`, defaults otherwise)
- **ESLint** with typescript-eslint recommended type-checked rules
- **Husky** pre-commit hook runs `format:check`, `lint`, and `tsc --noEmit`
- Commits follow conventional commit style (`feat:`, `fix:`, `docs:`)
