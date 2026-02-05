# Navigation Store Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Replace React Context (AppContext) with Zustand stores, eliminating Context entirely.

**Architecture:** Add `backend`/`syncManager` to existing `backendDataStore`. Create new `navigationStore` for screen routing, work item selection, and form context. Migrate all consumers from `useAppState()` to individual store selectors.

**Tech Stack:** Zustand (vanilla store pattern), TypeScript, React/Ink

---

### Task 1: Add backend/syncManager to backendDataStore

**Files:**
- Modify: `src/stores/backendDataStore.ts`

**Step 1: Update BackendDataState interface**

Add to the interface (around line 8):

```typescript
interface BackendDataState {
  // Existing fields...
  items: WorkItem[];
  statuses: string[];
  iterations: string[];
  types: string[];
  assignees: string[];
  labels: string[];
  capabilities: BackendCapabilities | null;
  currentIteration: string | null;
  loading: boolean;
  error: string | null;
  syncStatus: SyncStatus | null;

  // NEW: Backend references
  backend: Backend | null;
  syncManager: SyncManager | null;

  // Existing methods...
}
```

**Step 2: Update createBackendDataStore defaults**

Add to the initial state (around line 30):

```typescript
backend: null,
syncManager: null,
```

**Step 3: Update init() to set backend/syncManager**

Modify init() to store the references:

```typescript
init: (backend: Backend, syncManager: SyncManager | null) => {
  const state = get();
  if (state.backend) return; // Already initialized

  set({ backend, syncManager });

  // ... rest of existing init logic
},
```

**Step 4: Update destroy() to clear backend/syncManager**

Add to destroy():

```typescript
destroy: () => {
  // ... existing cleanup
  set({
    backend: null,
    syncManager: null,
    // ... existing reset
  });
},
```

**Step 5: Run tests**

Run: `npm test -- src/stores/backendDataStore.test.ts`
Expected: All existing tests pass

**Step 6: Commit**

```bash
git add src/stores/backendDataStore.ts
git commit -m "feat(stores): add backend and syncManager to backendDataStore"
```

---

### Task 2: Create navigationStore

**Files:**
- Create: `src/stores/navigationStore.ts`

**Step 1: Create the store file**

```typescript
import { createStore, useStore } from 'zustand';
import type { Template } from '../types.js';
import type { UpdateInfo } from '../update-checker.js';
import { uiStore } from './uiStore.js';

export type Screen =
  | 'list'
  | 'form'
  | 'iteration-picker'
  | 'settings'
  | 'status'
  | 'help';

interface NavigationState {
  // Screen routing
  screen: Screen;
  previousScreen: Screen;

  // Work item selection
  selectedWorkItemId: string | null;
  navigationStack: string[];

  // Form context
  activeType: string | null;
  activeTemplate: Template | null;
  formMode: 'item' | 'template';
  editingTemplateSlug: string | null;

  // Update info
  updateInfo: UpdateInfo | null;

  // Actions
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
  reset: () => void;
}

const initialState = {
  screen: 'list' as Screen,
  previousScreen: 'list' as Screen,
  selectedWorkItemId: null,
  navigationStack: [],
  activeType: null,
  activeTemplate: null,
  formMode: 'item' as const,
  editingTemplateSlug: null,
  updateInfo: null,
};

const createNavigationStore = () =>
  createStore<NavigationState>((set, get) => ({
    ...initialState,

    navigate: (newScreen: Screen) => {
      uiStore.getState().reset();
      const clearStack = newScreen !== 'form';
      set((state) => ({
        screen: newScreen,
        navigationStack: clearStack ? [] : state.navigationStack,
      }));
    },

    navigateToHelp: () => {
      set((state) => ({
        previousScreen: state.screen,
        screen: 'help',
      }));
    },

    navigateBackFromHelp: () => {
      set((state) => ({
        screen: state.previousScreen,
      }));
    },

    selectWorkItem: (id: string | null) => {
      set({ selectedWorkItemId: id });
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

    setActiveType: (type: string | null) => {
      set({ activeType: type });
    },

    setActiveTemplate: (template: Template | null) => {
      set({ activeTemplate: template });
    },

    setFormMode: (mode: 'item' | 'template') => {
      set({ formMode: mode });
    },

    setEditingTemplateSlug: (slug: string | null) => {
      set({ editingTemplateSlug: slug });
    },

    setUpdateInfo: (info: UpdateInfo | null) => {
      set({ updateInfo: info });
    },

    reset: () => {
      set(initialState);
    },
  }));

export const navigationStore = createNavigationStore();

export function useNavigationStore<T>(selector: (state: NavigationState) => T): T {
  return useStore(navigationStore, selector);
}
```

**Step 2: Verify build**

Run: `npm run build`
Expected: No errors

**Step 3: Commit**

