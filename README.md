# tic

A terminal UI for issue tracking, built for developers who live in the terminal. Track work items as markdown files stored right in your repository.

Built with TypeScript and [Ink](https://github.com/vadimdemedes/ink).

## Features

- **Keyboard-driven TUI** — browse, create, edit, and manage work items without leaving the terminal
- **Local markdown storage** — work items stored as markdown files with YAML frontmatter in a `.tic/` directory
- **Work item types** — organize by epic, issue, and task (configurable)
- **Iterations** — group work into sprints or milestones
- **Parent-child relationships** — build hierarchies with tree-indented views
- **Dependencies** — track which items block others, with warnings on premature completion
- **Priority & assignee** — track who owns what and what's most important
- **Comments** — add timestamped comments to any work item

## Installation

```bash
npm install -g tic
```

## Quick Start

```bash
cd your-project
tic
```

This launches the TUI. On first run, tic automatically creates a `.tic/` directory to store your work items. No setup or init command needed.

## Usage

### List View

The main screen shows work items filtered by type and iteration, displayed as a tree that reflects parent-child relationships.

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate between items |
| `Enter` | Edit selected item |
| `c` | Create new work item |
| `d` | Delete selected item (with confirmation) |
| `s` | Cycle status forward |
| `p` | Set parent for selected item |
| `Tab` | Switch work item type (epic / issue / task) |
| `i` | Switch iteration |
| `q` | Quit |

The list displays ID, title (tree-indented), status, priority, and assignee. Items with dependencies show a `⧗` indicator.

### Editing a Work Item

Press `Enter` on an item or `c` to create one. The form has these fields:

- **Title** — name of the work item
- **Type** — epic, issue, or task
- **Status** — backlog, todo, in-progress, review, done
- **Iteration** — which sprint/milestone this belongs to
- **Priority** — low, medium, high, critical
- **Assignee** — who owns this
- **Labels** — comma-separated tags
- **Parent** — ID of the parent item
- **Depends On** — comma-separated IDs of items this depends on
- **Description** — full details (multi-line)
- **Comments** — add new comments; existing comments shown as read-only

Navigate fields with `↑` `↓`, press `Enter` to edit a field, and `Esc` to save and return to the list.

### Iterations

Press `i` in the list view to open the iteration picker. The current iteration filters which items you see. New iterations are created automatically when you assign an item to one that doesn't exist yet.

### Relationships

**Parent-child:** Set a parent ID on an item to nest it under another. Children appear indented in the tree view. Circular parent chains are prevented.

**Dependencies:** Add dependency IDs to indicate that an item is blocked by others. When you try to complete an item that has open children or unresolved dependencies, tic shows a warning so you can decide whether to proceed.

Deleting an item automatically cleans up references — children have their parent cleared, and the item is removed from other items' dependency lists.

## Storage

Work items live in `.tic/` at the root of your project:

```
.tic/
├── config.yml          # Types, statuses, iterations, settings
└── items/
    ├── 1.md            # Work item #1
    ├── 2.md            # Work item #2
    └── ...
```

Each item is a markdown file with YAML frontmatter:

```markdown
---
id: 1
title: Implement user login
type: task
status: in-progress
iteration: sprint-1
priority: high
assignee: alice
labels: auth, backend
parent: 3
depends_on:
  - 2
created: 2026-01-15T10:00:00.000Z
updated: 2026-01-20T14:30:00.000Z
---

Full description of the work item goes here.

## Comments

---
author: alice
date: 2026-01-18T09:00:00.000Z

Decided to use JWT tokens for this.
```

Configuration in `.tic/config.yml`:

```yaml
types:
  - epic
  - issue
  - task
statuses:
  - backlog
  - todo
  - in-progress
  - review
  - done
iterations:
  - default
current_iteration: default
next_id: 1
```

You can edit these files directly — they're plain text. Customize types, statuses, and iterations by editing `config.yml`.

## MCP Server

tic includes a built-in [Model Context Protocol](https://modelcontextprotocol.io) (MCP) server that exposes your work items to AI assistants like Claude. This lets AI tools read, create, update, and manage your issues without leaving the conversation.

### Starting the Server

```bash
tic mcp serve
```

The server communicates over stdio using the MCP protocol.

### Connecting to Claude Code

Add tic as an MCP server in your project:

```bash
claude mcp add --scope project --transport stdio tic -- npx tic mcp serve
```

Or create a `.mcp.json` file in your project root:

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

### Available Tools

The MCP server exposes 14 tools:

| Tool | Description |
|------|-------------|
| `init_project` | Initialize a new tic project (creates `.tic/` directory) |
| `get_config` | Get project configuration (statuses, types, iterations) |
| `list_items` | List work items with optional filters by type, status, or iteration |
| `show_item` | Show full details of a single work item |
| `create_item` | Create a new work item with title, type, status, priority, and more |
| `update_item` | Update any field on an existing work item |
| `delete_item` | Preview deleting a work item (shows affected children and dependents) |
| `confirm_delete` | Confirm and execute a previously previewed deletion |
| `add_comment` | Add a timestamped comment to a work item |
| `set_iteration` | Set the current active iteration |
| `search_items` | Search work items by text query across titles and descriptions |
| `get_children` | Get child items of a specific work item |
| `get_dependents` | Get items that depend on a specific work item |
| `get_item_tree` | Get work items as a hierarchical tree structure |

### Safety

Deletion is a two-step process: `delete_item` returns a preview of what will be affected (children that will be unparented, dependents that will lose a dependency), and `confirm_delete` must be called separately to actually remove the item. This prevents accidental data loss when AI tools are managing your issues.

If the server is started in a directory without a `.tic/` project, all tools except `init_project` will return an error asking you to initialize first.

## Roadmap

Planned but not yet implemented:

- **Multi-backend support** — GitHub (via `gh`), GitLab (via `glab`), Azure DevOps (via `az`)
- **Automatic backend detection** — select backend based on git remote

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and conventions.

## License

[MIT](LICENSE)
