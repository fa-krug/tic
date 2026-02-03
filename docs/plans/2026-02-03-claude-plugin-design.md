# Claude Plugin Design

## Overview

Bundle tic as a Claude Code plugin that provides skills for using tic's MCP tools effectively. The tic repo serves as its own marketplace, enabling a single-command install experience.

## Goals

- Teach Claude how to use tic's 14 MCP tools effectively
- Auto-register the MCP server when the plugin is installed
- Auto-install tic on first use via npx
- Simplify README to a two-line install

## File Structure

```
tic/
├── .claude-plugin/
│   ├── plugin.json           # Plugin metadata
│   └── marketplace.json      # Self-referencing marketplace
├── .mcp.json                  # MCP server config
├── skills/
│   ├── tic-items/
│   │   └── SKILL.md          # CRUD, search, delete, comments
│   ├── tic-relationships/
│   │   └── SKILL.md          # Parent/child, dependencies, trees
│   └── tic-config/
│       └── SKILL.md          # Init, config, backend, iterations
└── README.md                  # Updated install section
```

## New Files

### .claude-plugin/plugin.json

```json
{
  "name": "tic",
  "description": "Issue tracking skills for Claude Code",
  "version": "1.0.0",
  "author": {
    "name": "Sascha Krug"
  },
  "repository": "https://github.com/sascha384/tic",
  "license": "MIT",
  "keywords": ["issue-tracking", "work-items", "mcp"]
}
```

### .claude-plugin/marketplace.json

```json
{
  "name": "tic",
  "description": "Issue tracking plugin for Claude Code",
  "owner": {
    "name": "Sascha Krug"
  },
  "plugins": [
    {
      "name": "tic",
      "description": "Issue tracking skills and MCP server",
      "source": "./"
    }
  ]
}
```

### .mcp.json

```json
{
  "tic": {
    "command": "npx",
    "args": ["-y", "@sascha384/tic", "mcp", "serve"]
  }
}
```

The `-y` flag auto-confirms install. When Claude invokes the MCP server, npx automatically installs `@sascha384/tic` if not present.

## Skills

### tic-items/SKILL.md

```yaml
---
name: tic-items
description: Use when creating, updating, listing, searching, or deleting work items
---
```

Covers:
- `list_items` — filters (type, status, iteration, all)
- `show_item` — full details including URL
- `create_item` — required vs optional fields, capability-aware
- `update_item` — partial updates, null to clear parent
- `search_items` — text search across title/description
- `delete_item` / `confirm_delete` — two-step safety pattern
- `add_comment` — only when backend supports comments

Key guidance:
- Always call `get_config` first to understand available types, statuses, iterations
- Use `list_items` with filters rather than fetching all and filtering locally
- Two-step delete: `delete_item` returns preview, `confirm_delete` executes
- Check capabilities before using optional fields (parent, depends_on, comments)

### tic-relationships/SKILL.md

```yaml
---
name: tic-relationships
description: Use when working with parent-child hierarchies or dependencies between items
---
```

Covers:
- `get_children` — direct children of an item
- `get_dependents` — items blocked by this item
- `get_item_tree` — full hierarchical view
- Setting `parent` and `depends_on` fields during create/update
- Circular reference prevention (backend enforces)
- Cleanup on delete (children unparented, dependency refs removed)

Key guidance:
- Use `get_item_tree` for understanding overall structure
- Use `get_children`/`get_dependents` for specific item relationships
- Set `parent: null` to clear a parent relationship
- Dependencies are IDs of items this item is blocked by

### tic-config/SKILL.md

```yaml
---
name: tic-config
description: Use when initializing projects, checking configuration, or changing backends/iterations
---
```

Covers:
- `init_project` — creates `.tic/` directory
- `get_config` — returns backend, statuses, types, iterations, capabilities
- `set_backend` — switch between local/github/gitlab/azure/jira
- `set_iteration` — change active iteration filter

Key guidance:
- Call `get_config` at start to understand project setup
- If tools fail with "Not a tic project", call `init_project` first
- Capabilities object shows what the backend supports
- Iteration filter affects which items appear in list/search

## README Changes

Replace the current "MCP Server" section (lines 159-216) with:

