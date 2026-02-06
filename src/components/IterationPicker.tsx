import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useNavigationStore } from '../stores/navigationStore.js';
import {
  useBackendDataStore,
  backendDataStore,
} from '../stores/backendDataStore.js';

export function IterationPicker() {
  const backend = useBackendDataStore((s) => s.backend);
  const navigate = useNavigationStore((s) => s.navigate);
  const navigateToHelp = useNavigationStore((s) => s.navigateToHelp);
  const iterations = useBackendDataStore((s) => s.iterations);
  const current = useBackendDataStore((s) => s.currentIteration);
  const loading = useBackendDataStore((s) => s.loading);

  useInput((input, key) => {
    if (key.escape) {
      navigate('list');
    }
    if (input === '?') {
      navigateToHelp();
    }
  });

  if (loading) {
    return (
      <Box>
        <Text dimColor>Loading...</Text>
      </Box>
    );
  }

  const items = iterations.map((it) => ({
    label: it === current ? `${it} (current)` : it,
    value: it,
  }));

  return (
    <Box flexDirection="column">
      <Box marginBottom={1}>
        <Text bold>Switch Iteration</Text>
      </Box>
      <SelectInput
        items={items}
        initialIndex={iterations.indexOf(current)}
        onSelect={(item) => {
          void (async () => {
            if (!backend) return;
            await backend.setCurrentIteration(item.value);
            await backendDataStore.getState().refresh();
            navigate('list');
          })();
        }}
      />
      <Box marginTop={1}>
        <Text dimColor>{'↑↓ navigate  enter select  esc back  ? help'}</Text>
      </Box>
    </Box>
  );
}
