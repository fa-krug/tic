# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository. See [CONTRIBUTING.md](CONTRIBUTING.md) for full developer documentation.

## Project Overview

**tic** is a terminal UI for issue tracking across multiple backends (GitHub, GitLab, Azure DevOps, local markdown). Built with TypeScript and Ink (React for the terminal). Currently only the local markdown backend is implemented.

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

The only implementation so far is `LocalBackend` (`src/backends/local/index.ts`), which stores work items as markdown files with YAML frontmatter in a `.tic/` directory:
- `.tic/config.yml` — types, statuses, iterations, current iteration, next item ID
- `.tic/items/{id}.md` — individual work item files (frontmatter metadata + markdown body + comments section)

### Components

- `WorkItemList` — tree-indented table view with keyboard navigation (arrows, `c` create, `d` delete, `s` cycle status, `p` set parent, `Tab` switch work item type, `i` switch iteration, `q` quit). Shows `⧗` indicator for items with dependencies and warnings when completing items with open children/deps.
- `WorkItemForm` — multi-field form for create/edit with type dropdown, parent ID field, and comma-separated dependency IDs (field navigation with arrows, Enter to edit, Esc to save and return). Shows read-only relationships section (children, dependents) when editing.
- `IterationPicker` — select from configured iterations

### Shared Types

`src/types.ts` defines `WorkItem`, `Comment`, `NewWorkItem`, and `NewComment` interfaces used across backends and components. `WorkItem` includes `parent: number | null` and `dependsOn: number[]` for hierarchical and dependency relationships. Validation (circular references, referential integrity) is enforced at the backend level, and references are cleaned up on delete.

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
