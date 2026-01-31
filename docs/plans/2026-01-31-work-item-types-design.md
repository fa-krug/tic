# Work Item Types Design

Migrate from a flat issue model to a typed work item system. Each item has a type (e.g., epic, issue, task) provided by the backend. The TUI filters by type, cycling through types with Tab.

## Data Model

### WorkItem (replaces Issue)

```typescript
interface WorkItem {
  id: number;
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string[];
  description: string;
  comments: Comment[];
}

interface NewWorkItem {
  title: string;
  type: string;
  status?: string;
  iteration?: string;
  priority?: string;
  assignee?: string;
  labels?: string[];
  description?: string;
}
```

All types share the same fields. The `type` field is a plain string matching one of the backend's configured types.

`Comment` and `NewComment` are unchanged.

### Backend Interface

```typescript
interface Backend {
  getWorkItems(): Promise<WorkItem[]>;
  createWorkItem(item: NewWorkItem): Promise<WorkItem>;
  updateWorkItem(item: WorkItem): Promise<WorkItem>;
  deleteWorkItem(id: number): Promise<void>;
  getWorkItemTypes(): Promise<string[]>;
  getStatuses(): Promise<string[]>;
  getIterations(): Promise<string[]>;
  getCurrentIteration(): Promise<string>;
  setCurrentIteration(iteration: string): Promise<void>;
}
```

Renamed methods: `getIssues` -> `getWorkItems`, `createIssue` -> `createWorkItem`, `updateIssue` -> `updateWorkItem`, `deleteIssue` -> `deleteWorkItem`.

New method: `getWorkItemTypes()` returns the list of available types from the backend.

## Local Backend

### Config (`.tic/config.yml`)

Add a `types` field:

```yaml
types:
  - epic
  - issue
  - task
statuses:
  - todo
  - in-progress
  - done
iterations:
  - backlog
  - sprint-1
current_iteration: backlog
next_id: 1
```

Default types are `['epic', 'issue', 'task']`.

### File Storage

Directory renamed from `.tic/issues/` to `.tic/items/`.

Item files (`.tic/items/{id}.md`) gain a `type` field in frontmatter:

```yaml
---
id: 1
title: Build the thing
type: issue
status: todo
iteration: backlog
priority: medium
assignee: ''
labels: []
---
Description here.
```

### File Renames

- `src/backends/local/issues.ts` -> `src/backends/local/items.ts`
- Functions: `readIssue` -> `readWorkItem`, `writeIssue` -> `writeWorkItem`, `deleteIssue` -> `deleteWorkItem`
- `LocalBackend` methods renamed to match the new `Backend` interface
- `getWorkItemTypes()` reads `types` from config

## TUI Changes

### WorkItemList (replaces IssueList)

- `src/components/IssueList.tsx` -> `src/components/WorkItemList.tsx`
- Fetches types from `backend.getWorkItemTypes()` on mount
- Tracks `activeTypeIndex` state, starting at 0 (first type)
- `Tab` cycles to the next type (wraps around to first after last)
- Filters displayed items to only those matching the active type
- Header shows the active type name (e.g., "Epics", "Tasks")
- `c` creates a new item with the active type pre-filled
- Table columns: ID, Title, Status, Priority, Assignee (no Type column since filtering already shows the type)

Updated keybindings:
- Up/Down: navigate items
- Enter: open/edit item
- c: create new item (pre-filled with active type)
- d: delete item (with y/n confirm)
- s: cycle status
- i: switch iteration
- Tab: cycle work item type filter
- q: quit

### WorkItemForm (replaces IssueForm)

- `src/components/IssueForm.tsx` -> `src/components/WorkItemForm.tsx`
- Adds a `type` select dropdown field, populated from `getWorkItemTypes()`
- When creating from the list, pre-fills type with the currently active type filter
- When editing, shows the current type (changeable via dropdown)

### IterationPicker

No changes needed.

### App Shell

- Update screen routing to reference renamed components
- Pass active type context when navigating from list to form

## Shared Types

- `src/types.ts`: `Issue` -> `WorkItem`, `NewIssue` -> `NewWorkItem`
- `Comment` and `NewComment` unchanged

## Out of Scope

- Type-specific fields or behaviors
- Hierarchical relationships between types (e.g., epic contains issues)
- Migration of existing `.tic/issues/` data
