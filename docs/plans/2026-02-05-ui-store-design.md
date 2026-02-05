# UIStore Design: Centralized Overlay State Management

## Problem

WorkItemList has 11 overlay-related `useState` hooks and an 8-line guard chain of `if (X) return;` to enforce "only one overlay at a time." Settings has 4 more overlay states with its own guard pattern. This creates:

- **State sprawl**: 15 boolean/array `useState` hooks across two components just for overlay visibility
- **Fragile guards**: Correctness depends on careful ordering of early returns in `useInput`
- **Awkward cascades**: Bulk menu → picker transitions require manual "close X, open Y" with multiple `setState` calls
- **Duplicated target tracking**: `deleteTargetIds`, `parentTargetIds`, `bulkTargetIds` serve the same purpose — "which items does this overlay operate on?"
- **No cleanup on navigation**: Switching screens doesn't close overlays — each component manages its own teardown

## Design

### Discriminated Union

Replace 15 booleans with a single `activeOverlay` field using a discriminated union. When `null`, no overlay is active. TypeScript narrows the type automatically.

```typescript
type ActiveOverlay =
  // WorkItemList overlays
  | { type: 'search' }
  | { type: 'command-palette' }
  | { type: 'bulk-menu' }
  | { type: 'delete-confirm'; targetIds: string[] }
  | { type: 'template-picker' }
  | { type: 'status-picker'; targetIds: string[] }
  | { type: 'type-picker'; targetIds: string[] }
  | { type: 'priority-picker'; targetIds: string[] }
  | { type: 'parent-input'; targetIds: string[] }
  | { type: 'assignee-input'; targetIds: string[] }
  | { type: 'labels-input'; targetIds: string[] }
  // Settings overlays
  | { type: 'default-type-picker' }
  | { type: 'default-iteration-picker' }
  | { type: 'delete-template-confirm'; templateSlug: string }
  | { type: 'settings-edit' };
```

### Store Shape

```typescript
interface UIStoreState {
  activeOverlay: ActiveOverlay | null;
  warning: string;

  openOverlay: (overlay: ActiveOverlay) => void;
  closeOverlay: () => void;
  setWarning: (msg: string) => void;
  clearWarning: () => void;
  reset: () => void;
}
```

### Store Implementation

Follows the existing singleton pattern from `configStore` and `backendDataStore`:

```typescript
// src/stores/uiStore.ts
import { createStore } from 'zustand/vanilla';
import { useStore } from 'zustand';

const uiStore = createStore<UIStoreState>((set) => ({
  activeOverlay: null,
  warning: '',

  openOverlay: (overlay) => set({ activeOverlay: overlay }),
  closeOverlay: () => set({ activeOverlay: null }),
  setWarning: (msg) => set({ warning: msg }),
  clearWarning: () => set({ warning: '' }),
  reset: () => set({ activeOverlay: null, warning: '' }),
}));

export { uiStore };
export const useUIStore = <T>(selector: (s: UIStoreState) => T): T =>
  useStore(uiStore, selector);
```

No `init()`/`destroy()` lifecycle needed — pure UI state with no side effects, file watchers, or backend connections.

### Key Design Decisions

**Input values stay local.** The text values for inline inputs (`parentInput`, `assigneeInput`, `labelsInput`) remain as local component state in the `AutocompleteInput`/`MultiAutocompleteInput` components. The store owns visibility + target IDs, not every keystroke. This avoids high-frequency store updates.

**`openOverlay` implicitly closes the previous overlay.** This makes the bulk menu cascade a single call instead of two separate `setState` calls. Opening a priority picker from the bulk menu is just `openOverlay({ type: 'priority-picker', targetIds })` — no need to manually close the bulk menu first.

**`reset()` for clean slate.** Unlike `destroy()` on other stores (which tears down file watchers and listeners), `reset()` just clears state. Used for screen navigation cleanup and test isolation.

