import { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import { Settings } from './components/Settings.js';
import type { Backend } from './backends/types.js';

type Screen = 'list' | 'form' | 'iteration-picker' | 'settings';

interface AppState {
  screen: Screen;
  selectedWorkItemId: string | null;
  activeType: string | null;
  backend: Backend;
  navigate: (screen: Screen) => void;
  selectWorkItem: (id: string | null) => void;
  setActiveType: (type: string | null) => void;
}

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({ backend }: { backend: Backend }) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<string | null>(
    null,
  );
  const [activeType, setActiveType] = useState<string | null>(null);

  const state: AppState = {
    screen,
    selectedWorkItemId,
    activeType,
    backend,
    navigate: setScreen,
    selectWorkItem: setSelectedWorkItemId,
    setActiveType,
  };

  return (
    <AppContext.Provider value={state}>
      <Box flexDirection="column">
        {screen === 'list' && <WorkItemList />}
        {screen === 'form' && <WorkItemForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
        {screen === 'settings' && <Settings />}
      </Box>
    </AppContext.Provider>
  );
}