```bash
git add src/stores/navigationStore.ts
git commit -m "feat(stores): create navigationStore for screen routing"
```

---

### Task 3: Add navigationStore tests

**Files:**
- Create: `src/stores/navigationStore.test.ts`

**Step 1: Write the tests**

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { navigationStore } from './navigationStore.js';
import { uiStore } from './uiStore.js';

beforeEach(() => {
  navigationStore.getState().reset();
  uiStore.getState().reset();
});

describe('navigationStore', () => {
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
      navigationStore.setState({
        screen: 'form',
        navigationStack: ['item-1', 'item-2'],
      });
      navigationStore.getState().navigate('list');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('preserves navigation stack when navigating to form', () => {
      navigationStore.setState({ navigationStack: ['item-1'] });
      navigationStore.getState().navigate('form');
      expect(navigationStore.getState().navigationStack).toEqual(['item-1']);
    });
  });

  describe('navigateToHelp / navigateBackFromHelp', () => {
    it('saves previous screen and navigates to help', () => {
      navigationStore.setState({ screen: 'settings' });
      navigationStore.getState().navigateToHelp();
      expect(navigationStore.getState().screen).toBe('help');
      expect(navigationStore.getState().previousScreen).toBe('settings');
    });

    it('returns to previous screen', () => {
      navigationStore.setState({ screen: 'help', previousScreen: 'settings' });
      navigationStore.getState().navigateBackFromHelp();
      expect(navigationStore.getState().screen).toBe('settings');
    });
  });

  describe('selectWorkItem', () => {
    it('sets selected work item id', () => {
      navigationStore.getState().selectWorkItem('item-123');
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-123');
    });

    it('clears selected work item id', () => {
      navigationStore.setState({ selectedWorkItemId: 'item-123' });
      navigationStore.getState().selectWorkItem(null);
      expect(navigationStore.getState().selectedWorkItemId).toBeNull();
    });
  });

  describe('pushWorkItem', () => {
    it('pushes current item to stack and selects new', () => {
      navigationStore.setState({ selectedWorkItemId: 'item-1' });
      navigationStore.getState().pushWorkItem('item-2');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-2');
      expect(navigationStore.getState().navigationStack).toEqual(['item-1']);
    });

    it('does not push null to stack', () => {
      navigationStore.setState({ selectedWorkItemId: null });
      navigationStore.getState().pushWorkItem('item-1');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('builds up navigation stack', () => {
      navigationStore.getState().pushWorkItem('item-1');
      navigationStore.getState().pushWorkItem('item-2');
      navigationStore.getState().pushWorkItem('item-3');

      expect(navigationStore.getState().selectedWorkItemId).toBe('item-3');
      expect(navigationStore.getState().navigationStack).toEqual([
        'item-1',
        'item-2',
      ]);
    });
  });

  describe('popWorkItem', () => {
    it('pops from stack and returns previous item', () => {
      navigationStore.setState({
        selectedWorkItemId: 'item-2',
        navigationStack: ['item-1'],
      });

      const prev = navigationStore.getState().popWorkItem();

      expect(prev).toBe('item-1');
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
      expect(navigationStore.getState().navigationStack).toEqual([]);
    });

    it('returns null when stack is empty', () => {
      navigationStore.setState({
        selectedWorkItemId: 'item-1',
        navigationStack: [],
      });

      const prev = navigationStore.getState().popWorkItem();

      expect(prev).toBeNull();
      expect(navigationStore.getState().selectedWorkItemId).toBe('item-1');
    });
  });

  describe('form context setters', () => {
    it('sets activeType', () => {
      navigationStore.getState().setActiveType('bug');
      expect(navigationStore.getState().activeType).toBe('bug');
    });

    it('sets activeTemplate', () => {
      const template = { slug: 'test', name: 'Test', description: '' };
      navigationStore.getState().setActiveTemplate(template);
      expect(navigationStore.getState().activeTemplate).toEqual(template);
    });

    it('sets formMode', () => {
      navigationStore.getState().setFormMode('template');
      expect(navigationStore.getState().formMode).toBe('template');
    });

    it('sets editingTemplateSlug', () => {
      navigationStore.getState().setEditingTemplateSlug('my-template');
      expect(navigationStore.getState().editingTemplateSlug).toBe('my-template');
    });

    it('sets updateInfo', () => {
      const info = { currentVersion: '1.0.0', latestVersion: '2.0.0' };
      navigationStore.getState().setUpdateInfo(info);
      expect(navigationStore.getState().updateInfo).toEqual(info);
    });
  });

  describe('reset', () => {
    it('resets all state to initial values', () => {
      navigationStore.setState({
        screen: 'settings',
        previousScreen: 'form',
        selectedWorkItemId: 'item-1',
        navigationStack: ['item-0'],
        activeType: 'bug',
        activeTemplate: { slug: 'test', name: 'Test', description: '' },
        formMode: 'template',
        editingTemplateSlug: 'my-template',
        updateInfo: { currentVersion: '1.0.0', latestVersion: '2.0.0' },
      });

      navigationStore.getState().reset();

      expect(navigationStore.getState().screen).toBe('list');
      expect(navigationStore.getState().previousScreen).toBe('list');
      expect(navigationStore.getState().selectedWorkItemId).toBeNull();
      expect(navigationStore.getState().navigationStack).toEqual([]);
      expect(navigationStore.getState().activeType).toBeNull();
      expect(navigationStore.getState().activeTemplate).toBeNull();
      expect(navigationStore.getState().formMode).toBe('item');
      expect(navigationStore.getState().editingTemplateSlug).toBeNull();
      expect(navigationStore.getState().updateInfo).toBeNull();
    });
  });
});
```

**Step 2: Run tests**

Run: `npm test -- src/stores/navigationStore.test.ts`
Expected: All tests pass

**Step 3: Commit**

```bash
git add src/stores/navigationStore.test.ts
git commit -m "test(stores): add navigationStore tests"
```

---

### Task 4: Migrate app.tsx

**Files:**
- Modify: `src/app.tsx`

**Step 1: Replace entire app.tsx**

```typescript
import { useEffect } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import { Settings } from './components/Settings.js';
import { StatusScreen } from './components/StatusScreen.js';
import { HelpScreen } from './components/HelpScreen.js';
import { Header } from './components/Header.js';
import type { Backend } from './backends/types.js';
import type { SyncManager } from './sync/SyncManager.js';
import { checkForUpdate } from './update-checker.js';
import { useConfigStore } from './stores/configStore.js';
import {
  navigationStore,
  useNavigationStore,
} from './stores/navigationStore.js';
import { backendDataStore } from './stores/backendDataStore.js';

