# Claude Plugin Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Bundle tic as a Claude Code plugin with skills and auto-registered MCP server.

**Architecture:** Plugin files at repo root (`.claude-plugin/`, `.mcp.json`, `skills/`). Self-referencing marketplace allows single-command install. Version sync via semantic-release on each npm publish.

**Tech Stack:** Claude Code plugin system, MCP, semantic-release plugins

---

## Task 1: Create Plugin Directory and Manifest

**Files:**
- Create: `.claude-plugin/plugin.json`

**Step 1: Create directory**

```bash
mkdir -p .claude-plugin
```

**Step 2: Create plugin.json**

```json
{
  "name": "tic",
  "description": "Issue tracking skills for Claude Code",
  "version": "0.1.0",
  "author": {
    "name": "Sascha Krug"
  },
  "repository": "https://github.com/fa-krug/tic",
  "license": "MIT",
  "keywords": ["issue-tracking", "work-items", "mcp"]
}
```

**Step 3: Verify file exists**

Run: `cat .claude-plugin/plugin.json`
Expected: JSON content displayed

**Step 4: Commit**

```bash
git add .claude-plugin/plugin.json
git commit -m "feat: add Claude plugin manifest"
```

---

## Task 2: Create Marketplace Manifest

**Files:**
- Create: `.claude-plugin/marketplace.json`

**Step 1: Create marketplace.json**

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

**Step 2: Verify file exists**

Run: `cat .claude-plugin/marketplace.json`
Expected: JSON content displayed

**Step 3: Commit**

```bash
git add .claude-plugin/marketplace.json
git commit -m "feat: add self-referencing marketplace manifest"
```

---

## Task 3: Create MCP Server Configuration

**Files:**
- Create: `.mcp.json`

**Step 1: Create .mcp.json at repo root**

```json
{
  "tic": {
    "command": "npx",
    "args": ["-y", "@sascha384/tic", "mcp", "serve"]
  }
}
```

**Step 2: Verify file exists**

Run: `cat .mcp.json`
Expected: JSON content displayed

**Step 3: Commit**

```bash
git add .mcp.json
git commit -m "feat: add MCP server configuration for plugin"
```

---

## Task 4: Create tic-config Skill

**Files:**
- Create: `skills/tic-config/SKILL.md`

**Step 1: Create directory**

```bash
mkdir -p skills/tic-config
```

**Step 2: Create SKILL.md**

```markdown
---
name: tic-config
description: Use when initializing projects, checking configuration, or changing backends/iterations
---

# tic Configuration

Use these tools to initialize and configure tic projects.

## Tools

### init_project

Creates a `.tic/` directory in the current project. Call this first if other tools fail with "Not a tic project".

### get_config

Returns project configuration:
- `backend` — current backend type (local, github, gitlab, azure, jira)
- `statuses` — available status values
- `types` — available work item types
- `iterations` — configured iterations
- `currentIteration` — active iteration filter
- `capabilities` — what the backend supports

**Always call this first** to understand what types, statuses, and iterations are available before creating or updating items.

### set_backend

Switch between backends: `local`, `github`, `gitlab`, `azure`, `jira`.

The backend is auto-detected from git remotes, but can be overridden.

### set_iteration

Set the current iteration filter. This affects which items appear in `list_items` and `search_items` unless `all: true` is passed.

## Capabilities

The `capabilities` object from `get_config` tells you what the backend supports:

```json
{
  "relationships": true,    // parent/child, dependencies
  "customTypes": true,      // configurable work item types
  "customStatuses": true,   // configurable statuses
  "iterations": true,       // iteration/sprint support
  "comments": true,         // commenting on items
  "fields": {
    "priority": true,
    "assignee": true,
    "labels": true,
    "parent": true,
    "dependsOn": true
  }
}
```

Check capabilities before using optional fields — not all backends support all features.
```

**Step 3: Verify file exists**

Run: `cat skills/tic-config/SKILL.md`
Expected: Markdown content displayed

**Step 4: Commit**

```bash
git add skills/tic-config/SKILL.md
git commit -m "feat: add tic-config skill"
```

