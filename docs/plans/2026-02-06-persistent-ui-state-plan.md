# Persistent UI State Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Persist list view state (cursor, expanded nodes, marked items) and form drafts across screen transitions, enabling nested editing with a breadcrumb bar.

**Architecture:** Two new Zustand stores — `listViewStore` for list UI state and `formStackStore` for a stack of form drafts. Form saves auto-pop to previous draft. Breadcrumb component shows navigation depth.

**Tech Stack:** Zustand vanilla stores with React hooks, TypeScript, Ink components

---

## Task 1: Create listViewStore

**Files:**
- Create: `src/stores/listViewStore.ts`
- Test: `src/stores/listViewStore.test.ts`

**Step 1: Write the failing test**

```typescript
// src/stores/listViewStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { listViewStore } from './listViewStore.js';

beforeEach(() => {
  listViewStore.getState().reset();
});

describe('listViewStore', () => {
  describe('cursor', () => {
    it('sets cursor position', () => {
      listViewStore.getState().setCursor(5);
      expect(listViewStore.getState().cursor).toBe(5);
    });

    it('clamps cursor to valid range', () => {
      listViewStore.getState().setCursor(10);
      listViewStore.getState().clampCursor(5);
      expect(listViewStore.getState().cursor).toBe(5);
    });

    it('does not clamp cursor if already valid', () => {
      listViewStore.getState().setCursor(3);
      listViewStore.getState().clampCursor(5);
      expect(listViewStore.getState().cursor).toBe(3);
    });
  });

  describe('expandedIds', () => {
    it('toggles expanded state on', () => {
      listViewStore.getState().toggleExpanded('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(true);
    });

    it('toggles expanded state off', () => {
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleExpanded('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(false);
    });
  });

  describe('markedIds', () => {
    it('toggles marked state', () => {
      listViewStore.getState().toggleMarked('item-1');
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(true);
      listViewStore.getState().toggleMarked('item-1');
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(false);
    });

    it('clears all marked items', () => {
      listViewStore.getState().toggleMarked('item-1');
      listViewStore.getState().toggleMarked('item-2');
      listViewStore.getState().clearMarked();
      expect(listViewStore.getState().markedIds.size).toBe(0);
    });
  });

  describe('removeDeletedItem', () => {
    it('removes item from expandedIds and markedIds', () => {
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleMarked('item-1');
      listViewStore.getState().removeDeletedItem('item-1');
      expect(listViewStore.getState().expandedIds.has('item-1')).toBe(false);
      expect(listViewStore.getState().markedIds.has('item-1')).toBe(false);
    });
  });

  describe('scrollOffset', () => {
    it('sets scroll offset', () => {
      listViewStore.getState().setScrollOffset(100);
      expect(listViewStore.getState().scrollOffset).toBe(100);
    });
  });

  describe('reset', () => {
    it('resets all state', () => {
      listViewStore.getState().setCursor(5);
      listViewStore.getState().toggleExpanded('item-1');
      listViewStore.getState().toggleMarked('item-2');
      listViewStore.getState().setScrollOffset(100);
      listViewStore.getState().reset();

      expect(listViewStore.getState().cursor).toBe(0);
      expect(listViewStore.getState().expandedIds.size).toBe(0);
      expect(listViewStore.getState().markedIds.size).toBe(0);
      expect(listViewStore.getState().scrollOffset).toBe(0);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: FAIL with "Cannot find module './listViewStore.js'"

**Step 3: Write minimal implementation**

```typescript
// src/stores/listViewStore.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

interface ListViewState {
  cursor: number;
  expandedIds: Set<string>;
  markedIds: Set<string>;
  scrollOffset: number;

  setCursor: (index: number) => void;
  clampCursor: (maxIndex: number) => void;
  toggleExpanded: (id: string) => void;
  toggleMarked: (id: string) => void;
  clearMarked: () => void;
  setScrollOffset: (offset: number) => void;
  removeDeletedItem: (id: string) => void;
  reset: () => void;
}

const initialState = {
  cursor: 0,
  expandedIds: new Set<string>(),
  markedIds: new Set<string>(),
  scrollOffset: 0,
};

