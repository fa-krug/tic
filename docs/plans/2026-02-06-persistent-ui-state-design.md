# Persistent UI State Design

## Problem

UI state is lost during screen transitions:
- List view: cursor position, expanded nodes, marked items, scroll offset reset when navigating to form and back
- Form view: draft edits lost when navigating to related items

## Solution

Two new Zustand stores to persist UI state across screen transitions:
1. **listViewStore** — list-specific state
2. **formStackStore** — stack of form drafts for nested editing

## Data Model

### listViewStore

```typescript
interface ListViewState {
  cursor: number;              // selected row index
  expandedIds: Set<string>;    // expanded tree nodes
  markedIds: Set<string>;      // bulk-selected items
  scrollOffset: number;        // vertical scroll position
}

interface ListViewActions {
  setCursor: (index: number) => void;
  clampCursor: (maxIndex: number) => void;
  toggleExpanded: (id: string) => void;
  toggleMarked: (id: string) => void;
  clearMarked: () => void;
  setScrollOffset: (offset: number) => void;
  removeDeletedItem: (id: string) => void;  // cleanup expanded/marked
}
```

### formStackStore

```typescript
interface FormFields {
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

interface FormDraft {
  itemId: string | null;       // null = new item
  itemTitle: string;           // for breadcrumb display
  fields: FormFields;
  initialSnapshot: FormFields; // for dirty detection
  focusedField: number;        // cursor position in form
}

interface FormStackState {
  stack: FormDraft[];
  showDiscardPrompt: boolean;
}

interface FormStackActions {
  push: (draft: FormDraft) => void;
  pop: () => FormDraft | undefined;
  updateFields: (fields: Partial<FormFields>) => void;
  setFocusedField: (index: number) => void;
  isDirty: () => boolean;
  setShowDiscardPrompt: (show: boolean) => void;
  clear: () => void;
  currentDraft: () => FormDraft | undefined;
}
```

## Behavior

### List View State

**Persistence:**
- State persists for app lifetime (not saved to disk)
- Survives List → Form → List transitions
- Survives List → Settings → List transitions

**Cursor management:**
- When items refresh, clamp cursor to valid range
- When selected item is deleted, cursor stays at same index (or moves to last)

**Expanded nodes:**
- Toggle via `e` key (existing behavior)
- When parent deleted, remove from `expandedIds`

**Marked items:**
- Persist across screen transitions
- Clear after bulk operation completes
- When marked item deleted, remove from `markedIds`

### Form Stack

**Pushing (navigate to related item):**
1. Capture current form state as `FormDraft`
2. Push onto stack
3. Create new draft for target item (load from backend or empty for new)
4. Stay on form screen, now showing new draft

**Saving:**
1. Persist to backend (existing logic)
2. Pop current draft
3. If stack non-empty → restore previous draft, stay on form
4. If stack empty → navigate to list

**Canceling (Escape):**
1. Compare fields to `initialSnapshot`
2. If dirty → show discard prompt
3. On confirm (or not dirty) → pop draft
4. Restore previous draft or navigate to list

**Circular navigation:**
- Allowed (A → B → A creates separate draft snapshots)

## Breadcrumb Bar

**Display:**
- Shown at top of form when stack depth > 1
- Format: `Item A › Item B › Item C`
- Current item is last, not interactive
- New items show `(new)`
- Long titles truncated with ellipsis

**Example:**
```
Fix auth bug › Add login form › (new)
─────────────────────────────────────────
Title: [                    ]
```

**Interaction:**
- Display-only (no clicking in terminal)
- `Escape` goes back one level (with discard prompt if dirty)
- Footer hint: `Esc: Back`

## Implementation

### New Files

| File | Purpose |
|------|---------|
| `src/stores/listViewStore.ts` | Cursor, expanded, marked, scroll state |
| `src/stores/formStackStore.ts` | Draft stack, discard prompt state |
| `src/components/Breadcrumbs.tsx` | Breadcrumb bar component |

### Changes to Existing Files

| File | Changes |
|------|---------|
| `WorkItemList.tsx` | Replace `useState` for cursor, expandedIds, markedIds with store selectors |
| `WorkItemForm.tsx` | Replace `useState` for form fields with store; add push/pop on relationship nav |
| `navigationStore.ts` | Remove `formContext` (now in formStackStore) |

### What Stays Local

- `existingItem`, `children`, `dependents`, `parentItem` — loaded fresh from backend
- Inline picker overlays — ephemeral UI state

## Migration Strategy

1. Create `listViewStore` with current shape
2. Swap `WorkItemList` useState → store selectors
3. Create `formStackStore` with current shape
4. Swap `WorkItemForm` useState → store selectors
5. Add breadcrumb component
6. Wire push/pop on relationship navigation and save/cancel
7. Remove `formContext` from navigationStore

## Testing

- Unit tests for store actions (push, pop, dirty detection, clamp)
- Integration tests for List → Form → List state preservation
- Integration tests for nested form navigation with save/cancel flows
