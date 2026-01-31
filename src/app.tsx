import { useState, createContext, useContext } from 'react';
import { Box } from 'ink';
import { IssueList } from './components/IssueList.js';
import { IssueForm } from './components/IssueForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import type { Backend } from './backends/types.js';

type Screen = 'list' | 'form' | 'iteration-picker';

interface AppState {
  screen: Screen;
  selectedIssueId: number | null;
  backend: Backend;
  navigate: (screen: Screen) => void;
  selectIssue: (id: number | null) => void;
}

export const AppContext = createContext<AppState>(null!);

export function useAppState() {
  return useContext(AppContext);
}

export function App({ backend }: { backend: Backend }) {
  const [screen, setScreen] = useState<Screen>('list');
  const [selectedIssueId, setSelectedIssueId] = useState<number | null>(null);

  const state: AppState = {
    screen,
    selectedIssueId,
    backend,
    navigate: setScreen,
    selectIssue: setSelectedIssueId,
  };

  return (
    <AppContext.Provider value={state}>
      <Box flexDirection="column">
        {screen === 'list' && <IssueList />}
        {screen === 'form' && <IssueForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
      </Box>
    </AppContext.Provider>
  );
}