export const listViewStore = createStore<ListViewState>((set) => ({
  ...initialState,

  setCursor: (index) => set({ cursor: index }),

  clampCursor: (maxIndex) =>
    set((state) => ({
      cursor: Math.min(state.cursor, Math.max(0, maxIndex)),
    })),

  toggleExpanded: (id) =>
    set((state) => {
      const next = new Set(state.expandedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { expandedIds: next };
    }),

  toggleMarked: (id) =>
    set((state) => {
      const next = new Set(state.markedIds);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return { markedIds: next };
    }),

  clearMarked: () => set({ markedIds: new Set() }),

  setScrollOffset: (offset) => set({ scrollOffset: offset }),

  removeDeletedItem: (id) =>
    set((state) => {
      const nextExpanded = new Set(state.expandedIds);
      const nextMarked = new Set(state.markedIds);
      nextExpanded.delete(id);
      nextMarked.delete(id);
      return { expandedIds: nextExpanded, markedIds: nextMarked };
    }),

  reset: () =>
    set({
      cursor: 0,
      expandedIds: new Set(),
      markedIds: new Set(),
      scrollOffset: 0,
    }),
}));

export function useListViewStore<T>(selector: (state: ListViewState) => T): T {
  return useStore(listViewStore, selector);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/listViewStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/listViewStore.ts src/stores/listViewStore.test.ts
git commit -m "feat(stores): add listViewStore for persistent list UI state"
```

---

## Task 2: Create formStackStore

**Files:**
- Create: `src/stores/formStackStore.ts`
- Test: `src/stores/formStackStore.test.ts`

**Step 1: Write the failing test**

```typescript
// src/stores/formStackStore.test.ts
import { describe, it, expect, beforeEach } from 'vitest';
import { formStackStore } from './formStackStore.js';
import type { FormDraft } from './formStackStore.js';

const createDraft = (overrides: Partial<FormDraft> = {}): FormDraft => ({
  itemId: null,
  itemTitle: '(new)',
  fields: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  initialSnapshot: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  focusedField: 0,
  ...overrides,
});

beforeEach(() => {
  formStackStore.getState().clear();
});

describe('formStackStore', () => {
  describe('push', () => {
    it('adds draft to stack', () => {
      const draft = createDraft({ itemId: 'item-1', itemTitle: 'Test' });
      formStackStore.getState().push(draft);
      expect(formStackStore.getState().stack).toHaveLength(1);
      expect(formStackStore.getState().stack[0]).toEqual(draft);
    });

    it('builds up stack with multiple pushes', () => {
      formStackStore.getState().push(createDraft({ itemId: 'item-1' }));
      formStackStore.getState().push(createDraft({ itemId: 'item-2' }));
      expect(formStackStore.getState().stack).toHaveLength(2);
    });
  });

  describe('pop', () => {
    it('removes and returns top draft', () => {
      const draft1 = createDraft({ itemId: 'item-1' });
      const draft2 = createDraft({ itemId: 'item-2' });
      formStackStore.getState().push(draft1);
      formStackStore.getState().push(draft2);

      const popped = formStackStore.getState().pop();
      expect(popped).toEqual(draft2);
      expect(formStackStore.getState().stack).toHaveLength(1);
    });

    it('returns undefined when stack is empty', () => {
      const popped = formStackStore.getState().pop();
      expect(popped).toBeUndefined();
    });
  });

  describe('currentDraft', () => {
    it('returns top of stack', () => {
      const draft = createDraft({ itemId: 'item-1' });
      formStackStore.getState().push(draft);
      expect(formStackStore.getState().currentDraft()).toEqual(draft);
    });

    it('returns undefined when empty', () => {
      expect(formStackStore.getState().currentDraft()).toBeUndefined();
    });
  });

  describe('updateFields', () => {
    it('updates fields in current draft', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().updateFields({ title: 'Updated' });
      expect(formStackStore.getState().currentDraft()?.fields.title).toBe(
        'Updated',
      );
    });

    it('does nothing when stack is empty', () => {
      formStackStore.getState().updateFields({ title: 'Test' });
      expect(formStackStore.getState().stack).toHaveLength(0);
    });
  });

  describe('setFocusedField', () => {
    it('updates focusedField in current draft', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().setFocusedField(5);
      expect(formStackStore.getState().currentDraft()?.focusedField).toBe(5);
    });
  });

  describe('isDirty', () => {
    it('returns false when fields match snapshot', () => {
      formStackStore.getState().push(createDraft());
      expect(formStackStore.getState().isDirty()).toBe(false);
    });

    it('returns true when fields differ from snapshot', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().updateFields({ title: 'Changed' });
      expect(formStackStore.getState().isDirty()).toBe(true);
    });

    it('returns false when stack is empty', () => {
      expect(formStackStore.getState().isDirty()).toBe(false);
    });
  });

  describe('showDiscardPrompt', () => {
    it('sets and clears discard prompt state', () => {
      formStackStore.getState().setShowDiscardPrompt(true);
      expect(formStackStore.getState().showDiscardPrompt).toBe(true);
      formStackStore.getState().setShowDiscardPrompt(false);
      expect(formStackStore.getState().showDiscardPrompt).toBe(false);
    });
  });

  describe('clear', () => {
    it('resets all state', () => {
      formStackStore.getState().push(createDraft());
      formStackStore.getState().setShowDiscardPrompt(true);
      formStackStore.getState().clear();

      expect(formStackStore.getState().stack).toHaveLength(0);
      expect(formStackStore.getState().showDiscardPrompt).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/formStackStore.test.ts`
Expected: FAIL with "Cannot find module './formStackStore.js'"

**Step 3: Write minimal implementation**

```typescript
// src/stores/formStackStore.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

export interface FormFields {
  title: string;
  type: string;
  status: string;
  iteration: string;
  priority: string;
  assignee: string;
  labels: string;
  description: string;
  parentId: string;
  dependsOn: string;
  newComment: string;
}

export interface FormDraft {
  itemId: string | null;
  itemTitle: string;
  fields: FormFields;
  initialSnapshot: FormFields;
  focusedField: number;
}

interface FormStackState {
  stack: FormDraft[];
  showDiscardPrompt: boolean;

  push: (draft: FormDraft) => void;
  pop: () => FormDraft | undefined;
  updateFields: (fields: Partial<FormFields>) => void;
  setFocusedField: (index: number) => void;
  isDirty: () => boolean;
  setShowDiscardPrompt: (show: boolean) => void;
  clear: () => void;
  currentDraft: () => FormDraft | undefined;
}

function fieldsEqual(a: FormFields, b: FormFields): boolean {
  return (
    a.title === b.title &&
    a.type === b.type &&
    a.status === b.status &&
    a.iteration === b.iteration &&
    a.priority === b.priority &&
    a.assignee === b.assignee &&
    a.labels === b.labels &&
    a.description === b.description &&
    a.parentId === b.parentId &&
    a.dependsOn === b.dependsOn &&
    a.newComment === b.newComment
  );
}

export const formStackStore = createStore<FormStackState>((set, get) => ({
  stack: [],
  showDiscardPrompt: false,

  push: (draft) =>
    set((state) => ({
      stack: [...state.stack, draft],
    })),

  pop: () => {
    const { stack } = get();
    if (stack.length === 0) return undefined;
    const popped = stack[stack.length - 1]!;
    set({ stack: stack.slice(0, -1) });
    return popped;
  },

  currentDraft: () => {
    const { stack } = get();
    return stack.length > 0 ? stack[stack.length - 1] : undefined;
  },

  updateFields: (fields) =>
    set((state) => {
      if (state.stack.length === 0) return state;
      const updated = [...state.stack];
      const current = updated[updated.length - 1]!;
      updated[updated.length - 1] = {
        ...current,
        fields: { ...current.fields, ...fields },
      };
      return { stack: updated };
    }),

  setFocusedField: (index) =>
    set((state) => {
      if (state.stack.length === 0) return state;
      const updated = [...state.stack];
      const current = updated[updated.length - 1]!;
      updated[updated.length - 1] = { ...current, focusedField: index };
      return { stack: updated };
    }),

  isDirty: () => {
    const current = get().currentDraft();
    if (!current) return false;
    return !fieldsEqual(current.fields, current.initialSnapshot);
  },

  setShowDiscardPrompt: (show) => set({ showDiscardPrompt: show }),

  clear: () => set({ stack: [], showDiscardPrompt: false }),
}));

export function useFormStackStore<T>(selector: (state: FormStackState) => T): T {
  return useStore(formStackStore, selector);
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/formStackStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/formStackStore.ts src/stores/formStackStore.test.ts
git commit -m "feat(stores): add formStackStore for nested form editing"
```

---

## Task 3: Create Breadcrumbs component

**Files:**
- Create: `src/components/Breadcrumbs.tsx`
- Test: `src/components/Breadcrumbs.test.tsx`

**Step 1: Write the failing test**

```typescript
// src/components/Breadcrumbs.test.tsx
import { describe, it, expect, beforeEach } from 'vitest';
import { render } from 'ink-testing-library';
import { Breadcrumbs } from './Breadcrumbs.js';
import { formStackStore } from '../stores/formStackStore.js';
import type { FormDraft } from '../stores/formStackStore.js';

const createDraft = (
  itemId: string | null,
  itemTitle: string,
): FormDraft => ({
  itemId,
  itemTitle,
  fields: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  initialSnapshot: {
    title: '',
    type: 'task',
    status: 'open',
    iteration: 'current',
    priority: 'medium',
    assignee: '',
    labels: '',
    description: '',
    parentId: '',
    dependsOn: '',
    newComment: '',
  },
  focusedField: 0,
});

beforeEach(() => {
  formStackStore.getState().clear();
});

describe('Breadcrumbs', () => {
  it('renders nothing when stack has 0-1 items', () => {
    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toBe('');
  });

  it('renders breadcrumb trail when stack has multiple items', () => {
    formStackStore.getState().push(createDraft('item-1', 'First Item'));
    formStackStore.getState().push(createDraft('item-2', 'Second Item'));

    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toContain('First Item');
    expect(lastFrame()).toContain('›');
    expect(lastFrame()).toContain('Second Item');
  });

  it('shows (new) for items without id', () => {
    formStackStore.getState().push(createDraft('item-1', 'First Item'));
    formStackStore.getState().push(createDraft(null, '(new)'));

    const { lastFrame } = render(<Breadcrumbs />);
    expect(lastFrame()).toContain('(new)');
  });

  it('truncates long titles', () => {
    formStackStore
      .getState()
      .push(createDraft('item-1', 'This is a very long title that should be truncated'));
    formStackStore.getState().push(createDraft('item-2', 'Short'));

    const { lastFrame } = render(<Breadcrumbs maxTitleLength={20} />);
    expect(lastFrame()).toContain('...');
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/Breadcrumbs.test.tsx`
Expected: FAIL with "Cannot find module './Breadcrumbs.js'"

**Step 3: Write minimal implementation**

```typescript
// src/components/Breadcrumbs.tsx
import { Box, Text } from 'ink';
import { useFormStackStore } from '../stores/formStackStore.js';

interface BreadcrumbsProps {
  maxTitleLength?: number;
}

export function Breadcrumbs({ maxTitleLength = 30 }: BreadcrumbsProps) {
  const stack = useFormStackStore((s) => s.stack);

  if (stack.length <= 1) {
    return null;
  }

  const truncate = (title: string) => {
    if (title.length <= maxTitleLength) return title;
    return title.slice(0, maxTitleLength - 3) + '...';
  };

  return (
    <Box marginBottom={1}>
      {stack.map((draft, index) => (
        <Text key={index} dimColor={index < stack.length - 1}>
          {index > 0 && <Text dimColor> › </Text>}
          {truncate(draft.itemTitle)}
        </Text>
      ))}
    </Box>
  );
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/components/Breadcrumbs.test.tsx`
Expected: PASS

**Step 5: Commit**

```bash
git add src/components/Breadcrumbs.tsx src/components/Breadcrumbs.test.tsx
git commit -m "feat(components): add Breadcrumbs for form navigation stack"
```

---

## Task 4: Migrate WorkItemList to listViewStore

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Update imports and replace useState calls**

Replace these lines at the top of `WorkItemList.tsx`:

```typescript
// Old imports to remove:
// import { useState, useMemo, useEffect, useCallback } from 'react';

// New imports:
import { useMemo, useEffect, useCallback } from 'react';
```

Add new import:

```typescript
import { listViewStore, useListViewStore } from '../stores/listViewStore.js';
```

**Step 2: Replace useState declarations with store selectors**

Remove these useState calls (around lines 62-69):

```typescript
// REMOVE:
const [cursor, setCursor] = useState(0);
const [markedIds, setMarkedIds] = useState<Set<string>>(() => new Set());
const [expandedIds, setExpandedIds] = useState<Set<string>>(() => new Set<string>());
```

Replace with store selectors:

```typescript
const cursor = useListViewStore((s) => s.cursor);
const markedIds = useListViewStore((s) => s.markedIds);
const expandedIds = useListViewStore((s) => s.expandedIds);
const { setCursor, toggleExpanded, toggleMarked, clearMarked, clampCursor, removeDeletedItem } =
  listViewStore.getState();
```

**Step 3: Update cursor manipulation calls**

Replace `setCursor((c) => ...)` patterns with direct store calls:

```typescript
// Old: setCursor((c) => Math.max(0, c - 1));
// New: setCursor(Math.max(0, cursor - 1));

// Old: setCursor((c) => Math.min(treeItems.length - 1, c + 1));
// New: setCursor(Math.min(treeItems.length - 1, cursor + 1));
```

**Step 4: Update expand/collapse logic**

Replace `setExpandedIds` calls:

```typescript
// Old: setExpandedIds((prev) => new Set(prev).add(current.item.id));
// New: toggleExpanded(current.item.id);

// Old: setExpandedIds((prev) => { const next = new Set(prev); next.delete(current.item.id); return next; });
// New: toggleExpanded(current.item.id);
```

**Step 5: Update marked items logic**

Replace `setMarkedIds` calls:

```typescript
// Old toggle:
// setMarkedIds((prev) => { const next = new Set(prev); if (next.has(itemId)) { next.delete(itemId); } else { next.add(itemId); } return next; });
// New:
toggleMarked(itemId);

// Old clear:
// setMarkedIds(new Set());
// New:
clearMarked();
```

**Step 6: Update delete handler to clean up store**

In the delete confirmation handler, add store cleanup:

```typescript
// After deleting items, clean up the store:
for (const id of targetIds) {
  removeDeletedItem(id);
}
```

**Step 7: Update useEffect for cursor clamping**

Replace the cursor clamping effect:

```typescript
// Old:
useEffect(() => {
  setCursor((c) => Math.min(c, Math.max(0, treeItems.length - 1)));
}, [treeItems.length]);

// New:
useEffect(() => {
  clampCursor(treeItems.length - 1);
}, [treeItems.length]);
```

**Step 8: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 9: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(WorkItemList): migrate to listViewStore"
```

---

## Task 5: Migrate WorkItemForm to formStackStore — Part 1 (State)

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

This is a large migration. We'll do it in parts.

**Step 1: Add new imports**

```typescript
import {
  formStackStore,
  useFormStackStore,
  type FormFields,
  type FormDraft,
} from '../stores/formStackStore.js';
import { Breadcrumbs } from './Breadcrumbs.js';
```

**Step 2: Remove local form field useState calls**

Remove these (around lines 194-207):

```typescript
// REMOVE all of these:
const [title, setTitle] = useState('');
const [type, setType] = useState(activeType ?? types[0] ?? '');
const [status, setStatus] = useState(statuses[0] ?? '');
const [iteration, setIteration] = useState(currentIteration);
const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
const [assignee, setAssignee] = useState('');
const [labels, setLabels] = useState('');
const [description, setDescription] = useState('');
const [parentId, setParentId] = useState('');
const [dependsOn, setDependsOn] = useState('');
const [newComment, setNewComment] = useState('');
```

**Step 3: Add store selectors for form fields**

```typescript
const currentDraft = useFormStackStore((s) => s.currentDraft());
const showDiscardPrompt = useFormStackStore((s) => s.showDiscardPrompt);
const isDirty = useFormStackStore((s) => s.isDirty());
const stackDepth = useFormStackStore((s) => s.stack.length);

const { updateFields, setFocusedField, setShowDiscardPrompt, push, pop, clear } =
  formStackStore.getState();

// Derive field values from current draft (with fallbacks for initial render)
const title = currentDraft?.fields.title ?? '';
const type = currentDraft?.fields.type ?? activeType ?? types[0] ?? '';
const status = currentDraft?.fields.status ?? statuses[0] ?? '';
const iteration = currentDraft?.fields.iteration ?? currentIteration;
const priority = currentDraft?.fields.priority ?? 'medium';
const assignee = currentDraft?.fields.assignee ?? '';
const labels = currentDraft?.fields.labels ?? '';
const description = currentDraft?.fields.description ?? '';
const parentId = currentDraft?.fields.parentId ?? '';
const dependsOn = currentDraft?.fields.dependsOn ?? '';
const newComment = currentDraft?.fields.newComment ?? '';
const focusedField = currentDraft?.focusedField ?? 0;
```

**Step 4: Create field setter helpers**

```typescript
const setTitle = (v: string) => updateFields({ title: v });
const setType = (v: string) => updateFields({ type: v });
const setStatus = (v: string) => updateFields({ status: v });
const setIteration = (v: string) => updateFields({ iteration: v });
const setPriority = (v: string) => updateFields({ priority: v });
const setAssignee = (v: string) => updateFields({ assignee: v });
const setLabels = (v: string) => updateFields({ labels: v });
const setDescription = (v: string) => updateFields({ description: v });
const setParentId = (v: string) => updateFields({ parentId: v });
const setDependsOn = (v: string) => updateFields({ dependsOn: v });
const setNewComment = (v: string) => updateFields({ newComment: v });
```

**Step 5: Remove old focusedField useState and dirty tracking**

Remove these:

```typescript
// REMOVE:
const [focusedField, setFocusedField] = useState(0);
const [initialSnapshot, setInitialSnapshot] = useState<FormSnapshot | null>(null);
const currentValues = createSnapshot({...});
const isDirty = initialSnapshot !== null && !isSnapshotEqual(initialSnapshot, currentValues);
```

The focusedField is now from the store, and isDirty comes from `useFormStackStore`.

**Step 6: Keep these local state items (they're ephemeral UI state)**

```typescript
const [editing, setEditing] = useState(false);
const [preEditValue, setPreEditValue] = useState<string>('');
const [pendingRelNav, setPendingRelNav] = useState<string | null>(null);
const [saving, setSaving] = useState(false);
```

Note: `showDirtyPrompt` is now from the store, so remove:
```typescript
// REMOVE:
const [showDirtyPrompt, setShowDirtyPrompt] = useState(false);
```

**Step 7: Commit partial progress**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "refactor(WorkItemForm): migrate form fields to formStackStore (part 1)"
```

---

## Task 6: Migrate WorkItemForm to formStackStore — Part 2 (Lifecycle)

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Initialize draft on mount**

Add an effect to push initial draft when entering the form:

```typescript
// Initialize form draft when entering form screen
useEffect(() => {
  // Only push if stack is empty (fresh entry) or navigating to new item
  if (formStackStore.getState().stack.length === 0) {
    const initialFields: FormFields = {
      title: '',
      type: activeType ?? types[0] ?? '',
      status: statuses[0] ?? '',
      iteration: currentIteration,
      priority: 'medium',
      assignee: '',
      labels: '',
      description: '',
      parentId: '',
      dependsOn: '',
      newComment: '',
    };

    const draft: FormDraft = {
      itemId: selectedWorkItemId,
      itemTitle: selectedWorkItemId ? `#${selectedWorkItemId}` : '(new)',
      fields: initialFields,
      initialSnapshot: { ...initialFields },
      focusedField: 0,
    };

    push(draft);
  }
}, []); // Run once on mount
```

**Step 2: Update draft when existing item loads**

Modify the existing `useEffect` that syncs form fields:

```typescript
useEffect(() => {
  if (!existingItem) return;

  const fields: FormFields = {
    title: existingItem.title,
    type: existingItem.type,
    status: existingItem.status,
    iteration: existingItem.iteration,
    priority: existingItem.priority ?? 'medium',
    assignee: existingItem.assignee ?? '',
    labels: existingItem.labels.join(', '),
    description: existingItem.description ?? '',
    parentId: /* existing parentId logic */,
    dependsOn: /* existing dependsOn logic */,
    newComment: '',
  };

  // Update current draft with loaded data
  formStackStore.setState((state) => {
    if (state.stack.length === 0) return state;
    const updated = [...state.stack];
    const current = updated[updated.length - 1]!;
    updated[updated.length - 1] = {
      ...current,
      itemTitle: existingItem.title,
      fields,
      initialSnapshot: { ...fields },
    };
    return { stack: updated };
  });

  setComments(existingItem.comments ?? []);
}, [existingItem]);
```

**Step 3: Update navigation handlers to use stack**

Modify the relationship navigation to push drafts:

```typescript
// When navigating to a related item:
if (targetId) {
  if (isDirty) {
    setPendingRelNav(targetId);
    setShowDiscardPrompt(true);
  } else {
    // Push current draft and create new one for target
    const targetItem = allItems.find((i) => i.id === targetId);
    const newDraft: FormDraft = {
      itemId: targetId,
      itemTitle: targetItem?.title ?? `#${targetId}`,
      fields: {
        title: '',
        type: activeType ?? types[0] ?? '',
        status: statuses[0] ?? '',
        iteration: currentIteration,
        priority: 'medium',
        assignee: '',
        labels: '',
        description: '',
        parentId: '',
        dependsOn: '',
        newComment: '',
      },
      initialSnapshot: { /* same as fields */ },
      focusedField: 0,
    };
    push(newDraft);
    navigationStore.getState().selectWorkItem(targetId);
  }
}
```

**Step 4: Update save handler to pop and navigate**

After saving:

```typescript
// In save():
// ... existing save logic ...

// After successful save:
const popped = pop();
if (formStackStore.getState().stack.length > 0) {
  // Restore previous draft
  const prev = formStackStore.getState().currentDraft();
  if (prev) {
    navigationStore.getState().selectWorkItem(prev.itemId);
  }
} else {
  // Stack empty, go to list
  navigate('list');
}
```

**Step 5: Update cancel/escape handler**

```typescript
// On escape (clean):
const popped = pop();
if (formStackStore.getState().stack.length > 0) {
  const prev = formStackStore.getState().currentDraft();
  if (prev) {
    navigationStore.getState().selectWorkItem(prev.itemId);
  }
} else {
  navigate('list');
}
```

**Step 6: Clear stack when leaving form**

Update navigationStore's navigate function or add cleanup:

```typescript
// When navigating away from form to list:
if (newScreen === 'list') {
  formStackStore.getState().clear();
}
```

**Step 7: Run tests**

Run: `npm test`
Expected: All tests pass

**Step 8: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "refactor(WorkItemForm): migrate lifecycle to formStackStore (part 2)"
```

---

## Task 7: Add Breadcrumbs to WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Import Breadcrumbs**

Already added in Task 5.

**Step 2: Add Breadcrumbs to JSX**

Insert after the header Box, before the fields:

```typescript
return (
  <Box flexDirection="column">
    <Box marginBottom={1}>
      <Text bold color="cyan">
        {mode}
        {typeLabel ? ` ${typeLabel}` : ''}
        {formMode !== 'template' && selectedWorkItemId !== null
          ? ` #${selectedWorkItemId}`
          : ''}
      </Text>
    </Box>

    <Breadcrumbs />  {/* ADD THIS LINE */}

    {fields.map((field, index) => {
      // ... rest of render
    })}
```

**Step 3: Run the app manually to verify**

Run: `npm start`
- Create item A, navigate to edit
- Click on a related item to push
- Verify breadcrumb appears: "Item A › Item B"
- Save Item B, verify auto-pop back to Item A
- Escape with dirty changes, verify prompt appears

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(WorkItemForm): add breadcrumb navigation bar"
```

---

## Task 8: Update navigationStore to clear form stack

**Files:**
- Modify: `src/stores/navigationStore.ts`
- Modify: `src/stores/navigationStore.test.ts`

**Step 1: Write the failing test**

Add to `navigationStore.test.ts`:

```typescript
import { formStackStore } from './formStackStore.js';

// In beforeEach:
formStackStore.getState().clear();

describe('navigate', () => {
  // ... existing tests ...

  it('clears form stack when navigating away from form', () => {
    formStackStore.getState().push({
      itemId: 'item-1',
      itemTitle: 'Test',
      fields: { /* ... */ },
      initialSnapshot: { /* ... */ },
      focusedField: 0,
    });
    navigationStore.setState({ screen: 'form' });
    navigationStore.getState().navigate('list');
    expect(formStackStore.getState().stack).toHaveLength(0);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run src/stores/navigationStore.test.ts`
Expected: FAIL

**Step 3: Update navigationStore implementation**

```typescript
import { formStackStore } from './formStackStore.js';

// In navigate():
navigate: (newScreen: Screen) => {
  uiStore.getState().reset();
  const clearStack = newScreen !== 'form';
  if (clearStack) {
    formStackStore.getState().clear();
  }
  set((state) => ({
    screen: newScreen,
    navigationStack: clearStack ? [] : state.navigationStack,
  }));
},
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run src/stores/navigationStore.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/stores/navigationStore.ts src/stores/navigationStore.test.ts
git commit -m "feat(navigationStore): clear form stack when leaving form"
```

---

## Task 9: Final integration and cleanup

**Files:**
- Modify: `src/components/WorkItemForm.tsx` (remove unused imports)
- Run full test suite

**Step 1: Remove unused imports from WorkItemForm**

Remove imports that are no longer needed:

```typescript
// Remove if no longer used:
import { createSnapshot, isSnapshotEqual, type FormSnapshot } from './formSnapshot.js';
```

**Step 2: Run full test suite**

Run: `npm test`
Expected: All 551+ tests pass

**Step 3: Run linter and formatter**

Run: `npm run lint && npm run format:check`
Expected: No errors

**Step 4: Run build**

Run: `npm run build`
Expected: Clean build

**Step 5: Manual testing**

Run: `npm start`

Test scenarios:
1. List → Form → List: cursor position preserved
2. List → Form → List: expanded nodes preserved
3. List → Form → List: marked items preserved
4. Form → Related Item → Save → Auto-pop back
5. Form → Related Item → Escape (dirty) → Discard prompt → Pop back
6. Form → Related Item → Related Item → Breadcrumbs show 3 levels
7. Delete item: removed from expanded and marked sets

**Step 6: Final commit**

```bash
git add -A
git commit -m "feat: complete persistent UI state migration

- listViewStore persists cursor, expanded, marked across screens
- formStackStore enables nested form editing with auto-pop
- Breadcrumbs component shows navigation depth
- Form stack cleared when leaving form screen"
```

---

## Summary

| Task | Description | Est. Time |
|------|-------------|-----------|
| 1 | Create listViewStore | 10 min |
| 2 | Create formStackStore | 15 min |
| 3 | Create Breadcrumbs component | 10 min |
| 4 | Migrate WorkItemList to listViewStore | 20 min |
| 5 | Migrate WorkItemForm state to formStackStore | 25 min |
| 6 | Migrate WorkItemForm lifecycle | 25 min |
| 7 | Add Breadcrumbs to form | 5 min |
| 8 | Update navigationStore integration | 10 min |
| 9 | Final integration and cleanup | 15 min |

**Total: ~2.5 hours**
