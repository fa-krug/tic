# Navigable Relationships in Work Item Form

## Problem

The relationships section at the bottom of the work item form (parent, children, depended on by) is read-only text. Users can see related items but cannot navigate to them without going back to the list and finding them manually.

## Design

### Interaction Model

The relationships section becomes a list of selectable items that participate in the form's existing focus/navigation system.

When the user arrows down past the last editable field, focus enters the relationships section. Within that section:

- **Up/Down arrows** move between individual relationship items
- **Enter** navigates to that item's form view, pushing the current item onto a navigation stack
- **Escape** pops the stack (returns to previous item's form, or to list view if stack is empty)

Group headers (Parent, Children, Depended on by) are labels only, not focusable.

### Navigation Stack

A navigation stack lives in `AppContext` alongside existing `screen` and `selectedWorkItemId` state:

```typescript
navigationStack: string[]
```

**Opening a related item:**
1. Push current `selectedWorkItemId` onto `navigationStack`
2. Set `selectedWorkItemId` to the target item's ID
3. Stay on `form` screen

**Pressing Escape in the form:**
- Stack non-empty: pop last ID, set as `selectedWorkItemId` (stay on form)
- Stack empty: navigate to `list` (unchanged from today)

Expose a `pushWorkItem(id: string)` helper from AppContext.

### Dynamic Field Types

Relationship entries are appended to the existing `fields` array as new field types:

- `rel-parent` — single entry if parent exists
- `rel-child-{id}` — one per child
- `rel-dependent-{id}` — one per dependent

These fields are not editable. Pressing Enter triggers navigation instead of entering edit mode.

### Rendering

Each relationship item renders with the same focus style as form fields (`>` cursor, cyan highlight when focused):

```
  Relationships:
    Parent:
      > #12 (Epic: User auth)
    Children:
        #15 (Add login page)
        #16 (Add signup page)
    Depended on by:
        #20 (Deploy auth service)
```

Groups with no items are hidden. If no relationships exist, the entire section is omitted.

## Files to Change

- `src/app.tsx` — Add `navigationStack` state and `pushWorkItem` helper to AppContext
- `src/components/WorkItemForm.tsx` — Add relationship field types to `fields` array, render selectable items, handle Enter for navigation, modify Escape to use stack
