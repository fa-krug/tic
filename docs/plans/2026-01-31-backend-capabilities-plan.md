# Backend Capabilities Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a capabilities system so each backend declares what it supports, and the TUI/CLI/MCP hide unsupported features.

**Architecture:** Add `BackendCapabilities` interface and `BaseBackend` abstract class to `src/backends/types.ts`. `LocalBackend` extends `BaseBackend`. TUI components check capabilities to conditionally render fields/shortcuts. CLI builds commands dynamically after backend resolution. MCP server conditionally registers tools.

**Tech Stack:** TypeScript, React/Ink, Commander.js, Vitest

---

### Task 1: BackendCapabilities Interface and BaseBackend Class

**Files:**
- Modify: `src/backends/types.ts:1-20`
- Test: `src/backends/local/index.test.ts`

**Step 1: Write the failing test**

Add to `src/backends/local/index.test.ts`:

```typescript
it('returns capabilities with all features enabled', () => {
  const caps = backend.getCapabilities();
  expect(caps).toEqual({
    relationships: true,
    customTypes: true,
    customStatuses: true,
    iterations: true,
    comments: true,
    fields: {
      priority: true,
      assignee: true,
      labels: true,
      parent: true,
      dependsOn: true,
    },
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `getCapabilities` is not a function

**Step 3: Add types and BaseBackend to `src/backends/types.ts`**

Add after the existing imports:

```typescript
export interface BackendCapabilities {
  relationships: boolean;
  customTypes: boolean;
  customStatuses: boolean;
  iterations: boolean;
  comments: boolean;
  fields: {
    priority: boolean;
    assignee: boolean;
    labels: boolean;
    parent: boolean;
    dependsOn: boolean;
  };
}

export class UnsupportedOperationError extends Error {
  constructor(operation: string, backend: string) {
    super(`${operation} is not supported by the ${backend} backend`);
    this.name = 'UnsupportedOperationError';
  }
}
```

Add `getCapabilities(): BackendCapabilities;` to the `Backend` interface.

Add the abstract base class:

```typescript
export abstract class BaseBackend implements Backend {
  abstract getCapabilities(): BackendCapabilities;
  abstract getStatuses(): string[];
  abstract getIterations(): string[];
  abstract getWorkItemTypes(): string[];
  abstract getCurrentIteration(): string;
  abstract setCurrentIteration(name: string): void;
  abstract listWorkItems(iteration?: string): WorkItem[];
  abstract getWorkItem(id: number): WorkItem;
  abstract createWorkItem(data: NewWorkItem): WorkItem;
  abstract updateWorkItem(id: number, data: Partial<WorkItem>): WorkItem;
  abstract deleteWorkItem(id: number): void;
  abstract addComment(workItemId: number, comment: NewComment): Comment;
  abstract getChildren(id: number): WorkItem[];
  abstract getDependents(id: number): WorkItem[];
  abstract getItemUrl(id: number): string;
  abstract openItem(id: number): void;

