# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) for full developer documentation.

## Project Overview

**tic** is a terminal UI for issue tracking across multiple backends (GitHub, GitLab, Azure DevOps, local markdown). Built with TypeScript and Ink (React for the terminal). All four backends are implemented.

## Commands

```bash
npm run build        # Compile TypeScript (tsc)
npm run dev          # Watch mode (tsc --watch)
npm start            # Run the TUI (node dist/index.js)
npm test             # Run all tests (vitest run --exclude 'dist/**')
npx vitest run src/backends/local/config.test.ts   # Run a single test file
npm run lint         # Run ESLint on src/
npm run lint:fix     # Run ESLint with auto-fix
npm run format       # Format src/ with Prettier
npm run format:check # Check formatting without writing
```

### MCP Server

`tic mcp serve` starts an MCP server on stdio, exposing 14 tools for work item management. Connect it to Claude Code with:

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

`src/index.tsx` is the CLI entry point. It renders `<App>` using Ink's `render()`. The app uses screen-based routing via React Context (`AppContext` in `src/app.tsx`), with screens: `list`, `form`, `iteration-picker`.

### Backend Abstraction

`src/backends/types.ts` defines the `Backend` interface (CRUD for work items, iteration management, status/iteration/type lists, relationship queries via `getChildren(id)` and `getDependents(id)`). All UI components interact with backends only through this interface.

`BaseBackend` (`src/backends/types.ts`) is the abstract base class all backends extend. It provides `validateFields()` to throw `UnsupportedOperationError` for fields the backend doesn't support, and `assertSupported()` for gating entire operations. Each backend implements `getCapabilities()` returning a `BackendCapabilities` object that declares supported feature groups (`relationships`, `customTypes`, `customStatuses`, `iterations`, `comments`) and individual fields (`priority`, `assignee`, `labels`, `parent`, `dependsOn`). TUI components, CLI commands, and MCP tools use capabilities to hide unsupported features.

**Implemented backends:**

- `LocalBackend` (`src/backends/local/`) — markdown files with YAML frontmatter in `.tic/` (`.tic/config.yml` for config, `.tic/items/{id}.md` for items)
- `GitHubBackend` (`src/backends/github/`) — GitHub Issues via `gh` CLI
- `GitLabBackend` (`src/backends/gitlab/`) — GitLab Issues via `glab` CLI
- `AzureDevOpsBackend` (`src/backends/ado/`) — Azure DevOps Work Items via `az` CLI

`src/backends/factory.ts` auto-detects the backend from git remotes (github.com → GitHub, gitlab.com → GitLab, dev.azure.com/visualstudio.com → Azure DevOps, fallback → local). Can be overridden via `backend` in `.tic/config.yml`.

### Components

- `WorkItemList` — tree-indented table view with keyboard navigation (arrows, `c` create, `d` delete, `s` cycle status, `p` set parent, `Tab` switch work item type, `i` switch iteration, `q` quit). Shows `⧗` indicator for items with dependencies and warnings when completing items with open children/deps.
- `WorkItemForm` — multi-field form for create/edit with type dropdown, parent ID field, and comma-separated dependency IDs (field navigation with arrows, Enter to edit, Esc to save and return). Shows read-only relationships section (children, dependents) when editing.
- `IterationPicker` — select from configured iterations

### CLI

`src/cli/index.ts` defines CLI commands via Commander: `init` (with `--backend`), `item` (list/show/create/update/delete/open/comment), `iteration` (list/set), `config` (get/set), `mcp serve`. Global options: `--json`, `--quiet`.

### Shared Types

`src/types.ts` defines `WorkItem`, `Comment`, `NewWorkItem`, and `NewComment` interfaces used across backends and components. `WorkItem` includes `parent: string | null` and `dependsOn: string[]` for hierarchical and dependency relationships (IDs are strings to support non-numeric IDs from external backends). Validation (circular references, referential integrity) is enforced at the backend level, and references are cleaned up on delete.

## Tech Stack

- **UI**: React 19 + Ink 6 (terminal rendering)
- **Language**: TypeScript 5.9 (strict, via `@sindresorhus/tsconfig`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Testing**: Vitest 4 (tests use temp directories for isolation)
- **Work item storage**: gray-matter (YAML frontmatter) + yaml (serialization)

## Conventions

- Tests live alongside source files (`*.test.ts`)
- **Prettier** for formatting (`singleQuote: true`, defaults otherwise)
- **ESLint** with typescript-eslint recommended type-checked rules
- **Husky** pre-commit hook runs `format:check`, `lint`, and `tsc --noEmit`
- Commits follow conventional commit style (`feat:`, `fix:`, `docs:`)
