# Navigable Relationships Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make parent, children, and dependents selectable in the work item form so users can navigate between related items.

**Architecture:** Add a navigation stack to AppContext for back-navigation. Extend the form's `fields` array with relationship entry types that trigger navigation on Enter instead of edit mode.

**Tech Stack:** TypeScript, React 19, Ink 6

---

### Task 1: Add navigation stack to AppContext

**Files:**
- Modify: `src/app.tsx:12-51`

**Step 1: Add `navigationStack` and `pushWorkItem` to AppState interface**

In `src/app.tsx`, update the `AppState` interface (lines 12-21) to add the new members:

```typescript
interface AppState {
  screen: Screen;
  selectedWorkItemId: string | null;
  activeType: string | null;
  backend: Backend;
  syncManager: SyncManager | null;
  navigationStack: string[];
  navigate: (screen: Screen) => void;
  selectWorkItem: (id: string | null) => void;
  setActiveType: (type: string | null) => void;
  pushWorkItem: (id: string) => void;
  popWorkItem: () => string | null;
}
```

**Step 2: Add state and helpers in the App component**

In `src/app.tsx`, inside the `App` function (after line 40), add:

```typescript
const [navigationStack, setNavigationStack] = useState<string[]>([]);

const pushWorkItem = (id: string) => {
  if (selectedWorkItemId !== null) {
    setNavigationStack((stack) => [...stack, selectedWorkItemId]);
  }
  setSelectedWorkItemId(id);
};

const popWorkItem = (): string | null => {
  if (navigationStack.length === 0) return null;
  const prev = navigationStack[navigationStack.length - 1]!;
  setNavigationStack((stack) => stack.slice(0, -1));
  setSelectedWorkItemId(prev);
  return prev;
};
```

**Step 3: Wire into the state object**

Update the `state` object (lines 42-51) to include the new members:

```typescript
const state: AppState = {
  screen,
  selectedWorkItemId,
  activeType,
  backend,
  syncManager,
  navigationStack,
  navigate: setScreen,
  selectWorkItem: setSelectedWorkItemId,
  setActiveType,
  pushWorkItem,
  popWorkItem,
};
```

**Step 4: Build and verify no type errors**

