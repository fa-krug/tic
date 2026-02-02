import { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import { Settings } from './components/Settings.js';
import { StatusScreen } from './components/StatusScreen.js';
import { Header } from './components/Header.js';
import type { Backend } from './backends/types.js';
import type { SyncManager } from './sync/SyncManager.js';

type Screen = 'list' | 'form' | 'iteration-picker' | 'settings' | 'status';

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

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({
  backend,
  syncManager,
}: {
  backend: Backend;
  syncManager: SyncManager | null;
}) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(
    null,
  );
  const [activeType, setActiveType] = useState<string | null>(null);
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

  const navigateWithStackClear = (newScreen: Screen) => {
    if (newScreen !== 'form') {
      setNavigationStack([]);
    }
    setScreen(newScreen);
  };

  const state: AppState = {
    screen,
    selectedWorkItemId,
    activeType,
    backend,
    syncManager,
    navigationStack,
    navigate: navigateWithStackClear,
    selectWorkItem: setSelectedWorkItemId,
    setActiveType,
    pushWorkItem,
    popWorkItem,
  };

  return (
    <AppContext.Provider value={state}>
      <Box flexDirection="column">
        {screen === 'list' && <Header />}
        {screen === 'list' && <WorkItemList />}
        {screen === 'form' && <WorkItemForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
        {screen === 'settings' && <Settings />}
        {screen === 'status' && <StatusScreen />}
      </Box>
    </AppContext.Provider>
  );
}
