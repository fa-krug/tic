# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

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

## Architecture

### Entry Point & Rendering

`src/index.tsx` is the CLI entry point. It renders `<App>` using Ink's `render()`. The app uses screen-based routing via React Context (`AppContext` in `src/app.tsx`), with screens: `list`, `form`, `iteration-picker`.

### Backend Abstraction

`src/backends/types.ts` defines the `Backend` interface (CRUD for issues, iteration management, status/iteration lists). All UI components interact with backends only through this interface.

The only implementation so far is `LocalBackend` (`src/backends/local/index.ts`), which stores issues as markdown files with YAML frontmatter in a `.tic/` directory:
- `.tic/config.yml` — statuses, iterations, current iteration, next issue ID
- `.tic/issues/{id}.md` — individual issue files (frontmatter metadata + markdown body + comments section)

### Components

- `IssueList` — table view with keyboard navigation (arrows, `c` create, `d` delete, `s` cycle status, `i` switch iteration, `q` quit)
- `IssueForm` — multi-field form for create/edit (field navigation with arrows, Enter to edit, Esc to save and return)
- `IterationPicker` — select from configured iterations

### Shared Types

`src/types.ts` defines `Issue`, `Comment`, `NewIssue`, and `NewComment` interfaces used across backends and components.

## Tech Stack

- **UI**: React 19 + Ink 6 (terminal rendering)
- **Language**: TypeScript 5.9 (strict, via `@sindresorhus/tsconfig`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Testing**: Vitest 4 (tests use temp directories for isolation)
- **Issue storage**: gray-matter (YAML frontmatter) + yaml (serialization)

## Conventions

- Tests live alongside source files (`*.test.ts`)
- **Prettier** for formatting (`singleQuote: true`, defaults otherwise)
- **ESLint** with typescript-eslint recommended type-checked rules
- **Husky** pre-commit hook runs `format:check`, `lint`, and `tsc --noEmit`
- Commits follow conventional commit style (`feat:`, `fix:`, `docs:`)