---

## Task 5: Create tic-items Skill

**Files:**
- Create: `skills/tic-items/SKILL.md`

**Step 1: Create directory**

```bash
mkdir -p skills/tic-items
```

**Step 2: Create SKILL.md**

```markdown
---
name: tic-items
description: Use when creating, updating, listing, searching, or deleting work items
---

# tic Work Items

Use these tools to manage work items across any backend.

## Before You Start

Call `get_config` first to understand:
- Available `types` (e.g., epic, issue, task)
- Available `statuses` (e.g., backlog, todo, in-progress, done)
- Available `iterations`
- Backend `capabilities` (which fields are supported)

## Tools

### list_items

List work items with optional filters:
- `type` — filter by work item type
- `status` — filter by status
- `iteration` — filter by iteration
- `all` — show all iterations (ignores current iteration filter)

Use filters rather than fetching all and filtering locally.

### show_item

Get full details of a work item by ID. Returns all fields including description, comments, and a `url` for opening in browser/editor.

### search_items

Text search across title and description. Supports the same filters as `list_items`.

### create_item

Create a new work item. Required field:
- `title` — work item title

Optional fields (check capabilities first):
- `type` — defaults to first available type
- `status` — defaults to first available status
- `priority` — low, medium, high, critical
- `assignee` — who owns this
- `labels` — comma-separated tags
- `iteration` — which sprint/milestone
- `parent` — ID of parent item
- `depends_on` — array of IDs this item depends on
- `description` — full details

### update_item

Update an existing work item. Required field:
- `id` — work item ID

All other fields are optional — only pass what you want to change.

To clear a parent relationship, pass `parent: null`.

### delete_item / confirm_delete

**Two-step deletion for safety:**

1. Call `delete_item` with the ID — returns a preview showing:
   - The item being deleted
   - Children that will be unparented
   - Dependents that will lose this dependency

2. Call `confirm_delete` with the same ID to execute

This prevents accidental data loss. Always preview before confirming.

### add_comment

Add a timestamped comment to a work item. Only available if backend supports comments (check `capabilities.comments`).

- `id` — work item ID
- `text` — comment content
- `author` — optional, defaults to system

## Example Workflow

```
1. get_config → understand available types/statuses
2. list_items with type: "task", status: "todo" → see open tasks
3. create_item with title, type, priority → create new item
4. update_item with id, status: "in-progress" → update status
5. add_comment with id, text → add progress note
```
```

**Step 3: Verify file exists**

Run: `cat skills/tic-items/SKILL.md`
Expected: Markdown content displayed

**Step 4: Commit**

```bash
git add skills/tic-items/SKILL.md
git commit -m "feat: add tic-items skill"
```

---

## Task 6: Create tic-relationships Skill

**Files:**
- Create: `skills/tic-relationships/SKILL.md`

**Step 1: Create directory**

```bash
mkdir -p skills/tic-relationships
```

**Step 2: Create SKILL.md**

```markdown
---
name: tic-relationships
description: Use when working with parent-child hierarchies or dependencies between items
---

# tic Relationships

Use these tools to navigate and manage work item hierarchies and dependencies.

## Prerequisites

Check `capabilities.relationships` from `get_config` — not all backends support relationships.

## Tools

### get_item_tree

Get all work items as a hierarchical tree structure. Children are nested under their parents.

Best for understanding overall project structure. Supports same filters as `list_items`:
- `type`, `status`, `iteration`, `all`

### get_children

Get direct children of a specific work item.

- `id` — parent work item ID

Returns array of child work items.

### get_dependents

Get items that depend on (are blocked by) a specific work item.

- `id` — work item ID

Returns array of dependent work items. Useful for understanding impact before completing or deleting an item.

## Setting Relationships

### Parent-Child

Set during `create_item` or `update_item`:
- `parent: "123"` — set parent to item 123
- `parent: null` — clear parent (make root-level)

Children appear indented under their parent in tree views.

### Dependencies

Set during `create_item` or `update_item`:
- `depends_on: ["123", "456"]` — this item is blocked by items 123 and 456

Dependencies indicate work that must complete before this item can proceed.

## Validation

The backend enforces:
- **No circular parents** — item cannot be its own ancestor
- **Referential integrity** — referenced items must exist

## Cleanup on Delete

When an item is deleted:
- Children have their `parent` cleared (become root-level)
- The item is removed from other items' `depends_on` lists

The `delete_item` preview shows these affected items before you confirm.

## Warnings

When completing an item (`status: "done"`), tic warns if:
- Item has open children
- Item has unresolved dependencies

These are warnings, not blockers — you can proceed if appropriate.
```