  protected validateFields(
    data: Partial<NewWorkItem>,
  ): void {
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

  protected assertSupported(
    capability: boolean,
    operation: string,
  ): void {
    if (!capability)
      throw new UnsupportedOperationError(operation, this.constructor.name);
  }
}
```

**Step 4: Run test to verify it still fails**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: FAIL — `LocalBackend` doesn't have `getCapabilities` yet (next task)

**Step 5: Commit**

```bash
git add src/backends/types.ts
git commit -m "feat: add BackendCapabilities interface, UnsupportedOperationError, and BaseBackend class"
```

---

### Task 2: LocalBackend Extends BaseBackend

**Files:**
- Modify: `src/backends/local/index.ts:1-27` (class declaration and imports)
- Modify: `src/backends/local/index.ts:137-168` (createWorkItem/updateWorkItem add validateFields call)
- Test: `src/backends/local/index.test.ts`

**Step 1: Update LocalBackend to extend BaseBackend**

In `src/backends/local/index.ts`, change the import:

```typescript
import { BaseBackend } from '../types.js';
```

Change the class declaration:

```typescript
export class LocalBackend extends BaseBackend {
```

Add `getCapabilities()` method (after the `save()` method):

```typescript
getCapabilities() {
  return {
    relationships: true,
    customTypes: true,
    customStatuses: true,
    iterations: true,
    comments: true,
    fields: {
      priority: true,
      assignee: true,
      labels: true,
      parent: true,
      dependsOn: true,
    },
  };
}
```

Add `this.validateFields(data)` as the first line of `createWorkItem` (before `const now = ...`).

Add `this.validateFields(data)` as the first line of `updateWorkItem` (before `const item = ...`).

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/backends/local/index.test.ts`
Expected: ALL PASS (including the new `getCapabilities` test)

**Step 3: Run all tests to check no regressions**

Run: `npm test`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/backends/types.ts src/backends/local/index.ts src/backends/local/index.test.ts
git commit -m "feat: LocalBackend extends BaseBackend with full capabilities"
```

---

### Task 3: BaseBackend Validation Tests

**Files:**
- Create: `src/backends/base.test.ts`

**Step 1: Write tests for validateFields and assertSupported**

Create `src/backends/base.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import {
  BaseBackend,
  UnsupportedOperationError,
  type BackendCapabilities,
} from './types.js';
import type { WorkItem, NewWorkItem, NewComment, Comment } from '../types.js';

class TestBackend extends BaseBackend {
  private caps: BackendCapabilities;
  constructor(caps: BackendCapabilities) {
    super();
    this.caps = caps;
  }
  getCapabilities() { return this.caps; }
  getStatuses() { return ['open', 'closed']; }
  getIterations() { return ['default']; }
  getWorkItemTypes() { return ['issue']; }
  getCurrentIteration() { return 'default'; }
  setCurrentIteration() {}
  listWorkItems() { return []; }
  getWorkItem() { return {} as WorkItem; }
  createWorkItem(data: NewWorkItem) {
    this.validateFields(data);
    return {} as WorkItem;
  }
  updateWorkItem(_id: number, data: Partial<WorkItem>) {
    this.validateFields(data);
    return {} as WorkItem;
  }
  deleteWorkItem() {}
  addComment() { return {} as Comment; }
  getChildren() { return []; }
  getDependents() { return []; }
  getItemUrl() { return ''; }
  openItem() {}

  // Expose protected methods for testing
  testAssertSupported(capability: boolean, operation: string) {
    this.assertSupported(capability, operation);
  }
}

const ALL_FALSE: BackendCapabilities = {
  relationships: false,
  customTypes: false,
  customStatuses: false,
  iterations: false,
  comments: false,
  fields: {
    priority: false,
    assignee: false,
    labels: false,
    parent: false,
    dependsOn: false,
  },
};

describe('BaseBackend', () => {
  describe('validateFields', () => {
    it('throws for unsupported priority field', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: 'high', assignee: '',
          labels: [], description: '', parent: null, dependsOn: [],
        }),
      ).toThrow(UnsupportedOperationError);
    });

