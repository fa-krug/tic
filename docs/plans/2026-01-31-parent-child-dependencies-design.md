# Parent-Child & Dependency Relationships

## Overview

Add hierarchical parent-child relationships and dependency tracking to work items. Any item can parent any other item regardless of type, with unlimited nesting depth. Dependencies are informational with status warnings — no hard blocks.

## Data Model

Two new optional fields on `WorkItem`:

```typescript
interface WorkItem {
  // ... existing fields ...
  parent: number | null;    // ID of parent item, or null
  dependsOn: number[];      // IDs of items this depends on
}
```

Frontmatter representation:

```yaml
---
id: 5
title: Implement login form
type: task
status: in-progress
parent: 3
depends_on: [4, 2]
# ... rest of existing fields
---
```

Both fields are optional. Missing fields default to `null` and `[]`. Existing items without these fields continue to work — no migration needed.

## Validation Rules

Enforced at write time (create and update):

- **No self-reference**: an item cannot be its own parent or depend on itself.
- **No circular parents**: walk up the parent chain from the proposed parent. If the current item's ID is encountered, reject.
- **No circular dependencies**: depth-first traversal of `depends_on` links. If the item being saved is encountered, reject.
- **Referential integrity**: all referenced IDs must exist.

Both cycle checks are O(n) worst case, acceptable for a local tracker.

## Backend Changes

### Existing Methods

- `createWorkItem` / `updateWorkItem` — validate `parent` and `dependsOn` fields (existence, no cycles, no self-reference). These already accept `Partial<WorkItem>`.
- `listWorkItems` — unchanged. Returns items as before; UI derives tree structure from `parent` fields.
- `deleteWorkItem` — on delete, scan all items and clean up references:
  - Clear `parent` on any item whose parent was the deleted item.
  - Remove the deleted ID from any item's `dependsOn` list.

### New Methods

```typescript
getChildren(id: number): WorkItem[]     // direct children of an item
getDependents(id: number): WorkItem[]   // items that depend on the given item
```

These keep component code clean and make intent explicit.

### Interface Addition

```typescript
interface Backend {
  // ... existing methods ...
  getChildren(id: number): WorkItem[];
  getDependents(id: number): WorkItem[];
}
```

## Storage Changes

In `items.ts`:

- `parent` stored as a plain number in YAML frontmatter, omitted if null.
- `depends_on` stored as a YAML list of numbers, omitted if empty.
- Reading maps `depends_on` (snake_case YAML) to `dependsOn` (camelCase TypeScript).
- Missing fields default to `null` / `[]` on read — full backwards compatibility.

Reference cleanup on delete is handled by the backend, which scans all items and rewrites any that referenced the deleted ID.

## UI Changes

### List View (`WorkItemList`)

- **Tree indentation**: children indented under parents with tree prefixes (`├─`, `└─`). Top-level items have no parent. Provides natural hierarchy view.
- **Dependency indicators**: items with unresolved dependencies show a marker (e.g., `⧗`) next to status. Selecting the item shows unresolved dependency details in the bottom detail line.
- **Status warnings**: when cycling status to the final status (e.g., `done`), if the item has open children or unresolved dependencies, a warning line appears (e.g., "3 children still open" or "Depends on #4 (in-progress)"). The status change still goes through.
- **New keybinding**: `p` — set or change an item's parent via a picker of other items. Option to clear the parent.

Type filter (`Tab`) and iteration filter (`i`) continue to work. Filtered views show matching items with ancestry for context.

### Form View (`WorkItemForm`)

Two new fields:

- **Parent**: dropdown/picker showing existing items by ID and title. Can be "None". Pre-filled when creating a child from the list view.
- **Dependencies**: comma-separated item IDs. Displayed with titles for readability (e.g., `#4 (Implement auth), #2 (Set up DB)`).

Validation errors show inline. Save is blocked until data integrity issues are fixed (this is structural validation, not workflow).

**Read-only relationship section** at bottom of form:

- **Children**: list of direct children.
- **Depended on by**: list of items that depend on this one.

## Testing

### `items.test.ts`

- Read/write items with `parent` and `depends_on` fields.
- Read existing items without these fields (backwards compatibility).
- Round-trip: write with relationships, read back, verify.

### `index.test.ts` (LocalBackend)

- Create item with parent; `getChildren` returns it.
- Create item with `dependsOn`; `getDependents` returns correct items.
- Circular parent detection (A parent of B, B parent of A) rejected.
- Circular dependency detection (A depends on B, B depends on A) rejected.
- Self-reference rejected for both parent and dependsOn.
- Delete parent: children's parent field cleared.
- Delete dependency target: removed from dependsOn lists.
- `getChildren` / `getDependents` return empty arrays when no relationships exist.

No component tests — consistent with existing project pattern of backend-level testing only.