**Step 3: Verify file exists**

Run: `cat skills/tic-relationships/SKILL.md`
Expected: Markdown content displayed

**Step 4: Commit**

```bash
git add skills/tic-relationships/SKILL.md
git commit -m "feat: add tic-relationships skill"
```

---

## Task 7: Create Version Sync Script

**Files:**
- Create: `scripts/sync-plugin-version.js`

**Step 1: Create directory**

```bash
mkdir -p scripts
```

**Step 2: Create sync-plugin-version.js**

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

**Step 3: Test the script**

Run: `node scripts/sync-plugin-version.js 1.2.3 && cat .claude-plugin/plugin.json`
Expected: plugin.json shows `"version": "1.2.3"`

**Step 4: Reset version for commit**

Run: `node scripts/sync-plugin-version.js 0.1.0`
Expected: Version reset to 0.1.0

**Step 5: Commit**

```bash
git add scripts/sync-plugin-version.js
git commit -m "feat: add version sync script for releases"
```

---

## Task 8: Install Release Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install semantic-release plugins**

Run: `npm install -D @semantic-release/exec @semantic-release/git`
Expected: Packages added to devDependencies

**Step 2: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add semantic-release exec and git plugins"
```

---

## Task 9: Update Release Configuration

**Files:**
- Modify: `package.json` (release section)

**Step 1: Update release config in package.json**

Replace the `release` section:

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

**Step 2: Verify JSON is valid**

Run: `node -e "require('./package.json')"`
Expected: No error

**Step 3: Commit**

```bash
git add package.json
git commit -m "feat: configure semantic-release to sync plugin version"
```

---

## Task 10: Update README

**Files:**
- Modify: `README.md` (lines 159-216)

**Step 1: Replace MCP Server section**

Replace the current "MCP Server" section (## MCP Server through the safety paragraph) with:

```markdown
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
```

**Step 2: Verify README renders correctly**

Run: `head -200 README.md | tail -50`
Expected: New Claude Code Integration section visible

**Step 3: Commit**

```bash
git add README.md
git commit -m "docs: simplify Claude Code integration instructions"
```

---

## Task 11: Update package.json files array

**Files:**
- Modify: `package.json` (files array)

**Step 1: Add plugin files to npm package**

Update the `files` array to include plugin assets:

```json
{
  "files": [
    "dist",
    "README.md",
    ".claude-plugin",
    ".mcp.json",
    "skills"
  ]
}
```

**Step 2: Verify JSON is valid**

Run: `node -e "require('./package.json')"`
Expected: No error

**Step 3: Commit**

```bash
git add package.json
git commit -m "chore: include plugin files in npm package"
```

---

## Task 12: Final Verification

**Step 1: Verify all plugin files exist**

Run: `ls -la .claude-plugin/ .mcp.json skills/*/SKILL.md scripts/`
Expected: All files listed

**Step 2: Verify plugin.json is valid**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json')))"`
Expected: Plugin object displayed

**Step 3: Verify marketplace.json is valid**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json')))"`
Expected: Marketplace object displayed

**Step 4: Verify .mcp.json is valid**

Run: `node -e "console.log(JSON.parse(require('fs').readFileSync('.mcp.json')))"`
Expected: MCP config object displayed

**Step 5: Run tests to ensure nothing broke**

Run: `npm test`
Expected: All tests pass

**Step 6: Run lint to ensure code quality**

Run: `npm run lint`
Expected: No errors