    it('throws for unsupported parent field', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: undefined as unknown as 'medium',
          assignee: '', labels: [], description: '', parent: 5, dependsOn: [],
        }),
      ).toThrow(UnsupportedOperationError);
    });

    it('throws for unsupported dependsOn field', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: undefined as unknown as 'medium',
          assignee: '', labels: [], description: '', parent: null,
          dependsOn: [1, 2],
        }),
      ).toThrow(UnsupportedOperationError);
    });

    it('throws for unsupported assignee field', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: undefined as unknown as 'medium',
          assignee: 'alice', labels: [], description: '', parent: null,
          dependsOn: [],
        }),
      ).toThrow(UnsupportedOperationError);
    });

    it('throws for unsupported labels field', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: undefined as unknown as 'medium',
          assignee: '', labels: ['bug'], description: '', parent: null,
          dependsOn: [],
        }),
      ).toThrow(UnsupportedOperationError);
    });

    it('does not throw when unsupported fields have default/empty values', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: undefined as unknown as 'medium',
          assignee: '', labels: [], description: '', parent: null,
          dependsOn: [],
        }),
      ).not.toThrow();
    });

    it('does not throw when all capabilities are enabled', () => {
      const allTrue: BackendCapabilities = {
        relationships: true, customTypes: true, customStatuses: true,
        iterations: true, comments: true,
        fields: { priority: true, assignee: true, labels: true, parent: true, dependsOn: true },
      };
      const backend = new TestBackend(allTrue);
      expect(() =>
        backend.createWorkItem({
          title: 'Test', type: 'issue', status: 'open',
          iteration: 'default', priority: 'high', assignee: 'alice',
          labels: ['bug'], description: '', parent: 5, dependsOn: [1, 2],
        }),
      ).not.toThrow();
    });
  });

  describe('assertSupported', () => {
    it('throws UnsupportedOperationError when capability is false', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() => backend.testAssertSupported(false, 'iterations')).toThrow(
        UnsupportedOperationError,
      );
    });

    it('does not throw when capability is true', () => {
      const backend = new TestBackend(ALL_FALSE);
      expect(() => backend.testAssertSupported(true, 'iterations')).not.toThrow();
    });
  });
});
```

**Step 2: Run test to verify it passes**

Run: `npx vitest run src/backends/base.test.ts`
Expected: ALL PASS

**Step 3: Commit**

```bash
git add src/backends/base.test.ts
git commit -m "test: add BaseBackend validateFields and assertSupported tests"
```

---

### Task 4: TUI WorkItemForm — Conditional Fields

**Files:**
- Modify: `src/components/WorkItemForm.tsx:8-33` (FIELDS array and FieldName type)
- Modify: `src/components/WorkItemForm.tsx:37-42` (add capabilities lookup)
- Modify: `src/components/WorkItemForm.tsx:415` (use filtered FIELDS in map)
- Modify: `src/components/WorkItemForm.tsx:417-441` (relationships section)

**Step 1: Build the filtered fields list**

In `WorkItemForm`, after getting `backend` from `useAppState()`, add:

```typescript
const capabilities = useMemo(() => backend.getCapabilities(), [backend]);