```markdown
## Claude Code Integration

```bash
claude plugin marketplace add sascha384/tic
claude plugin install tic
```

That's it. The plugin installs tic automatically on first use.

### What Claude Can Do

- List, search, create, update, and delete work items
- Navigate parent-child hierarchies and dependencies
- Add comments and manage iterations
- Initialize tic in new projects

The plugin auto-detects your backend (GitHub, GitLab, Azure DevOps, or local) and adapts to its capabilities.
```

## Installation Flow

1. User runs `claude plugin marketplace add sascha384/tic`
2. User runs `claude plugin install tic`
3. Plugin registers MCP server and loads skills
4. First time Claude uses a tic tool, npx installs `@sascha384/tic`
5. MCP server starts and tools become available

## Design Decisions

### Why 3 skills instead of 1?

Modular skills are easier to maintain and invoke. Claude can load just `tic-items` for basic CRUD without loading relationship or config guidance.

### Why self-referencing marketplace?

Avoids maintaining a separate repo. The tic repo contains everything needed for plugin distribution.

### Why npx with -y?

Auto-installs tic on first use. Users don't need a separate `npm install -g` step.

### Why remove detailed tool table from README?

The tool documentation moves into skills where Claude actually reads it. README stays focused on human quick-start.

## Version Sync on Release

The plugin version in `.claude-plugin/plugin.json` must stay in sync with the npm package version.

### Approach

Add `@semantic-release/exec` to run a script that updates plugin.json before committing:

**package.json release config:**

```json
{
  "release": {
    "branches": ["main"],
    "plugins": [
      "@semantic-release/commit-analyzer",
      "@semantic-release/release-notes-generator",
      [
        "@semantic-release/exec",
        {
          "prepareCmd": "node scripts/sync-plugin-version.js ${nextRelease.version}"
        }
      ],
      "@semantic-release/npm",
      [
        "@semantic-release/git",
        {
          "assets": [".claude-plugin/plugin.json"],
          "message": "chore(release): sync plugin version to ${nextRelease.version} [skip ci]"
        }
      ],
      "@semantic-release/github"
    ]
  }
}
```

**scripts/sync-plugin-version.js:**

```javascript
#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'fs';

const version = process.argv[2];
if (!version) {
  console.error('Usage: sync-plugin-version.js <version>');
  process.exit(1);
}

const pluginPath = '.claude-plugin/plugin.json';
const plugin = JSON.parse(readFileSync(pluginPath, 'utf8'));
plugin.version = version;
writeFileSync(pluginPath, JSON.stringify(plugin, null, 2) + '\n');
console.log(`Updated ${pluginPath} to version ${version}`);
```

### New Dependencies

```bash
npm install -D @semantic-release/exec @semantic-release/git
```

### Release Flow

1. semantic-release determines next version from commits
2. `@semantic-release/exec` runs sync script to update plugin.json
3. `@semantic-release/npm` publishes to npm
4. `@semantic-release/git` commits plugin.json update
5. `@semantic-release/github` creates GitHub release

## Plugin Updates

### How Claude Code Handles Updates

Claude Code tracks installed plugins in `~/.claude/plugins/installed_plugins.json` with:
- `version` — semantic version or git commit SHA
- `gitCommitSha` — pinned commit at install time
- `lastUpdated` — timestamp of last update check

**Update mechanisms:**

| Method | Command/Setting |
|--------|-----------------|
| Manual | `claude plugin update tic` |
| Auto-update | Enable per-marketplace in Claude Code settings (v2.0.70+) |

A restart is required after updates to apply changes.

### Version Detection

Claude Code compares the installed `gitCommitSha` against the marketplace's current HEAD. When using semantic versioning (our approach), it reads the version from `plugin.json` in the marketplace.

This is why syncing `plugin.json` version on release matters — it enables proper version detection and update notifications.

### User Update Flow

```bash
# Manual update
claude plugin update tic

# Or enable auto-update in Claude Code settings for the tic marketplace
```

### README Update Section

Add to the Claude Code Integration section:

```markdown
### Updating

```bash
claude plugin update tic
```

Or enable auto-updates for the tic marketplace in Claude Code settings.
```
