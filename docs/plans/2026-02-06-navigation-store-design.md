# Navigation Store Design

## Overview

Replace React Context (`AppContext`) with a Zustand store for navigation state, and expose `backend`/`syncManager` from `backendDataStore`. This eliminates React Context entirely, enables selective re-rendering, and makes navigation logic unit-testable.

## Problem

`app.tsx` holds 9 pieces of state via `useState` and bundles them with `backend`/`syncManager` refs and 7 navigation methods into a single React Context. Issues:

1. **No selective re-rendering** — any state change triggers re-render of every consumer
2. **Untestable navigation logic** — methods are closures tied to React state
3. **Mixed concerns** — stable refs bundled with frequently changing state
4. **Inconsistent** — other state already in Zustand stores

## Solution

### Store Changes

**backendDataStore** — add `backend` and `syncManager`:

```ts
interface BackendDataState {
  // ... existing fields
  backend: Backend | null;
  syncManager: SyncManager | null;
}
```

**navigationStore** — new store:

```ts
interface NavigationState {
  screen: Screen;
  previousScreen: Screen;
  selectedWorkItemId: string | null;
  navigationStack: string[];
  activeType: string | null;
  activeTemplate: Template | null;
  formMode: 'item' | 'template';
  editingTemplateSlug: string | null;
  updateInfo: UpdateInfo | null;
}

interface NavigationActions {
  navigate: (screen: Screen) => void;
  navigateToHelp: () => void;
  navigateBackFromHelp: () => void;
  selectWorkItem: (id: string | null) => void;
  pushWorkItem: (id: string) => void;
  popWorkItem: () => string | null;
  setActiveType: (type: string | null) => void;
  setActiveTemplate: (template: Template | null) => void;
  setFormMode: (mode: 'item' | 'template') => void;
  setEditingTemplateSlug: (slug: string | null) => void;
  setUpdateInfo: (info: UpdateInfo | null) => void;
}
```

### app.tsx After Refactor

```tsx
export function App({
  backend,
  syncManager,
}: {
  backend: Backend;
  syncManager: SyncManager | null;
}) {
  const screen = useNavigationStore((s) => s.screen);
  const previousScreen = useNavigationStore((s) => s.previousScreen);
  const setUpdateInfo = useNavigationStore((s) => s.setUpdateInfo);
  const autoUpdate = useConfigStore((s) => s.config.autoUpdate);

  useEffect(() => {
    if (autoUpdate !== false) {
      void checkForUpdate().then((info) => {
        if (info) setUpdateInfo(info);
      });
    }
  }, [autoUpdate, setUpdateInfo]);

  return (
    <Box flexDirection="column">
      {screen === 'list' && <Header />}
      {screen === 'list' && <WorkItemList />}
      {screen === 'form' && <WorkItemForm />}
      {screen === 'iteration-picker' && <IterationPicker />}
      {screen === 'settings' && <Settings />}
      {screen === 'status' && <StatusScreen />}
      {screen === 'help' && <HelpScreen sourceScreen={previousScreen} />}
    </Box>
  );
}
```

Store initialization happens in `index.tsx` before `render()`, consistent with existing stores.

### Consumer Migration

Components switch from `useAppState()` to individual selectors:

```ts
// Before
const { backend, syncManager, navigate, activeType } = useAppState();

// After
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigate = useNavigationStore((s) => s.navigate);
const activeType = useNavigationStore((s) => s.activeType);
```

Individual selectors (not grouped objects) to match existing codebase patterns and avoid shallow-compare pitfalls.

### navigate() Implementation

```ts
navigate: (newScreen: Screen) => {
  uiStore.getState().reset();
  const clearStack = newScreen !== 'form';
  set((state) => ({
    screen: newScreen,
    navigationStack: clearStack ? [] : state.navigationStack,
  }));
},

pushWorkItem: (id: string) => {
  set((state) => ({
    navigationStack: state.selectedWorkItemId
      ? [...state.navigationStack, state.selectedWorkItemId]
      : state.navigationStack,
    selectedWorkItemId: id,
  }));
},

popWorkItem: () => {
  const { navigationStack } = get();
  if (navigationStack.length === 0) return null;
  const prev = navigationStack[navigationStack.length - 1]!;
  set((state) => ({
    navigationStack: state.navigationStack.slice(0, -1),
    selectedWorkItemId: prev,
  }));
  return prev;
},
```

## Files Changed

| File | Change |
|------|--------|
| `src/stores/backendDataStore.ts` | Add `backend`, `syncManager` to state |
| `src/stores/navigationStore.ts` | New file |
| `src/stores/navigationStore.test.ts` | New file |
| `src/index.tsx` | Initialize stores before render |
| `src/app.tsx` | Remove Context, use store selectors |
| `src/components/WorkItemList.tsx` | Switch to store selectors |
| `src/components/WorkItemForm.tsx` | Switch to store selectors |
| `src/components/Settings.tsx` | Switch to store selectors |
| `src/components/IterationPicker.tsx` | Switch to store selectors |
| `src/components/StatusScreen.tsx` | Switch to store selectors |
| `src/components/HelpScreen.tsx` | Switch to store selectors |

## Migration Order

1. Add `backend`/`syncManager` to backendDataStore
2. Create navigationStore with tests
3. Update index.tsx initialization
4. Migrate app.tsx (remove Context)
5. Migrate consumers one at a time (smallest first)
6. Delete AppContext exports

Each step is independently committable.

## Testing

Navigation logic becomes unit-testable without React:

```ts
describe('navigate', () => {
  it('changes screen', () => {
    navigationStore.getState().navigate('settings');
    expect(navigationStore.getState().screen).toBe('settings');
  });

  it('resets UI overlays', () => {
    uiStore.getState().openOverlay({ kind: 'search' });
    navigationStore.getState().navigate('settings');
    expect(uiStore.getState().activeOverlay).toBeNull();
  });

  it('clears navigation stack when leaving form', () => {
    navigationStore.setState({ screen: 'form', navigationStack: ['item-1'] });
    navigationStore.getState().navigate('list');
    expect(navigationStore.getState().navigationStack).toEqual([]);
  });
});

describe('pushWorkItem / popWorkItem', () => {
  it('pushes current item to stack', () => {
    navigationStore.setState({ selectedWorkItemId: 'item-1' });
    navigationStore.getState().pushWorkItem('item-2');
    expect(navigationStore.getState().navigationStack).toEqual(['item-1']);
    expect(navigationStore.getState().selectedWorkItemId).toBe('item-2');
  });

  it('pops and returns previous item', () => {
    navigationStore.setState({
      selectedWorkItemId: 'item-2',
      navigationStack: ['item-1']
    });
    const prev = navigationStore.getState().popWorkItem();
    expect(prev).toBe('item-1');
    expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
  });
});
```

## Benefits

- **Selective re-rendering**: Components subscribe only to fields they use
- **Testable navigation**: Pure state logic, no React required
- **No Context**: One fewer pattern, consistent Zustand everywhere
- **Consistent**: Matches configStore, backendDataStore, uiStore patterns
- **Simpler app.tsx**: Just renders screens, no state management
