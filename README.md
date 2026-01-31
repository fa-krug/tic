# tic

A terminal UI for issue tracking that works across backends. Connect to GitHub, GitLab, Azure DevOps, or use local markdown-based issues — all from one interface. The backend is selected automatically based on your git remote.

Built with TypeScript and [Ink](https://github.com/vadimdemedes/ink). Fully controllable via CLI. Exposes an MCP server for AI integration.

## Features

- **Unified interface** — browse, create, edit, and manage issues without leaving the terminal
- **Multi-backend support**
  - **GitHub** via `gh`
  - **GitLab** via `glab`
  - **Azure DevOps** via `az`
  - **Local** markdown file-based issue tracking
- **Automatic backend detection** — determines the right backend from your current git remote
- **Full CLI control** — every action available as a command, scriptable and composable
- **MCP server** — expose your issues as context for AI tools and agents

## Installation

```bash
npm install -g tic
```

## Usage

### TUI

```bash
tic
```

Opens the interactive terminal UI in your current repository. The backend is detected automatically.

### CLI

```bash
tic list                  # List issues
tic view <id>             # View issue details
tic create                # Create a new issue
tic edit <id>             # Edit an issue
tic close <id>            # Close an issue
```

### MCP Server

```bash
tic mcp
```

Starts the MCP server, making your issues available as context for AI tools.

## Backend Detection

tic reads your git remotes to determine which backend to use:

| Remote host          | Backend   |
|----------------------|-----------|
| `github.com`         | GitHub    |
| `gitlab.com` / self-hosted GitLab | GitLab |
| `dev.azure.com`      | Azure DevOps |
| No remote / unknown  | Local (markdown) |

## Prerequisites

Backend CLIs must be installed and authenticated for their respective providers:

- [gh](https://cli.github.com/) for GitHub
- [glab](https://gitlab.com/gitlab-org/cli) for GitLab
- [az](https://learn.microsoft.com/en-us/cli/azure/) with the DevOps extension for Azure DevOps

No additional tooling is needed for local markdown-based tracking.

## License

[MIT](LICENSE)
