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
npx vitest run src/backends/local/config.test.ts
```

## Tech Stack

- **UI**: React 19 + [Ink](https://github.com/vadimdemedes/ink) 6 (terminal rendering)
- **Language**: TypeScript 5.9 (strict mode via `@sindresorhus/tsconfig`)
- **Module system**: ESM (`"type": "module"` in package.json)
- **Testing**: Vitest 4
- **Work item storage**: [gray-matter](https://github.com/jonschlinkert/gray-matter) (YAML frontmatter) + [yaml](https://github.com/eemeli/yaml) (serialization)

## Architecture

### Entry Point

`src/index.tsx` is the CLI entry point. It renders `<App>` using Ink's `render()`.

### Routing

The app uses screen-based routing via React Context (`AppContext` in `src/app.tsx`). Screens:

- `list` — main work item list
- `form` — create/edit work item
- `iteration-picker` — select current iteration

### Backend Abstraction

`src/backends/types.ts` defines the `Backend` interface — CRUD for work items, iteration management, status/iteration/type lists, and relationship queries (`getChildren(id)`, `getDependents(id)`). All UI components interact through this interface only.

**Local backend** (`src/backends/local/index.ts`) is the only implementation so far. It stores work items as markdown files with YAML frontmatter in a `.tic/` directory:

- `.tic/config.yml` — types, statuses, iterations, current iteration, next item ID
- `.tic/items/{id}.md` — individual work item files

### Components

- **WorkItemList** (`src/components/work-item-list.tsx`) — tree-indented table with keyboard navigation. Handles status cycling, parent assignment, deletion with confirmation, and type/iteration filtering.
- **WorkItemForm** (`src/components/work-item-form.tsx`) — multi-field form for create/edit. Supports text fields, dropdowns, and read-only relationship display.
- **IterationPicker** (`src/components/iteration-picker.tsx`) — select from configured iterations.

### Types

`src/types.ts` defines shared interfaces:

- `WorkItem` — includes `parent: number | null` and `dependsOn: number[]`
- `Comment` — author, date, body
- `NewWorkItem` / `NewComment` — creation inputs

Validation (circular references, referential integrity) is enforced at the backend level. References are cleaned up on delete.

## Conventions

- Tests live alongside source files (`*.test.ts`) and use temp directories for isolation
- **Prettier** for formatting (`singleQuote: true`, defaults otherwise)
- **ESLint** with typescript-eslint recommended type-checked rules
- **Husky** pre-commit hook runs `format:check`, `lint`, and `tsc --noEmit`
- Commits follow conventional commit style (`feat:`, `fix:`, `docs:`)
