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
