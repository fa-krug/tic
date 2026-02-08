---
name: items
description: Use when creating, updating, listing, searching, or deleting epics, tasks, issues, bugs, stories, features, tickets, items, cards, defects, improvements, subtasks, or any work item
---

# tic Work Items

Use these tools to manage work items across any backend.

## Before You Start

Call `get_config` first to understand:
- Available `types` (e.g., epic, issue, task)
- Available `statuses` (e.g., backlog, todo, in-progress, done)
- Available `iterations`
- Backend `capabilities` (which fields are supported)

## Creating Items — Brainstorm First

When the user asks to create a work item, **brainstorm before calling `create_item`**:

1. **Clarify intent** — Ask what the item is about if the request is vague. Use `AskUserQuestion` with concrete options when possible.
2. **Suggest structure** — Propose a title, type, priority, and brief description. For larger items (epics, features), suggest breaking them into child tasks.
3. **Check for duplicates** — Use `search_items` to see if a similar item already exists. If matches are found, ask whether to update an existing item or create a new one.
4. **Present the plan** — Show the user exactly what you'll create before calling `create_item`. Use options to let them approve or adjust.

**Skip brainstorming** when the user provides all details explicitly (e.g., "create a bug titled 'Login fails on Safari' with priority high").

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
