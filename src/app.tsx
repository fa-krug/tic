import { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import type { Backend } from './backends/types.js';

type Screen = 'list' | 'form' | 'iteration-picker';

interface AppState {
  screen: Screen;
  selectedWorkItemId: number | null;
  activeType: string | null;
  backend: Backend;
  navigate: (screen: Screen) => void;
  selectWorkItem: (id: number | null) => void;
  setActiveType: (type: string | null) => void;
}

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({ backend }: { backend: Backend }) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedWorkItemId, setSelectedWorkItemId] = useState<number | null>(
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
      </Box>
    </AppContext.Provider>
  );
}
