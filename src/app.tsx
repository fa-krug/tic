import { useEffect } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { WorkItemForm } from './components/WorkItemForm.js';
import { IterationPicker } from './components/IterationPicker.js';
import { Settings } from './components/Settings.js';
import { StatusScreen } from './components/StatusScreen.js';
import { HelpScreen } from './components/HelpScreen.js';
import { Header } from './components/Header.js';
import { checkForUpdate } from './update-checker.js';
import { useConfigStore } from './stores/configStore.js';
import {
  navigationStore,
  useNavigationStore,
} from './stores/navigationStore.js';

// Re-export Screen type for consumers that need it
export type { Screen } from './stores/navigationStore.js';

export function App() {
  const screen = useNavigationStore((s) => s.screen);
  const previousScreen = useNavigationStore((s) => s.previousScreen);
  const autoUpdate = useConfigStore((s) => s.config.autoUpdate);

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
