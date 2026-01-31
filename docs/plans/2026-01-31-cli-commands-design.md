# CLI Commands Design

## Overview

Add a scriptable CLI interface to tic for shell scripting and automation (e.g., creating items from CI). The TUI remains the default when `tic` is run with no arguments. Subcommands provide machine-readable output in TSV or JSON.

## Command Structure

Uses Commander.js with git-style nested subcommands:

```
tic                          -> launches TUI (no args)
tic init                     -> initialize .tic/ directory
tic item list                -> list items (with filters)
tic item show <id>           -> show single item
tic item create <title>      -> create item
tic item update <id>         -> update item fields
tic item delete <id>         -> delete item
tic item comment <id> <text> -> add comment
tic iteration list           -> list iterations
tic iteration set <name>     -> set current iteration
```

## Output Format

### TSV (default)

No headers by default. Add `--headers` to include them.

**`tic item list`** — one item per line, tab-separated fields:

```
1	task	in-progress	high	Fix login bug	sprint-1
2	issue	todo	medium	Add search	sprint-1
```

**`tic item show <id>`** — key/value pairs, one per line:

```
id	1
title	Fix login bug
type	task
status	in-progress
priority	high
iteration	sprint-1
assignee	alice
labels	auth,backend
parent	3
depends_on	2,5
created	2026-01-15T10:00:00.000Z
updated	2026-01-20T14:30:00.000Z
```

Description body is excluded from `item list`, included in `item show` after a blank line separator. Lists within fields (labels, depends_on) are comma-separated. Empty fields are empty strings.

### JSON (`--json`)

Global flag available on all commands. Outputs structured JSON to stdout.

## Flags & Arguments

### Global flags

- `--json` — output JSON instead of TSV
- `--quiet` — suppress output on mutations (exit code only)

### `tic item list`

- `--status <status>` — filter by status
- `--type <type>` — filter by work item type
- `--iteration <name>` — filter by iteration (defaults to current)
- `--all` — show all iterations
- `--headers` — include TSV column headers

### `tic item create <title>`

- `--type <type>` — work item type (default: `task`)
- `--status <status>` — initial status (default: first in config)
- `--priority <priority>` — priority level
- `--assignee <name>` — assignee
- `--labels <a,b>` — comma-separated labels
- `--iteration <name>` — iteration (default: current)
- `--parent <id>` — parent item ID
- `--depends-on <id,id>` — comma-separated dependency IDs
- Reads description from stdin if piped: `echo "details" | tic item create "Title"`

### `tic item update <id>`

Same flags as create (each optional, only updates provided fields), plus:

- `--title <title>` — update title
- Stdin for description replacement

### `tic item delete <id>`

No additional flags. Deletes without confirmation (scripts don't prompt).

### `tic item comment <id> <text>`

- `--author <name>` — comment author (default: git user or "anonymous")

### `tic init`

No flags. Creates `.tic/` with default config.

### `tic iteration list`

No additional flags.

### `tic iteration set <name>`

No additional flags.

## Mutation Output

Mutating commands (`create`, `update`, `delete`, `comment`, `init`, `iteration set`) print the resulting object in the chosen format unless `--quiet` is set. This allows capturing results:

```bash
id=$(tic item create "Bug" | cut -f1)
```

## Error Handling

- Errors go to stderr, exit code 1
- TSV mode: `Error: <message>` as plain text
- JSON mode: `{"error": "<message>"}` as JSON
- Invalid enum values list valid options: `Error: Invalid status "wip". Valid: backlog, todo, in-progress, review, done`
- Missing `.tic/` directory: `Error: Not a tic project (no .tic/ directory found). Run 'tic init' first.`
- `tic init` on existing project: no-op with message `Already initialized in .tic/`
- Stdin detection via `process.stdin.isTTY`

## File Structure

```
src/
  cli/
    index.ts              — Commander program setup, subcommand registration
    format.ts             — TSV and JSON output formatters
    commands/
      init.ts             — tic init
      item.ts             — tic item {list,show,create,update,delete,comment}
      iteration.ts        — tic iteration {list,set}
  cli/__tests__/
    init.test.ts          — init command tests
    item.test.ts          — item command tests
    iteration.test.ts     — iteration command tests
```

## Entry Point

`src/index.tsx` checks `process.argv.length > 2` before rendering:

```typescript
if (process.argv.length > 2) {
  await runCli(process.argv);  // from src/cli/index.ts
} else {
  render(<App />);             // existing TUI
}
```

## Dependencies

- **Commander.js** — argument parsing, subcommand routing, auto-generated help
- No other new dependencies. CLI reuses the existing `Backend` interface and `LocalBackend`.

## Testing

Tests live in `src/cli/__tests__/`. Each test file spins up a temp `.tic/` directory, runs command handlers directly, and asserts on stdout content and exit codes. Same isolation pattern as existing backend tests.
