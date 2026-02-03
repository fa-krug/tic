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
