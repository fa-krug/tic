# tic

A terminal UI for issue tracking, built for developers who live in the terminal. Track work items across multiple backends — local markdown files, GitHub Issues, GitLab Issues, and Azure DevOps Work Items.

Built with TypeScript and [Ink](https://github.com/vadimdemedes/ink).

## Features

- **Keyboard-driven TUI** — browse, create, edit, and manage work items without leaving the terminal
- **Multiple backends** — local markdown, GitHub (via `gh`), GitLab (via `glab`), Azure DevOps (via `az`)
- **Automatic backend detection** — selects backend based on git remote, or configure manually
- **Local markdown storage** — work items stored as markdown files with YAML frontmatter in a `.tic/` directory
- **CLI commands** — scriptable commands for all operations (`tic item list`, `tic item create`, etc.)
- **Work item types** — organize by epic, issue, and task (configurable)
- **Iterations** — group work into sprints or milestones
- **Parent-child relationships** — build hierarchies with tree-indented views
- **Dependencies** — track which items block others, with warnings on premature completion
- **Priority & assignee** — track who owns what and what's most important
- **Comments** — add timestamped comments to any work item
- **MCP server** — expose work items to AI assistants via the Model Context Protocol

## Installation

```bash
npm install -g @sascha384/tic
```

## Quick Start

```bash
cd your-project
tic init           # Initialize (auto-detects backend from git remote)
tic                # Launch the TUI
```

For local storage, `tic init` creates a `.tic/` directory to store your work items. For GitHub, GitLab, or Azure DevOps projects, it detects the backend from the git remote automatically. You can also specify a backend explicitly:

```bash
tic init --backend github
tic init --backend gitlab
tic init --backend azure
tic init --backend local
```

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

## Claude Code Integration

```bash
claude plugin marketplace add fa-krug/tic
claude plugin install tic
```

That's it. The plugin installs tic automatically on first use.

### What Claude Can Do

- List, search, create, update, and delete work items
- Navigate parent-child hierarchies and dependencies
- Add comments and manage iterations
- Initialize tic in new projects

The plugin auto-detects your backend (GitHub, GitLab, Azure DevOps, or local) and adapts to its capabilities.

### Updating

```bash
claude plugin update tic
```

Or enable auto-updates for the tic marketplace in Claude Code settings.

## CLI Commands

tic also provides a full CLI for scripting and automation:

```bash
tic item list                        # List work items
tic item list --status in-progress   # Filter by status
tic item list --type task            # Filter by type
tic item show 42                     # Show item details
tic item create --title "Fix bug"    # Create an item
tic item update 42 --status done     # Update an item
tic item delete 42                   # Delete an item
tic item comment 42 --body "Done"    # Add a comment
tic item open 42                     # Open in editor/browser
tic iteration list                   # List iterations
tic iteration set sprint-2           # Set current iteration
tic config get backend               # Get config value
tic config set backend github        # Set config value
```

Add `--json` to any command for machine-readable output, or `--quiet` to suppress non-essential output.

## Backends

| Backend | CLI Tool | Detection |
|---------|----------|-----------|
| Local markdown | — | Default fallback |
| GitHub Issues | [`gh`](https://cli.github.com/) | `github.com` in git remote |
| GitLab Issues | [`glab`](https://gitlab.com/gitlab-org/cli) | `gitlab.com` in git remote |
| Azure DevOps Work Items | [`az`](https://learn.microsoft.com/en-us/cli/azure/) | `dev.azure.com` or `visualstudio.com` in git remote |

Each backend supports a different set of capabilities (types, statuses, iterations, relationships, etc.). The TUI and CLI automatically adapt to show only what the active backend supports.

### Azure DevOps Authentication

Azure DevOps requires the [Azure CLI](https://learn.microsoft.com/en-us/cli/azure/) (`az`) with the `azure-devops` extension. There are two authentication methods, and **both are recommended** for full functionality:

| Method | Command | What it enables |
|--------|---------|-----------------|
| PAT (Personal Access Token) | `az devops login` | Work items, queries, iterations, relations |
| Azure AD / Entra ID | `az login` | Comments (read and write) |

The Work Item Comments API is a preview endpoint that requires Azure AD tokens. If you only use `az devops login`, everything works except comments — they will silently be unavailable when viewing items and explicitly fail when adding comments.

For full functionality:

```bash
az login                # Azure AD — needed for comments
az devops login         # PAT — needed for work items
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and conventions.

## License

[MIT](LICENSE)
