# Local Backend TUI — Design

## Overview

First version of tic: a terminal UI for local markdown-based issue tracking. Issues are stored as markdown files with YAML frontmatter in a `.tic/` folder at the repository root. The TUI is built with TypeScript and Ink.

## File Structure

```
.tic/
  config.yml
  issues/
    1.md
    2.md
```

### config.yml

```yaml
statuses:
  - backlog
  - todo
  - in-progress
  - review
  - done
current_iteration: v1.0
iterations:
  - v1.0
  - v2.0
next_id: 4
```

- `statuses` — ordered list of valid statuses (configurable by user)
- `current_iteration` — which iteration the TUI shows on launch
- `iterations` — all known iteration labels (freeform strings)
- `next_id` — auto-incrementing counter for new issues

### Issue File (e.g., `1.md`)

```markdown
---
id: 1
title: Add user login
status: todo
iteration: v1.0
priority: high
assignee: skrug
labels: [auth, frontend]
created: 2026-01-31T10:00:00Z
updated: 2026-01-31T12:00:00Z
---

Description of the issue goes here.

## Comments

---
author: skrug
date: 2026-01-31T11:00:00Z

This needs to support OAuth too.

---
author: skrug
date: 2026-01-31T12:00:00Z

Decided to defer OAuth to v2.
```

## Issue Attributes

| Field       | Type           | Notes                              |
|-------------|----------------|------------------------------------|
| id          | integer        | Auto-generated, unique             |
| title       | string         | Short summary                      |
| status      | string         | Must be one of configured statuses |
| iteration   | string         | Freeform label                     |
| priority    | enum           | low, medium, high, critical        |
| assignee    | string         | Freeform                           |
| labels      | list of string | Tags                               |
| created     | ISO timestamp  | Set on creation                    |
| updated     | ISO timestamp  | Updated on any change              |

The markdown body (below frontmatter) is the description. Comments live under a `## Comments` heading, separated by `---`, each with `author` and `date` metadata lines.

## TUI Layout

### Main Screen — Issue List

Header bar shows current iteration name. Below it, a table of open issues for that iteration:

| Column   | Source            |
|----------|-------------------|
| ID       | `id`              |
| Title    | `title`           |
| Status   | `status`          |
| Priority | `priority`        |
| Assignee | `assignee`        |

### Keybindings — List View

| Key     | Action                                    |
|---------|-------------------------------------------|
| up/down | Move through issue list                   |
| Enter   | Open issue detail/edit form               |
| i       | Switch iteration (opens selector)         |
| c       | Create new issue                          |
| d       | Delete selected issue (with confirmation) |
| s       | Cycle status of selected issue            |
| q       | Quit                                      |

### Issue Form (on Enter)

Vertical form with fields:

1. Title (text input)
2. Status (dropdown — from configured statuses)
3. Iteration (dropdown — from configured iterations)
4. Priority (dropdown — low/medium/high/critical)
5. Assignee (text input)
6. Labels (text input, comma-separated)
7. Description (multiline text)
8. Comments section (read-only display + add new comment)

### Keybindings — Form View

| Key   | Action                          |
|-------|---------------------------------|
| up/down | Navigate between fields       |
| Enter | Activate/edit focused field     |
| Esc   | Go back to list (auto-saves)   |

## Architecture

### Backend Abstraction

Statuses and iterations are extracted from the backend. The local backend reads them from `config.yml`. Future backends (GitHub, GitLab, Azure DevOps) will provide their own implementations.

```
Backend interface:
  getStatuses(): string[]
  getIterations(): string[]
  getCurrentIteration(): string
  setCurrentIteration(name: string): void
  listIssues(iteration?: string): Issue[]
  getIssue(id: number): Issue
  createIssue(data: NewIssue): Issue
  updateIssue(id: number, data: Partial<Issue>): Issue
  deleteIssue(id: number): void
  addComment(issueId: number, comment: NewComment): Comment
```

### Project Structure

```
src/
  index.tsx            # Entry point, CLI argument parsing
  app.tsx              # Root Ink component
  backends/
    types.ts           # Backend interface definition
    local/
      index.ts         # Local backend implementation
      config.ts        # config.yml read/write
      issues.ts        # Issue file read/write/delete
  components/
    IssueList.tsx      # Main list view
    IssueForm.tsx      # Detail/edit form
    IterationPicker.tsx # Iteration switcher
    StatusCycler.tsx   # Inline status change
    ConfirmDialog.tsx  # Delete confirmation
  types.ts             # Shared types (Issue, Comment, etc.)
```

### Dependencies

- **ink** — React-based terminal UI framework
- **ink-text-input** — text input component
- **ink-select-input** — dropdown/select component
- **gray-matter** — YAML frontmatter parsing
- **yaml** — YAML serialization for config
- **meow** or **commander** — CLI argument parsing
