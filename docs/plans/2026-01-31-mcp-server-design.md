# MCP Server Design

## Overview

Add a `tic mcp serve` command that starts an MCP (Model Context Protocol) server over stdio, exposing tic's work item operations as tools. This lets AI assistants like Claude Code interact with tic directly — listing items, creating tasks, updating statuses, and more — without shelling out to the CLI.

## Command

```
tic mcp serve    -> starts MCP server on stdio (blocks until host disconnects)
```

Follows the convention used by other MCP-enabled CLIs (e.g., `glab mcp serve`). Lives under a `tic mcp` subcommand group, leaving room for future MCP-related commands.

## Tools (14)

### Project (1)

| Tool | Description | Inputs |
|------|-------------|--------|
| `init_project` | Initialize a new .tic project in the current directory | (none) |

Returns `{ initialized: true }` or `{ alreadyExists: true }`.

### Configuration (1)

| Tool | Description | Inputs |
|------|-------------|--------|
| `get_config` | Get project config: valid types, statuses, iterations, and current iteration | (none) |

Returns `{ statuses: [...], types: [...], iterations: [...], currentIteration: "..." }`. Replaces the need for separate metadata queries — the AI gets all valid values in one call before creating or updating items.

### Item CRUD (7)

| Tool | Description | Inputs |
|------|-------------|--------|
| `list_items` | List work items with optional filters | `type?`, `status?`, `iteration?`, `all?` (bool) |
| `show_item` | Get full details of a work item | `id` (number) |
| `create_item` | Create a new work item | `title`, `type?`, `status?`, `priority?`, `assignee?`, `labels?` (string), `iteration?`, `parent?` (number), `depends_on?` (number[]), `description?` |
| `update_item` | Update fields on an existing work item | `id` (number), then all same optional fields as create |
| `delete_item` | Preview deletion of a work item (does NOT delete) | `id` (number) |
| `confirm_delete` | Confirm and execute a previously previewed deletion | `id` (number) |
| `add_comment` | Add a comment to a work item | `id` (number), `text`, `author?` |

#### Two-Step Delete

`delete_item` is a preview-only operation. It returns the item that would be deleted plus side effects:
- Children that will be orphaned (parent set to null)
- Dependency references that will be cleaned up

The item is NOT deleted. The server tracks previewed IDs in a `Set<number>` in memory.

`confirm_delete` checks that the ID was previously previewed, performs the actual deletion, and removes the ID from the set. If `confirm_delete` is called without a prior `delete_item` preview, it returns an error.

This gives the AI host (and its user) a chance to review what will happen before committing to the deletion.

### Iteration (1)

| Tool | Description | Inputs |
|------|-------------|--------|
| `set_iteration` | Set the current iteration | `name` |

### Search & Relationships (4)

| Tool | Description | Inputs |
|------|-------------|--------|
| `search_items` | Search work items by text in titles and descriptions | `query`, `type?`, `status?`, `iteration?`, `all?` (bool) |
| `get_children` | Get child items of a work item | `id` (number) |
| `get_dependents` | Get items that depend on a given work item | `id` (number) |
| `get_item_tree` | Get work items as a nested parent-child tree | `type?`, `status?`, `iteration?`, `all?` (bool) |

#### Search

Case-insensitive substring matching on `title` and `description` fields. Implemented in the handler by calling `listWorkItems()` then filtering — no backend changes needed.

#### Item Tree

Returns items nested under their parents:

```json
[
  {
    "id": 1, "title": "Epic A", "type": "epic", "status": "open",
    "children": [
      { "id": 2, "title": "Task 1", "type": "task", "status": "open", "children": [] }
    ]
  },
  { "id": 3, "title": "Standalone issue", "type": "issue", "status": "open", "children": [] }
]
```

Items without a parent are root nodes. Built in the handler by fetching all items, mapping by ID, and nesting children.

## Return Format

All tools return MCP content blocks:

```typescript
// Success
{ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] }

// Error
{ content: [{ type: "text", text: errorMessage }], isError: true }
```

## Error Handling

Each tool handler wraps its backend call in a try/catch and returns errors as `isError: true` responses rather than throwing. This keeps the MCP connection alive.

**Specific cases:**

- **Not a tic project:** All tools except `init_project` return: `"Not a tic project. Use the init_project tool first."`
- **Item not found:** Returns error with the requested ID.
- **Invalid relationships:** Backend's existing validation (circular parents, circular deps, referential integrity) throws; handler catches and returns the message.
- **Invalid inputs:** Zod validates before the handler runs. The SDK returns validation errors automatically.
- **Search with no results:** Returns an empty array, not an error.
- **confirm_delete without preview:** Returns error: `"No pending delete for item {id}. Call delete_item first to preview."`

## Architecture

### Backend Interface

The MCP server accepts a `Backend` instance rather than hardcoding `LocalBackend`. Currently only `LocalBackend` exists, but when GitHub/GitLab backends are added, the MCP server works automatically.

### Testable Handlers

Tool handlers are exported as standalone functions:

```typescript
export function handleListItems(backend: Backend, args: { ... }): ToolResult
export function handleShowItem(backend: Backend, args: { id: number }): ToolResult
// etc.
```

A `registerTools(server: McpServer, backend: Backend)` function wires them into the MCP server. Tests call the handlers directly without spinning up the server or stdio transport.

### Stdio Constraint

The MCP server communicates via JSON-RPC over stdio. It must NEVER call `console.log()` — all logging uses `console.error()` (stderr). This is isolated to the MCP command handler; the rest of the CLI is unaffected.

## File Structure

```
src/
  cli/
    index.ts              — add `tic mcp serve` subcommand (modified)
    commands/
      mcp.ts              — MCP server: tool registration, handlers, serve function (new)
  cli/__tests__/
    mcp.test.ts           — handler unit tests (new)
```

## Dependencies

- **@modelcontextprotocol/sdk** — MCP server framework (McpServer, StdioServerTransport)
- **zod** — input schema validation (peer dependency of the SDK)

## Testing

Tests in `src/cli/__tests__/mcp.test.ts`. Each test creates a temp `.tic/` directory, instantiates `LocalBackend`, and calls handler functions directly.

**What gets tested:**

- Each of the 14 tool handlers — correct return structure and data
- Error cases — item not found, invalid ID, not a tic project
- Search — matches in title, matches in description, case-insensitive, no results
- Tree building — root items, nested children, items with no parent
- Delete safety — `delete_item` returns preview without deleting, `confirm_delete` works after preview, `confirm_delete` rejects without prior preview
- `get_config` — returns statuses, types, iterations, current iteration

**What doesn't need testing:**

- MCP SDK internals (stdio transport, JSON-RPC, Zod validation)
- Commander wiring (`tic mcp serve`) — trivial glue code

## Claude Code Integration

### Setup (after `tic` is published to npm)

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

### Verify

```bash
claude mcp list          # should show "tic"
claude --mcp-debug       # launch with debug logging
```

Inside a Claude Code session, run `/mcp` to check server status.

### Test with MCP Inspector

```bash
npx @modelcontextprotocol/inspector npx tic mcp serve
```

Opens a browser UI where you can list tools, invoke them, and inspect the JSON-RPC messages.
