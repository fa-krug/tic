import { Box, Text, useInput } from 'ink';
import SelectInput from 'ink-select-input';
import { useAppState } from '../app.js';
import { useBackendData } from '../hooks/useBackendData.js';

export function IterationPicker() {
  const { backend, navigate, navigateToHelp } = useAppState();
  const {
    iterations,
    currentIteration: current,
    loading,
  } = useBackendData(backend);

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
            await backend.setCurrentIteration(item.value);
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