**Cross-screen safety.** Only one screen renders at a time, so WorkItemList and Settings overlays share the same `activeOverlay` slot without conflict. Screen navigation calls `reset()` to guarantee no stale overlays.

## Usage Patterns

### Rendering overlays (WorkItemList)

```typescript
const activeOverlay = useUIStore((s) => s.activeOverlay);

if (activeOverlay?.type === 'search') return <SearchOverlay ... />;
if (activeOverlay?.type === 'command-palette') return <CommandPalette ... />;

// Picker overlays
if (activeOverlay?.type === 'priority-picker') {
  return <PriorityPicker
    targetIds={activeOverlay.targetIds}  // narrowed by discriminant
    onSelect={...}
    onCancel={() => uiStore.getState().closeOverlay()}
  />;
}
```

### Input guard (replaces 8 if-returns)

```typescript
const overlayActive = useUIStore((s) => s.activeOverlay !== null);

useInput((input, key) => {
  // ... normal key handling, only runs when no overlay active
}, { isActive: !overlayActive });
```

### Bulk menu cascade

```typescript
// BulkMenu selects "Set priority" → one call does it all
const handleBulkAction = (action: string) => {
  const { openOverlay } = uiStore.getState();
  if (action === 'priority') {
    openOverlay({ type: 'priority-picker', targetIds: markedIds });
    // bulk menu is implicitly closed
  }
};
```

### Settings overlays

```typescript
const activeOverlay = useUIStore((s) => s.activeOverlay);
const { openOverlay, closeOverlay } = uiStore.getState();

openOverlay({ type: 'default-type-picker' });

if (activeOverlay?.type === 'delete-template-confirm') {
  const slug = activeOverlay.templateSlug; // narrowed
}
```

### Navigation cleanup

```typescript
// In AppContext navigate()
uiStore.getState().reset();
```

## Migration Plan

### Step 1: Create the store
- `src/stores/uiStore.ts` — types, store, hook (~40 lines)
- `src/stores/uiStore.test.ts` — unit tests (~10 tests)

### Step 2: Migrate WorkItemList
Remove 11+ `useState` hooks:
- `isSearching`, `showCommandPalette`, `showBulkMenu`, `confirmDelete`, `deleteTargetIds`, `showStatusPicker`, `showTypePicker`, `showPriorityPicker`, `settingParent`, `parentTargetIds`, `settingAssignee`, `settingLabels`, `showTemplatePicker`, `bulkTargetIds`, `warning`

Keep local:
- `parentInput`, `assigneeInput`, `labelsInput` (transient input values)
- `cursor`, `markedIds`, `expandedIds` (list navigation state)
- `templates`, `allSearchItems` (data, not overlay state)

Replace the guard chain with single `isActive: !overlayActive`.

### Step 3: Migrate Settings
Remove 4 `useState` hooks:
- `showDefaultTypePicker`, `showDefaultIterationPicker`, `confirmDeleteTemplate`, `templateToDelete`

### Step 4: Wire up navigation cleanup
Add `uiStore.getState().reset()` in AppContext's `navigate` function.

## Testing Strategy

### Store unit tests (`src/stores/uiStore.test.ts`)
- `openOverlay` sets `activeOverlay` correctly
- `openOverlay` replaces a previously active overlay (cascade)
- `closeOverlay` resets to `null`
- `setWarning` / `clearWarning` work
- `reset()` clears all state

### Existing component tests
- Behavior is unchanged — pressing `/` still opens search, `Escape` closes it
- Tests assert rendered output and simulate input, not internal state
- No changes expected to pass

### Store cleanup between tests
```typescript
beforeEach(() => {
  uiStore.getState().reset();
});
```

## Impact

- **~15 useState hooks removed** across WorkItemList and Settings
- **Guard chain eliminated** — replaced by single `isActive` check
- **Cascade transitions simplified** — one `openOverlay` call instead of manual close-then-open
- **Navigation cleanup centralized** — `reset()` on screen change
- **Type-safe overlay data** — TypeScript narrows `targetIds`/`templateSlug` by discriminant