Run: `npm run build`
Expected: Success (WorkItemForm doesn't use the new fields yet, so no breakage)

**Step 5: Commit**

```bash
git add src/app.tsx
git commit -m "feat(ui): add navigation stack to AppContext for form back-navigation"
```

---

### Task 2: Add relationship field types to the form's fields array

**Files:**
- Modify: `src/components/WorkItemForm.tsx:10-21,53-66`

**Step 1: Extend the FieldName type**

In `src/components/WorkItemForm.tsx`, update the `FieldName` type (lines 10-21) to include a catch-all for relationship fields:

```typescript
type FieldName =
  | 'title'
  | 'type'
  | 'status'
  | 'iteration'
  | 'priority'
  | 'assignee'
  | 'labels'
  | 'description'
  | 'parent'
  | 'dependsOn'
  | 'comments'
  | `rel-parent`
  | `rel-child-${string}`
  | `rel-dependent-${string}`;
```

**Step 2: Build relationship fields dynamically**

In `src/components/WorkItemForm.tsx`, update the `fields` useMemo (lines 53-66). The relationship fields depend on having an existing item and the `relationships` capability. Add after the existing field logic:

```typescript
const fields = useMemo(() => {
  const all: FieldName[] = ['title'];
  if (capabilities.customTypes) all.push('type');
  all.push('status');
  if (capabilities.iterations) all.push('iteration');
  if (capabilities.fields.priority) all.push('priority');
  if (capabilities.fields.assignee) all.push('assignee');
  if (capabilities.fields.labels) all.push('labels');
  all.push('description');
  if (capabilities.fields.parent) all.push('parent');
  if (capabilities.fields.dependsOn) all.push('dependsOn');
  if (capabilities.comments) all.push('comments');

  if (selectedWorkItemId !== null && capabilities.relationships) {
    const item = backend.getWorkItem(selectedWorkItemId);
    if (item.parent) {
      all.push('rel-parent');
    }
    const children = backend.getChildren(selectedWorkItemId);
    for (const child of children) {
      all.push(`rel-child-${child.id}`);
    }
    const dependents = backend.getDependents(selectedWorkItemId);
    for (const dep of dependents) {
      all.push(`rel-dependent-${dep.id}`);
    }
  }

  return all;
}, [capabilities, selectedWorkItemId, backend]);
```

**Step 3: Build and verify no type errors**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(ui): add relationship field types to form fields array"
```

---

### Task 3: Render selectable relationship items

**Files:**
- Modify: `src/components/WorkItemForm.tsx:292-437,442-477`

**Step 1: Add a `renderRelationshipField` function**

Add a new function after the existing `renderField` function. This renders a single relationship item with focus styling:

```typescript
function renderRelationshipField(field: FieldName, index: number) {
  const focused = index === focusedField;
  const cursor = focused ? '>' : ' ';
  const id = field.startsWith('rel-child-')
    ? field.slice('rel-child-'.length)
    : field.startsWith('rel-dependent-')
      ? field.slice('rel-dependent-'.length)
      : null;

  let item: { id: string; title: string };
  if (field === 'rel-parent' && existingItem?.parent) {
    const parentItem = backend.getWorkItem(existingItem.parent);
    item = { id: parentItem.id, title: parentItem.title };
  } else if (id) {
    const relItem = backend.getWorkItem(id);
    item = { id: relItem.id, title: relItem.title };
  } else {
    return null;
  }

  return (
    <Box key={field}>
      <Text color={focused ? 'cyan' : undefined}>{cursor}   </Text>
      <Text bold={focused} color={focused ? 'cyan' : undefined}>
        #{item.id} ({item.title})
      </Text>
    </Box>
  );
}
```

**Step 2: Replace the static relationships section with grouped selectable items**

Replace the relationships rendering block (lines 453-477) and integrate it into the fields map (line 451). The approach: render relationship fields inline within `fields.map()`, injecting group headers before the first item of each group:

```typescript
{fields.map((field, index) => {
  if (field === 'rel-parent' || field.startsWith('rel-child-') || field.startsWith('rel-dependent-')) {
    return null; // rendered separately below
  }
  return renderField(field, index);
})}

{selectedWorkItemId !== null && capabilities.relationships && fields.some((f) => f.startsWith('rel-')) && (
  <Box flexDirection="column" marginTop={1}>
    <Text bold dimColor>Relationships:</Text>

    {existingItem?.parent && (
      <Box flexDirection="column">
        <Box marginLeft={2}>
          <Text dimColor>Parent:</Text>
        </Box>
        {fields.map((field, index) =>
          field === 'rel-parent' ? (
            <Box key={field} marginLeft={2}>
              {renderRelationshipField(field, index)}
            </Box>
          ) : null,
        )}
      </Box>
    )}

    {fields.some((f) => f.startsWith('rel-child-')) && (
      <Box flexDirection="column">
        <Box marginLeft={2}>
          <Text dimColor>Children:</Text>
        </Box>
        {fields.map((field, index) =>
          field.startsWith('rel-child-') ? (
            <Box key={field} marginLeft={2}>
              {renderRelationshipField(field, index)}
            </Box>
          ) : null,
        )}
      </Box>
    )}

    {fields.some((f) => f.startsWith('rel-dependent-')) && (
      <Box flexDirection="column">
        <Box marginLeft={2}>
          <Text dimColor>Depended on by:</Text>
        </Box>
        {fields.map((field, index) =>
          field.startsWith('rel-dependent-') ? (
            <Box key={field} marginLeft={2}>
              {renderRelationshipField(field, index)}
            </Box>
          ) : null,
        )}
      </Box>
    )}
  </Box>
)}
```

**Step 3: Build and verify no type errors**

Run: `npm run build`
Expected: Success

**Step 4: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "feat(ui): render selectable relationship items in form"
```

---

### Task 4: Handle Enter on relationship fields (navigate) and Escape with stack

**Files:**
- Modify: `src/components/WorkItemForm.tsx:182-208`

**Step 1: Update the useInput handler**

Replace the `useInput` callback (lines 182-208) to handle relationship fields differently on Enter, and use the navigation stack on Escape:

```typescript
const isRelationshipField = currentField === 'rel-parent' ||
  currentField.startsWith('rel-child-') ||
  currentField.startsWith('rel-dependent-');

useInput(
  (_input, key) => {
    if (!editing) {
      if (key.upArrow) {
        setFocusedField((f) => Math.max(0, f - 1));
      }

      if (key.downArrow) {
        setFocusedField((f) => Math.min(fields.length - 1, f + 1));
      }

      if (key.return) {
        if (isRelationshipField) {
          // Navigate to the related item
          let targetId: string | null = null;
          if (currentField === 'rel-parent' && existingItem?.parent) {
            targetId = existingItem.parent;
          } else if (currentField.startsWith('rel-child-')) {
            targetId = currentField.slice('rel-child-'.length);
          } else if (currentField.startsWith('rel-dependent-')) {
            targetId = currentField.slice('rel-dependent-'.length);
          }
          if (targetId) {
            save();
            pushWorkItem(targetId);
          }
        } else {
          setEditing(true);
        }
      }

      if (key.escape) {
        save();
        const prev = popWorkItem();
        if (prev === null) {
          navigate('list');
        }
      }
    } else {
      if (key.escape) {
        setEditing(false);
      }
    }
  },
  { isActive: !editing || !isSelectField },
);
```

**Step 2: Destructure `pushWorkItem` and `popWorkItem` from useAppState**

Update the destructuring at the top of the component (line 27-28):

```typescript
const { backend, syncManager, navigate, selectedWorkItemId, activeType, pushWorkItem, popWorkItem } =
  useAppState();
```

**Step 3: Update the help text to mention relationship navigation**

Update the help text (lines 479-486) to include relationship navigation hint:

```typescript
<Box marginTop={1}>
  <Text dimColor>
    {editing
      ? isSelectField
        ? 'up/down: navigate  enter: select'
        : 'type to edit  enter/esc: confirm'
      : isRelationshipField
        ? 'up/down: navigate  enter: open item  esc: save & back'
        : 'up/down: navigate  enter: edit field  esc: save & back'}
  </Text>
</Box>
```

**Step 4: Build and verify no type errors**

Run: `npm run build`
Expected: Success

**Step 5: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 6: Commit**

```bash
git add src/app.tsx src/components/WorkItemForm.tsx
git commit -m "feat(ui): navigate to related items from form with back-stack"
```

---

### Task 5: Clear navigation stack on screen transitions

**Files:**
- Modify: `src/app.tsx`

**Step 1: Clear the stack when navigating away from the form**

Wrap the `navigate` function to clear the stack when leaving the form screen:

```typescript
const navigateWithStackClear = (newScreen: Screen) => {
  if (newScreen !== 'form') {
    setNavigationStack([]);
  }
  setScreen(newScreen);
};
```

Use `navigateWithStackClear` instead of `setScreen` in the state object.

**Step 2: Build and run tests**

Run: `npm run build && npm test`
Expected: Success

**Step 3: Commit**

```bash
git add src/app.tsx
git commit -m "fix(ui): clear navigation stack when leaving form screen"
```

---

### Task 6: Lint, format, and final verification

**Step 1: Format and lint**

Run: `npm run format && npm run lint:fix`
Expected: No errors

**Step 2: Build**

Run: `npm run build`
Expected: Success

**Step 3: Run full test suite**

Run: `npm test`
Expected: All tests pass

**Step 4: Manual smoke test**

Run: `npm start`
- Create a parent item and a child item
- Open the child item form
- Arrow down to the Relationships section
- Verify parent is selectable with `>` cursor and cyan highlight
- Press Enter on the parent — should open the parent's form
- Press Escape — should return to the child's form
- Press Escape again — should return to the list

**Step 5: Commit any final fixes if needed**
