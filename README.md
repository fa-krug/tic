# tic

A terminal UI for issue tracking, built for developers who live in the terminal. Track work items across multiple backends — GitHub Issues, GitLab Issues, Azure DevOps Work Items, and Jira — with local SQLite storage.

Built with TypeScript and [Ink](https://github.com/vadimdemedes/ink).

## Features

- **Keyboard-driven TUI** — browse, create, edit, and manage work items without leaving the terminal
- **Multiple backends** — GitHub (REST/GraphQL API), GitLab (REST/GraphQL API), Azure DevOps (REST API), Jira (REST API)
- **Built-in authentication** — OAuth device flow for GitHub, GitLab, and Azure DevOps, with PAT fallback
- **Automatic backend detection** — selects backend based on git remote, or configure manually
- **SQLite storage** — all data stored locally in `.tic/tic.db` with optional sync to remote backends
- **CLI commands** — scriptable commands for all operations (`tic item list`, `tic item create`, etc.)
- **Work item types** — organize by epic, issue, and task (configurable)
- **Iterations** — group work into sprints or milestones, with optional start/end dates and color-coded status (active, past, upcoming)
- **Parent-child relationships** — build hierarchies with collapsible tree-indented views
- **Dependencies** — track which items block others, with warnings on premature completion
- **Priority & assignee** — track who owns what and what's most important
- **Comments** — add timestamped comments to any work item
- **Bulk operations** — mark multiple items and change status, type, priority, assignee, labels, or parent in batch
- **Quick search** — fuzzy search across all work items regardless of type or iteration
- **Detail panel** — inline preview of selected item with metadata, description, and scroll support
- **Undo** — undo delete, create, and property changes with `u` (up to 5 actions deep)
- **Built-in markdown editor** — edit descriptions in-TUI with syntax highlighting, or use your `$EDITOR`
- **Settings screen** — switch backends and configure Jira connection from within the TUI
- **Pull requests** — view, create, merge, and close PRs from the TUI (GitHub backend); link PRs to work items
- **Branch management** — list, switch, create, delete, merge, and push branches from the TUI; linked work items shown for `tic/` branches; worktree support
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

`tic init` creates a `.tic/` directory with a SQLite database to store your work items. For GitHub, GitLab, or Azure DevOps projects, it detects the backend from the git remote automatically. You can also specify a backend explicitly:

```bash
tic init --backend github
tic init --backend gitlab
tic init --backend azure
tic init --backend jira
tic init --backend none
```

The TUI also auto-initializes on first run if no `.tic/` directory exists.

## Usage

### List View

The main screen shows work items filtered by type and iteration, displayed as a collapsible tree that reflects parent-child relationships. In narrow terminals (< 80 columns) the display switches to a card layout.

| Key | Action |
|-----|--------|
| `↑` `↓` | Navigate between items |
| `←` | Collapse children or jump to parent |
| `→` | Expand children |
| `PageUp` `PageDown` | Jump by viewport height |
| `Home` `End` | Jump to first/last item |
| `Enter` | Edit selected item |
| `c` | Create new work item |
| `d` | Delete item(s) (with confirmation) |
| `u` | Undo last action (delete, create, or property change) |
| `o` | Open item in browser/editor |
| `v` | Toggle detail panel |
| `Space` | Expand full description in detail panel |
| `/` | Quick search across all items |
| `:` | Command palette |
| `s` | Set status (single or marked items) |
| `S` | Sync status screen |
| `p` | Create pull request for selected item |
| `m` | Toggle mark on current item |
| `M` | Clear all marks |
| `x` | Bulk actions menu |
| `P` | Pull request list |
| `B` | Branch management |
| `a` | Set assignee (single or marked items) |
| `l` | Set labels (single or marked items) |
| `t` | Set type (single or marked items) |
| `Tab` | Cycle work item type filter (epic / issue / task) |
| `i` | Set iteration (single or marked items) |
| `I` | Switch iteration (full-screen picker) |
| `,` | Settings |
| `b` | Create branch / worktree for item (requires git) |
| `r` | Sync with remote backend |
| `?` | Show keyboard shortcuts |
| `q` | Quit |

The list displays ID, title (tree-indented), status, priority, and assignee. Items with dependencies show a `⧗` indicator. Marked items are highlighted — bulk actions apply to all marked items, or to the cursor item if none are marked.

### Editing a Work Item

Press `Enter` on an item or `c` to create one. The form has these fields:

- **Title** — name of the work item
- **Type** — epic, issue, or task (dropdown)
- **Status** — backlog, todo, in-progress, review, done (dropdown)
- **Iteration** — which sprint/milestone this belongs to (dropdown)
- **Priority** — low, medium, high, critical (dropdown)
- **Assignee** — who owns this (autocomplete from existing assignees)
- **Labels** — comma-separated tags (autocomplete from existing labels)
- **Description** — full details (opens built-in markdown editor on Enter, or `$EDITOR` if configured)
- **Parent** — ID of the parent item (autocomplete from existing items)
- **Depends On** — comma-separated IDs of items this depends on (autocomplete)
- **Comments** — add new comments; existing comments shown as read-only

Navigate fields with `↑` `↓`, press `Enter` to edit a field, and `Esc` to save and return to the list. Press `?` for help. When editing a related item in the relationships section, pressing `Enter` navigates to that item (and `Esc` navigates back through the stack).

### Iterations

Press `I` in the list view to open the full-screen iteration picker, which shows all iterations with their date ranges and color-coded status (active, past, upcoming). The current iteration filters which items you see. Press `i` to set the iteration on the selected or marked items. Iterations support optional start and end dates. Changing an item's iteration cascades to its non-closed descendants. New iterations are created automatically when you assign an item to one that doesn't exist yet.

### Relationships

**Parent-child:** Set a parent ID on an item to nest it under another. Children appear indented in the tree view. Circular parent chains are prevented.

**Dependencies:** Add dependency IDs to indicate that an item is blocked by others. When you try to complete an item that has open children or unresolved dependencies, tic shows a warning so you can decide whether to proceed.

Deleting an item automatically cleans up references — children have their parent cleared, and the item is removed from other items' dependency lists.

## Storage

All data lives in `.tic/` at the root of your project:

```
.tic/
├── tic.db              # SQLite database (all items, config, undo log)
└── items/              # Markdown mirrors (for sync / human-readable export)
    ├── 1.md
    ├── 2.md
    └── ...
```

The SQLite database (`.tic/tic.db`) is the single source of truth for work items, config, templates, and undo history. When a remote backend is configured, `SyncManager` also writes markdown mirrors to `.tic/items/` via `FilesBackend`.

Configuration (types, statuses, iterations, etc.) is stored in the `project_config` table and managed via the TUI settings screen or `tic config` CLI commands.

If upgrading from a legacy `.tic/config.yml` setup, the database will automatically migrate the YAML config on first open.

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
- Manage pull requests (list, create, merge, close, link to items)
- Manage git branches (list, switch, create, delete, merge, push)
- Initialize tic in new projects

The plugin auto-detects your backend (GitHub, GitLab, Azure DevOps, Jira, or local) and adapts to its capabilities.

### Updating

```bash
claude plugin update tic@tic
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
tic auth login github                # Authenticate with GitHub (OAuth device flow)
tic auth login ado                   # Authenticate with Azure DevOps (Entra ID)
tic auth login ado --pat             # Authenticate with a Personal Access Token
tic auth status                      # Show authentication status
tic auth logout github               # Remove stored credentials
tic pr list                          # List pull requests
tic pr list --status open            # Filter PRs by status
tic pr show 123                      # Show PR details
tic pr create --title "Feature" --source feat/branch  # Create a PR
tic pr merge 123                     # Merge a PR
tic pr close 123                     # Close a PR
tic pr open 123                      # Open PR in browser
tic pr link 123 42                   # Link PR to work item
tic pr unlink 123 42                 # Unlink PR from work item
tic branch list                      # List branches with linked items
tic branch switch feat/branch        # Switch to a branch
tic branch create feat/new           # Create a new branch
tic branch delete feat/old           # Delete a branch (and its worktree)
tic branch merge feat/branch         # Merge into current branch
tic branch push                      # Push current branch to remote
```

Add `--json` to any command for machine-readable output, or `--quiet` to suppress non-essential output.

## Backends

| Backend | Auth Method | Detection |
|---------|-------------|-----------|
| Local only (SQLite) | — | Default fallback |
| GitHub Issues | `tic auth login github` (OAuth) or existing `gh` token | `github.com` in git remote |
| GitLab Issues | `tic auth login gitlab` (OAuth) or PAT | `gitlab.com` in git remote |
| Azure DevOps Work Items | `tic auth login ado` (Entra ID) or `--pat` | `dev.azure.com` or `visualstudio.com` in git remote |
| Jira | REST API (configured in settings) | Configured via settings |

Each backend supports a different set of capabilities (types, statuses, iterations, relationships, etc.). The TUI and CLI automatically adapt to show only what the active backend supports.

You can switch backends from within the TUI by pressing `,` to open settings. For Jira, you'll need to configure your site URL, project key, and optionally a board ID.

### Authentication

GitHub, GitLab, and Azure DevOps use tic's built-in authentication with credentials stored securely in your OS keychain. If not already authenticated, the TUI will prompt you to log in when a remote backend is detected.

**GitHub:**

```bash
tic auth login github   # Opens browser for OAuth device flow
```

Falls back to an existing `gh` CLI token if available.

**GitLab:**

```bash
tic auth login gitlab        # OAuth device code flow (recommended)
tic auth login gitlab --pat  # Personal Access Token
```

**Azure DevOps:**

```bash
tic auth login ado        # Entra ID device code flow (recommended)
tic auth login ado --pat  # Personal Access Token
```

**Managing credentials:**

```bash
tic auth status             # Show auth status for all providers
tic auth logout github      # Remove stored credentials
tic auth logout azure
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for development setup, architecture, and conventions.

## License

[MIT](LICENSE)