// Re-export Screen type for consumers that need it
export type { Screen } from './stores/navigationStore.js';

export function App({
  backend,
  syncManager,
}: {
  backend: Backend;
  syncManager: SyncManager | null;
}) {
  const screen = useNavigationStore((s) => s.screen);
  const previousScreen = useNavigationStore((s) => s.previousScreen);
  const autoUpdate = useConfigStore((s) => s.config.autoUpdate);

  // Initialize backendDataStore with backend/syncManager
  useEffect(() => {
    backendDataStore.getState().init(backend, syncManager);
  }, [backend, syncManager]);

  // Update check on mount
  useEffect(() => {
    if (autoUpdate !== false) {
      void checkForUpdate().then((info) => {
        if (info) navigationStore.getState().setUpdateInfo(info);
      });
    }
  }, [autoUpdate]);

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

**Step 2: Verify build**

Run: `npm run build`
Expected: Build errors in consumer components (expected - we'll fix next)

**Step 3: Commit (WIP)**

```bash
git add src/app.tsx
git commit -m "refactor(app): migrate to navigationStore (WIP - consumers next)"
```

---

### Task 5: Migrate IterationPicker

**Files:**
- Modify: `src/components/IterationPicker.tsx`

**Step 1: Update imports and hook usage**

Replace the useAppState import and usage:

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';

// In the component, replace:
// const { backend, navigate, navigateToHelp } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const navigate = useNavigationStore((s) => s.navigate);
const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
```

**Step 2: Verify build**

Run: `npm run build`
Expected: Fewer errors (this file fixed)

**Step 3: Commit**

```bash
git add src/components/IterationPicker.tsx
git commit -m "refactor(IterationPicker): migrate to store selectors"
```

---

### Task 6: Migrate HelpScreen

**Files:**
- Modify: `src/components/HelpScreen.tsx`

**Step 1: Update imports and hook usage**

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';

// In the component, replace:
// const { backend, syncManager, navigateBackFromHelp } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigateBackFromHelp = useNavigationStore((s) => s.navigateBackFromHelp);
```

**Step 2: Commit**

```bash
git add src/components/HelpScreen.tsx
git commit -m "refactor(HelpScreen): migrate to store selectors"
```

---

### Task 7: Migrate StatusScreen

**Files:**
- Modify: `src/components/StatusScreen.tsx`

**Step 1: Update imports and hook usage**

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';

// In the component, replace:
// const { backend, syncManager, navigate, navigateToHelp } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigate = useNavigationStore((s) => s.navigate);
const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
```

**Step 2: Commit**

```bash
git add src/components/StatusScreen.tsx
git commit -m "refactor(StatusScreen): migrate to store selectors"
```

---

### Task 8: Migrate Settings

**Files:**
- Modify: `src/components/Settings.tsx`

**Step 1: Update imports and hook usage**

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
import { useBackendDataStore } from '../stores/backendDataStore.js';

// In the component, replace:
// const {
//   navigate,
//   navigateToHelp,
//   backend,
//   syncManager,
//   setFormMode,
//   setEditingTemplateSlug,
//   selectWorkItem,
// } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigate = useNavigationStore((s) => s.navigate);
const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
const setFormMode = useNavigationStore((s) => s.setFormMode);
const setEditingTemplateSlug = useNavigationStore((s) => s.setEditingTemplateSlug);
const selectWorkItem = useNavigationStore((s) => s.selectWorkItem);
```

**Step 2: Commit**

```bash
git add src/components/Settings.tsx
git commit -m "refactor(Settings): migrate to store selectors"
```

---

### Task 9: Migrate WorkItemList

**Files:**
- Modify: `src/components/WorkItemList.tsx`

**Step 1: Update imports and hook usage**

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
// Note: useBackendDataStore is likely already imported

// In the component, replace:
// const {
//   backend,
//   syncManager,
//   navigate,
//   navigateToHelp,
//   selectWorkItem,
//   activeType,
//   setActiveType,
//   setActiveTemplate,
//   setFormMode,
//   updateInfo,
// } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigate = useNavigationStore((s) => s.navigate);
const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
const selectWorkItem = useNavigationStore((s) => s.selectWorkItem);
const activeType = useNavigationStore((s) => s.activeType);
const setActiveType = useNavigationStore((s) => s.setActiveType);
const setActiveTemplate = useNavigationStore((s) => s.setActiveTemplate);
const setFormMode = useNavigationStore((s) => s.setFormMode);
const updateInfo = useNavigationStore((s) => s.updateInfo);
```

**Step 2: Commit**

```bash
git add src/components/WorkItemList.tsx
git commit -m "refactor(WorkItemList): migrate to store selectors"
```

---

### Task 10: Migrate WorkItemForm

**Files:**
- Modify: `src/components/WorkItemForm.tsx`

**Step 1: Update imports and hook usage**

```typescript
// Remove this:
import { useAppState } from '../app.js';

// Add these:
import { useNavigationStore } from '../stores/navigationStore.js';
// Note: useBackendDataStore is likely already imported

// In the component, replace:
// const {
//   backend,
//   syncManager,
//   navigate,
//   navigateToHelp,
//   selectedWorkItemId,
//   activeType,
//   activeTemplate,
//   setActiveTemplate,
//   formMode,
//   setFormMode,
//   editingTemplateSlug,
//   setEditingTemplateSlug,
//   pushWorkItem,
//   popWorkItem,
// } = useAppState();

// With:
const backend = useBackendDataStore((s) => s.backend);
const syncManager = useBackendDataStore((s) => s.syncManager);
const navigate = useNavigationStore((s) => s.navigate);
const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
const selectedWorkItemId = useNavigationStore((s) => s.selectedWorkItemId);
const activeType = useNavigationStore((s) => s.activeType);
const activeTemplate = useNavigationStore((s) => s.activeTemplate);
const setActiveTemplate = useNavigationStore((s) => s.setActiveTemplate);
const formMode = useNavigationStore((s) => s.formMode);
const setFormMode = useNavigationStore((s) => s.setFormMode);
const editingTemplateSlug = useNavigationStore((s) => s.editingTemplateSlug);
const setEditingTemplateSlug = useNavigationStore((s) => s.setEditingTemplateSlug);
const pushWorkItem = useNavigationStore((s) => s.pushWorkItem);
const popWorkItem = useNavigationStore((s) => s.popWorkItem);
```

**Step 2: Commit**

```bash
git add src/components/WorkItemForm.tsx
git commit -m "refactor(WorkItemForm): migrate to store selectors"
```

---

### Task 11: Final cleanup and verification

**Files:**
- Verify: All files

**Step 1: Build**

Run: `npm run build`
Expected: No errors

**Step 2: Run all tests**

Run: `npm test`
Expected: All tests pass

**Step 3: Run format and lint**

Run: `npm run format && npm run lint`
Expected: No errors

**Step 4: Verify no remaining useAppState imports**

Run: `grep -r "useAppState" src/`
Expected: No matches (or only the commented-out old code if any)

**Step 5: Final commit**

```bash
git add -A
git commit -m "refactor: complete migration from AppContext to Zustand stores

- Add backend/syncManager to backendDataStore
- Create navigationStore for screen routing and form context
- Migrate all consumers to individual store selectors
- Remove AppContext entirely

BREAKING: useAppState() is no longer exported from app.tsx"
```

---

### Task 12: Update Header component (if needed)

**Files:**
- Check: `src/components/Header.tsx`

**Step 1: Check if Header uses useAppState**

Run: `grep "useAppState" src/components/Header.tsx`

If it does, migrate it the same way as other components. If not, this task is complete.

**Step 2: Commit if changes made**

```bash
git add src/components/Header.tsx
git commit -m "refactor(Header): migrate to store selectors"
```
