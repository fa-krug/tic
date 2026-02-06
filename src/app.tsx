import { lazy, Suspense, useEffect } from 'react';
import { Box } from 'ink';
import { WorkItemList } from './components/WorkItemList.js';
import { Header } from './components/Header.js';
import { useConfigStore } from './stores/configStore.js';
import {
  navigationStore,
  useNavigationStore,
} from './stores/navigationStore.js';

// Re-export Screen type for consumers that need it
export type { Screen } from './stores/navigationStore.js';

// Lazy — loaded on demand when screen changes
const WorkItemForm = lazy(() =>
  import('./components/WorkItemForm.js').then((m) => ({
    default: m.WorkItemForm,
  })),
);
const IterationPicker = lazy(() =>
  import('./components/IterationPicker.js').then((m) => ({
    default: m.IterationPicker,
  })),
);
const Settings = lazy(() =>
  import('./components/Settings.js').then((m) => ({ default: m.Settings })),
);
const StatusScreen = lazy(() =>
  import('./components/StatusScreen.js').then((m) => ({
    default: m.StatusScreen,
  })),
);
const HelpScreen = lazy(() =>
  import('./components/HelpScreen.js').then((m) => ({
    default: m.HelpScreen,
  })),
);

export function App() {
  const screen = useNavigationStore((s) => s.screen);
  const previousScreen = useNavigationStore((s) => s.previousScreen);
  const autoUpdate = useConfigStore((s) => s.config.autoUpdate);

  // Update check on mount
  useEffect(() => {
    if (autoUpdate !== false) {
      void import('./update-checker.js').then(({ checkForUpdate }) =>
        checkForUpdate().then((info) => {
          if (info) navigationStore.getState().setUpdateInfo(info);
        }),
      );
    }
  }, [autoUpdate]);

  return (
    <Box flexDirection="column">
      <Header />
      {screen === 'list' && <WorkItemList />}
      <Suspense fallback={null}>
        {screen === 'form' && <WorkItemForm />}
        {screen === 'iteration-picker' && <IterationPicker />}
        {screen === 'settings' && <Settings />}
        {screen === 'status' && <StatusScreen />}
        {screen === 'help' && <HelpScreen sourceScreen={previousScreen} />}
      </Suspense>
    </Box>
  );
}