const fields = useMemo(() => {
  const all: FieldName[] = ['title'];
  if (capabilities.customTypes) all.push('type');
  all.push('status'); // always shown
  if (capabilities.iterations) all.push('iteration');
  if (capabilities.fields.priority) all.push('priority');
  if (capabilities.fields.assignee) all.push('assignee');
  if (capabilities.fields.labels) all.push('labels');
  all.push('description'); // always shown
  if (capabilities.fields.parent) all.push('parent');
  if (capabilities.fields.dependsOn) all.push('dependsOn');
  if (capabilities.comments) all.push('comments');
  return all;
}, [capabilities]);
```

**Step 2: Use `fields` instead of `FIELDS` everywhere**

Replace `FIELDS` in the component render and navigation:
- `FIELDS.length - 1` → `fields.length - 1` in the `setFocusedField` clamp
- `FIELDS.map(...)` → `fields.map(...)` in the render
- `FIELDS[focusedField]` → `fields[focusedField]`

Keep the top-level `FIELDS` constant for the `FieldName` type definition, rename it to `ALL_FIELDS` or just keep `FieldName` as a union type.

**Step 3: Conditionally render relationships section**

Wrap the relationships section (`selectedWorkItemId !== null && (...)`) with an additional `capabilities.relationships` check:

```typescript
{selectedWorkItemId !== null && capabilities.relationships && (
  // ... existing relationships JSX
)}
```

**Step 4: Conditionally render comments in the save function**

Wrap the `addComment` calls in `save()` with `capabilities.comments`:

```typescript
if (capabilities.comments && newComment.trim().length > 0) {
```

**Step 5: Run the build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 6: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat: conditionally render form fields based on backend capabilities"
```

---

### Task 5: TUI WorkItemList — Conditional Shortcuts and Display

**Files:**
- Modify: `src/components/WorkItemList.tsx:45-47` (add capabilities)
- Modify: `src/components/WorkItemList.tsx:56` (conditional type cycling)
- Modify: `src/components/WorkItemList.tsx:64` (conditional iteration fetch)
- Modify: `src/components/WorkItemList.tsx:115` (conditional `i` key)
- Modify: `src/components/WorkItemList.tsx:132-172` (conditional status warnings)
- Modify: `src/components/WorkItemList.tsx:174-178` (conditional `p` key)
- Modify: `src/components/WorkItemList.tsx:180-186` (conditional Tab key)
- Modify: `src/components/WorkItemList.tsx:243-274` (conditional tree prefix and dep indicator)
- Modify: `src/components/WorkItemList.tsx:306-309` (conditional help text)

**Step 1: Get capabilities in the component**

After getting `backend` from `useAppState()`:

```typescript
const capabilities = useMemo(() => backend.getCapabilities(), [backend]);
```

**Step 2: Conditional keyboard handlers**

- `i` key: only call `navigate('iteration-picker')` when `capabilities.iterations`
- `p` key: only enter `settingParent` mode when `capabilities.fields.parent`
- Tab key: only cycle types when `capabilities.customTypes`
- `s` key status cycling: only check children/deps warnings when `capabilities.relationships`

In the status cycling section (lines 138-169), wrap the children/deps check:

```typescript
if (capabilities.relationships && nextStatus === statuses[statuses.length - 1]) {
  // ... existing children and deps warning logic
}
```

**Step 3: Conditional rendering**

- Tree prefix: only show `prefix` when `capabilities.relationships` — use `{capabilities.relationships ? prefix : ''}`
- Dependency indicator: only show `⧗` when `capabilities.fields.dependsOn` — use `{capabilities.fields.dependsOn && hasUnresolvedDeps ? '⧗ ' : ''}`
- Priority column: only show when `capabilities.fields.priority`
- Assignee column: only show when `capabilities.fields.assignee`

**Step 4: Update help text**

Build the help text dynamically:

```typescript
const helpParts = ['up/down: navigate', 'enter: edit', 'o: open', 'c: create', 'd: delete', 's: cycle status'];
if (capabilities.fields.parent) helpParts.push('p: set parent');
if (capabilities.customTypes) helpParts.push('tab: type');
if (capabilities.iterations) helpParts.push('i: iteration');
helpParts.push(',: settings', 'q: quit');
```

**Step 5: Conditional set-parent UI**

Wrap the `settingParent` render block in the footer with `capabilities.fields.parent &&`:

```typescript
{capabilities.fields.parent && settingParent ? (
  // ... existing parent input JSX
) : confirmDelete ? (
```

**Step 6: Run the build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 7: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "feat: conditionally render list shortcuts and columns based on capabilities"
```

---

### Task 6: CLI Dynamic Command Registration

**Files:**
- Modify: `src/cli/index.ts:110-449` (refactor command registration)

**Step 1: Refactor CLI to build commands dynamically**

The key change: the `item create`, `item update`, and `iteration` commands need access to capabilities. Move command registration that needs backend/capabilities into a function.

For `item create` and `item update`: wrap the option registration in conditionals.

The backend can only be resolved after `init` has been run (it requires `.tic/`). The approach: create a helper that lazily resolves backend + capabilities, and use it in the action handlers. The option registration for create/update becomes conditional on a pre-resolved backend.

However, since `--help` can run without a `.tic/` project, we need a fallback. The cleanest approach: add a helper `tryGetCapabilities()` that returns all-true if no project exists (showing all options in help), and actual capabilities when a project exists.

```typescript
function tryGetCapabilities(): BackendCapabilities | null {
  try {
    requireTicProject(process.cwd());
    const backend = createBackendFromConfig(process.cwd());
    return backend.getCapabilities();
  } catch {
    return null; // no project — show all options
  }
}
```

For `item create`:

```typescript
const caps = tryGetCapabilities();
const create = item.command('create').description('Create a new work item').argument('<title>', 'Work item title');
create.option('--status <status>', 'Initial status');
create.option('--description <desc>', 'Description');
if (!caps || caps.customTypes) create.option('--type <type>', 'Work item type');
if (!caps || caps.fields.priority) create.option('--priority <priority>', 'Priority level');
if (!caps || caps.fields.assignee) create.option('--assignee <name>', 'Assignee');
if (!caps || caps.fields.labels) create.option('--labels <labels>', 'Comma-separated labels');
if (!caps || caps.iterations) create.option('--iteration <name>', 'Iteration');
if (!caps || caps.fields.parent) create.option('--parent <id>', 'Parent item ID');
if (!caps || caps.fields.dependsOn) create.option('--depends-on <ids>', 'Comma-separated dependency IDs');
```

Same pattern for `item update`.

For the `iteration` subcommand — conditionally register the entire command:

```typescript
if (!caps || caps.iterations) {
  const iteration = program.command('iteration').description('Manage iterations');
  // ... list and set subcommands
}
```

**Step 2: Run the build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 3: Run existing CLI tests to verify no regressions**

Run: `npx vitest run src/cli/__tests__/`
Expected: ALL PASS

**Step 4: Commit**

```bash
git add src/cli/index.ts
git commit -m "feat: conditionally register CLI options and commands based on capabilities"
```

---

### Task 7: MCP Server Conditional Tool Registration

**Files:**
- Modify: `src/cli/commands/mcp.ts:401-599` (registerTools function)
- Modify: `src/cli/commands/mcp.ts:66-79` (handleGetConfig to include capabilities)

**Step 1: Update handleGetConfig to include capabilities**

```typescript
export function handleGetConfig(backend: Backend, root: string): ToolResult {
  try {
    const config = readConfig(root);
    return success({
      backend: config.backend,
      statuses: backend.getStatuses(),
      types: backend.getWorkItemTypes(),
      iterations: backend.getIterations(),
      currentIteration: backend.getCurrentIteration(),
      capabilities: backend.getCapabilities(),
    });
  } catch (err) {
    return error(err instanceof Error ? err.message : String(err));
  }
}
```

**Step 2: Make registerTools conditional**

In `registerTools`, get capabilities at the top:

```typescript
export function registerTools(
  server: McpServer,
  backend: Backend,
  pendingDeletes: DeleteTracker,
  root: string,
): void {
  const caps = backend.getCapabilities();
```

Keep always-registered tools: `init_project`, `get_config`, `list_items`, `show_item`, `create_item`, `update_item`, `delete_item`, `confirm_delete`, `search_items`, `set_backend`.

Wrap conditional tools:

```typescript
if (caps.comments) {
  server.tool('add_comment', ...);
}

if (caps.iterations) {
  server.tool('set_iteration', ...);
}

if (caps.relationships) {
  server.tool('get_children', ...);
  server.tool('get_dependents', ...);
  server.tool('get_item_tree', ...);
}
```

**Step 3: Update MCP delete_item handler for capabilities**

The `handleDeleteItem` handler calls `backend.getChildren` and `backend.getDependents`. Make these conditional:

```typescript
export function handleDeleteItem(
  backend: Backend,
  args: { id: number },
  pendingDeletes: DeleteTracker,
): ToolResult {
  try {
    const item = backend.getWorkItem(args.id);
    const caps = backend.getCapabilities();
    const children = caps.relationships ? backend.getChildren(args.id) : [];
    const dependents = caps.relationships ? backend.getDependents(args.id) : [];
    // ... rest unchanged
  }
}
```

**Step 4: Run the build to verify no type errors**

Run: `npm run build`
Expected: PASS

**Step 5: Run MCP tests to verify no regressions**

Run: `npx vitest run src/cli/__tests__/mcp.test.ts`
Expected: ALL PASS

**Step 6: Commit**

```bash
git add src/cli/commands/mcp.ts
git commit -m "feat: conditionally register MCP tools and include capabilities in get_config"
```

---

### Task 8: Full Test Suite and Lint

**Files:** None new

**Step 1: Run full test suite**

Run: `npm test`
Expected: ALL PASS

**Step 2: Run lint**

Run: `npm run lint`
Expected: PASS

**Step 3: Run format check**

Run: `npm run format:check`
If FAIL, run: `npm run format`

**Step 4: Run type check**

Run: `npx tsc --noEmit`
Expected: PASS

**Step 5: Final commit (if format changes)**

```bash
git add -A
git commit -m "style: format code"
```

---

### Task 9: Update CLAUDE.md

**Files:**
- Modify: `CLAUDE.md`

**Step 1: Add capabilities to Architecture section**

In the Backend Abstraction section, add a note about `BackendCapabilities`:

```
`BaseBackend` (`src/backends/types.ts`) is the abstract base class all backends extend. It provides `validateFields()` to throw `UnsupportedOperationError` for fields the backend doesn't support, and `assertSupported()` for gating entire operations. Each backend implements `getCapabilities()` returning a `BackendCapabilities` object that declares supported feature groups (`relationships`, `customTypes`, `customStatuses`, `iterations`, `comments`) and individual fields (`priority`, `assignee`, `labels`, `parent`, `dependsOn`). TUI components, CLI commands, and MCP tools use capabilities to hide unsupported features.
```

**Step 2: Commit**

```bash
git add CLAUDE.md
git commit -m "docs: add capabilities system to CLAUDE.md architecture section"
```
