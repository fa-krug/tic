# Backend Capabilities Design

## Overview

Each backend declares a static set of capabilities via `getCapabilities()`. The TUI, CLI, and MCP server use these capabilities to hide unsupported features entirely. Backends throw `UnsupportedOperationError` when a consumer mistakenly calls an unsupported method or passes an unsupported field.

## Capabilities Interface

A `BackendCapabilities` interface in `src/backends/types.ts`:

```typescript
interface BackendCapabilities {
  // Feature groups
  relationships: boolean;   // parent-child and dependencies together
  customTypes: boolean;     // multiple work item types (tab switching)
  customStatuses: boolean;  // more than open/closed
  iterations: boolean;      // iteration/milestone support
  comments: boolean;        // adding comments to items

  // Field-level detail where groups are too coarse
  fields: {
    priority: boolean;      // priority field on work items
    assignee: boolean;      // assignee field
    labels: boolean;        // labels field
    parent: boolean;        // parent field (subset of relationships)
    dependsOn: boolean;     // dependsOn field (subset of relationships)
  };
}
```

When `relationships` is false, `fields.parent` and `fields.dependsOn` should also be false. The field-level flags allow a future backend to support parent but not dependencies.

## Capability Matrix

| Capability | Local | GitHub (planned) |
|---|---|---|
| `relationships` | true | false |
| `customTypes` | true | false |
| `customStatuses` | true | false |
| `iterations` | true | true (milestones) |
| `comments` | true | true |
| `fields.priority` | true | false |
| `fields.assignee` | true | true |
| `fields.labels` | true | true |
| `fields.parent` | true | false |
| `fields.dependsOn` | true | false |

## Backend Interface Change

A single addition to the `Backend` interface:

```typescript
interface Backend {
  getCapabilities(): BackendCapabilities;
  // ... all existing methods unchanged
}
```

Capabilities are static per backend instance. No async, no runtime changes.

## UnsupportedOperationError

A standard error for unsupported operations:

```typescript
class UnsupportedOperationError extends Error {
  constructor(operation: string, backend: string) {
    super(`${operation} is not supported by the ${backend} backend`);
    this.name = 'UnsupportedOperationError';
  }
}
```

## Base Class

An abstract `BaseBackend` class provides shared validation:

```typescript
abstract class BaseBackend implements Backend {
  abstract getCapabilities(): BackendCapabilities;

  protected validateFields(data: Partial<NewWorkItem>): void {
    const caps = this.getCapabilities();
    const name = this.constructor.name;

    if (!caps.fields.priority && data.priority !== undefined)
      throw new UnsupportedOperationError('priority', name);
    if (!caps.fields.parent && data.parent != null)
      throw new UnsupportedOperationError('parent', name);
    if (!caps.fields.dependsOn && data.dependsOn?.length)
      throw new UnsupportedOperationError('dependsOn', name);
    if (!caps.fields.assignee && data.assignee)
      throw new UnsupportedOperationError('assignee', name);
    if (!caps.fields.labels && data.labels?.length)
      throw new UnsupportedOperationError('labels', name);
  }

  protected assertSupported(capability: boolean, operation: string): void {
    if (!capability)
      throw new UnsupportedOperationError(operation, this.constructor.name);
  }
}
```

Backends extend `BaseBackend` and call `this.validateFields(data)` at the top of `createWorkItem`/`updateWorkItem`, and `this.assertSupported(caps.X, 'operation')` at the top of capability-gated methods.

### Method-Level Enforcement

| Capability | Methods that throw when false |
|---|---|
| `relationships` | `getChildren()`, `getDependents()` |
| `iterations` | `setCurrentIteration()`, `getCurrentIteration()`, `getIterations()` |
| `comments` | `addComment()` |

`createWorkItem` and `updateWorkItem` throw via `validateFields` when unsupported field values are provided.

## TUI Changes

Components call `backend.getCapabilities()` and conditionally render.

### WorkItemList

- `Tab` key (cycle types) — only active when `customTypes` is true
- `p` key (set parent) — only active when `fields.parent` is true
- `i` key (iteration picker) — only active when `iterations` is true
- Tree indentation — only shown when `relationships` is true
- `⧗` dependency indicator — only shown when `fields.dependsOn` is true
- Completion warnings (open children/deps) — only when `relationships` is true

### WorkItemForm

Each field is conditionally included based on its capability flag:

- `type` dropdown — only when `customTypes` is true
- `status` dropdown — always shown
- `priority` — only when `fields.priority` is true
- `assignee` — only when `fields.assignee` is true
- `labels` — only when `fields.labels` is true
- `iteration` — only when `iterations` is true
- `parent` — only when `fields.parent` is true
- `dependsOn` — only when `fields.dependsOn` is true
- Relationships section (children/dependents) — only when `relationships` is true
- Comments section — only when `comments` is true

### IterationPicker

No changes needed — access is gated by the `i` shortcut in WorkItemList.

## CLI Changes

### Dynamic Command Registration

Commands are built dynamically after backend resolution. The CLI entry point resolves the backend first, then passes it to command builder functions.

For `tic item create` and `tic item update`, options are conditionally registered:

```typescript
const caps = backend.getCapabilities();

const createCmd = program.command('create <title>');
createCmd.option('--status <status>', 'Work item status');
createCmd.option('--description <desc>', 'Description');

if (caps.customTypes)      createCmd.option('--type <type>', 'Work item type');
if (caps.fields.priority)  createCmd.option('--priority <p>', 'Priority level');
if (caps.fields.assignee)  createCmd.option('--assignee <a>', 'Assignee');
if (caps.fields.labels)    createCmd.option('--labels <l>', 'Labels (comma-separated)');
if (caps.iterations)        createCmd.option('--iteration <i>', 'Iteration');
if (caps.fields.parent)    createCmd.option('--parent <id>', 'Parent item ID');
if (caps.fields.dependsOn) createCmd.option('--depends-on <ids>', 'Dependency IDs');
```

The `tic iteration` subcommand is conditionally registered — if `caps.iterations` is false, it doesn't appear at all.

Unsupported flags are hidden from `--help` output since they're never registered.

## MCP Server Changes

Tool registration is conditional based on capabilities:

```typescript
const caps = backend.getCapabilities();

// Always registered:
server.tool('list_items', ...);
server.tool('show_item', ...);
server.tool('create_item', ...);   // field validation via base class
server.tool('update_item', ...);   // field validation via base class
server.tool('delete_item', ...);
server.tool('confirm_delete', ...);
server.tool('search_items', ...);
server.tool('get_config', ...);

// Conditional:
if (caps.iterations)    server.tool('set_iteration', ...);
if (caps.relationships) server.tool('get_children', ...);
if (caps.relationships) server.tool('get_dependents', ...);
if (caps.relationships) server.tool('get_item_tree', ...);
if (caps.comments)      server.tool('add_comment', ...);
```

The `get_config` tool includes a `capabilities` field in its response so MCP clients know what the backend supports.

## Files Changed

| File | Change |
|---|---|
| `src/backends/types.ts` | Add `BackendCapabilities` interface, `UnsupportedOperationError` class, `BaseBackend` abstract class |
| `src/backends/local/index.ts` | Extend `BaseBackend`, implement `getCapabilities()` (all true), call `this.validateFields()` in create/update |
| `src/components/WorkItemList.tsx` | Check capabilities for tree indent, dependency indicators, `Tab`/`p`/`i` keys |
| `src/components/WorkItemForm.tsx` | Conditionally include fields based on capability flags |
| `src/cli/commands/item.ts` | Accept backend, conditionally register option flags |
| `src/cli/commands/iteration.ts` | Conditionally register entire subcommand |
| `src/cli/index.ts` | Resolve backend before command registration, pass to command builders |
| `src/cli/commands/mcp.ts` | Conditionally register MCP tools |

No new files added.

## Tests

- Unit tests for `BaseBackend.validateFields()` and `assertSupported()` — verify throws on unsupported fields/operations
- Update existing `LocalBackend` tests to verify `getCapabilities()` returns all true
- Verify `LocalBackend` still passes all existing tests (no regressions)
